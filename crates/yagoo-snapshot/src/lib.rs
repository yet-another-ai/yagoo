//! Versioned snapshot schema and NDJSON streaming events.
//!
//! Engine ownership and winrates in snapshots are **black-positive**
//! (`reportAnalysisWinratesAs = BLACK`). See `docs/pipeline/snapshots.md`.
//! `MoveComparison` explicitly converts its displayed winrates to mover perspective.
//!
//! Teaching **groups** (块) are computed from deep ownership scenarios via
//! [`compute_groups`] — see `docs/modules/groups.md`.

#![forbid(unsafe_code)]

mod comparison;
mod convert;
mod events;
mod groups;
mod ledger;
mod openings;
mod pv_lineage;
mod sacrifice;
mod schema;

pub use comparison::{
    candidate_has_comparison_evidence, compute_move_comparison, ComparisonBranch,
    ComparisonCandidateSource, ComparisonContext, ComparisonEvidence, ComparisonGroupTempo,
    MoveComparison, SavingCandidateProbe,
};
pub use convert::{
    board_from_game, candidate_from_move_info, candidates_from_response, chains_from_game,
    engine_from_response,
};
pub use events::{AnalysisPhase, AnalysisStage, DeepPlySelection, PipelineEvent};
pub use groups::{compute_groups, compute_groups_with_params, GroupParams};
pub use ledger::{
    best_candidate, compute_ledger, compute_ledger_against, compute_ledger_against_with_tempo,
    compute_tempo_changes, GainLossLedger, GainLossLine, GroupTempoChange, LedgerBaseline,
    LedgerInconsistency, LedgerLineKind, LedgerScaling, LedgerStrengthChange, LedgerTempo,
    LEDGER_CONSISTENCY_TOLERANCE, LEDGER_STRENGTH_THRESHOLD,
};
pub use openings::match_opening;
pub use pv_lineage::{trace_candidate_pv, CandidatePvLineage, RootStoneCapture};
pub use sacrifice::{
    compute_sacrifices, compute_sacrifices_with_params, SacrificeAnnotation, SacrificeAssessment,
    SacrificeAssessmentStatus, SacrificeCheck, SacrificeEvidence, SacrificeExchange,
    SacrificeParams, SacrificeReason, SacrificeReferenceSource,
};
pub use schema::{
    BoardSnapshot, CandidateSnapshot, ChainSnapshot, ColorToken, EngineAnalysis, GameSnapshot,
    GroupKind, GroupMembers, GroupPart, GroupSnapshot, GroupSource, GroupStatus, GroupStrength,
    OpeningMatch, OwnershipConvention, PassProbeSkipReason, PositionSnapshot, PvEndSnapshot,
    SCHEMA_VERSION,
};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
