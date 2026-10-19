//! Teaching groups (块): correlation clustering over ownership scenarios.
//!
//! Algorithm (see `docs/modules/groups.md` + `docs/modules/tempo-sensitivity.md`):
//! 1. Build fate vectors \(d_i(s)=o_i^{(s)}-o_i^{\mathrm{root}}\) from deep scenarios.
//! 2. Drop stable points (\(\|\mathbf{d}_i\|_w < \varepsilon\)), keeping high-stdev exceptions.
//! 3. Hierarchical clustering (average linkage) on weighted cosine correlation, cut at \(r^\ast\).
//! 4. Analyze 4-connectivity inside each cluster; classify simple / contested / bound.
//! 5. Assign tempo status from root vs pass-probe strengths.
//!
//! Affinity has **no spatial term**. Scenario weights are equal (MVP) so the pass
//! probe is not drowned by high-visit candidates. Output is deterministic.

// Board sizes ≤25 ⇒ `usize as f64` for means is exact in practice.
#![allow(clippy::cast_precision_loss)]

mod cluster;
mod params;
mod tempo;

pub use params::GroupParams;

use crate::schema::{
    ColorToken, GroupKind, GroupMembers, GroupPart, GroupSnapshot, GroupSource, GroupStatus,
    GroupStrength, PositionSnapshot,
};
use cluster::{cluster_indices, correlation, fate_magnitude};
use tempo::{classify_status, side_strengths};
use yagoo_core::Point;

/// Compute teaching groups for a filled deep [`PositionSnapshot`].
///
/// Returns an empty vec when root ownership is missing or fewer than two scenarios
/// with ownership are available (nothing to correlate against).
#[must_use]
pub fn compute_groups(snap: &PositionSnapshot) -> Vec<GroupSnapshot> {
    compute_groups_with_params(snap, &GroupParams::default())
}

/// Same as [`compute_groups`] with explicit thresholds (for tests / tuning).
#[must_use]
pub fn compute_groups_with_params(
    snap: &PositionSnapshot,
    params: &GroupParams,
) -> Vec<GroupSnapshot> {
    let Some(root) = snap.root.as_ref() else {
        return Vec::new();
    };
    let Some(root_own) = root.ownership.as_ref() else {
        return Vec::new();
    };
    let size = snap.board.size;
    let n = usize::from(size) * usize::from(size);
    if root_own.len() != n {
        return Vec::new();
    }

    let scenarios = collect_scenarios(snap, n);
    if scenarios.len() < 2 {
        return Vec::new();
    }

    let stdev = root.ownership_stdev.as_deref();
    let weights: Vec<f64> = scenarios.iter().map(|s| s.weight).collect();
    let w_sum: f64 = weights.iter().sum();
    if w_sum <= 0.0 {
        return Vec::new();
    }

    let mut active: Vec<usize> = Vec::new();
    let mut fate: Vec<Vec<f64>> = Vec::new();
    for (i, &o_root) in root_own.iter().enumerate() {
        let d: Vec<f64> = scenarios.iter().map(|s| s.ownership[i] - o_root).collect();
        let mag = fate_magnitude(&d, &weights);
        let keep_stdev = stdev
            .and_then(|s| s.get(i).copied())
            .is_some_and(|s| s >= params.keep_stdev);
        if mag >= params.epsilon || keep_stdev {
            active.push(i);
            fate.push(d);
        }
    }

    if active.len() < params.n_min {
        return Vec::new();
    }

    let clusters = cluster_indices(&fate, &weights, params.r_star, params.gamma);
    let stone_color = board_color_map(snap);
    let chain_ids = chain_id_index(snap);

    let mut groups: Vec<GroupSnapshot> = Vec::new();
    for members_local in clusters {
        if members_local.len() < params.n_min {
            continue;
        }
        let member_indices: Vec<usize> = members_local.iter().map(|&li| active[li]).collect();
        if let Some(group) = build_group(
            snap,
            root_own,
            stdev,
            &scenarios,
            &weights,
            &fate,
            &members_local,
            &member_indices,
            &stone_color,
            &chain_ids,
            params,
        ) {
            groups.push(group);
        }
    }

    groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
    groups
}

