//! Deterministic report metadata. Teaching prose is rendered from approved facts.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use yagoo_core::Point;

use crate::{candidate_has_comparison_evidence, ColorToken, MoveComparison, PositionSnapshot};

/// A played-move comparison reference, always anchored at `root_ply = ply - 1`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewMoveReference {
    pub ply: u32,
    pub root_ply: u32,
    pub mover: ColorToken,
    pub actual_move: String,
    pub ai_move: String,
    /// Preferred minus actual, in mover perspective. May be negative.
    pub score_loss: f64,
    pub winrate_loss: f64,
}

/// Final metadata for CLI and UI consumers. Missing coverage remains explicit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub schema_version: u32,
    pub move_count: u32,
    pub completed_position_plies: Vec<u32>,
    pub compared_move_plies: Vec<u32>,
    pub missing_position_plies: Vec<u32>,
    pub missing_comparison_plies: Vec<u32>,
    /// Descending signed score loss, then winrate loss; ties use ascending ply.
    pub ranked_moves: Vec<ReviewMoveReference>,
    pub limitations: Vec<String>,
}

fn valid_coordinate(value: &str, size: u8) -> bool {
    let bytes = value.as_bytes();
    (2..=3).contains(&bytes.len())
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] != b'0'
        && bytes[1..].iter().all(u8::is_ascii_digit)
        && Point::parse_gtp(value, size).is_ok()
}

fn valid_comparison(comparison: &MoveComparison, ply: u32, size: u8) -> bool {
    let sign = if comparison.mover == ColorToken::B {
        1.0
    } else {
        -1.0
    };
    let context = &comparison.context;
    let evidence = &comparison.evidence;
    let mover_winrate = |value: f64| if sign > 0.0 { value } else { 1.0 - value };
    let close = |a: f64, b: f64| a.is_finite() && b.is_finite() && (a - b).abs() <= 1e-8;
    comparison.ply == ply
        && comparison.root_ply.checked_add(1) == Some(ply)
        && comparison.context.root_ply == comparison.root_ply
        && comparison.context.mover == comparison.mover
        && comparison.context.actual.move_ == comparison.actual_move
        && comparison.context.preferred.move_ == comparison.ai_move
        && context.board.size == size
        && context
            .board
            .black
            .iter()
            .chain(&context.board.white)
            .all(|stone| valid_coordinate(stone, size))
        && candidate_has_comparison_evidence(&context.actual, context.board.size)
        && candidate_has_comparison_evidence(&context.preferred, context.board.size)
        && [&context.actual, &context.preferred]
            .iter()
            .all(|candidate| {
                candidate.move_.eq_ignore_ascii_case("pass")
                    || valid_coordinate(&candidate.move_, size)
            })
        && !evidence.root_query_id.trim().is_empty()
        && !evidence.actual_query_id.trim().is_empty()
        && evidence.actual_visits.is_some_and(|visits| visits > 0)
        && evidence.ai_visits.is_some_and(|visits| visits > 0)
        && context
            .actual
            .score_lead
            .is_some_and(|value| close(value, comparison.actual_score_lead))
        && context
            .preferred
            .score_lead
            .is_some_and(|value| close(value, comparison.ai_score_lead))
        && context
            .actual
            .winrate
            .is_some_and(|value| close(mover_winrate(value), comparison.actual_winrate))
        && context
            .preferred
            .winrate
            .is_some_and(|value| close(mover_winrate(value), comparison.ai_winrate))
        && (!comparison
            .actual_move
            .eq_ignore_ascii_case(&comparison.ai_move)
            || (comparison.score_loss == 0.0 && comparison.winrate_loss == 0.0))
        && comparison.ownership_delta.len() == usize::from(size).pow(2)
        && comparison
            .ownership_delta
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 2.0)
        && comparison.ledger_diff.as_ref().is_none_or(|ledger| {
            ledger.root_ply == comparison.root_ply
                && ledger.mover == comparison.mover
                && ledger.move_ == comparison.actual_move
                && ledger.reference_move == comparison.ai_move
        })
        && comparison.score_loss.is_finite()
        && comparison.winrate_loss.is_finite()
        && (comparison.score_loss
            - sign * (comparison.ai_score_lead - comparison.actual_score_lead))
            .abs()
            <= 1e-8
        && (comparison.winrate_loss - (comparison.ai_winrate - comparison.actual_winrate)).abs()
            <= 1e-8
        && !matches!(
            (&comparison.evidence.root_hash, &comparison.evidence.actual_root_hash),
            (Some(root), Some(actual)) if root != actual
        )
}

