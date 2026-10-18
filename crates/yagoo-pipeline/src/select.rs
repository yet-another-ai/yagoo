//! Choose deep-phase plies from scan-phase swings.

use serde::{Deserialize, Serialize};
use yagoo_snapshot::{DeepPlySelection, PositionSnapshot};

/// Why a ply was selected for deepening.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepPlyReason {
    pub ply: u32,
    /// Combined priority score (higher = more important).
    pub score: f64,
    pub winrate_delta: f64,
    pub score_lead_delta: f64,
    pub ownership_delta: f64,
}

impl From<DeepPlyReason> for DeepPlySelection {
    fn from(r: DeepPlyReason) -> Self {
        Self {
            ply: r.ply,
            score: r.score,
            winrate_delta: r.winrate_delta,
            score_lead_delta: r.score_lead_delta,
            ownership_delta: r.ownership_delta,
        }
    }
}

/// Thresholds / limits for swing-based selection.
///
/// Defaults documented in `docs/appendix/parameters.md`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSelectConfig {
    /// |\Delta winrate| between consecutive scan plies (fraction, not percent).
    pub winrate_threshold: f64,
    /// |\Delta scoreLead| in points.
    pub score_lead_threshold: f64,
    /// Mean absolute ownership change across the board.
    pub ownership_threshold: f64,
    /// Maximum plies to deepen (after ranking by score).
    pub max_deep_plies: usize,
}

impl Default for DeepSelectConfig {
    fn default() -> Self {
        Self {
            winrate_threshold: 0.05,
            score_lead_threshold: 3.0,
            ownership_threshold: 0.08,
            max_deep_plies: 24,
        }
    }
}

/// Pick deep plies from consecutive scan snapshots inside `from_ply..=to_ply`.
///
/// A swing is measured between ply `p-1` and `p`; when it clears any threshold,
/// ply `p` (after the move) is a candidate. Candidates are ranked by
/// `wr/τ_wr + sl/τ_sl + own/τ_own` and truncated to `max_deep_plies`.
#[must_use]
pub fn select_deep_plies(
    scan: &[(u32, &PositionSnapshot)],
    cfg: &DeepSelectConfig,
) -> Vec<DeepPlyReason> {
    if scan.len() < 2 {
        return Vec::new();
    }

    let mut reasons = Vec::new();
    for window in scan.windows(2) {
        let (prev_ply, prev) = window[0];
        let (ply, curr) = window[1];
        let _ = prev_ply;
        let Some(prev_root) = prev.root.as_ref() else {
            continue;
        };
        let Some(curr_root) = curr.root.as_ref() else {
            continue;
        };

        let wr = abs_opt(prev_root.winrate, curr_root.winrate);
        let sl = abs_opt(prev_root.score_lead, curr_root.score_lead);
        let own = ownership_mean_abs(
            prev_root.ownership.as_deref(),
            curr_root.ownership.as_deref(),
        );

        let qualifies = wr >= cfg.winrate_threshold
            || sl >= cfg.score_lead_threshold
            || own >= cfg.ownership_threshold;
        if !qualifies {
            continue;
        }

        let score = wr / cfg.winrate_threshold
            + sl / cfg.score_lead_threshold
            + own / cfg.ownership_threshold;
        reasons.push(DeepPlyReason {
            ply,
            score,
            winrate_delta: wr,
            score_lead_delta: sl,
            ownership_delta: own,
        });
    }

    reasons.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.ply.cmp(&b.ply))
    });
    reasons.truncate(cfg.max_deep_plies);
    reasons.sort_by_key(|r| r.ply);
    reasons
}

fn abs_opt(a: Option<f64>, b: Option<f64>) -> f64 {
    match (a, b) {
        (Some(x), Some(y)) => (x - y).abs(),
        _ => 0.0,
    }
}

fn ownership_mean_abs(a: Option<&[f64]>, b: Option<&[f64]>) -> f64 {
    let (Some(a), Some(b)) = (a, b) else {
        return 0.0;
    };
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let sum: f64 = a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).sum();
    #[allow(clippy::cast_precision_loss)]
    let n = a.len() as f64;
    sum / n
}

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_snapshot::{
        BoardSnapshot, ColorToken, EngineAnalysis, OwnershipConvention, SCHEMA_VERSION,
    };

    fn snap(ply: u32, wr: f64, sl: f64, own: Vec<f64>) -> PositionSnapshot {
        PositionSnapshot {
            schema_version: SCHEMA_VERSION,
            ply,
            to_play: ColorToken::B,
            last_move: None,
            ownership_convention: OwnershipConvention::BlackPositive,
            board: BoardSnapshot {
                size: 9,
                black: vec![],
                white: vec![],
            },
            chains: vec![],
            root: Some(EngineAnalysis {
                visits: Some(100),
                winrate: Some(wr),
                score_lead: Some(sl),
                score_stdev: None,
                utility: None,
                ownership: Some(own),
                ownership_stdev: None,
                policy: None,
            }),
            pass_probe: None,
            pass_probe_skipped: None,
            candidates: vec![],
            pv_ends: vec![],
            phase: Some("scan".into()),
        }
    }

    #[test]
    fn picks_large_winrate_swing_ply() {
        let s0 = snap(0, 0.50, 0.0, vec![0.0, 0.0, 0.0]);
        let s1 = snap(1, 0.51, 0.2, vec![0.01, 0.0, 0.0]); // small
        let s2 = snap(2, 0.70, 1.0, vec![0.02, 0.0, 0.0]); // big wr swing from s1
        let list = [(0, &s0), (1, &s1), (2, &s2)];
        let picked = select_deep_plies(&list, &DeepSelectConfig::default());
        assert_eq!(picked.iter().map(|r| r.ply).collect::<Vec<_>>(), vec![2]);
        assert!(picked[0].winrate_delta >= 0.05);
    }

    #[test]
    fn ranks_by_magnitude_then_caps() {
        let s0 = snap(0, 0.5, 0.0, vec![0.0; 4]);
        let s1 = snap(1, 0.6, 0.0, vec![0.0; 4]); // wr 0.1
        let s2 = snap(2, 0.6, 10.0, vec![0.0; 4]); // sl 10
        let s3 = snap(3, 0.61, 10.0, vec![0.5; 4]); // huge ownership
        let list = [(0, &s0), (1, &s1), (2, &s2), (3, &s3)];
        let cfg = DeepSelectConfig {
            max_deep_plies: 2,
            ..DeepSelectConfig::default()
        };
        let picked = select_deep_plies(&list, &cfg);
        assert_eq!(picked.len(), 2);
        // After truncate by score then re-sort by ply:
        assert!(picked.iter().any(|r| r.ply == 3));
    }
}
