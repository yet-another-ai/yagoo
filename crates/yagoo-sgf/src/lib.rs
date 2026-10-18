//! SGF (Smart Game Format) parsing focused on the **main line**.
//!
//! Supports board size, komi, rules, handicap, and `AB`/`AW` setup stones.

#![forbid(unsafe_code)]

mod error;
mod parse;
mod record;
mod replay;

pub use error::{SgfError, SgfResult};
pub use parse::parse_sgf;
pub use record::{GameRecord, GameTreeNode, MoveRecord, SetupStones};
pub use replay::{filter_ply_range, move_to_gtp, point_gtp, replay_main_line, ReplayedPosition};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
