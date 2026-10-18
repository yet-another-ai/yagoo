//! Stone / player colors.

use std::fmt;

/// Stone color on the board.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Color {
    Black,
    White,
}

impl Color {
    /// Opponent color.
    #[must_use]
    pub const fn opponent(self) -> Self {
        match self {
            Self::Black => Self::White,
            Self::White => Self::Black,
        }
    }
}

impl fmt::Display for Color {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Black => "B",
            Self::White => "W",
        })
    }
}

/// Side to play (same as [`Color`] for standard Go).
pub type Player = Color;
