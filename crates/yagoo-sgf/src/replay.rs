//! Replay a [`GameRecord`] main line into successive [`GameState`] positions.

use crate::error::{SgfError, SgfResult};
use crate::record::{GameRecord, MoveRecord};
use yagoo_core::{Color, GameState, Point};

/// One position along the main line, including the empty/setup root at ply 0.
#[derive(Clone, Debug)]
pub struct ReplayedPosition {
    /// Number of main-line moves already played (0 = after setup, before move 1).
    pub ply: u32,
    pub state: GameState,
    /// Move that led to this position (`None` at ply 0).
    pub last_move: Option<MoveRecord>,
}

/// Replay the main line. Returns positions from ply 0 through `moves.len()` inclusive.
pub fn replay_main_line(record: &GameRecord) -> SgfResult<Vec<ReplayedPosition>> {
    let mut state = GameState::new(record.size, record.ruleset)?;
    for p in &record.setup.black {
        state.setup_stone(*p, Color::Black)?;
    }
    for p in &record.setup.white {
        state.setup_stone(*p, Color::White)?;
    }
    state.set_to_play(record.initial_player);

    let mut out = Vec::with_capacity(record.moves.len() + 1);
    out.push(ReplayedPosition {
        ply: 0,
        state: state.clone(),
        last_move: None,
    });

    for (i, mv) in record.moves.iter().enumerate() {
        if state.to_play() != mv.color {
            return Err(SgfError::InvalidValue(format!(
                "side-to-move mismatch at move {}: expected {:?}, SGF has {:?}",
                i + 1,
                state.to_play(),
                mv.color
            )));
        }
        match mv.point {
            None => state.play_pass()?,
            Some(p) => {
                state.play(p)?;
            }
        }
        out.push(ReplayedPosition {
            ply: u32::try_from(i + 1).map_err(|_| SgfError::InvalidValue("ply overflow".into()))?,
            state: state.clone(),
            last_move: Some(mv.clone()),
        });
    }
    Ok(out)
}

/// Slice plies inclusively by move index range on the **resulting** position ply.
/// `from`/`to` are ply numbers (0 = setup). `to == None` means through the end.
#[must_use]
pub fn filter_ply_range(
    positions: &[ReplayedPosition],
    from: u32,
    to: Option<u32>,
) -> Vec<ReplayedPosition> {
    positions
        .iter()
        .filter(|p| p.ply >= from && to.is_none_or(|t| p.ply <= t))
        .cloned()
        .collect()
}

/// GTP string for a move record.
#[must_use]
pub fn move_to_gtp(mv: &MoveRecord, size: u8) -> String {
    match mv.point {
        None => "pass".into(),
        Some(p) => p.to_gtp(size),
    }
}

/// Helper used by tests / callers that only need the point list.
#[must_use]
pub fn point_gtp(point: Option<Point>, size: u8) -> String {
    match point {
        None => "pass".into(),
        Some(p) => p.to_gtp(size),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_sgf;

    #[test]
    fn replays_setup_and_moves() {
        let g = parse_sgf("(;SZ[9]KM[6.5];B[cc];W[ee];B[])").unwrap();
        let positions = replay_main_line(&g).unwrap();
        assert_eq!(positions.len(), 4);
        assert_eq!(positions[0].ply, 0);
        assert_eq!(positions[0].state.to_play(), Color::Black);
        assert_eq!(positions[1].ply, 1);
        assert_eq!(positions[1].state.to_play(), Color::White);
        assert_eq!(positions[3].last_move.as_ref().unwrap().point, None);
        assert_eq!(positions[3].state.consecutive_passes(), 1);
    }

    #[test]
    fn filter_range() {
        let g = parse_sgf("(;SZ[9];B[aa];W[bb];B[cc])").unwrap();
        let all = replay_main_line(&g).unwrap();
        let mid = filter_ply_range(&all, 1, Some(2));
        assert_eq!(mid.len(), 2);
        assert_eq!(mid[0].ply, 1);
        assert_eq!(mid[1].ply, 2);
    }
}
