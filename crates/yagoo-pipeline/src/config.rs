//! Pipeline knobs (defaults from `docs/appendix/parameters.md`).

use crate::select::DeepSelectConfig;
use serde::{Deserialize, Serialize};

/// How to prioritize positions across the game.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStrategy {
    /// Low-visit root-only scan of the range, then a deep pass on swing-selected plies.
    #[default]
    ScanThenDeep,
    /// Single deep pass only (no scan phase); deepens every ply in `--from`/`--to`.
    DeepOnly,
}

/// Configurable analysis parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct PipelineConfig {
    /// Compare each deeply analyzed played move at its historical root p-1.
    #[serde(default = "enabled")]
    pub include_comparison: bool,
    /// Re-search an actual candidate below this count (except exact equality).
    #[serde(default = "comparison_min_visits")]
    pub comparison_min_visits: u64,
    /// Query both played branches and their pass probes for status evidence.
    #[serde(default = "enabled")]
    pub comparison_branch_probes: bool,
    /// Query the preferred PV endpoint for downstream sacrifice evidence.
    #[serde(default = "enabled")]
    pub comparison_pv_end: bool,
    pub strategy: PipelineStrategy,
    /// Deep / primary root visits (default mid of 500–2000).
    pub root_visits: u32,
    /// Scan-phase visits.
    pub scan_visits: u32,
    /// PV-end query visits (default mid of 100–300).
    pub pv_end_visits: u32,
    /// Top-K candidates to keep from `moveInfos` (default mid of 5–8).
    pub top_k: usize,
    /// Inclusive ply range start (0 = setup position). Optional filter for scan + deep.
    pub from_ply: u32,
    /// Inclusive ply range end (`None` = last position).
    pub to_ply: Option<u32>,
    /// Run optional PV-end ownership queries for top candidates in the deep phase.
    pub include_pv_ends: bool,
    /// Max number of PV ends to query per position (capped by `top_k`).
    pub pv_end_count: usize,
    /// KataGo `reportDuringSearchEvery` seconds; `None` disables partials (default).
    pub report_during_search_every: Option<f64>,
    /// Include movesOwnership stdev on deep root queries.
    pub include_moves_ownership_stdev: bool,
    /// Rules string passed to KataGo (from SGF when available).
    pub rules_override: Option<String>,
    /// Emit aggregate `GameSnapshot` on `game_completed`.
    pub emit_game_aggregate: bool,
    /// Deepen every ply in the scanned range (skip swing auto-pick).
    pub deepen_all: bool,
    /// Swing thresholds / max deep plies (ignored when `deepen_all`).
    pub deep_select: DeepSelectConfig,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            include_comparison: true,
            comparison_min_visits: comparison_min_visits(),
            comparison_branch_probes: true,
            comparison_pv_end: true,
            strategy: PipelineStrategy::ScanThenDeep,
            root_visits: 800,
            scan_visits: 100,
            pv_end_visits: 200,
            top_k: 6,
            from_ply: 0,
            to_ply: None,
            include_pv_ends: false,
            pv_end_count: 3,
            report_during_search_every: None,
            include_moves_ownership_stdev: true,
            rules_override: None,
            emit_game_aggregate: true,
            deepen_all: false,
            deep_select: DeepSelectConfig::default(),
        }
    }
}

const fn enabled() -> bool {
    true
}
const fn comparison_min_visits() -> u64 {
    16
}
