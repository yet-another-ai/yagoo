//! Typed Analysis Engine query / response fields used by Yagoo.
//!
//! Field coverage follows `docs/data-sources.md` (Path A).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// A protocol update shared by the process and browser engines.
#[derive(Clone, Debug)]
pub enum AnalysisUpdate {
    Partial(AnalysisResponse),
    Final(AnalysisResponse),
}

/// `"B"` / `"W"` as used in Analysis Engine JSON.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum PlayerToken {
    B,
    W,
}

impl PlayerToken {
    #[must_use]
    pub const fn from_color(color: yagoo_core::Color) -> Self {
        match color {
            yagoo_core::Color::Black => Self::B,
            yagoo_core::Color::White => Self::W,
        }
    }
}

/// One element of `initialStones` / `moves`: `[color, gtpCoord]`.
pub type MoveListEntry = (PlayerToken, String);

/// `overrideSettings` bag — pass through known keys as JSON values.
pub type OverrideSettings = HashMap<String, Value>;

/// Analysis Engine query (request line).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisQuery {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_player: Option<PlayerToken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub initial_stones: Vec<MoveListEntry>,
    /// Always serialized (even as `[]`) — KataGo ≥1.16 rejects a missing `moves` field.
    #[serde(default)]
    pub moves: Vec<MoveListEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub komi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_x_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_y_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_visits: Option<u32>,
    /// Seconds between during-search progress reports (KataGo `reportDuringSearchEvery`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_during_search_every: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_pv_len: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_ownership: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_ownership_stdev: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_moves_ownership: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_moves_ownership_stdev: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_policy: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_pv_visits: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoid_moves: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_moves: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_moves: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_settings: Option<OverrideSettings>,
}

/// `rootInfo` object.
///
/// Per KataGo Analysis Engine docs, scalars live here. Per-point arrays
/// (`ownership`, `ownershipStdev`, `policy`, `humanPolicy`) are top-level
/// on [`AnalysisResponse`], not nested under `rootInfo`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    #[serde(default)]
    pub winrate: Option<f64>,
    #[serde(default)]
    pub score_lead: Option<f64>,
    #[serde(default)]
    pub score_selfplay: Option<f64>,
    #[serde(default)]
    pub utility: Option<f64>,
    #[serde(default)]
    pub visits: Option<u64>,
    #[serde(default)]
    pub raw_st_wr_error: Option<f64>,
    #[serde(default)]
    pub raw_st_score_error: Option<f64>,
    #[serde(default)]
    pub raw_var_time_left: Option<f64>,
}

/// One entry in `moveInfos`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveInfo {
    #[serde(rename = "move")]
    pub move_: String,
    #[serde(default)]
    pub visits: Option<u64>,
    #[serde(default)]
    pub winrate: Option<f64>,
    #[serde(default)]
    pub score_lead: Option<f64>,
    #[serde(default)]
    pub score_stdev: Option<f64>,
    #[serde(default)]
    pub prior: Option<f64>,
    #[serde(default)]
    pub human_prior: Option<f64>,
    #[serde(default)]
    pub utility: Option<f64>,
    #[serde(default)]
    pub lcb: Option<f64>,
    #[serde(default)]
    pub order: Option<u32>,
    #[serde(default)]
    pub pv: Option<Vec<String>>,
    #[serde(default)]
    pub pv_visits: Option<Vec<u64>>,
    #[serde(default)]
    pub ownership: Option<Vec<f64>>,
    #[serde(default)]
    pub ownership_stdev: Option<Vec<f64>>,
}

impl MoveInfo {
    /// GTP coordinate or `"pass"`.
    #[must_use]
    pub fn gtp_move(&self) -> &str {
        &self.move_
    }
}

/// A root identity-symmetry NN sample, separate from search-averaged estimates.
/// Spatial arrays retain the model's 19x19 padding and channel-first order.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RootNeuralOutput {
    #[serde(rename = "sampleToPlay")]
    pub to_play: PlayerToken,
    pub sample_symmetry: String,
    pub aggregation: String,
    pub tensor_layout: String,
    pub board_size: u8,
    pub model_board_size: u8,
    /// Natural log probabilities. Bin i is score_bin_first_center + i.
    pub score_belief_log_probs: Vec<f32>,
    pub score_bin_first_center: f64,
    /// Four 19x19 channels: first three softmax together, fourth sigmoid alone.
    pub seki_logits: Vec<f32>,
    /// Two 19x19 channels, pretanh stone occupancy at +8 / +32 half-moves.
    #[serde(rename = "futurePositionPreTanh")]
    pub futurepos_pretanh: Vec<f32>,
}

/// Full analysis response line.
///
/// Top-level per-position arrays match the Analysis Engine protocol:
/// `ownership` / `ownershipStdev` (when `includeOwnership*`), `policy` /
/// `humanPolicy` (when `includePolicy`). Candidate ownership still lives on
/// each [`MoveInfo`] when `includeMovesOwnership*` is set.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResponse {
    pub id: String,
    #[serde(default)]
    pub is_during_search: Option<bool>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
    #[serde(default)]
    pub move_infos: Option<Vec<MoveInfo>>,
    #[serde(default)]
    pub root_info: Option<RootInfo>,
    /// Row-major from A19, values in [-1, 1], black-positive when configured.
    #[serde(default)]
    pub ownership: Option<Vec<f64>>,
    #[serde(default)]
    pub ownership_stdev: Option<Vec<f64>>,
    #[serde(default)]
    pub policy: Option<Vec<f64>>,
    #[serde(default)]
    pub human_policy: Option<Vec<f64>>,
    /// Browser extension, absent from native KataGo and terminal positions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub neural: Option<RootNeuralOutput>,
    /// Catch-all for forward compatibility.
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}
