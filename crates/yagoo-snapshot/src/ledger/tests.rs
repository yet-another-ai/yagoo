//! Constructed arithmetic/edge-case tests; real engine replay is in pipeline tests.

use super::*;
use crate::{BoardSnapshot, EngineAnalysis, GroupKind, GroupMembers};

fn candidate(ownership: &[f64], score: f64) -> CandidateSnapshot {
    serde_json::from_value(serde_json::json!({
        "move": "B2", "order": 0, "ownership": ownership, "scoreLead": score
    }))
    .unwrap()
}

fn constructed_snapshot() -> PositionSnapshot {
    let mut snapshot = PositionSnapshot::empty_shell(
        0,
        ColorToken::B,
        BoardSnapshot {
            size: 3,
            black: vec!["A3".into()],
            white: vec!["C1".into()],
        },
        vec![],
    );
    snapshot.groups.push(GroupSnapshot {
        group_id: "A3".into(),
        members: GroupMembers {
            black_stones: vec!["A3".into()],
            white_stones: vec![],
            empty: vec!["B3".into(), "C3".into()],
        },
        kind: GroupKind::Simple,
        chains: vec![],
        parts: vec![],
        strength: None,
        certainty: None,
        cohesion: None,
        bound_confidence: None,
        status: Some(GroupStatus::Weak),
        g_plus: None,
        g_minus: None,
        delta: None,
        source: None,
    });
    let pass: EngineAnalysis = serde_json::from_value(serde_json::json!({
        "ownership": [0.1, 0.5, -0.5, 0.2, -0.2, 0.5, -0.5, -0.4, -0.4],
        "scoreLead": 0.0
    }))
    .unwrap();
    snapshot.pass_probe = Some(pass);
    snapshot.candidates.push(candidate(
        &[0.6, 0.7, -0.2, 0.4, -0.1, 0.3, -0.7, -0.6, -0.2],
        1.8,
    ));
    snapshot
}

fn pass_ledger(snapshot: &PositionSnapshot) -> GainLossLedger {
    compute_ledger(snapshot, &snapshot.candidates[0], LedgerBaseline::Pass).unwrap()
}

#[test]
fn constructed_played_status_change_prioritizes_a_group_without_ownership_swing() {
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].ownership = snapshot.pass_probe.as_ref().unwrap().ownership.clone();
    let tempo = PlayedGroupTempo {
        group_id: "A3".into(),
        color: ColorToken::B,
        stones: vec!["A3".into()],
        before_status: GroupStatus::Weak,
        after_status: GroupStatus::Settled,
        before_g_plus: 0.5,
        before_g_minus: 0.1,
        after_g_plus: 0.9,
        after_g_minus: 0.8,
    };
    let ledger = compute_played_ledger_with_tempo(
        &snapshot,
        &snapshot.candidates[0],
        std::slice::from_ref(&tempo),
    )
    .unwrap();
    let group = &ledger.ledger[0];
    assert_eq!(group.id.as_deref(), Some("A3"));
    assert_eq!(group.tempo, Some(LedgerTempo::RootBranchPassProbes));
    assert_eq!(group.played_tempo_changes, vec![tempo]);
    assert_eq!(group.tempo_changes, []);
    assert_eq!(group.book_value, 0.0);
    assert_eq!(group.points, None, "zero ownership book remains unpriced");
}

fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
}

#[test]
fn priority_assigns_every_coordinate_once_and_preserves_negative_lines() {
    let snapshot = constructed_snapshot();
    let ledger = pass_ledger(&snapshot);
    assert!(ledger.consistent);
    assert_eq!(ledger.scaling, LedgerScaling::Score);
    close(ledger.book_total, 0.9);
    close(
        ledger.ledger.iter().filter_map(|line| line.points).sum(),
        1.8,
    );
    let group = &ledger.ledger[0];
    assert_eq!(group.kind, LedgerLineKind::Group);
    assert_eq!(group.intersections, ["A3", "B3", "C3"]);
    close(group.book_value, 1.0);
    close(group.points.unwrap(), 2.0);
    assert_eq!(group.tempo, Some(LedgerTempo::Unassessed));
    close(group.strength_changes[0].delta, 0.5);
    let reduction = &ledger.ledger[2];
    assert_eq!(reduction.kind, LedgerLineKind::ReduceOpponent);
    close(reduction.points.unwrap(), -0.6);
    assert_eq!(ledger.ledger[3].intersections, ["C1"]);
    let coordinates: Vec<_> = ledger
        .ledger
        .iter()
        .flat_map(|line| &line.intersections)
        .collect();
    assert_eq!(coordinates.len(), 9);
    assert_eq!(coordinates.into_iter().collect::<HashSet<_>>().len(), 9);
    close(
        ledger.ledger.iter().map(|line| line.proportion.abs()).sum(),
        1.0,
    );
}

