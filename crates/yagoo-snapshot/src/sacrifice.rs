//! Conservative, counterfactual sacrifice candidates at a single historical root.
//! Ownership alone is not capture evidence. See docs/modules/sacrifices.md.
use serde::{Deserialize, Serialize};
use yagoo_core::Point;

use crate::{
    candidate_has_comparison_evidence, compute_ledger_against, CandidatePvLineage,
    CandidateSnapshot, ColorToken, GroupSnapshot, LedgerLineKind, MoveComparison, PositionSnapshot,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SacrificeParams {
    pub minimum_stones: usize,
    pub minimum_visits: u64,
    pub saving_ownership_minimum: f64,
    pub preferred_ownership_maximum: f64,
    pub endpoint_ownership_maximum: f64,
    pub ownership_flip_minimum: f64,
    pub minimum_compensation_book: f64,
    pub maximum_score_decline: f64,
    pub maximum_winrate_decline: f64,
    pub maximum_endpoint_score_decline: f64,
    pub maximum_endpoint_winrate_decline: f64,
}

impl Default for SacrificeParams {
    fn default() -> Self {
        Self {
            minimum_stones: 2,
            minimum_visits: 16,
            saving_ownership_minimum: 0.6,
            preferred_ownership_maximum: -0.4,
            endpoint_ownership_maximum: -0.6,
            ownership_flip_minimum: 1.0,
            minimum_compensation_book: 0.5,
            maximum_score_decline: 1.0,
            maximum_winrate_decline: 0.02,
            maximum_endpoint_score_decline: 3.0,
            maximum_endpoint_winrate_decline: 0.03,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SacrificeAssessmentStatus {
    Assessed,
    Unassessed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SacrificeReason {
    Supported,
    InvalidEvidence,
    MissingPreferredPv,
    InsufficientVisits,
    MixedOrOpponentGroup,
    TooFewStones,
    OriginalStonesNotCaptured,
    OwnershipNotLost,
    SavingAlternativeUnavailable,
    GlobalValueDeclines,
    CompensationUnavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SacrificeCheck {
    pub group_id: String,
    pub reason: SacrificeReason,
    pub reference_move: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SacrificeExchange {
    pub kind: LedgerLineKind,
    pub id: Option<String>,
    pub intersections: Vec<String>,
    /// Preferred minus saving alternative, mover-positive. Negative is another cost.
    pub book_value: f64,
    pub proportion: f64,
    pub points: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SacrificeReferenceSource {
    #[default]
    RootCandidate,
    ActualForced,
    SavingForced,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SacrificeEvidence {
    pub root_query_id: String,
    pub reference_query_id: String,
    #[serde(default)]
    pub reference_source: SacrificeReferenceSource,
    #[serde(default)]
    pub reference_root_hash: Option<String>,
    pub preferred_pv_query_id: String,
    pub root_hash: Option<String>,
    pub preferred_visits: u64,
    pub reference_visits: u64,
    pub endpoint_visits: u64,
    pub preferred_capture_ply_offset: usize,
    pub reference_pv: Vec<String>,
    /// Preferred minus saving alternative, in mover perspective.
    pub score_advantage: f64,
    pub winrate_advantage: f64,
    /// Endpoint minus preferred root value; a viability check, not attribution.
    pub endpoint_score_change: f64,
    pub endpoint_winrate_change: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SacrificeAnnotation {
    pub root_ply: u32,
    pub mover: ColorToken,
    pub group_id: String,
    pub stones: Vec<String>,
    pub captured_stones: Vec<String>,
    pub preferred_move: String,
    pub reference_move: String,
    /// Saving-alternative own-color ownership minus preferred own-color ownership.
    pub ownership_flip: f64,
    pub root_ownership: Option<f64>,
    pub reference_ownership: f64,
    pub preferred_ownership: f64,
    pub endpoint_ownership: f64,
    /// Positive group cost and NET elsewhere benefit from the same-root ledger.
    pub cost_book: f64,
    pub compensation_book: f64,
    /// Only available with consistent, sign-preserving search scaling.
    pub compensation_points: Option<f64>,
    pub exchanged_with: Vec<String>,
    pub exchanges: Vec<SacrificeExchange>,
    pub pv: Vec<String>,
    pub evidence: SacrificeEvidence,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SacrificeAssessment {
    pub root_ply: u32,
    pub mover: ColorToken,
    pub preferred_move: String,
    pub status: SacrificeAssessmentStatus,
    pub annotations: Vec<SacrificeAnnotation>,
    pub checks: Vec<SacrificeCheck>,
    pub parameters: SacrificeParams,
    pub limitations: Vec<String>,
}

#[must_use]
pub fn compute_sacrifices(comparison: &MoveComparison) -> SacrificeAssessment {
    compute_sacrifices_with_params(comparison, &SacrificeParams::default())
}

/// Does not infer intent or sacrifice from a root-to-end ownership revision.
/// A retained saving alternative must preserve the same original stones through
/// the capture horizon, and the preferred line must physically capture all of them.
#[must_use]
pub fn compute_sacrifices_with_params(
    comparison: &MoveComparison,
    params: &SacrificeParams,
) -> SacrificeAssessment {
    let context = &comparison.context;
    let mut assessment = SacrificeAssessment {
        root_ply: comparison.root_ply,
        mover: comparison.mover,
        preferred_move: comparison.ai_move.clone(),
        status: SacrificeAssessmentStatus::Unassessed,
        annotations: Vec::new(),
        checks: Vec::new(),
        parameters: params.clone(),
        limitations: vec![
            "Initial thresholds are uncalibrated; a supported candidate is not proof of intent."
                .into(),
            "Only retained same-root candidates, bounded explicit saving probes and finite legal PVs are checked. Unseen saving alternatives, partial captures, single stones and newly played throw-ins may be missed.".into(),
            "Ownership book units are not points. Later-root analysis is used only for viability, never for exchange attribution.".into(),
        ],
    };
    if let Some(reason) = prerequisites(comparison, params) {
        assessment.limitations.push(match reason {
            SacrificeReason::InsufficientVisits => "Assessment unavailable: preferred or endpoint analysis has fewer than the required visits.",
            SacrificeReason::MissingPreferredPv => "Assessment unavailable: matching legal preferred PV lineage or endpoint analysis is missing.",
            _ => "Assessment unavailable: root, candidate, or endpoint evidence is invalid.",
        }.into());
        return assessment;
    }
    assessment.status = SacrificeAssessmentStatus::Assessed;
    for group in &context.groups {
        let outcome = check_group(comparison, group, params);
        let (reason, reference_move) = match outcome {
            Ok(annotation) => {
                let reference_move = Some(annotation.reference_move.clone());
                assessment.annotations.push(annotation);
                (SacrificeReason::Supported, reference_move)
            }
            Err(reason) => (reason, None),
        };
        assessment.checks.push(SacrificeCheck {
            group_id: group.group_id.clone(),
            reason,
            reference_move,
        });
    }
    assessment
}

fn prerequisites(comparison: &MoveComparison, params: &SacrificeParams) -> Option<SacrificeReason> {
    let context = &comparison.context;
    if context.root_ply.checked_add(1) != Some(comparison.ply)
        || context.root_ply != comparison.root_ply
        || context.mover != comparison.mover
        || context.preferred.move_ != comparison.ai_move
        || !valid_params(params)
        || !candidate_has_comparison_evidence(&context.preferred, context.board.size)
        || matches!((&comparison.evidence.root_hash, &comparison.evidence.actual_root_hash), (Some(root), Some(actual)) if root != actual)
    {
        return Some(SacrificeReason::InvalidEvidence);
    }
    let Some(endpoint) = &context.preferred_pv_end else {
        return Some(SacrificeReason::MissingPreferredPv);
    };
    if lineage(comparison, &context.preferred).is_none()
        || endpoint.from_move != context.preferred.move_
        || context.preferred.pv.as_ref() != Some(&endpoint.pv)
        || context
            .preferred_pv_query_id
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Some(SacrificeReason::MissingPreferredPv);
    }
    let analysis = &endpoint.analysis;
    if !analysis
        .ownership
        .as_deref()
        .is_some_and(|map| crate::comparison::valid_map(map, context.board.size))
        || !analysis.score_lead.is_some_and(f64::is_finite)
        || !analysis
            .winrate
            .is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(&value))
    {
        return Some(SacrificeReason::InvalidEvidence);
    }
    if context.preferred.visits.unwrap_or(0) < params.minimum_visits
        || analysis.visits.unwrap_or(0) < params.minimum_visits
    {
        return Some(SacrificeReason::InsufficientVisits);
    }
    None
}

fn valid_params(params: &SacrificeParams) -> bool {
    params.minimum_stones > 0
        && params.minimum_visits > 0
        && [
            params.saving_ownership_minimum,
            params.preferred_ownership_maximum,
            params.endpoint_ownership_maximum,
        ]
        .iter()
        .all(|value| value.is_finite() && (-1.0..=1.0).contains(value))
        && [
            params.ownership_flip_minimum,
            params.minimum_compensation_book,
            params.maximum_score_decline,
            params.maximum_winrate_decline,
            params.maximum_endpoint_score_decline,
            params.maximum_endpoint_winrate_decline,
        ]
        .iter()
        .all(|value| value.is_finite() && *value >= 0.0)
}

fn lineage<'a>(
    comparison: &'a MoveComparison,
    candidate: &CandidateSnapshot,
) -> Option<&'a CandidatePvLineage> {
    comparison.context.pv_lineages.iter().find(|line| {
        line.root_ply == comparison.root_ply
            && line.move_ == candidate.move_
            && candidate.pv.as_ref() == Some(&line.pv)
            && line.pv.first() == Some(&candidate.move_)
            && line.board.size == comparison.context.board.size
    })
}

#[allow(clippy::too_many_lines)]
fn check_group(
    comparison: &MoveComparison,
    group: &GroupSnapshot,
    params: &SacrificeParams,
) -> Result<SacrificeAnnotation, SacrificeReason> {
    use SacrificeReason as Reason;
    let context = &comparison.context;
    let (stones, other, board_stones) = if comparison.mover == ColorToken::B {
        (
            &group.members.black_stones,
            &group.members.white_stones,
            &context.board.black,
        )
    } else {
        (
            &group.members.white_stones,
            &group.members.black_stones,
            &context.board.white,
        )
    };
    if stones.is_empty() || !other.is_empty() {
        return Err(Reason::MixedOrOpponentGroup);
    }
    if stones.len() < params.minimum_stones {
        return Err(Reason::TooFewStones);
    }
    if stones.iter().any(|stone| !board_stones.contains(stone))
        || stones
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != stones.len()
    {
        return Err(Reason::InvalidEvidence);
    }
    let preferred = &context.preferred;
    let preferred_line = lineage(comparison, preferred).ok_or(Reason::MissingPreferredPv)?;
    let captured: Vec<_> = preferred_line
        .captures
        .iter()
        .filter(|capture| capture.color == comparison.mover && stones.contains(&capture.stone))
        .collect();
    if captured.len() != stones.len()
        || !stones
            .iter()
            .all(|stone| captured.iter().any(|capture| &capture.stone == stone))
    {
        return Err(Reason::OriginalStonesNotCaptured);
    }
    let capture_offset = captured
        .iter()
        .map(|capture| capture.ply_offset)
        .max()
        .unwrap_or(0);
    if capture_offset == 0 || capture_offset > preferred_line.pv.len() {
        return Err(Reason::InvalidEvidence);
    }
    let endpoint = context
        .preferred_pv_end
        .as_ref()
        .ok_or(Reason::MissingPreferredPv)?;
    let mean = |map: Option<&[f64]>| own_mean(map?, stones, context.board.size, comparison.mover);
    let preferred_ownership =
        mean(preferred.ownership.as_deref()).ok_or(Reason::InvalidEvidence)?;
    let endpoint_ownership =
        mean(endpoint.analysis.ownership.as_deref()).ok_or(Reason::InvalidEvidence)?;
    if preferred_ownership > params.preferred_ownership_maximum
        || endpoint_ownership > params.endpoint_ownership_maximum
    {
        return Err(Reason::OwnershipNotLost);
    }
    let mut alternatives: Vec<_> = context.root_candidates.iter().collect();
    if !alternatives
        .iter()
        .any(|candidate| candidate.move_ == context.actual.move_)
    {
        alternatives.push(&context.actual);
    }
    alternatives.sort_by_key(|candidate| candidate.order.unwrap_or(u32::MAX));
    // Forced saving candidates remain distinct from unrestricted candidates. Only
    // query provenance at this same root may support a new reference branch.
    alternatives.extend(context.saving_probes.iter().filter_map(|probe| {
        (!probe.query_id.is_empty()
            && comparison
                .evidence
                .root_hash
                .as_ref()
                .is_some_and(|root| !root.is_empty() && probe.root_hash.as_ref() == Some(root)))
        .then_some(&probe.candidate)
    }));
    let mut failure = Reason::SavingAlternativeUnavailable;
    for reference in alternatives {
        if reference.move_ == preferred.move_
            || !candidate_has_comparison_evidence(reference, context.board.size)
            || reference.visits.unwrap_or(0) < params.minimum_visits
        {
            continue;
        }
        let Some(reference_ownership) = mean(reference.ownership.as_deref()) else {
            continue;
        };
        if reference_ownership < params.saving_ownership_minimum
            || reference_ownership - preferred_ownership < params.ownership_flip_minimum
        {
            continue;
        }
        let Some(reference_line) = lineage(comparison, reference) else {
            continue;
        };
        if reference_line.pv.len() < capture_offset
            || reference_line
                .captures
                .iter()
                .any(|capture| capture.color == comparison.mover && stones.contains(&capture.stone))
        {
            continue;
        }
        match build_annotation(
            comparison,
            group,
            reference,
            reference_line,
            params,
            preferred_ownership,
            reference_ownership,
            endpoint_ownership,
            capture_offset,
        ) {
            Ok(annotation) => return Ok(annotation),
            Err(reason) => failure = reason,
        }
    }
    Err(failure)
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn build_annotation(
    comparison: &MoveComparison,
    group: &GroupSnapshot,
    reference: &CandidateSnapshot,
    reference_line: &CandidatePvLineage,
    params: &SacrificeParams,
    preferred_ownership: f64,
    reference_ownership: f64,
    endpoint_ownership: f64,
    capture_offset: usize,
) -> Result<SacrificeAnnotation, SacrificeReason> {
    use SacrificeReason as Reason;
    let context = &comparison.context;
    let preferred = &context.preferred;
    let endpoint = &context
        .preferred_pv_end
        .as_ref()
        .ok_or(Reason::MissingPreferredPv)?
        .analysis;
    let sign = if comparison.mover == ColorToken::B {
        1.0
    } else {
        -1.0
    };
    let score_advantage = sign * (preferred.score_lead.unwrap() - reference.score_lead.unwrap());
    let winrate_advantage = sign * (preferred.winrate.unwrap() - reference.winrate.unwrap());
    let endpoint_score_change =
        sign * (endpoint.score_lead.unwrap() - preferred.score_lead.unwrap());
    let endpoint_winrate_change = sign * (endpoint.winrate.unwrap() - preferred.winrate.unwrap());
    if ![
        score_advantage,
        winrate_advantage,
        endpoint_score_change,
        endpoint_winrate_change,
    ]
    .iter()
    .all(|value| value.is_finite())
    {
        return Err(Reason::InvalidEvidence);
    }
    if score_advantage < -params.maximum_score_decline
        || winrate_advantage < -params.maximum_winrate_decline
        || endpoint_score_change < -params.maximum_endpoint_score_decline
        || endpoint_winrate_change < -params.maximum_endpoint_winrate_decline
    {
        return Err(Reason::GlobalValueDeclines);
    }
    let mut root = PositionSnapshot::empty_shell(
        context.root_ply,
        context.mover,
        context.board.clone(),
        vec![],
    );
    root.groups.clone_from(&context.groups);
    let ledger = compute_ledger_against(&root, reference, preferred)
        .ok_or(Reason::CompensationUnavailable)?;
    let cost = ledger
        .ledger
        .iter()
        .find(|line| {
            line.kind == LedgerLineKind::Group && line.id.as_deref() == Some(&group.group_id)
        })
        .ok_or(Reason::CompensationUnavailable)?;
    let elsewhere: Vec<_> = ledger
        .ledger
        .iter()
        .filter(|line| {
            !(line.kind == LedgerLineKind::Group && line.id.as_deref() == Some(&group.group_id))
        })
        .collect();
    let compensation_book = -elsewhere.iter().map(|line| line.book_value).sum::<f64>();
    if cost.book_value <= 0.0
        || compensation_book < cost.book_value
        || compensation_book < params.minimum_compensation_book
    {
        return Err(Reason::CompensationUnavailable);
    }
    let priced = ledger.consistent && ledger.book_total * ledger.value > 0.0;
    let exchanges: Vec<_> = elsewhere
        .iter()
        .filter(|line| line.book_value.abs() > 1e-6)
        .map(|line| SacrificeExchange {
            kind: line.kind,
            id: line.id.clone(),
            intersections: line.intersections.clone(),
            book_value: -line.book_value,
            proportion: -line.proportion,
            points: if priced {
                line.points.map(|points| -points)
            } else {
                None
            },
        })
        .collect();
    let stones = if comparison.mover == ColorToken::B {
        &group.members.black_stones
    } else {
        &group.members.white_stones
    };
    let compensation_points =
        priced.then(|| -elsewhere.iter().filter_map(|line| line.points).sum::<f64>());
    let (reference_source, reference_query_id, reference_root_hash) = if let Some(probe) =
        context.saving_probes.iter().find(|probe| {
            std::ptr::eq(
                std::ptr::from_ref(&probe.candidate),
                std::ptr::from_ref(reference),
            )
        }) {
        (
            SacrificeReferenceSource::SavingForced,
            probe.query_id.clone(),
            probe.root_hash.clone(),
        )
    } else if reference.move_ == context.actual.move_
        && comparison.evidence.actual_source == crate::ComparisonCandidateSource::Forced
    {
        (
            SacrificeReferenceSource::ActualForced,
            comparison.evidence.actual_query_id.clone(),
            comparison.evidence.actual_root_hash.clone(),
        )
    } else {
        (
            SacrificeReferenceSource::RootCandidate,
            comparison.evidence.root_query_id.clone(),
            comparison.evidence.root_hash.clone(),
        )
    };
    Ok(SacrificeAnnotation {
        root_ply: comparison.root_ply,
        mover: comparison.mover,
        group_id: group.group_id.clone(),
        stones: stones.clone(),
        captured_stones: stones.clone(),
        preferred_move: preferred.move_.clone(),
        reference_move: reference.move_.clone(),
        ownership_flip: reference_ownership - preferred_ownership,
        root_ownership: context
            .root
            .ownership
            .as_deref()
            .and_then(|map| own_mean(map, stones, context.board.size, comparison.mover)),
        reference_ownership,
        preferred_ownership,
        endpoint_ownership,
        cost_book: cost.book_value,
        compensation_book,
        compensation_points,
        exchanged_with: exchanges
            .iter()
            .filter(|exchange| exchange.book_value > 0.0)
            .map(|exchange| {
                exchange.id.clone().unwrap_or_else(|| match exchange.kind {
                    LedgerLineKind::OwnTerritory => "own_territory".into(),
                    LedgerLineKind::ReduceOpponent => "reduce_opponent".into(),
                    LedgerLineKind::Other => "other".into(),
                    LedgerLineKind::Group => "group".into(),
                })
            })
            .collect(),
        exchanges,
        pv: preferred.pv.clone().unwrap_or_default(),
        evidence: SacrificeEvidence {
            root_query_id: comparison.evidence.root_query_id.clone(),
            reference_query_id,
            reference_source,
            reference_root_hash,
            preferred_pv_query_id: context.preferred_pv_query_id.clone().unwrap_or_default(),
            root_hash: comparison.evidence.root_hash.clone(),
            preferred_visits: preferred.visits.unwrap_or(0),
            reference_visits: reference.visits.unwrap_or(0),
            endpoint_visits: endpoint.visits.unwrap_or(0),
            preferred_capture_ply_offset: capture_offset,
            reference_pv: reference_line.pv.clone(),
            score_advantage,
            winrate_advantage,
            endpoint_score_change,
            endpoint_winrate_change,
        },
    })
}

fn own_mean(map: &[f64], stones: &[String], size: u8, color: ColorToken) -> Option<f64> {
    if !crate::comparison::valid_map(map, size) || stones.is_empty() {
        return None;
    }
    let mut sum = 0.0;
    for stone in stones {
        if !stone.is_ascii()
            || !stone
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
        {
            return None;
        }
        sum += map[Point::parse_gtp(stone, size).ok()??.index(size)];
    }
    let count = f64::from(u32::try_from(stones.len()).ok()?);
    Some(sum / count * if color == ColorToken::B { 1.0 } else { -1.0 })
}

#[cfg(test)]
mod tests;
