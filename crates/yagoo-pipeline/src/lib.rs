//! Async streaming analysis pipeline: SGF → per-position snapshot events.
//!
//! See `docs/pipeline/streaming.md` for event order and scan-then-deep strategy.

#![forbid(unsafe_code)]

mod config;
mod error;
mod run;

pub use config::{PipelineConfig, PipelineStrategy};
pub use error::{PipelineError, PipelineResult};
pub use run::{analyze_game, analyze_game_collected};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
