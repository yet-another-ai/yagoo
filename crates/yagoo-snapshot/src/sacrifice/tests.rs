//! Constructed arithmetic and legal-board tests, NOT KataGo recordings and NOT
//! positive calibration evidence. Real-corpus regressions live in pipeline tests.
use super::*;
use crate::{board_from_game, compute_move_comparison, trace_candidate_pv};
use yagoo_core::{Color, GameState, Ruleset};

fn point(gtp: &str) -> Point {
    Point::parse_gtp(gtp, 5).unwrap().unwrap()
}

fn constructed(color: Color) -> MoveComparison {
    let mut state = GameState::new(5, Ruleset::Chinese).unwrap();
    for stone in ["B2", "C2"] {
        state.setup_stone(point(stone), color).unwrap();
    }
    for stone in ["A2", "B1", "C1", "C3", "D2"] {
        state.setup_stone(point(stone), color.opponent()).unwrap();
    }
    state.set_to_play(color);
    let sign = if color == Color::Black { 1.0 } else { -1.0 };
    let mut reference_map = vec![0.0; 25];
    let mut preferred_map = vec![0.0; 25];
    for stone in ["B2", "C2"] {
        reference_map[point(stone).index(5)] = 0.9 * sign;
        preferred_map[point(stone).index(5)] = -0.9 * sign;
    }
    for stone in ["A5", "B5", "C5", "D5", "A4"] {
        preferred_map[point(stone).index(5)] = sign;
    }
    let preferred: CandidateSnapshot = serde_json::from_value(serde_json::json!({
        "move":"E5","order":0,"visits":64,"winrate":0.5 + sign * 0.1,
        "scoreLead":sign * 1.4,"ownership":preferred_map,"pv":["E5","B3"]
    }))
    .unwrap();
    let reference: CandidateSnapshot = serde_json::from_value(serde_json::json!({
        "move":"B3","order":1,"visits":64,"winrate":0.5,"scoreLead":0.0,
        "ownership":reference_map,"pv":["B3","E1"]
    }))
    .unwrap();
    let board = board_from_game(&state);
    let (black_stones, white_stones) = if color == Color::Black {
        (vec!["B2", "C2"], vec![])
    } else {
        (vec![], vec!["B2", "C2"])
    };
    let analysis = serde_json::json!({
        "visits":64,"winrate":preferred.winrate,"scoreLead":preferred.score_lead,
        "ownership":preferred.ownership
    });
    let mut context: crate::ComparisonContext = serde_json::from_value(serde_json::json!({
        "rootPly":0,"mover":ColorToken::from(color),"board":board,
        "groups":[{"groupId":"B2","kind":"simple","members":{
            "blackStones":black_stones,"whiteStones":white_stones,"empty":[]
        }}],"root":analysis,"actual":reference,"preferred":preferred,
        "preferredPvEnd":{"fromMove":"E5","pv":["E5","B3"],"analysis":analysis},
        "preferredPvQueryId":"constructed-pv",
    }))
    .unwrap();
    context.root_candidates = vec![preferred.clone(), reference.clone()];
    context.pv_lineages = [&preferred, &reference]
        .iter()
        .map(|candidate| trace_candidate_pv(0, &state, candidate).unwrap())
        .collect();
    let evidence = serde_json::from_value(serde_json::json!({
        "rootQueryId":"constructed-root","actualQueryId":"constructed-root","actualSource":"root_candidate",
        "requestedVisits":64,"minimumCandidateVisits":16,"rootVisits":64,
        "actualVisits":64,"aiVisits":64,"rootHash":"constructed","actualRootHash":"constructed",
        "limitations":["Constructed unit-test values, not engine evidence."]
    })).unwrap();
    compute_move_comparison(1, context, evidence).unwrap()
}

