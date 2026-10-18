//! SGF (Smart Game Format) parsing focused on the **main line**.
//!
//! Supports board size, komi, rules, handicap, and `AB`/`AW` setup stones.

#![forbid(unsafe_code)]

mod error;
mod parse;
mod record;

pub use error::{SgfError, SgfResult};
pub use parse::parse_sgf;
pub use record::{GameRecord, GameTreeNode, MoveRecord, SetupStones};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
