//! NDJSON / in-process streaming event types.

use crate::schema::{EngineAnalysis, GameSnapshot, PositionSnapshot, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};

/// Pipeline prioritization phase.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisPhase {
    /// Low-visit root-only pass over the move range.
    Scan,
    /// Full visits with pass probe + candidates (+ optional PV ends).
    Deep,
}

/// Analysis stage within a position.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStage {
    Root,
    PassProbe,
    PvEnd,
}

/// Streaming events for CLI NDJSON and future WebGPU consumers.
///
/// Typical order for strategy `scan_then_deep`:
/// 1. `game_started`
/// 2. `phase_started` (scan)
/// 3. per ply: `position_started` → optional `stage_partial`* → `stage_completed` (root)
///    → `position_completed`
/// 4. `phase_completed` (scan)
/// 5. `phase_started` (deep)
/// 6. per ply: root (partials + completed) → pass_probe → optional pv_end* → `position_completed`
/// 7. `phase_completed` (deep)
/// 8. `game_completed`
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PipelineEvent {
    #[serde(rename_all = "camelCase")]
    GameStarted {
        v: u32,
        size: u8,
        komi: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        rules: Option<String>,
        move_count: u32,
        position_count: u32,
        strategy: String,
    },
    #[serde(rename_all = "camelCase")]
    PhaseStarted {
        v: u32,
        phase: AnalysisPhase,
        visits: u32,
    },
    #[serde(rename_all = "camelCase")]
    PhaseCompleted { v: u32, phase: AnalysisPhase },
    #[serde(rename_all = "camelCase")]
    PositionStarted {
        v: u32,
        ply: u32,
        to_play: String,
        phase: AnalysisPhase,
    },
    /// During-search refinement (`reportDuringSearchEvery`). Safe to render; may be noisy.
    #[serde(rename_all = "camelCase")]
    StagePartial {
        v: u32,
        ply: u32,
        phase: AnalysisPhase,
        stage: AnalysisStage,
        visits: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        root: Option<EngineAnalysis>,
    },
    #[serde(rename_all = "camelCase")]
    StageCompleted {
        v: u32,
        ply: u32,
        phase: AnalysisPhase,
        stage: AnalysisStage,
        #[serde(skip_serializing_if = "Option::is_none")]
        analysis: Option<EngineAnalysis>,
        #[serde(skip_serializing_if = "Option::is_none")]
        skipped: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    PositionCompleted {
        v: u32,
        phase: AnalysisPhase,
        snapshot: Box<PositionSnapshot>,
    },
    #[serde(rename_all = "camelCase")]
    GameCompleted {
        v: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        game: Option<Box<GameSnapshot>>,
    },
    #[serde(rename_all = "camelCase")]
    Warning { v: u32, message: String },
    #[serde(rename_all = "camelCase")]
    Error {
        v: u32,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        ply: Option<u32>,
    },
}

impl PipelineEvent {
    #[must_use]
    pub const fn schema_version() -> u32 {
        SCHEMA_VERSION
    }
}