#[test]
fn white_mover_uses_own_perspective_for_score_strength_and_territory() {
    let mut snapshot = constructed_snapshot();
    let expected = pass_ledger(&snapshot);
    snapshot.to_play = ColorToken::W;
    std::mem::swap(&mut snapshot.board.black, &mut snapshot.board.white);
    let members = &mut snapshot.groups[0].members;
    std::mem::swap(&mut members.black_stones, &mut members.white_stones);
    let pass = snapshot.pass_probe.as_mut().unwrap();
    for value in pass.ownership.as_mut().unwrap() {
        *value = -*value;
    }
    let candidate = &mut snapshot.candidates[0];
    for value in candidate.ownership.as_mut().unwrap() {
        *value = -*value;
    }
    candidate.score_lead = candidate.score_lead.map(|value| -value);
    let actual = pass_ledger(&snapshot);
    close(actual.value, expected.value);
    for (actual, expected) in actual.ledger.iter().zip(&expected.ledger) {
        assert_eq!(actual.kind, expected.kind);
        close(actual.points.unwrap(), expected.points.unwrap());
    }
    assert_eq!(actual.ledger[0].strength_changes[0].color, ColorToken::W);
    close(actual.ledger[0].strength_changes[0].delta, 0.5);
}

#[test]
fn mismatch_and_zero_book_never_scale_even_when_score_is_zero() {
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].score_lead = Some(10.0);
    let ledger = pass_ledger(&snapshot);
    assert_eq!(
        ledger.inconsistency,
        Some(LedgerInconsistency::BookSearchMismatch)
    );
    assert_eq!(ledger.scaling, LedgerScaling::Proportions);
    assert!(ledger.ledger.iter().all(|line| line.points.is_none()));
    let pass = snapshot.pass_probe.as_ref().unwrap();
    snapshot.candidates[0].ownership = pass.ownership.clone();
    snapshot.candidates[0].score_lead = pass.score_lead;
    let zero = pass_ledger(&snapshot);
    assert_eq!(zero.inconsistency, Some(LedgerInconsistency::ZeroBook));
    assert!(zero
        .ledger
        .iter()
        .all(|line| line.points.is_none() && line.proportion == 0.0));
}

#[test]
fn tolerance_is_three_points_inclusive() {
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].score_lead = Some(3.9);
    assert!(pass_ledger(&snapshot).consistent);
    snapshot.candidates[0].score_lead = Some(3.901);
    assert!(!pass_ledger(&snapshot).consistent);
}

#[test]
fn cancellation_reports_signed_proportions_without_dividing_by_zero() {
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].ownership.as_mut().unwrap()[8] -= 0.7;
    snapshot.candidates[0].ownership.as_mut().unwrap()[3] -= 0.2;
    let ledger = pass_ledger(&snapshot);
    assert_eq!(ledger.inconsistency, Some(LedgerInconsistency::ZeroBook));
    assert!(ledger.ledger.iter().any(|line| line.proportion < 0.0));
    assert!(ledger.ledger.iter().all(|line| line.points.is_none()));
}

#[test]
fn best_reference_uses_candidate_map_and_never_root_ownership() {
    let mut snapshot = constructed_snapshot();
    let mut alternative = snapshot.candidates[0].clone();
    alternative.move_ = "C2".into();
    alternative.order = Some(1);
    alternative.score_lead = Some(-1.0);
    alternative.ownership.as_mut().unwrap()[0] = -0.1;
    snapshot.candidates.insert(0, alternative.clone());
    // Poison root data: candidate comparison must not read it.
    snapshot.root = snapshot.pass_probe.clone();
    snapshot.root.as_mut().unwrap().score_lead = Some(900.0);
    snapshot.root.as_mut().unwrap().ownership = Some(vec![f64::NAN]);
    let ledger = compute_ledger(&snapshot, &alternative, LedgerBaseline::Best).unwrap();
    assert_eq!(ledger.reference_move, "B2");
    close(ledger.value, -2.8);
    close(ledger.book_total, -0.7);
}

#[test]
fn missing_malformed_and_nonfinite_inputs_do_not_fabricate_a_ledger() {
    let mut snapshot = constructed_snapshot();
    snapshot.pass_probe = None;
    assert!(compute_ledger(&snapshot, &snapshot.candidates[0], LedgerBaseline::Pass).is_none());
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].ownership = Some(vec![0.1]);
    assert!(compute_ledger(&snapshot, &snapshot.candidates[0], LedgerBaseline::Pass).is_none());
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].ownership.as_mut().unwrap()[0] = f64::NAN;
    assert!(compute_ledger(&snapshot, &snapshot.candidates[0], LedgerBaseline::Pass).is_none());
    let mut snapshot = constructed_snapshot();
    snapshot.groups.push(snapshot.groups[0].clone());
    assert!(compute_ledger(&snapshot, &snapshot.candidates[0], LedgerBaseline::Pass).is_none());
}

#[test]
fn tempo_helper_requires_actual_statuses_and_same_stone_membership() {
    let snapshot = constructed_snapshot();
    let before = snapshot.groups;
    let mut after = before.clone();
    after[0].status = Some(GroupStatus::Settled);
    let changes = compute_tempo_changes(&before, &after);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].from, GroupStatus::Weak);
    assert_eq!(changes[0].to, GroupStatus::Settled);
    after[0].members.black_stones.push("B2".into());
    assert_eq!(compute_tempo_changes(&before, &after), []);
    after = before.clone();
    after[0].status = None;
    assert_eq!(compute_tempo_changes(&before, &after), []);
}

#[test]
fn ledger_json_roundtrips_with_null_unpriced_points() {
    let mut snapshot = constructed_snapshot();
    snapshot.candidates[0].score_lead = Some(100.0);
    snapshot.ledger = Some(pass_ledger(&snapshot));
    let value = serde_json::to_value(&snapshot).unwrap();
    assert!(value["ledger"]["ledger"][0]["points"].is_null());
    let decoded: PositionSnapshot = serde_json::from_value(value).unwrap();
    assert_eq!(decoded, snapshot);
}
