//! Board grid, captures, and chain discovery.

use crate::chain::Chain;
use crate::color::Color;
use crate::coord::Point;
use crate::error::{CoreError, CoreResult};

/// Contents of an intersection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Stone {
    Empty,
    Black,
    White,
}

impl Stone {
    #[must_use]
    pub const fn from_color(color: Color) -> Self {
        match color {
            Color::Black => Self::Black,
            Color::White => Self::White,
        }
    }

    #[must_use]
    pub const fn color(self) -> Option<Color> {
        match self {
            Self::Empty => None,
            Self::Black => Some(Color::Black),
            Self::White => Some(Color::White),
        }
    }

    #[must_use]
    pub const fn is_empty(self) -> bool {
        matches!(self, Self::Empty)
    }
}

/// Result of playing a stone (not a pass).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MovePlay {
    pub point: Point,
    pub color: Color,
    pub captured: Vec<Point>,
}

/// Rectangular Go board. Size is generic; 19×19 is the primary target.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    size: u8,
    cells: Vec<Stone>,
}

impl Board {
    /// Create an empty board. Size must be in `2..=25`.
    pub fn empty(size: u8) -> CoreResult<Self> {
        if !(2..=25).contains(&size) {
            return Err(CoreError::InvalidBoardSize(size));
        }
        let n = usize::from(size) * usize::from(size);
        Ok(Self {
            size,
            cells: vec![Stone::Empty; n],
        })
    }

    #[must_use]
    pub const fn size(&self) -> u8 {
        self.size
    }

    pub fn get(&self, point: Point) -> CoreResult<Stone> {
        self.ensure_in_bounds(point)?;
        Ok(self.cells[point.index(self.size)])
    }

    pub fn set(&mut self, point: Point, stone: Stone) -> CoreResult<()> {
        self.ensure_in_bounds(point)?;
        self.cells[point.index(self.size)] = stone;
        Ok(())
    }

    /// Place a setup stone without capture logic (SGF `AB` / `AW`).
    pub fn place_setup(&mut self, point: Point, color: Color) -> CoreResult<()> {
        self.set(point, Stone::from_color(color))
    }

    fn ensure_in_bounds(&self, point: Point) -> CoreResult<()> {
        if point.x >= self.size || point.y >= self.size {
            return Err(CoreError::OutOfBounds {
                point,
                size: self.size,
            });
        }
        Ok(())
    }

