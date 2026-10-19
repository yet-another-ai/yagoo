//! Supported normal-phase boundaries from KataGo BoardHistory (MIT).
use super::FeatureRules;
use crate::{Board, Color, GameState};
use std::collections::HashMap;

pub struct HistoryStatus {
    pub pass_would_end_phase: bool,
    pub repeated_pass_would_end_phase: bool,
}

/// Validate the entire retained history, including a boundary followed by more
/// moves. No-result/encore/special-pass scoring is deliberately not estimated.
pub fn validate_history(game: &GameState, rules: FeatureRules) -> Result<HistoryStatus, String> {
    let moves = game.moves();
    let simple = rules != FeatureRules::ChineseOgs;
    let mut passes = 0;
    let mut ended = false;
    let mut prior_passes: Vec<(Color, &Board)> = Vec::new();
    // Compare boards within hash buckets, so a hash collision cannot reject a game.
    let mut occurrences: HashMap<(u64, Color), Vec<(&Board, usize)>> = HashMap::new();
    occurrences.insert(
        (game.initial_board().position_hash(), game.initial_player()),
        vec![(game.initial_board(), 1)],
    );
    for (i, &(player, point)) in moves.iter().enumerate() {
        if ended {
            return Err("Moves after an area-scoring terminal position are unsupported".into());
        }
        let before = game.recent_board(moves.len() - i);
        let after = game.recent_board(moves.len() - i - 1);
        if point.is_none() {
            passes += 1;
            if simple
                && prior_passes
                    .iter()
                    .any(|(p, b)| *p == player && *b == before)
            {
                // TODO(#16): score repeated-pass phase endings instead of rejecting.
                return Err(
                    "Repeated-pass phase ending is not implemented; position not evaluated".into(),
                );
            }
            prior_passes.push((player, before));
            if simple {
                occurrences.clear();
            }
            if passes >= 2 {
                if rules == FeatureRules::Japanese {
                    // TODO(#10): Japanese encore legality, V7 features, territory scoring.
                    return Err("Japanese encore legality, features and territory scoring are not implemented".into());
                }
                ended = true;
            }
        } else {
            passes = 0;
        }
        if simple {
            let bucket = occurrences
                .entry((after.position_hash(), player.opponent()))
                .or_default();
            let count = if let Some((_, count)) = bucket.iter_mut().find(|(b, _)| *b == after) {
                *count += 1;
                *count
            } else {
                bucket.push((after, 1));
                1
            };
            if point.is_some() && count >= 3 {
                // TODO(#16): score simple-ko long-cycle / no-result endings.
                return Err(
                    "Long-cycle no-result scoring is not implemented; position not evaluated"
                        .into(),
                );
            }
        }
    }
    let repeated = simple
        && prior_passes
            .iter()
            .any(|(p, b)| *p == game.to_play() && *b == game.board());
    Ok(HistoryStatus {
        pass_would_end_phase: passes >= 1 || repeated,
        repeated_pass_would_end_phase: repeated,
    })
}