struct Scenario {
    family: ScenarioFamily,
    ownership: Vec<f64>,
    weight: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum ScenarioFamily {
    Pass,
    Candidate,
    PvEnd,
}

fn collect_scenarios(snap: &PositionSnapshot, n: usize) -> Vec<Scenario> {
    let mut out = Vec::new();

    if let Some(pp) = snap.pass_probe.as_ref() {
        if let Some(own) = pp.ownership.as_ref() {
            if own.len() == n {
                out.push(Scenario {
                    family: ScenarioFamily::Pass,
                    ownership: own.clone(),
                    weight: 1.0,
                });
            }
        }
    }

    for c in &snap.candidates {
        if let Some(own) = c.ownership.as_ref() {
            if own.len() == n {
                out.push(Scenario {
                    family: ScenarioFamily::Candidate,
                    ownership: own.clone(),
                    weight: 1.0,
                });
            }
        }
    }

    for pv in &snap.pv_ends {
        if let Some(own) = pv.analysis.ownership.as_ref() {
            if own.len() == n {
                out.push(Scenario {
                    family: ScenarioFamily::PvEnd,
                    ownership: own.clone(),
                    weight: 1.0,
                });
            }
        }
    }

    out
}

fn board_color_map(snap: &PositionSnapshot) -> Vec<Option<ColorToken>> {
    let size = snap.board.size;
    let n = usize::from(size) * usize::from(size);
    let mut map = vec![None; n];
    for gtp in &snap.board.black {
        if let Ok(Some(p)) = Point::parse_gtp(gtp, size) {
            map[p.index(size)] = Some(ColorToken::B);
        }
    }
    for gtp in &snap.board.white {
        if let Ok(Some(p)) = Point::parse_gtp(gtp, size) {
            map[p.index(size)] = Some(ColorToken::W);
        }
    }
    map
}

fn chain_id_index(snap: &PositionSnapshot) -> Vec<Option<String>> {
    let size = snap.board.size;
    let n = usize::from(size) * usize::from(size);
    let mut map = vec![None; n];
    for chain in &snap.chains {
        let id = format_chain_id(chain.color, &chain.stones);
        for gtp in &chain.stones {
            if let Ok(Some(p)) = Point::parse_gtp(gtp, size) {
                map[p.index(size)] = Some(id.clone());
            }
        }
    }
    map
}

fn format_chain_id(color: ColorToken, stones: &[String]) -> String {
    let prefix = match color {
        ColorToken::B => "B",
        ColorToken::W => "W",
    };
    format!("{prefix}:{}", stones.join("-"))
}

#[allow(clippy::too_many_arguments)]
fn build_group(
    snap: &PositionSnapshot,
    root_own: &[f64],
    stdev: Option<&[f64]>,
    scenarios: &[Scenario],
    weights: &[f64],
    fate: &[Vec<f64>],
    members_local: &[usize],
    member_indices: &[usize],
    stone_color: &[Option<ColorToken>],
    chain_ids: &[Option<String>],
    params: &GroupParams,
) -> Option<GroupSnapshot> {
    let size = snap.board.size;
    let mut black_stones = Vec::new();
    let mut white_stones = Vec::new();
    let mut empty = Vec::new();
    let mut chain_set: Vec<String> = Vec::new();

    for &idx in member_indices {
        let Some(point) = Point::from_index(idx, size) else {
            continue;
        };
        let gtp = point.to_gtp(size);
        match stone_color[idx] {
            Some(ColorToken::B) => black_stones.push(gtp),
            Some(ColorToken::W) => white_stones.push(gtp),
            None => empty.push(gtp),
        }
        if let Some(cid) = chain_ids[idx].as_ref() {
            if !chain_set.iter().any(|c| c == cid) {
                chain_set.push(cid.clone());
            }
        }
    }
    black_stones.sort();
    white_stones.sort();
    empty.sort();
    chain_set.sort();

    // Empty-only clusters are open frameworks — zoning territory, not teaching 块.
    if black_stones.is_empty() && white_stones.is_empty() {
        return None;
    }

    let parts = connected_parts(member_indices, size, stone_color, chain_ids);
    let stone_count = black_stones.len() + white_stones.len();
    let contested = if stone_count == 0 {
        false
    } else {
        let b_share = black_stones.len() as f64 / stone_count as f64;
        let w_share = white_stones.len() as f64 / stone_count as f64;
        b_share >= params.contested_color_share && w_share >= params.contested_color_share
    };

    let (bound_confidence, binding_ok) = if parts.len() >= 2 {
        let conf = remote_binding_confidence(
            size,
            &parts,
            members_local,
            member_indices,
            fate,
            weights,
            scenarios,
            params,
        );
        (Some(conf), conf >= params.r_star)
    } else {
        (None, false)
    };

    let kind = if contested {
        GroupKind::Contested
    } else if parts.len() >= 2 && binding_ok {
        GroupKind::Bound
    } else {
        GroupKind::Simple
    };

    let cohesion = mean_pairwise_correlation(members_local, fate, weights);
    let certainty = mean_certainty(member_indices, stdev);
    let strength = group_strength(member_indices, root_own, stone_color);
    let (status, g_plus, g_minus, delta) = tempo_fields(
        snap,
        member_indices,
        stone_color,
        &strength,
        certainty,
        contested,
        params,
    );

    let group_id = representative_id(&black_stones, &white_stones, &empty);

    Some(GroupSnapshot {
        group_id,
        members: GroupMembers {
            black_stones,
            white_stones,
            empty,
        },
        chains: chain_set,
        parts,
        kind,
        strength: if strength.black.is_some() || strength.white.is_some() {
            Some(strength)
        } else {
            None
        },
        certainty: Some(certainty),
        cohesion: Some(cohesion),
        bound_confidence,
        status,
        g_plus,
        g_minus,
        delta,
        source: Some(GroupSource::Pipeline),
    })
}

fn connected_parts(
    member_indices: &[usize],
    size: u8,
    stone_color: &[Option<ColorToken>],
    chain_ids: &[Option<String>],
) -> Vec<GroupPart> {
    use std::collections::{BTreeSet, HashSet, VecDeque};

    let member_set: HashSet<usize> = member_indices.iter().copied().collect();
    let mut remaining: BTreeSet<usize> = member_indices.iter().copied().collect();
    let mut parts = Vec::new();

    while let Some(&start) = remaining.iter().next() {
        let mut queue = VecDeque::from([start]);
        remaining.remove(&start);
        let mut points = Vec::new();
        let mut part_chains: Vec<String> = Vec::new();

        while let Some(idx) = queue.pop_front() {
            points.push(idx);
            if let Some(cid) = chain_ids[idx].as_ref() {
                if stone_color[idx].is_some() && !part_chains.iter().any(|c| c == cid) {
                    part_chains.push(cid.clone());
                }
            }
            let Some(p) = Point::from_index(idx, size) else {
                continue;
            };
            for nb in p.neighbors(size) {
                let nidx = nb.index(size);
                if member_set.contains(&nidx) && remaining.remove(&nidx) {
                    queue.push_back(nidx);
                }
            }
        }

        let mut gtps: Vec<String> = points
            .iter()
            .filter_map(|&i| Point::from_index(i, size).map(|p| p.to_gtp(size)))
            .collect();
        gtps.sort();
        part_chains.sort();
        parts.push(GroupPart {
            points: gtps,
            chains: part_chains,
        });
    }

    parts.sort_by(|a, b| a.points.cmp(&b.points));
    parts
}

#[allow(clippy::too_many_arguments)]
fn remote_binding_confidence(
    size: u8,
    parts: &[GroupPart],
    members_local: &[usize],
    member_indices: &[usize],
    fate: &[Vec<f64>],
    weights: &[f64],
    scenarios: &[Scenario],
    params: &GroupParams,
) -> f64 {
    use std::collections::{HashMap, HashSet};

    if parts.len() < 2 {
        return 0.0;
    }

    // flat index → fate-row local index
    let mut flat_to_local: HashMap<usize, usize> = HashMap::new();
    for (&flat, &local) in member_indices.iter().zip(members_local.iter()) {
        flat_to_local.insert(flat, local);
    }

    let part_locals: Vec<Vec<usize>> = parts
        .iter()
        .map(|part| {
            let mut locals = Vec::new();
            for gtp in &part.points {
                if let Ok(Some(p)) = Point::parse_gtp(gtp, size) {
                    if let Some(&li) = flat_to_local.get(&p.index(size)) {
                        locals.push(li);
                    }
                }
            }
            locals.sort_unstable();
            locals
        })
        .collect();

    if part_locals.iter().any(|l| l.len() < params.n_min) {
        // Fail size gate → weak binding score (mean cross-r capped below r*).
        return cross_part_mean_r(&part_locals, fate, weights).min(params.r_star - 1e-6);
    }

    // Mean pairwise r across every pair of parts.
    let mean_r = cross_part_mean_r(&part_locals, fate, weights);

    // Scenario-type gate: ≥2 families show same-direction |mean d| ≥ binding_delta on every part.
    let mut families_ok: HashSet<ScenarioFamily> = HashSet::new();
    for (si, sc) in scenarios.iter().enumerate() {
        let means: Vec<f64> = part_locals
            .iter()
            .map(|locals| {
                if locals.is_empty() {
                    0.0
                } else {
                    locals.iter().map(|&li| fate[li][si]).sum::<f64>() / locals.len() as f64
                }
            })
            .collect();
        if means.len() < 2 {
            continue;
        }
        let first_sign = means[0].signum();
        let ok = means
            .iter()
            .all(|&m| m.abs() >= params.binding_delta && (m.signum() - first_sign).abs() < 1e-12);
        if ok {
            families_ok.insert(sc.family);
        }
    }

    if mean_r >= params.r_star && families_ok.len() >= 2 {
        mean_r
    } else {
        mean_r.min(params.r_star - 1e-6).max(0.0)
    }
}

fn cross_part_mean_r(part_locals: &[Vec<usize>], fate: &[Vec<f64>], weights: &[f64]) -> f64 {
    let mut sum = 0.0;
    let mut count = 0_usize;
    for a in 0..part_locals.len() {
        for b in (a + 1)..part_locals.len() {
            for &i in &part_locals[a] {
                for &j in &part_locals[b] {
                    sum += correlation(&fate[i], &fate[j], weights);
                    count += 1;
                }
            }
        }
    }
    if count == 0 {
        0.0
    } else {
        sum / count as f64
    }
}

fn mean_pairwise_correlation(members_local: &[usize], fate: &[Vec<f64>], weights: &[f64]) -> f64 {
    if members_local.len() < 2 {
        return 1.0;
    }
    let mut sum = 0.0;
    let mut count = 0_usize;
    for a in 0..members_local.len() {
        for b in (a + 1)..members_local.len() {
            sum += correlation(&fate[members_local[a]], &fate[members_local[b]], weights);
            count += 1;
        }
    }
    if count == 0 {
        1.0
    } else {
        sum / count as f64
    }
}

fn mean_certainty(member_indices: &[usize], stdev: Option<&[f64]>) -> f64 {
    let Some(s) = stdev else {
        return 1.0;
    };
    if member_indices.is_empty() {
        return 1.0;
    }
    let sum: f64 = member_indices
        .iter()
        .map(|&i| 1.0 - s.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.0))
        .sum();
    sum / member_indices.len() as f64
}

