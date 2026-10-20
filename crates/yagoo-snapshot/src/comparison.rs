//! Actual move p versus the engine's preferred move at root p-1.

use serde::{Deserialize, Serialize};
use yagoo_core::Point;

use crate::{
    compute_ledger_against_with_tempo, BoardSnapshot, CandidateSnapshot, ColorToken,
    EngineAnalysis, GainLossLedger, GroupParams, GroupSnapshot, GroupStatus, PositionSnapshot,
    PvEndSnapshot,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonCandidateSource {
    RootCandidate,
    Forced,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonEvidence {
    pub root_query_id: String,
    pub actual_query_id: String,
    pub actual_source: ComparisonCandidateSource,
    pub requested_visits: u32,
    pub minimum_candidate_visits: u64,
    pub root_visits: Option<u64>,
    pub actual_visits: Option<u64>,
    pub ai_visits: Option<u64>,
    pub root_hash: Option<String>,
    pub actual_root_hash: Option<String>,
    pub limitations: Vec<String>,
}

/// One played branch and its own explicit pass counterfactual.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonBranch {
    pub to_play: ColorToken,
    pub board: BoardSnapshot,
    pub root: EngineAnalysis,
    pub pass_probe: Option<EngineAnalysis>,
    pub root_query_id: String,
    pub pass_query_id: Option<String>,
}

/// Self-contained context for comparison and preferred-line sacrifice modules.
/// All group member coordinates refer to `board`, before either move is played.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonContext {
    pub root_ply: u32,
    pub mover: ColorToken,
    pub board: BoardSnapshot,
    pub groups: Vec<GroupSnapshot>,
    pub root: EngineAnalysis,
    pub pass_probe: Option<EngineAnalysis>,
    pub pass_query_id: Option<String>,
    pub actual: CandidateSnapshot,
    pub preferred: CandidateSnapshot,
    pub actual_branch: Option<ComparisonBranch>,
    pub preferred_branch: Option<ComparisonBranch>,
    pub preferred_pv_end: Option<PvEndSnapshot>,
    pub preferred_pv_query_id: Option<String>,
    /// Retained candidates of this same root, used to find saving alternatives.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_candidates: Vec<CandidateSnapshot>,
    /// Legal replays from the complete root, preserving original stone identity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pv_lineages: Vec<crate::CandidatePvLineage>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonGroupTempo {
    pub group_id: String,
    pub color: ColorToken,
    /// Fixed root stone coordinates, preserving identity after capture.
    pub stones: Vec<String>,
    pub actual_status: GroupStatus,
    pub preferred_status: GroupStatus,
    pub actual_g_plus: f64,
    pub actual_g_minus: f64,
    pub preferred_g_plus: f64,
    pub preferred_g_minus: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveComparison {
    pub ply: u32,
    pub root_ply: u32,
    pub mover: ColorToken,
    pub actual_move: String,
    pub ai_move: String,
    /// Winrate fractions in the mover's perspective.
    pub actual_winrate: f64,
    pub ai_winrate: f64,
    /// Both score leads remain Black-positive.
    pub actual_score_lead: f64,
    pub ai_score_lead: f64,
    /// AI minus actual in mover perspective; finite-visit estimates can be negative.
    pub winrate_loss: f64,
    pub score_loss: f64,
    /// Actual minus preferred ownership, still Black-positive.
    pub ownership_delta: Vec<f64>,
    pub ledger_diff: Option<GainLossLedger>,
    pub context: ComparisonContext,
    pub evidence: ComparisonEvidence,
    /// Per-color statuses from explicit branch/root pass pairs, when available.
    pub group_tempo: Vec<ComparisonGroupTempo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sacrifice_assessment: Option<crate::SacrificeAssessment>,
}

/// Validate enough candidate evidence to make comparison claims.
#[must_use]
pub fn candidate_has_comparison_evidence(candidate: &CandidateSnapshot, size: u8) -> bool {
    candidate.visits.is_some_and(|visits| visits > 0)
        && candidate
            .winrate
            .is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        && candidate.score_lead.is_some_and(f64::is_finite)
        && candidate
            .ownership
            .as_deref()
            .is_some_and(|map| valid_map(map, size))
}

pub(crate) fn valid_map(map: &[f64], size: u8) -> bool {
    (2..=25).contains(&size)
        && map.len() == usize::from(size).pow(2)
        && map
            .iter()
            .all(|value| value.is_finite() && (-1.0..=1.0).contains(value))
}

/// Derive claims only from two candidate branches of the identical pre-move root.
/// Missing, malformed, wrong-ply or conflicting hash evidence is rejected.
#[must_use]
pub fn compute_move_comparison(
    ply: u32,
    context: ComparisonContext,
    evidence: ComparisonEvidence,
) -> Option<MoveComparison> {
    if context.root_ply.checked_add(1)? != ply
        || !candidate_has_comparison_evidence(&context.actual, context.board.size)
        || !candidate_has_comparison_evidence(&context.preferred, context.board.size)
        || matches!((&evidence.root_hash, &evidence.actual_root_hash), (Some(root), Some(actual)) if root != actual)
    {
        return None;
    }
    let actual = &context.actual;
    let preferred = &context.preferred;
    let mut root = PositionSnapshot::empty_shell(
        context.root_ply,
        context.mover,
        context.board.clone(),
        vec![],
    );
    root.groups.clone_from(&context.groups);
    let group_tempo = compute_branch_tempo(&context);
    let ledger_diff = compute_ledger_against_with_tempo(&root, actual, preferred, &group_tempo);
    let sign = if context.mover == ColorToken::B {
        1.0
    } else {
        -1.0
    };
    let mover_winrate = |value: f64| {
        if context.mover == ColorToken::B {
            value
        } else {
            1.0 - value
        }
    };
    let actual_winrate = mover_winrate(actual.winrate?);
    let ai_winrate = mover_winrate(preferred.winrate?);
    let actual_score_lead = actual.score_lead?;
    let ai_score_lead = preferred.score_lead?;
    let score_loss = sign * (ai_score_lead - actual_score_lead);
    if !score_loss.is_finite() {
        return None;
    }
    let mut comparison = MoveComparison {
        ply,
        root_ply: context.root_ply,
        mover: context.mover,
        actual_move: actual.move_.clone(),
        ai_move: preferred.move_.clone(),
        actual_winrate,
        ai_winrate,
        actual_score_lead,
        ai_score_lead,
        winrate_loss: ai_winrate - actual_winrate,
        score_loss,
        ownership_delta: actual
            .ownership
            .as_ref()?
            .iter()
            .zip(preferred.ownership.as_ref()?)
            .map(|(actual, preferred)| actual - preferred)
            .collect(),
        ledger_diff,
        group_tempo,
        context,
        evidence,
        sacrifice_assessment: None,
    };
    comparison.sacrifice_assessment = Some(crate::compute_sacrifices(&comparison));
    Some(comparison)
}

fn compute_branch_tempo(context: &ComparisonContext) -> Vec<ComparisonGroupTempo> {
    let (Some(actual), Some(preferred)) = (&context.actual_branch, &context.preferred_branch)
    else {
        return vec![];
    };
    let mut result = Vec::new();
    for group in &context.groups {
        for (color, stones) in [
            (ColorToken::B, &group.members.black_stones),
            (ColorToken::W, &group.members.white_stones),
        ] {
            if stones.is_empty() {
                continue;
            }
            let Some((actual_status, actual_g_plus, actual_g_minus)) =
                branch_tempo(actual, color, stones)
            else {
                continue;
            };
            let Some((preferred_status, preferred_g_plus, preferred_g_minus)) =
                branch_tempo(preferred, color, stones)
            else {
                continue;
            };
            result.push(ComparisonGroupTempo {
                group_id: group.group_id.clone(),
                color,
                stones: stones.clone(),
                actual_status,
                preferred_status,
                actual_g_plus,
                actual_g_minus,
                preferred_g_plus,
                preferred_g_minus,
            });
        }
    }
    result
}

fn branch_tempo(
    branch: &ComparisonBranch,
    color: ColorToken,
    stones: &[String],
) -> Option<(GroupStatus, f64, f64)> {
    let size = branch.board.size;
    let root = branch.root.ownership.as_deref()?;
    let pass = branch.pass_probe.as_ref()?.ownership.as_deref()?;
    if !valid_map(root, size) || !valid_map(pass, size) {
        return None;
    }
    let indices = stones
        .iter()
        .map(|stone| {
            if !stone.is_ascii()
                || stone.len() < 2
                || !stone
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphabetic)
            {
                return None;
            }
            Point::parse_gtp(stone, size)
                .ok()
                .flatten()
                .map(|point| point.index(size))
        })
        .collect::<Option<Vec<_>>>()?;
    let count = f64::from(u32::try_from(indices.len()).ok()?);
    let sign = if color == ColorToken::B { 1.0 } else { -1.0 };
    let root_strength = sign * indices.iter().map(|&index| root[index]).sum::<f64>() / count;
    let pass_strength = sign * indices.iter().map(|&index| pass[index]).sum::<f64>() / count;
    let (plus, minus) = if color == branch.to_play {
        (root_strength, pass_strength)
    } else {
        (pass_strength, root_strength)
    };
    // These probes establish one-move sensitivity, not geometric seki evidence.
    let params = GroupParams {
        seki_certainty: f64::INFINITY,
        ..GroupParams::default()
    };
    let status = crate::groups::tempo::classify_status(plus, minus, 0.0, stones.len(), &params);
    Some((status, plus, minus))
}
