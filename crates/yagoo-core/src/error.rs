//! Errors for board / rules operations.

use crate::coord::Point;
use thiserror::Error;

/// Convenient result alias.
pub type CoreResult<T> = Result<T, CoreError>;

/// Board and coordinate errors.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CoreError {
    #[error("invalid board size {0} (must be 2..=25)")]
    InvalidBoardSize(u8),

    #[error("invalid coordinate `{0}`")]
    InvalidCoordinate(String),

    #[error("point {point:?} is out of bounds for size {size}")]
    OutOfBounds { point: Point, size: u8 },

    #[error("point {0:?} is occupied")]
    Occupied(Point),

    #[error("move at {0:?} is suicidal")]
    Suicide(Point),

    #[error("move at {0:?} violates simple ko")]
    SimpleKo(Point),

    #[error("move at {0:?} repeats a prior position (superko)")]
    Superko(Point),

    #[error("no moves left to undo")]
    NothingToUndo,
}
