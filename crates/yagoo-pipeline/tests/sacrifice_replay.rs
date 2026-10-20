//! Negative/boundary checks on unchanged genuine full-history recordings.
//! No positive synthetic case is presented as empirical calibration.
mod common;
use common::{config, fixture_dir, RecordedEngine};
use yagoo_pipeline::analyze_move_comparison;
use yagoo_sgf::{parse_sgf, replay_main_line};
use yagoo_snapshot::{SacrificeAssessmentStatus, SacrificeReason};

#[tokio::test]
async fn real_recorded_cases_do_not_turn_forecasts_into_sacrifices() {
    let record =
        parse_sgf(&std::fs::read_to_string(fixture_dir().join("source.sgf")).unwrap()).unwrap();
    let positions = replay_main_line(&record).unwrap();
    let engine = RecordedEngine::load();
    for ply in [43, 44, 50, 60, 96] {
        let comparison = analyze_move_comparison(&record, &positions[ply], &engine, &config())
            .await
            .unwrap()
            .unwrap();
        let assessment = comparison.sacrifice_assessment.as_ref().unwrap();
        assert_eq!(assessment.root_ply + 1, u32::try_from(ply).unwrap());
        assert_eq!(assessment.mover, comparison.mover);
        assert_eq!(assessment.preferred_move, comparison.ai_move);
        assert!(
            assessment.annotations.is_empty(),
            "unreviewed positive at move {ply}: {assessment:?}"
        );
        assert_ne!(comparison.context.pv_lineages.len(), 0);
        for lineage in &comparison.context.pv_lineages {
            assert_eq!(lineage.root_ply, assessment.root_ply);
            assert_eq!(lineage.pv.first(), Some(&lineage.move_));
            assert!(lineage
                .captures
                .iter()
                .all(|capture| capture.ply_offset <= lineage.pv.len()));
        }
        if ply == 50 {
            assert_eq!(assessment.status, SacrificeAssessmentStatus::Unassessed);
            assert_eq!(comparison.context.preferred.visits, Some(15));
        }
        if ply == 44 {
            // This root already forecasts the Q4 group lost; neither root→PV
            // ownership change nor a two-visit actual branch establishes a rescue.
            assert!(assessment
                .checks
                .iter()
                .any(|check| check.group_id == "Q4" && check.reason != SacrificeReason::Supported));
        }
    }
    assert_eq!(
        engine.seen.lock().unwrap().len(),
        30,
        "detector adds no engine process or queries"
    );
}

#[tokio::test]
async fn disabled_endpoint_remains_unassessed_and_does_not_erase_comparison() {
    let record =
        parse_sgf(&std::fs::read_to_string(fixture_dir().join("source.sgf")).unwrap()).unwrap();
    let positions = replay_main_line(&record).unwrap();
    let mut config = config();
    config.comparison_pv_end = false;
    let comparison =
        analyze_move_comparison(&record, &positions[60], &RecordedEngine::load(), &config)
            .await
            .unwrap()
            .unwrap();
    assert!((comparison.score_loss - 6.681_626_325).abs() < 1e-7);
    let assessment = comparison.sacrifice_assessment.unwrap();
    assert_eq!(assessment.status, SacrificeAssessmentStatus::Unassessed);
    assert_eq!(assessment.annotations, []);
}