#[test]
fn explicit_saving_branch_supports_foreseen_capture_and_same_root_exchange_for_both_colors() {
    for color in [Color::Black, Color::White] {
        let comparison = constructed(color);
        let assessment = compute_sacrifices(&comparison);
        assert_eq!(assessment.status, SacrificeAssessmentStatus::Assessed);
        assert_eq!(assessment.annotations.len(), 1);
        let item = &assessment.annotations[0];
        assert_eq!(item.stones, ["B2", "C2"]);
        assert_eq!(item.captured_stones, item.stones);
        assert_eq!(item.reference_move, "B3");
        assert_eq!(item.preferred_move, "E5");
        assert!((item.ownership_flip - 1.8).abs() < 1e-10);
        // Root already anticipates the preferred loss; the rescue proves avoidability.
        assert!(item.root_ownership.unwrap() < -0.8);
        assert!((item.cost_book - 3.6).abs() < 1e-10);
        assert!((item.compensation_book - 5.0).abs() < 1e-10);
        assert!((item.compensation_points.unwrap() - 5.0).abs() < 1e-10);
        assert!((item.evidence.score_advantage - 1.4).abs() < 1e-10);
        assert!((item.evidence.winrate_advantage - 0.1).abs() < 1e-10);
        assert_eq!(item.evidence.preferred_capture_ply_offset, 2);
        assert_eq!(item.evidence.reference_pv, ["B3", "E1"]);
    }
}

#[test]
fn forecast_drop_alone_and_saving_line_captured_or_too_short_are_not_sacrifices() {
    for scenario in 0..4 {
        let mut comparison = constructed(Color::Black);
        match scenario {
            0 => {
                comparison.context.root_candidates.clear();
                comparison.context.actual = comparison.context.preferred.clone();
            }
            1 => comparison.context.pv_lineages[0].captures.clear(),
            2 => {
                comparison.context.pv_lineages[1].captures =
                    comparison.context.pv_lineages[0].captures.clone();
            }
            _ => {
                comparison.context.root_candidates[1].pv = Some(vec!["B3".into()]);
                comparison.context.actual.pv = Some(vec!["B3".into()]);
                comparison.context.pv_lineages[1].pv = vec!["B3".into()];
            }
        }
        let assessment = compute_sacrifices(&comparison);
        assert!(assessment.annotations.is_empty(), "scenario {scenario}");
    }
}

#[test]
fn missing_or_corrupt_or_undersampled_primary_evidence_remains_unassessed() {
    for scenario in 0..6 {
        let mut comparison = constructed(Color::Black);
        match scenario {
            0 => comparison.context.preferred_pv_end = None,
            1 => comparison.context.pv_lineages.clear(),
            2 => comparison.context.preferred.visits = Some(15),
            3 => {
                comparison
                    .context
                    .preferred_pv_end
                    .as_mut()
                    .unwrap()
                    .analysis
                    .ownership = Some(vec![0.0; 24]);
            }
            4 => comparison.context.preferred_pv_end.as_mut().unwrap().pv = vec!["E5".into()],
            _ => comparison.context.root_ply = 10,
        }
        let result = compute_sacrifices(&comparison);
        assert_eq!(
            result.status,
            SacrificeAssessmentStatus::Unassessed,
            "scenario {scenario}"
        );
        assert_eq!(result.annotations, []);
    }
}

#[test]
fn declines_missing_compensation_and_already_dead_alternative_are_rejected() {
    for scenario in 0..6 {
        let mut comparison = constructed(Color::Black);
        match scenario {
            0 => {
                comparison
                    .context
                    .preferred_pv_end
                    .as_mut()
                    .unwrap()
                    .analysis
                    .winrate = Some(0.1);
            }
            1 => {
                comparison
                    .context
                    .preferred_pv_end
                    .as_mut()
                    .unwrap()
                    .analysis
                    .score_lead = Some(-20.0);
            }
            2 => comparison.context.preferred.winrate = Some(0.1),
            3 => {
                for stone in ["A5", "B5", "C5", "D5", "A4"] {
                    comparison.context.preferred.ownership.as_mut().unwrap()
                        [point(stone).index(5)] = 0.0;
                }
            }
            4 => {
                comparison.context.root_candidates[1].ownership =
                    comparison.context.preferred.ownership.clone();
                comparison.context.actual.ownership =
                    comparison.context.preferred.ownership.clone();
            }
            _ => {
                comparison.context.root_candidates[1].visits = Some(1);
                comparison.context.actual.visits = Some(1);
            }
        }
        assert!(
            compute_sacrifices(&comparison).annotations.is_empty(),
            "scenario {scenario}"
        );
    }
}

