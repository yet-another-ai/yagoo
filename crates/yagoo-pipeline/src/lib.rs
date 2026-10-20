//! Async streaming analysis pipeline: SGF → per-position snapshot events.
//!
//! See `docs/pipeline/streaming.md` for event order and scan-then-deep strategy.

#![forbid(unsafe_code)]

mod config;
mod engine;
mod error;
mod interactive;
mod run;
mod select;

pub use config::{PipelineConfig, PipelineStrategy};
pub use engine::{AnalysisEngine, UpdateCallback};
pub use error::{PipelineError, PipelineResult};
pub use interactive::{
    analyze_position, complete_position, prepare_position, validate_analysis_sgf,
    InteractivePositionRequest, PreparedPosition,
};
pub use run::{analyze_game, analyze_game_collected};
pub use select::{select_deep_plies, DeepPlyReason, DeepSelectConfig};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
