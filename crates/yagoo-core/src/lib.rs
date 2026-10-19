//! Board rules and coordinates for Yagoo.
//!
//! Teaching modules (groups, tempo, …) build on board/chain primitives here;
//! group clustering itself lives in `yagoo-snapshot::compute_groups`.
//! A **chain** (串) is a maximal orthogonally connected same-color string.
//! A teaching **group** (块) is a separate concept — see `docs/glossary.md`.

#![forbid(unsafe_code)]

mod board;
mod chain;
mod color;
mod coord;
mod error;
mod game;
pub mod nn_features;

pub use board::{Board, MovePlay, Stone};
pub use chain::Chain;
pub use color::{Color, Player};
pub use coord::{Point, BOARD_SIZE_19};
pub use error::{CoreError, CoreResult};
pub use game::{GameState, Ruleset};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
