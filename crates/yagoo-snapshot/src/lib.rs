//! Versioned snapshot schema and NDJSON streaming events.
//!
//! Ownership and winrates in snapshots are **black-positive**
//! (`reportAnalysisWinratesAs = BLACK`). See `docs/pipeline/snapshots.md`.

#![forbid(unsafe_code)]

mod convert;
mod events;
mod schema;

pub use convert::{
    board_from_game, candidate_from_move_info, candidates_from_response, chains_from_game,
    engine_from_response,
};
pub use events::{AnalysisPhase, AnalysisStage, DeepPlySelection, PipelineEvent};
pub use schema::{
    BoardSnapshot, CandidateSnapshot, ChainSnapshot, ColorToken, EngineAnalysis, GameSnapshot,
    OwnershipConvention, PassProbeSkipReason, PositionSnapshot, PvEndSnapshot, SCHEMA_VERSION,
};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
