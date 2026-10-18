//! Orthogonal chains (串) — rules objects, not teaching groups.

use crate::color::Color;
use crate::coord::Point;

/// A maximal 4-connected set of same-color stones.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chain {
    pub color: Color,
    pub stones: Vec<Point>,
    pub liberties: Vec<Point>,
}

impl Chain {
    #[must_use]
    pub fn liberty_count(&self) -> usize {
        self.liberties.len()
    }
}
