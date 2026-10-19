//! Game state: side to move, ko, optional positional superko, pass.

use crate::board::{Board, MovePlay, Stone};
use crate::color::{Color, Player};
use crate::coord::Point;
use crate::error::{CoreError, CoreResult};

/// Rules profile for legality checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ruleset {
    /// Chinese-style: positional superko.
    Chinese,
    /// Japanese-style: simple ko only (no multi-stone superko enforcement here).
    Japanese,
}

impl Ruleset {
    #[must_use]
    pub const fn uses_positional_superko(self) -> bool {
        matches!(self, Self::Chinese)
    }
}

#[derive(Clone, Debug)]
struct HistoryEntry {
    board: Board,
    to_play: Player,
    ko_point: Option<Point>,
    consecutive_passes: u8,
    history_len: usize,
    move_count: usize,
}

/// Mutable game position with move legality.
#[derive(Clone, Debug)]
pub struct GameState {
    board: Board,
    to_play: Player,
    rules: Ruleset,
    /// Point where a single-stone recapture is forbidden (simple ko).
    ko_point: Option<Point>,
    consecutive_passes: u8,
    /// Hashes of positions **after** each completed ply (including setup baseline).
    position_history: Vec<u64>,
    undo_stack: Vec<HistoryEntry>,
    moves: Vec<(Color, Option<Point>)>,
}

impl GameState {
    /// Empty board, Black to play.
    pub fn new(size: u8, rules: Ruleset) -> CoreResult<Self> {
        let board = Board::empty(size)?;
        let hash = board.position_hash();
        Ok(Self {
            board,
            to_play: Color::Black,
            rules,
            ko_point: None,
            consecutive_passes: 0,
            position_history: vec![hash],
            undo_stack: Vec::new(),
            moves: Vec::new(),
        })
    }

    #[must_use]
    pub fn board(&self) -> &Board {
        &self.board
    }

    #[must_use]
    pub const fn to_play(&self) -> Player {
        self.to_play
    }

    #[must_use]
    pub const fn rules(&self) -> Ruleset {
        self.rules
    }

    #[must_use]
    pub const fn ko_point(&self) -> Option<Point> {
        self.ko_point
    }

    #[must_use]
    pub const fn consecutive_passes(&self) -> u8 {
        self.consecutive_passes
    }

    /// Moves since the last setup edit. Passes are retained for neural features.
    #[must_use]
    pub fn moves(&self) -> &[(Color, Option<Point>)] {
        &self.moves
    }

    #[must_use]
    pub fn initial_board(&self) -> &Board {
        self.undo_stack
            .first()
            .map_or(&self.board, |entry| &entry.board)
    }

    #[must_use]
    pub fn initial_player(&self) -> Color {
        self.undo_stack
            .first()
            .map_or(self.to_play, |entry| entry.to_play)
    }

    /// Board before `turns` moves, or the setup board if history is shorter.
    #[must_use]
    pub fn recent_board(&self, turns: usize) -> &Board {
        if turns == 0 {
            return &self.board;
        }
        self.undo_stack
            .get(self.undo_stack.len().saturating_sub(turns))
            .map_or(&self.board, |entry| &entry.board)
    }

    /// Place handicap / setup stones. Does not change side to play by itself.
    pub fn setup_stone(&mut self, point: Point, color: Color) -> CoreResult<()> {
        self.board.place_setup(point, color)?;
        self.rebuild_history_baseline();
        Ok(())
    }

    /// After setup, set who moves next and reset history baseline.
    pub fn set_to_play(&mut self, player: Player) {
        self.to_play = player;
        self.ko_point = None;
        self.consecutive_passes = 0;
        self.rebuild_history_baseline();
    }

    fn rebuild_history_baseline(&mut self) {
        let hash = self.board.position_hash();
        self.position_history.clear();
        self.position_history.push(hash);
        self.undo_stack.clear();
        self.moves.clear();
    }

    /// Pass. Two consecutive passes leave `consecutive_passes == 2`.
    pub fn play_pass(&mut self) -> CoreResult<()> {
        self.push_undo();
        self.moves.push((self.to_play, None));
        self.to_play = self.to_play.opponent();
        self.ko_point = None;
        self.consecutive_passes = self.consecutive_passes.saturating_add(1);
        // Board unchanged; keep history as-is for positional superko of later moves.
        Ok(())
    }