fn group_strength(
    member_indices: &[usize],
    ownership: &[f64],
    stone_color: &[Option<ColorToken>],
) -> GroupStrength {
    let mut b_sum = 0.0;
    let mut b_n = 0_usize;
    let mut w_sum = 0.0;
    let mut w_n = 0_usize;
    for &i in member_indices {
        match stone_color[i] {
            Some(ColorToken::B) => {
                b_sum += ownership[i];
                b_n += 1;
            }
            Some(ColorToken::W) => {
                w_sum += -ownership[i];
                w_n += 1;
            }
            None => {}
        }
    }
    GroupStrength {
        black: if b_n > 0 {
            Some(b_sum / b_n as f64)
        } else {
            None
        },
        white: if w_n > 0 {
            Some(w_sum / w_n as f64)
        } else {
            None
        },
    }
}

fn tempo_fields(
    snap: &PositionSnapshot,
    member_indices: &[usize],
    stone_color: &[Option<ColorToken>],
    root_strength: &GroupStrength,
    certainty: f64,
    contested: bool,
    params: &GroupParams,
) -> (Option<GroupStatus>, Option<f64>, Option<f64>, Option<f64>) {
    let Some(pass) = snap.pass_probe.as_ref().and_then(|p| p.ownership.as_ref()) else {
        return (None, None, None, None);
    };
    let pass_strength = group_strength(member_indices, pass, stone_color);
    let to_play = snap.to_play;
    let sides: Vec<ColorToken> = if contested {
        vec![ColorToken::B, ColorToken::W]
    } else if root_strength.black.is_some() {
        vec![ColorToken::B]
    } else if root_strength.white.is_some() {
        vec![ColorToken::W]
    } else {
        return (None, None, None, None);
    };

    let stone_count = member_indices
        .iter()
        .filter(|&&i| stone_color.get(i).copied().flatten().is_some())
        .count();

    let mut best: Option<(GroupStatus, f64, f64, f64, f64)> = None;
    for side in sides {
        let (g_plus, g_minus) = side_strengths(side, to_play, root_strength, &pass_strength);
        let delta = g_plus - g_minus;
        let status = classify_status(g_plus, g_minus, certainty, stone_count, params);
        let urgency = delta.abs();
        let replace = match &best {
            None => true,
            Some((_, _, _, _, u)) => urgency > *u + 1e-15,
        };
        if replace {
            best = Some((status, g_plus, g_minus, delta, urgency));
        }
    }

    best.map_or((None, None, None, None), |(s, gp, gm, d, _)| {
        (Some(s), Some(gp), Some(gm), Some(d))
    })
}

fn representative_id(black: &[String], white: &[String], empty: &[String]) -> String {
    black
        .iter()
        .chain(white.iter())
        .chain(empty.iter())
        .min()
        .cloned()
        .unwrap_or_else(|| "G0".into())
}

#[cfg(test)]
mod tests;
