//! Ownership attribution for a move and a reference at the same root position.
//!
//! See `docs/modules/gain-loss-ledger.md`. This module never subtracts analyses
//! of successive game positions. Candidate maps are `movesOwnership`; the pass
//! reference is the explicit root pass probe.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use yagoo_core::Point;

use crate::{
    CandidateSnapshot, ColorToken, ComparisonGroupTempo, GroupSnapshot, GroupStatus,
    PlayedGroupTempo, PositionSnapshot,
};

/// Initial, uncalibrated tolerance in ownership-book versus search points.
pub const LEDGER_CONSISTENCY_TOLERANCE: f64 = 3.0;
pub const LEDGER_STRENGTH_THRESHOLD: f64 = 0.3;
const ZERO_BOOK_EPSILON: f64 = 1e-6;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerBaseline {
    Pass,
    Best,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerLineKind {
    Group,
    OwnTerritory,
    ReduceOpponent,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerScaling {
    Score,
    Proportions,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerInconsistency {
    BookSearchMismatch,
    ZeroBook,
}

/// Candidate ownership alone cannot establish a branch's tempo status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerTempo {
    Unassessed,
    BranchPassProbes,
    RootBranchPassProbes,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerStrengthChange {
    pub color: ColorToken,
    /// Mean own-color ownership on the root group's stones in the reference.
    pub reference: f64,
    /// The same fixed stone coordinates in the candidate scenario.
    pub candidate: f64,
    pub delta: f64,
}

/// A status transition supported by two independently assessed group snapshots.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupTempoChange {
    pub group_id: String,
    pub from: GroupStatus,
    pub to: GroupStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GainLossLine {
    pub kind: LedgerLineKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change: Option<String>,
    /// Search-scaled points, absent when the book cannot safely price the line.
    pub points: Option<f64>,
    /// Signed ownership-book contribution, not a calibrated point value.
    pub book_value: f64,
    /// Signed share of sum(abs(bookValue)); zero when every line is zero.
    pub proportion: f64,
    /// Exact, disjoint root-board coordinates assigned to this line.
    pub intersections: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strength_changes: Vec<LedgerStrengthChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tempo: Option<LedgerTempo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tempo_changes: Vec<ComparisonGroupTempo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub played_tempo_changes: Vec<PlayedGroupTempo>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GainLossLedger {
    pub root_ply: u32,
    pub mover: ColorToken,
    #[serde(rename = "move")]
    pub move_: String,
    pub vs: LedgerBaseline,
    pub reference_move: String,
    /// Search score difference in the root mover's favor.
    pub value: f64,
    pub ledger: Vec<GainLossLine>,
    pub consistent: bool,
    pub book_total: f64,
    pub scaling: LedgerScaling,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inconsistency: Option<LedgerInconsistency>,
}

/// Best retained candidate by engine rank; preserves response order for ties.
#[must_use]
pub fn best_candidate(snapshot: &PositionSnapshot) -> Option<&CandidateSnapshot> {
    snapshot
        .candidates
        .iter()
        .min_by_key(|candidate| candidate.order.unwrap_or(u32::MAX))
}

/// Explain `candidate` versus the explicit pass probe or best root candidate.
///
/// All candidates supplied here must belong to this root's query (or a forced
/// `allowMoves` query of the identical position). Missing/invalid evidence
/// returns `None`; there is no fallback to root or later-position ownership.
#[must_use]
pub fn compute_ledger(
    snapshot: &PositionSnapshot,
    candidate: &CandidateSnapshot,
    baseline: LedgerBaseline,
) -> Option<GainLossLedger> {
    match baseline {
        LedgerBaseline::Pass => {
            let (reference, reference_score) = pass_reference(snapshot, candidate)?;
            build_ledger(
                snapshot,
                candidate,
                baseline,
                "pass",
                reference,
                reference_score,
                &[],
                &[],
            )
        }
        LedgerBaseline::Best => {
            compute_ledger_against(snapshot, candidate, best_candidate(snapshot)?)
        }
    }
}

/// Compare two candidate branches of the identical root, including a played
/// move obtained by a forced root query. The caller guarantees branch provenance.
#[must_use]
pub fn compute_ledger_against(
    snapshot: &PositionSnapshot,
    candidate: &CandidateSnapshot,
    reference: &CandidateSnapshot,
) -> Option<GainLossLedger> {
    build_ledger(
        snapshot,
        candidate,
        LedgerBaseline::Best,
        &reference.move_,
        reference.ownership.as_deref()?,
        reference.score_lead?,
        &[],
        &[],
    )
}

/// Same-root ledger with status evidence on the root's fixed group membership.
/// The evidence comes from explicit root/pass probes of both played branches.
#[must_use]
pub fn compute_ledger_against_with_tempo(
    snapshot: &PositionSnapshot,
    candidate: &CandidateSnapshot,
    reference: &CandidateSnapshot,
    tempo: &[ComparisonGroupTempo],
) -> Option<GainLossLedger> {
    build_ledger(
        snapshot,
        candidate,
        LedgerBaseline::Best,
        &reference.move_,
        reference.ownership.as_deref()?,
        reference.score_lead?,
        tempo,
        &[],
    )
}

/// Value of the played candidate against passing at the same historical root.
/// Before/after statuses use separate explicit root/pass pairs; their maps are
/// never subtracted to price the move.
#[must_use]
pub fn compute_played_ledger_with_tempo(
    snapshot: &PositionSnapshot,
    candidate: &CandidateSnapshot,
    tempo: &[PlayedGroupTempo],
) -> Option<GainLossLedger> {
    let (reference, reference_score) = pass_reference(snapshot, candidate)?;
    build_ledger(
        snapshot,
        candidate,
        LedgerBaseline::Pass,
        "pass",
        reference,
        reference_score,
        &[],
        tempo,
    )
}

fn pass_reference<'a>(
    snapshot: &'a PositionSnapshot,
    candidate: &'a CandidateSnapshot,
) -> Option<(&'a [f64], f64)> {
    let pass = snapshot.pass_probe.as_ref()?;
    let pass_ownership = pass.ownership.as_deref()?;
    let pass_score = pass.score_lead?;
    if !crate::comparison::valid_map(pass_ownership, snapshot.board.size) || !pass_score.is_finite()
    {
        return None;
    }
    // Passing and the pass reference are the same action. Independent searches
    // may disagree, but their sampling difference is not value from playing.
    // Keep the explicit pass-evidence requirement, then alias the actual branch.
    Some(if candidate.move_.eq_ignore_ascii_case("pass") {
        (candidate.ownership.as_deref()?, candidate.score_lead?)
    } else {
        (pass_ownership, pass_score)
    })
}

/// Compare already assessed tempo statuses only for exactly matching stone
/// membership. A missing status or a repartitioned group is not a transition.
/// This helper does not manufacture branch pass probes from ownership maps.
#[must_use]
pub fn compute_tempo_changes(
    reference: &[GroupSnapshot],
    candidate: &[GroupSnapshot],
) -> Vec<GroupTempoChange> {
    candidate
        .iter()
        .filter_map(|group| {
            let previous = reference.iter().find(|previous| {
                previous.group_id == group.group_id
                    && same_stones(&previous.members.black_stones, &group.members.black_stones)
                    && same_stones(&previous.members.white_stones, &group.members.white_stones)
            })?;
            let (from, to) = (previous.status?, group.status?);
            (from != to).then(|| GroupTempoChange {
                group_id: group.group_id.clone(),
                from,
                to,
            })
        })
        .collect()
}

fn same_stones(left: &[String], right: &[String]) -> bool {
    let left: HashSet<_> = left.iter().collect();
    let right: HashSet<_> = right.iter().collect();
    left == right
}

#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
fn build_ledger(
    snapshot: &PositionSnapshot,
    candidate: &CandidateSnapshot,
    baseline: LedgerBaseline,
    reference_move: &str,
    reference: &[f64],
    reference_score: f64,
    tempo: &[ComparisonGroupTempo],
    played_tempo: &[PlayedGroupTempo],
) -> Option<GainLossLedger> {
    let size = snapshot.board.size;
    let count = usize::from(size).pow(2);
    let own = candidate.ownership.as_deref()?;
    let score = candidate.score_lead?;
    if !(2..=25).contains(&size)
        || own.len() != count
        || reference.len() != count
        || own
            .iter()
            .chain(reference)
            .any(|value| !value.is_finite() || !(-1.0..=1.0).contains(value))
        || !score.is_finite()
        || !reference_score.is_finite()
    {
        return None;
    }
    let sign = color_sign(snapshot.to_play);
    let delta: Vec<_> = own
        .iter()
        .zip(reference)
        .map(|(candidate, reference)| sign * (candidate - reference))
        .collect();
    let occupied = snapshot
        .board
        .black
        .iter()
        .chain(&snapshot.board.white)
        .map(|coordinate| coordinate_index(coordinate, size))
        .collect::<Option<HashSet<_>>>()?;
    let mut assigned = vec![false; count];
    let mut lines = Vec::new();
    for group in &snapshot.groups {
        let changes = strength_changes(group, own, reference, size)?;
        let statuses: Vec<_> = tempo
            .iter()
            .filter(|entry| {
                entry.group_id == group.group_id
                    && same_stones(
                        &entry.stones,
                        if entry.color == ColorToken::B {
                            &group.members.black_stones
                        } else {
                            &group.members.white_stones
                        },
                    )
            })
            .cloned()
            .collect();
        let status_changed = statuses
            .iter()
            .any(|entry| entry.actual_status != entry.preferred_status);
        let played_statuses: Vec<_> = played_tempo
            .iter()
            .filter(|entry| {
                entry.group_id == group.group_id
                    && same_stones(
                        &entry.stones,
                        if entry.color == ColorToken::B {
                            &group.members.black_stones
                        } else {
                            &group.members.white_stones
                        },
                    )
            })
            .cloned()
            .collect();
        let status_changed = status_changed
            || played_statuses
                .iter()
                .any(|entry| entry.before_status != entry.after_status);
        if !changes
            .iter()
            .any(|change| change.delta.abs() >= LEDGER_STRENGTH_THRESHOLD)
            && !status_changed
        {
            continue;
        }
        let indices = group
            .members
            .black_stones
            .iter()
            .chain(&group.members.white_stones)
            .chain(&group.members.empty)
            .map(|coordinate| coordinate_index(coordinate, size))
            .collect::<Option<HashSet<_>>>()?;
        // A malformed overlapping partition must not silently double-count.
        if indices.iter().any(|&index| assigned[index]) {
            return None;
        }
        let mut indices: Vec<_> = indices.into_iter().collect();
        indices.sort_unstable();
        for &index in &indices {
            assigned[index] = true;
        }
        let mut line = make_line(LedgerLineKind::Group, &indices, &delta, size);
        line.id = Some(group.group_id.clone());
        line.change = Some(
            if status_changed {
                "status_changed"
            } else {
                "strength_changed"
            }
            .into(),
        );
        line.strength_changes = changes;
        line.tempo = Some(if !played_statuses.is_empty() {
            LedgerTempo::RootBranchPassProbes
        } else if statuses.is_empty() {
            LedgerTempo::Unassessed
        } else {
            LedgerTempo::BranchPassProbes
        });
        line.tempo_changes = statuses;
        line.played_tempo_changes = played_statuses;
        lines.push(line);
    }
    for kind in [
        LedgerLineKind::OwnTerritory,
        LedgerLineKind::ReduceOpponent,
        LedgerLineKind::Other,
    ] {
        let indices: Vec<_> = (0..count)
            .filter(|&index| {
                !assigned[index]
                    && if occupied.contains(&index) {
                        kind == LedgerLineKind::Other
                    } else if sign * reference[index] >= 0.0 {
                        kind == LedgerLineKind::OwnTerritory
                    } else {
                        kind == LedgerLineKind::ReduceOpponent
                    }
            })
            .collect();
        if !indices.is_empty() {
            lines.push(make_line(kind, &indices, &delta, size));
        }
    }
    let value = sign * (score - reference_score);
    let book_total: f64 = lines.iter().map(|line| line.book_value).sum();
    if !value.is_finite() || !book_total.is_finite() {
        return None;
    }
    let inconsistency = if book_total.abs() < ZERO_BOOK_EPSILON {
        Some(LedgerInconsistency::ZeroBook)
    } else if (book_total - value).abs() > LEDGER_CONSISTENCY_TOLERANCE {
        Some(LedgerInconsistency::BookSearchMismatch)
    } else {
        None
    };
    let consistent = inconsistency.is_none();
    let absolute_total: f64 = lines.iter().map(|line| line.book_value.abs()).sum();
    for line in &mut lines {
        line.proportion = if absolute_total > 0.0 {
            line.book_value / absolute_total
        } else {
            0.0
        };
        line.points = consistent.then(|| line.book_value * value / book_total);
    }
    Some(GainLossLedger {
        root_ply: snapshot.ply,
        mover: snapshot.to_play,
        move_: candidate.move_.clone(),
        vs: baseline,
        reference_move: reference_move.into(),
        value,
        ledger: lines,
        consistent,
        book_total,
        scaling: if consistent {
            LedgerScaling::Score
        } else {
            LedgerScaling::Proportions
        },
        inconsistency,
    })
}

fn color_sign(color: ColorToken) -> f64 {
    match color {
        ColorToken::B => 1.0,
        ColorToken::W => -1.0,
    }
}

fn coordinate_index(coordinate: &str, size: u8) -> Option<usize> {
    // Reject malformed prefixes before the general GTP parser's arithmetic.
    if !coordinate.is_ascii()
        || !coordinate
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
    {
        return None;
    }
    let point = Point::parse_gtp(coordinate, size).ok()??;
    Some(usize::from(point.y) * usize::from(size) + usize::from(point.x))
}

fn strength_changes(
    group: &GroupSnapshot,
    candidate: &[f64],
    reference: &[f64],
    size: u8,
) -> Option<Vec<LedgerStrengthChange>> {
    let mut result = Vec::new();
    for (color, stones) in [
        (ColorToken::B, &group.members.black_stones),
        (ColorToken::W, &group.members.white_stones),
    ] {
        if stones.is_empty() {
            continue;
        }
        let indices = stones
            .iter()
            .map(|stone| coordinate_index(stone, size))
            .collect::<Option<Vec<_>>>()?;
        // Board sizes are bounded by u8, so this conversion is exact.
        let count = f64::from(u32::try_from(indices.len()).ok()?);
        let sign = color_sign(color);
        let before = sign * indices.iter().map(|&index| reference[index]).sum::<f64>() / count;
        let after = sign * indices.iter().map(|&index| candidate[index]).sum::<f64>() / count;
        result.push(LedgerStrengthChange {
            color,
            reference: before,
            candidate: after,
            delta: after - before,
        });
    }
    Some(result)
}

fn make_line(kind: LedgerLineKind, indices: &[usize], delta: &[f64], size: u8) -> GainLossLine {
    GainLossLine {
        kind,
        id: None,
        change: None,
        points: None,
        book_value: indices.iter().map(|&index| delta[index]).sum(),
        proportion: 0.0,
        intersections: indices
            .iter()
            .map(|&index| {
                let x = u8::try_from(index % usize::from(size)).expect("board column");
                let y = u8::try_from(index / usize::from(size)).expect("board row");
                Point::new(x, y).to_gtp(size)
            })
            .collect(),
        strength_changes: Vec::new(),
        tempo: None,
        tempo_changes: Vec::new(),
        played_tempo_changes: Vec::new(),
    }
}

#[cfg(test)]
mod tests;
