//! Durable per-position / per-game snapshot types.

use serde::{Deserialize, Serialize};

/// Wire schema version for snapshot JSON documents.
pub const SCHEMA_VERSION: u32 = 1;

/// Ownership / winrate sign convention stored in snapshots.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OwnershipConvention {
    /// Black positive, White negative (Yagoo default).
    #[default]
    BlackPositive,
}

/// `"B"` / `"W"` in snapshot JSON.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ColorToken {
    B,
    W,
}

impl From<yagoo_core::Color> for ColorToken {
    fn from(c: yagoo_core::Color) -> Self {
        match c {
            yagoo_core::Color::Black => Self::B,
            yagoo_core::Color::White => Self::W,
        }
    }
}

/// Board stones for a position (GTP coordinates).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub size: u8,
    pub black: Vec<String>,
    pub white: Vec<String>,
}

/// One rules chain (串), not a teaching group.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainSnapshot {
    pub color: ColorToken,
    pub stones: Vec<String>,
    pub liberties: Vec<String>,
    pub liberty_count: usize,
}

/// Compact copy of Analysis Engine scalars + ownership used by teaching modules.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAnalysis {
    pub visits: Option<u64>,
    pub winrate: Option<f64>,
    pub score_lead: Option<f64>,
    pub score_stdev: Option<f64>,
    pub utility: Option<f64>,
    /// Row-major from A19; black-positive.
    pub ownership: Option<Vec<f64>>,
    pub ownership_stdev: Option<Vec<f64>>,
    pub policy: Option<Vec<f64>>,
}

/// One top candidate from `moveInfos` (includes movesOwnership when present).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSnapshot {
    #[serde(rename = "move")]
    pub move_: String,
    pub order: Option<u32>,
    pub visits: Option<u64>,
    pub winrate: Option<f64>,
    pub score_lead: Option<f64>,
    pub score_stdev: Option<f64>,
    pub prior: Option<f64>,
    pub utility: Option<f64>,
    pub lcb: Option<f64>,
    pub pv: Option<Vec<String>>,
    pub pv_visits: Option<Vec<u64>>,
    pub ownership: Option<Vec<f64>>,
    pub ownership_stdev: Option<Vec<f64>>,
}

/// Optional PV-end root analysis.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PvEndSnapshot {
    pub from_move: String,
    pub pv: Vec<String>,
    pub analysis: EngineAnalysis,
}

/// Why a pass probe was not run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PassProbeSkipReason {
    /// Previous action was already a pass (consecutive passes may end the game).
    PreviousWasPass,
    /// Disabled by pipeline config for this phase.
    DisabledInPhase,
}

/// Full teaching input for one board position.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionSnapshot {
    pub schema_version: u32,
    pub ply: u32,
    pub to_play: ColorToken,
    /// GTP move that produced this position (`None` / omitted at ply 0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_move: Option<String>,
    pub ownership_convention: OwnershipConvention,
    pub board: BoardSnapshot,
    pub chains: Vec<ChainSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<EngineAnalysis>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pass_probe: Option<EngineAnalysis>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pass_probe_skipped: Option<PassProbeSkipReason>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<CandidateSnapshot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pv_ends: Vec<PvEndSnapshot>,
    /// Pipeline phase that last completed a deep/scan fill for this position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
}

impl PositionSnapshot {
    #[must_use]
    pub fn empty_shell(
        ply: u32,
        to_play: ColorToken,
        board: BoardSnapshot,
        chains: Vec<ChainSnapshot>,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            ply,
            to_play,
            last_move: None,
            ownership_convention: OwnershipConvention::BlackPositive,
            board,
            chains,
            root: None,
            pass_probe: None,
            pass_probe_skipped: None,
            candidates: Vec::new(),
            pv_ends: Vec::new(),
            phase: None,
        }
    }
}

/// Aggregated game document (written optionally at the end).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshot {
    pub schema_version: u32,
    pub size: u8,
    pub komi: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    pub ownership_convention: OwnershipConvention,
    pub positions: Vec<PositionSnapshot>,
}