/// Only authoritative completed snapshots contribute. No adjacent-root subtraction
/// or unsigned scan-selection reasons are accepted as played-move evidence.
#[must_use]
pub fn summarize_review<'a>(
    move_count: u32,
    snapshots: impl IntoIterator<Item = &'a PositionSnapshot>,
) -> ReviewSummary {
    let positions: BTreeMap<_, _> = snapshots
        .into_iter()
        .filter(|snapshot| snapshot.ply <= move_count && snapshot.root.is_some())
        .map(|snapshot| (snapshot.ply, snapshot))
        .collect();
    let mut ranked_moves: Vec<_> = positions
        .values()
        .filter_map(|snapshot| {
            let comparison = snapshot.comparison.as_ref()?;
            (snapshot.ply > 0 && valid_comparison(comparison, snapshot.ply, snapshot.board.size))
                .then(|| ReviewMoveReference {
                    ply: comparison.ply,
                    root_ply: comparison.root_ply,
                    mover: comparison.mover,
                    actual_move: comparison.actual_move.clone(),
                    ai_move: comparison.ai_move.clone(),
                    score_loss: comparison.score_loss,
                    winrate_loss: comparison.winrate_loss,
                })
        })
        .collect();
    ranked_moves.sort_by(|a, b| {
        b.score_loss
            .partial_cmp(&a.score_loss)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.winrate_loss
                    .partial_cmp(&a.winrate_loss)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.ply.cmp(&b.ply))
    });
    let mut compared_move_plies: Vec<_> = ranked_moves.iter().map(|m| m.ply).collect();
    compared_move_plies.sort_unstable();
    ReviewSummary {
        schema_version: 1,
        move_count,
        completed_position_plies: positions.keys().copied().collect(),
        missing_position_plies: (0..=move_count).filter(|p| !positions.contains_key(p)).collect(),
        missing_comparison_plies: (1..=move_count)
            .filter(|p| compared_move_plies.binary_search(p).is_err()).collect(),
        compared_move_plies,
        ranked_moves,
        limitations: vec![
            "Rankings use only actual-versus-preferred comparisons at the same preceding root.".into(),
            "Finite-visit search estimates are not proof of optimal play; negative differences are retained.".into(),
            "Scan swing magnitudes prioritize analysis and do not establish played-move loss.".into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BoardSnapshot;

    #[test]
    fn genuine_history_ranks_actual_p60_and_retains_p43_equality() {
        let snapshots: Vec<PositionSnapshot> = serde_json::from_str(include_str!(
            "../../../packages/ui/src/analysis/__fixtures__/comparison-positions.json"
        ))
        .unwrap();
        let summary = summarize_review(100, &snapshots);
        assert_eq!(
            summary
                .ranked_moves
                .iter()
                .map(|r| r.ply)
                .collect::<Vec<_>>(),
            vec![60, 44, 43, 50, 96]
        );
        let first = &summary.ranked_moves[0];
        assert_eq!((first.ply, first.root_ply), (60, 59));
        assert_eq!((&*first.actual_move, &*first.ai_move), ("S3", "H3"));
        assert!((first.score_loss - 6.681_626_325).abs() < 1e-9);
        let equal = summary.ranked_moves.iter().find(|r| r.ply == 43).unwrap();
        assert_eq!(equal.score_loss, 0.0);
        assert_eq!(equal.actual_move, equal.ai_move);
        assert_eq!(summary.missing_comparison_plies.len(), 95);
        let mut wrong_root = snapshots.iter().find(|s| s.ply == 60).unwrap().clone();
        wrong_root.comparison.as_mut().unwrap().root_ply = 60;
        assert_eq!(summarize_review(100, [&wrong_root]).ranked_moves.len(), 0);
    }

    #[test]
    fn absent_comparisons_are_not_inferred_from_root_values() {
        let mut snapshot = PositionSnapshot::empty_shell(
            2,
            ColorToken::B,
            BoardSnapshot {
                size: 9,
                black: vec![],
                white: vec![],
            },
            vec![],
        );
        snapshot.root = Some(crate::EngineAnalysis {
            visits: Some(100),
            winrate: Some(0.01),
            score_lead: Some(-90.0),
            score_stdev: None,
            utility: None,
            ownership: None,
            ownership_stdev: None,
            policy: None,
            neural: None,
        });
        let summary = summarize_review(3, [&snapshot]);
        assert_eq!(summary.completed_position_plies, vec![2]);
        assert_eq!(summary.missing_position_plies, vec![0, 1, 3]);
        assert_eq!(summary.missing_comparison_plies, vec![1, 2, 3]);
        assert_eq!(summary.ranked_moves.len(), 0);
    }

    #[test]
    fn contradictory_candidate_values_and_nonzero_same_move_loss_are_unassessed() {
        let snapshots: Vec<PositionSnapshot> = serde_json::from_str(include_str!(
            "../../../packages/ui/src/analysis/__fixtures__/comparison-positions.json"
        ))
        .unwrap();
        let mut inconsistent = snapshots.iter().find(|s| s.ply == 60).unwrap().clone();
        let comparison = inconsistent.comparison.as_mut().unwrap();
        // Arithmetic alone is insufficient when the copied values contradict the candidate.
        comparison.actual_score_lead += 1.0;
        comparison.score_loss += 1.0;
        assert_eq!(
            summarize_review(100, [&inconsistent]).ranked_moves,
            Vec::<ReviewMoveReference>::new()
        );

        let mut equal = snapshots.iter().find(|s| s.ply == 43).unwrap().clone();
        let comparison = equal.comparison.as_mut().unwrap();
        comparison.actual_score_lead += 1.0;
        comparison.context.actual.score_lead = Some(comparison.actual_score_lead);
        comparison.score_loss = -1.0;
        let summary = summarize_review(100, [&equal]);
        assert_eq!(summary.ranked_moves, Vec::<ReviewMoveReference>::new());
        assert!(summary.missing_comparison_plies.contains(&43));
        assert_eq!(summary.completed_position_plies, vec![43]);

        let mut missing_source = snapshots.iter().find(|s| s.ply == 60).unwrap().clone();
        missing_source
            .comparison
            .as_mut()
            .unwrap()
            .evidence
            .actual_query_id
            .clear();
        assert_eq!(
            summarize_review(100, [&missing_source]).ranked_moves,
            Vec::<ReviewMoveReference>::new()
        );
    }
}