#[test]
fn mismatched_book_keeps_exchange_unpriced_and_mixed_or_single_groups_are_excluded() {
    let mut comparison = constructed(Color::Black);
    comparison.context.preferred.score_lead = Some(10.0);
    comparison
        .context
        .preferred_pv_end
        .as_mut()
        .unwrap()
        .analysis
        .score_lead = Some(10.0);
    let result = compute_sacrifices(&comparison);
    assert_eq!(result.annotations.len(), 1);
    assert_eq!(result.annotations[0].compensation_points, None);
    assert!(result.annotations[0]
        .exchanges
        .iter()
        .all(|line| line.points.is_none()));
    comparison.context.groups[0].members.black_stones.pop();
    assert_eq!(
        compute_sacrifices(&comparison).checks[0].reason,
        SacrificeReason::TooFewStones
    );
    comparison.context.groups[0]
        .members
        .white_stones
        .push("A2".into());
    assert_eq!(
        compute_sacrifices(&comparison).checks[0].reason,
        SacrificeReason::MixedOrOpponentGroup
    );
}

#[test]
fn legal_lineage_keeps_capture_identity_after_same_color_replacement() {
    let comparison = constructed(Color::Black);
    let mut state = GameState::new(5, Ruleset::Chinese).unwrap();
    for (stones, color) in [
        (&comparison.context.board.black, Color::Black),
        (&comparison.context.board.white, Color::White),
    ] {
        for stone in stones {
            state.setup_stone(point(stone), color).unwrap();
        }
    }
    let mut candidate = comparison.context.preferred;
    candidate.pv = Some(vec!["E5".into(), "B3".into(), "B2".into(), "E1".into()]);
    let line = trace_candidate_pv(0, &state, &candidate).unwrap();
    assert!(line.board.black.contains(&"B2".into()));
    assert!(line
        .captures
        .iter()
        .any(|capture| capture.stone == "B2" && capture.ply_offset == 2));
    candidate.pv = Some(vec!["E5".into(), "B3".into(), "B3".into()]);
    assert!(trace_candidate_pv(0, &state, &candidate).is_none());
}

#[test]
fn explicit_saving_probe_retains_forced_provenance_and_requires_matching_root_hash() {
    let mut comparison = constructed(Color::Black);
    let reference = comparison.context.actual.clone();
    comparison.context.actual = comparison.context.preferred.clone();
    comparison.actual_move.clone_from(&comparison.ai_move);
    comparison.context.root_candidates = vec![comparison.context.preferred.clone()];
    comparison.context.saving_probes = vec![crate::SavingCandidateProbe {
        query_id: "constructed-saving-B3".into(),
        root_hash: comparison.evidence.root_hash.clone(),
        candidate: reference,
    }];
    let supported = compute_sacrifices(&comparison);
    assert_eq!(supported.annotations.len(), 1);
    let evidence = &supported.annotations[0].evidence;
    assert_eq!(
        evidence.reference_source,
        SacrificeReferenceSource::SavingForced
    );
    assert_eq!(evidence.reference_query_id, "constructed-saving-B3");
    assert_eq!(evidence.reference_root_hash, comparison.evidence.root_hash);
    for root_hash in [None, Some(String::new()), Some("different-root".into())] {
        comparison.context.saving_probes[0].root_hash = root_hash;
        assert_eq!(compute_sacrifices(&comparison).annotations, []);
    }
}

#[test]
fn actual_forced_reference_is_not_labelled_as_unrestricted() {
    let mut comparison = constructed(Color::White);
    comparison.evidence.actual_source = crate::ComparisonCandidateSource::Forced;
    comparison.evidence.actual_query_id = "constructed-actual-forced".into();
    let supported = compute_sacrifices(&comparison);
    let evidence = &supported.annotations[0].evidence;
    assert_eq!(
        evidence.reference_source,
        SacrificeReferenceSource::ActualForced
    );
    assert_eq!(evidence.reference_query_id, "constructed-actual-forced");
}