    /// Zobrist-free positional hash (FNV-1a over cell bytes). Good enough for superko.
    #[must_use]
    pub fn position_hash(&self) -> u64 {
        const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const FNV_PRIME: u64 = 0x0100_0000_01b3;
        let mut hash = FNV_OFFSET;
        hash ^= u64::from(self.size);
        hash = hash.wrapping_mul(FNV_PRIME);
        for cell in &self.cells {
            let byte = match cell {
                Stone::Empty => 0_u8,
                Stone::Black => 1,
                Stone::White => 2,
            };
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        hash
    }

    /// Find the chain containing `point`, or `None` if empty / OOB.
    #[must_use]
    pub fn chain_at(&self, point: Point) -> Option<Chain> {
        let color = self.get(point).ok()?.color()?;
        let mut stones = Vec::new();
        let mut liberties = Vec::new();
        let mut seen_stones = vec![false; self.cells.len()];
        let mut seen_libs = vec![false; self.cells.len()];
        let mut stack = vec![point];
        seen_stones[point.index(self.size)] = true;

        while let Some(cur) = stack.pop() {
            stones.push(cur);
            for n in cur.neighbors(self.size) {
                let idx = n.index(self.size);
                match self.cells[idx] {
                    Stone::Empty => {
                        if !seen_libs[idx] {
                            seen_libs[idx] = true;
                            liberties.push(n);
                        }
                    }
                    s if s.color() == Some(color) && !seen_stones[idx] => {
                        seen_stones[idx] = true;
                        stack.push(n);
                    }
                    _ => {}
                }
            }
        }

        stones.sort();
        liberties.sort();
        Some(Chain {
            color,
            stones,
            liberties,
        })
    }

    /// All chains on the board.
    #[must_use]
    pub fn all_chains(&self) -> Vec<Chain> {
        let mut visited = vec![false; self.cells.len()];
        let mut out = Vec::new();
        for y in 0..self.size {
            for x in 0..self.size {
                let p = Point::new(x, y);
                let idx = p.index(self.size);
                if visited[idx] || self.cells[idx].is_empty() {
                    continue;
                }
                if let Some(chain) = self.chain_at(p) {
                    for s in &chain.stones {
                        visited[s.index(self.size)] = true;
                    }
                    out.push(chain);
                }
            }
        }
        out
    }

    /// Play a stone with capture. Does **not** check ko / superko / suicide —
    /// callers in [`crate::game::GameState`] do.
    ///
    /// Returns the list of captured opponent stones.
    pub fn place_with_captures(&mut self, point: Point, color: Color) -> CoreResult<Vec<Point>> {
        if !self.get(point)?.is_empty() {
            return Err(CoreError::Occupied(point));
        }
        self.set(point, Stone::from_color(color))?;

        let opponent = color.opponent();
        let mut captured = Vec::new();
        for n in point.neighbors(self.size) {
            if self.get(n)?.color() != Some(opponent) {
                continue;
            }
            if let Some(chain) = self.chain_at(n) {
                if chain.liberty_count() == 0 {
                    for s in chain.stones {
                        if !captured.contains(&s) {
                            captured.push(s);
                        }
                    }
                }
            }
        }
        for s in &captured {
            self.set(*s, Stone::Empty)?;
        }

        // Suicide: own chain has no liberties after captures.
        if let Some(own) = self.chain_at(point) {
            if own.liberty_count() == 0 {
                // Roll back.
                self.set(point, Stone::Empty)?;
                for s in &captured {
                    self.set(*s, Stone::from_color(opponent))?;
                }
                return Err(CoreError::Suicide(point));
            }
        }

        captured.sort();
        Ok(captured)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_single_stone() {
        let mut b = Board::empty(9).unwrap();
        b.place_setup(Point::new(0, 0), Color::Black).unwrap();
        b.place_setup(Point::new(1, 0), Color::White).unwrap();
        let captured = b
            .place_with_captures(Point::new(0, 1), Color::White)
            .unwrap();
        assert_eq!(captured, vec![Point::new(0, 0)]);
        assert!(b.get(Point::new(0, 0)).unwrap().is_empty());
    }

    #[test]
    fn suicide_rejected() {
        let mut b = Board::empty(9).unwrap();
        b.place_setup(Point::new(1, 0), Color::White).unwrap();
        b.place_setup(Point::new(0, 1), Color::White).unwrap();
        let err = b
            .place_with_captures(Point::new(0, 0), Color::Black)
            .unwrap_err();
        assert_eq!(err, CoreError::Suicide(Point::new(0, 0)));
    }

    #[test]
    fn capture_rescues_apparent_suicide() {
        // White stone in atari at (0,0); Black fills the capturing point?
        // Corner: B at (1,0) and (0,1); W to play at (0,0) would be suicide.
        // Instead: B at (0,0); W at (1,0); B plays (0,1) — already tested.
        // Recapture shape: W stone at (1,0) with one liberty (0,0), surrounded.
        let mut b = Board::empty(9).unwrap();
        b.place_setup(Point::new(1, 0), Color::White).unwrap();
        b.place_setup(Point::new(0, 1), Color::Black).unwrap();
        b.place_setup(Point::new(1, 1), Color::Black).unwrap();
        b.place_setup(Point::new(2, 0), Color::Black).unwrap();
        // W(1,0) liberties: only (0,0). Black plays (0,0) capturing White.
        let captured = b
            .place_with_captures(Point::new(0, 0), Color::Black)
            .unwrap();
        assert_eq!(captured, vec![Point::new(1, 0)]);
    }

    #[test]
    fn chain_lists_liberties() {
        let mut b = Board::empty(9).unwrap();
        b.place_setup(Point::new(2, 2), Color::Black).unwrap();
        b.place_setup(Point::new(3, 2), Color::Black).unwrap();
        let chain = b.chain_at(Point::new(2, 2)).unwrap();
        assert_eq!(chain.stones.len(), 2);
        assert_eq!(chain.liberty_count(), 6);
    }
}
