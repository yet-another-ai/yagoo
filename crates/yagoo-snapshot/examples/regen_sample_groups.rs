//! One-shot: enrich deep-ply scenario ownership in the bundled sample NDJSON,
//! run [`yagoo_snapshot::compute_groups`], and rewrite the fixture.
#![allow(clippy::cast_precision_loss, clippy::map_unwrap_or)]
//!
//! The prior sample used identical candidate ownership (→ no fate signal).
//! This synthesizes localized, correlated ownership deltas from the board so
//! clustering yields real pipeline groups — without downloading KataGo.
//!
//! Usage:
//! ```sh
//! cargo run -p yagoo-snapshot --example regen_sample_groups -- \
//!   docs/public/app/sample-scan-deep.ndjson \
//!   packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson
//! ```

use std::env;
use std::fs;
use std::path::Path;
use yagoo_core::Point;
use yagoo_snapshot::{compute_groups, ColorToken, PipelineEvent, PositionSnapshot};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let input = args
        .first()
        .map_or("docs/public/app/sample-scan-deep.ndjson", String::as_str);
    let outputs: Vec<&str> = if args.len() > 1 {
        args[1..].iter().map(String::as_str).collect()
    } else {
        vec![
            input,
            "packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson",
        ]
    };

    let text = fs::read_to_string(input).expect("read sample ndjson");
    let mut out_lines: Vec<String> = Vec::new();
    let mut deep_groups = 0_usize;

    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut ev: PipelineEvent = serde_json::from_str(line).expect("parse event");
        if let PipelineEvent::PositionCompleted {
            phase, snapshot, ..
        } = &mut ev
        {
            if *phase == yagoo_snapshot::AnalysisPhase::Deep {
                enrich_scenarios(snapshot);
                snapshot.groups = compute_groups(snapshot);
                deep_groups = snapshot.groups.len();
                // Drop any leftover fixture_proposal — source is pipeline now.
                for g in &mut snapshot.groups {
                    g.source = Some(yagoo_snapshot::GroupSource::Pipeline);
                }
            } else {
                snapshot.groups.clear();
            }
        }
        out_lines.push(serde_json::to_string(&ev).expect("serialize"));
    }

    let body = out_lines.join("\n") + "\n";
    for path in outputs {
        let p = Path::new(path);
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(p, &body).unwrap_or_else(|e| panic!("write {path}: {e}"));
        eprintln!("wrote {path} ({deep_groups} groups on deep ply)");
    }
}

/// Inject localized ownership deltas so correlation clustering has signal.
fn enrich_scenarios(snap: &mut PositionSnapshot) {
    let size = snap.board.size;
    let n = usize::from(size) * usize::from(size);
    let Some(root) = snap.root.as_ref().and_then(|r| r.ownership.clone()) else {
        return;
    };
    if root.len() != n {
        return;
    }

    // Region seeds: each chain's first stone + a few empties around it.
    let mut regions: Vec<Vec<usize>> = Vec::new();
    for chain in &snap.chains {
        let mut pts = Vec::new();
        for gtp in &chain.stones {
            if let Ok(Some(p)) = Point::parse_gtp(gtp, size) {
                pts.push(p.index(size));
                for nb in p.neighbors(size) {
                    pts.push(nb.index(size));
                }
            }
        }
        pts.sort_unstable();
        pts.dedup();
        if pts.len() >= 3 {
            regions.push(pts);
        }
    }
    // Cap regions for stability; prefer larger ones.
    regions.sort_by_key(|r| std::cmp::Reverse(r.len()));
    regions.truncate(8);

    // Pass probe: weaken unsettled-looking regions (low |root own| stones).
    if let Some(pp) = snap.pass_probe.as_mut() {
        let mut own = root.clone();
        for (ri, region) in regions.iter().enumerate() {
            let sign = if ri % 2 == 0 { -1.0 } else { 1.0 };
            let amp = 0.35 + 0.05 * (ri as f64);
            for &i in region {
                own[i] = (root[i] + sign * amp).clamp(-1.0, 1.0);
            }
        }
        pp.ownership = Some(own);
    }

    // Candidates: each move “claims” one region with a correlated swing.
    let to_play_sign = match snap.to_play {
        ColorToken::B => 1.0,
        ColorToken::W => -1.0,
    };
    for (ci, cand) in snap.candidates.iter_mut().enumerate() {
        let mut own = root.clone();
        if let Some(region) = regions.get(ci % regions.len().max(1)) {
            let amp = 0.45;
            for &i in region {
                own[i] = (root[i] + to_play_sign * amp).clamp(-1.0, 1.0);
            }
            // Slight opposite tug on next region so correlations aren't global.
            if let Some(other) = regions.get((ci + 1) % regions.len()) {
                for &i in other {
                    own[i] = (root[i] - to_play_sign * 0.25).clamp(-1.0, 1.0);
                }
            }
        }
        // Local bump near the candidate move itself.
        if let Ok(Some(p)) = Point::parse_gtp(&cand.move_, size) {
            let i = p.index(size);
            own[i] = (root[i] + to_play_sign * 0.55).clamp(-1.0, 1.0);
            for nb in p.neighbors(size) {
                let j = nb.index(size);
                own[j] = (root[j] + to_play_sign * 0.35).clamp(-1.0, 1.0);
            }
        }
        cand.ownership = Some(own);
    }
}