    /// Play a stone for the current side.
    pub fn play(&mut self, point: Point) -> CoreResult<MovePlay> {
        if let Some(ko) = self.ko_point {
            if point == ko {
                return Err(CoreError::SimpleKo(point));
            }
        }

        self.push_undo();
        let color = self.to_play;
        let captured = match self.board.place_with_captures(point, color) {
            Ok(c) => c,
            Err(e) => {
                self.pop_undo()?;
                return Err(e);
            }
        };

        let new_hash = self.board.position_hash();
        if self.rules.uses_positional_superko() && self.position_history.contains(&new_hash) {
            self.pop_undo()?;
            return Err(CoreError::Superko(point));
        }

        let ko = if captured.len() == 1 {
            // Simple ko: if we captured exactly one stone and the played stone
            // has exactly one liberty (the captured point), forbid immediate recapture.
            if let Some(chain) = self.board.chain_at(point) {
                if chain.stones.len() == 1 && chain.liberty_count() == 1 {
                    Some(captured[0])
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        self.ko_point = ko;
        self.consecutive_passes = 0;
        self.to_play = color.opponent();
        self.position_history.push(new_hash);
        self.moves.push((color, Some(point)));

        Ok(MovePlay {
            point,
            color,
            captured,
        })
    }

    /// Play GTP move text (`D4` / `pass`).
    pub fn play_gtp(&mut self, text: &str) -> CoreResult<Option<MovePlay>> {
        match Point::parse_gtp(text, self.board.size())? {
            None => {
                self.play_pass()?;
                Ok(None)
            }
            Some(p) => Ok(Some(self.play(p)?)),
        }
    }

    pub fn undo(&mut self) -> CoreResult<()> {
        self.pop_undo()?;
        Ok(())
    }

    fn push_undo(&mut self) {
        self.undo_stack.push(HistoryEntry {
            board: self.board.clone(),
            to_play: self.to_play,
            ko_point: self.ko_point,
            consecutive_passes: self.consecutive_passes,
            history_len: self.position_history.len(),
            move_count: self.moves.len(),
        });
    }

    fn pop_undo(&mut self) -> CoreResult<()> {
        let entry = self.undo_stack.pop().ok_or(CoreError::NothingToUndo)?;
        self.board = entry.board;
        self.to_play = entry.to_play;
        self.ko_point = entry.ko_point;
        self.consecutive_passes = entry.consecutive_passes;
        self.position_history.truncate(entry.history_len);
        self.moves.truncate(entry.move_count);
        Ok(())
    }

    /// Stones of `color` currently on the board.
    #[must_use]
    pub fn stones(&self, color: Color) -> Vec<Point> {
        let mut out = Vec::new();
        let size = self.board.size();
        for y in 0..size {
            for x in 0..size {
                let p = Point::new(x, y);
                if self.board.get(p).ok().and_then(Stone::color) == Some(color) {
                    out.push(p);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_ko_forbids_immediate_recapture() {
        let mut g = GameState::new(9, Ruleset::Japanese).unwrap();
        // Build a classic ko shape around (2,2)/(3,2).
        // Black: (2,1)(1,2)(2,3); White: (3,1)(4,2)(3,3); White stone at (3,2) to capture.
        for p in [
            Point::new(2, 1),
            Point::new(1, 2),
            Point::new(2, 3),
            Point::new(3, 2),
        ] {
            g.setup_stone(p, Color::Black).unwrap();
        }
        for p in [Point::new(3, 1), Point::new(4, 2), Point::new(3, 3)] {
            g.setup_stone(p, Color::White).unwrap();
        }
        g.set_to_play(Color::White);
        // White captures the black stone at (3,2) by playing (2,2)?
        // Black at (3,2) liberties: (2,2),(3,0)? neighbors of (3,2): (2,2),(4,2)W,(3,1)W,(3,3)W
        // So only liberty is (2,2). White plays (2,2) capturing (3,2).
        let play = g.play(Point::new(2, 2)).unwrap();
        assert_eq!(play.captured, vec![Point::new(3, 2)]);
        assert_eq!(g.ko_point(), Some(Point::new(3, 2)));
        assert_eq!(g.to_play(), Color::Black);
        let err = g.play(Point::new(3, 2)).unwrap_err();
        assert_eq!(err, CoreError::SimpleKo(Point::new(3, 2)));
        // Tenuki then recapture OK.
        g.play(Point::new(0, 0)).unwrap();
        g.play(Point::new(8, 8)).unwrap();
        assert!(g.play(Point::new(3, 2)).is_ok());
    }

    #[test]
    fn pass_and_gtp() {
        let mut g = GameState::new(9, Ruleset::Chinese).unwrap();
        assert!(g.play_gtp("pass").unwrap().is_none());
        assert_eq!(g.to_play(), Color::White);
        assert_eq!(g.consecutive_passes(), 1);
        g.play_gtp("D4").unwrap();
        assert_eq!(g.consecutive_passes(), 0);
    }

    #[test]
    fn capture_updates_board() {
        let mut g = GameState::new(9, Ruleset::Chinese).unwrap();
        g.setup_stone(Point::new(0, 0), Color::Black).unwrap();
        g.setup_stone(Point::new(1, 0), Color::White).unwrap();
        g.set_to_play(Color::White);
        let play = g.play(Point::new(0, 1)).unwrap();
        assert_eq!(play.captured, vec![Point::new(0, 0)]);
    }
}
