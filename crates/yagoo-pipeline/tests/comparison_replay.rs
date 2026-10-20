//! Genuine full-history same-root corpus. Altered-evidence cases are explicitly
//! corruption tests, never represented as new engine recordings.
mod common;
use common::{config, fixture_dir, RecordedEngine};
use yagoo_katago::PlayerToken;
use yagoo_pipeline::analyze_move_comparison;
use yagoo_sgf::{parse_sgf, replay_main_line};
use yagoo_snapshot::{compute_move_comparison, ColorToken, ComparisonCandidateSource};

fn record() -> yagoo_sgf::GameRecord {
    parse_sgf(&std::fs::read_to_string(fixture_dir().join("source.sgf")).unwrap()).unwrap()
}

#[tokio::test]
async fn recorded_comparisons_use_true_previous_root_and_engine_rank() {
    let record = record();
    let positions = replay_main_line(&record).unwrap();
    let engine = RecordedEngine::load();
    for (ply, actual, preferred, expected_loss) in [
        (43, "R2", "R2", 0.0),
        (44, "S7", "P9", 2.457_585_13),
        (50, "R7", "R7", 0.0),
        (60, "S3", "H3", 6.681_626_325),
        (96, "R14", "R14", 0.0),
    ] {
        let comparison = analyze_move_comparison(&record, &positions[ply], &engine, &config())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(comparison.ply, u32::try_from(ply).unwrap());
        assert_eq!(comparison.root_ply + 1, comparison.ply);
        assert_eq!(comparison.actual_move, actual);
        assert_eq!(comparison.ai_move, preferred);
        assert!((comparison.score_loss - expected_loss).abs() < 1e-7);
        assert_eq!(
            comparison.evidence.root_hash,
            comparison.evidence.actual_root_hash
        );
        let sign = if comparison.mover == ColorToken::B {
            1.0
        } else {
            -1.0
        };
        assert!(
            (comparison.score_loss
                - sign * (comparison.ai_score_lead - comparison.actual_score_lead))
                .abs()
                < 1e-10
        );
        let raw_winrate = comparison.context.actual.winrate.unwrap();
        assert!(
            (comparison.actual_winrate
                - if sign > 0.0 {
                    raw_winrate
                } else {
                    1.0 - raw_winrate
                })
            .abs()
                < 1e-10
        );
        assert_eq!(
            comparison.ledger_diff.as_ref().unwrap().root_ply,
            comparison.root_ply
        );
        assert!(
            (comparison.ledger_diff.as_ref().unwrap().value + comparison.score_loss).abs() < 1e-9
        );
        assert!(
            !comparison.group_tempo.is_empty(),
            "real branch/pass probes"
        );
        assert!(comparison.context.preferred_pv_end.is_some());
        if actual == preferred {
            assert_eq!(comparison.winrate_loss, 0.0);
            assert!(comparison.ownership_delta.iter().all(|delta| *delta == 0.0));
            assert_eq!(
                comparison.context.actual_branch,
                comparison.context.preferred_branch
            );
        }
        if ply == 60 {
            assert_eq!(
                comparison.evidence.actual_source,
                ComparisonCandidateSource::Forced
            );
            assert_eq!(comparison.evidence.actual_visits, Some(63));
            assert_eq!(comparison.evidence.ai_visits, Some(56));
        }
    }
    let seen = engine.seen.lock().unwrap();
    let forced = seen
        .iter()
        .find(|query| query.id == "p60-actual-forced")
        .unwrap();
    let unrestricted = seen.iter().find(|query| query.id == "p60-root").unwrap();
    assert_eq!(forced.moves, unrestricted.moves);
    assert_eq!(forced.moves.len(), 59);
    assert_eq!(
        forced.allow_moves,
        Some(serde_json::json!([{"player":"W","moves":["S3"],"untilDepth":1}]))
    );
    assert_eq!(seen.len(), 30);
    // True root 43 has an active ko at R1, unlike the obsolete setup-only corpus.
    assert_eq!(positions[43].state.ko_point().unwrap().to_gtp(19), "R1");
    assert_eq!(unrestricted.moves.last().unwrap().0, PlayerToken::B);
}

#[tokio::test]
async fn missing_rules_defaults_to_chinese_and_undersampled_actual_is_forced() {
    let mut record = record();
    record.rules = None;
    let positions = replay_main_line(&record).unwrap();
    let engine = RecordedEngine::load();
    let comparison = analyze_move_comparison(&record, &positions[60], &engine, &config())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(comparison.mover, ColorToken::W);
    let mut strict = config();
    strict.comparison_min_visits = 16;
    // The corpus deliberately has no p44 forced response. This error confirms
    // production asks for more evidence rather than pricing two visits silently.
    assert!(
        analyze_move_comparison(&record, &positions[44], &engine, &strict)
            .await
            .is_err()
    );
    assert!(engine
        .seen
        .lock()
        .unwrap()
        .iter()
        .any(|query| query.id == "p44-actual-forced"));
    // Equality remains zero even below the configured threshold.
    let same = analyze_move_comparison(&record, &positions[50], &engine, &strict)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(same.score_loss, 0.0);
    assert!(!engine
        .seen
        .lock()
        .unwrap()
        .iter()
        .any(|query| query.id == "p50-actual-forced"));
}

#[tokio::test]
async fn rejects_wrong_root_and_malformed_ownership_and_reports_missing_probes() {
    let record = record();
    let positions = replay_main_line(&record).unwrap();
    let mut engine = RecordedEngine::load();
    let comparison = analyze_move_comparison(&record, &positions[60], &engine, &config())
        .await
        .unwrap()
        .unwrap();
    let mut wrong = comparison.context.clone();
    wrong.root_ply += 1;
    assert!(compute_move_comparison(60, wrong, comparison.evidence.clone()).is_none());
    let mut evidence = comparison.evidence.clone();
    evidence.actual_root_hash = Some("deliberately mismatched test hash".into());
    assert!(compute_move_comparison(60, comparison.context.clone(), evidence).is_none());
    for malformed in [vec![0.0; 360], vec![f64::NAN; 361], vec![2.0; 361]] {
        let mut context = comparison.context.clone();
        context.actual.ownership = Some(malformed);
        assert!(compute_move_comparison(60, context, comparison.evidence.clone()).is_none());
    }
    let mut context = comparison.context.clone();
    context.preferred.winrate = None;
    assert!(compute_move_comparison(60, context, comparison.evidence).is_none());
    engine.responses.remove("p60-actual-branch-pass");
    let incomplete = analyze_move_comparison(&record, &positions[60], &engine, &config())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(incomplete.group_tempo.len(), 0);
    assert!(incomplete
        .evidence
        .limitations
        .iter()
        .any(|limit| limit.contains("p60-actual-branch-pass")));
}

#[tokio::test]
async fn engine_order_wins_over_visit_count() {
    let record = record();
    let positions = replay_main_line(&record).unwrap();
    let mut engine = RecordedEngine::load();
    // Explicit ordering regression: only ranking metadata is perturbed; no claim
    // is made that these modified visit counts are another real recording.
    let response = engine.responses.get_mut("p50-root").unwrap();
    let infos = response.move_infos.as_mut().unwrap();
    for info in infos.iter_mut() {
        info.visits = Some(if info.order == Some(0) { 2 } else { 200 });
    }
    infos.reverse();
    let comparison = analyze_move_comparison(&record, &positions[50], &engine, &config())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(comparison.ai_move, "R7");
    assert_eq!(comparison.score_loss, 0.0);
}

#[tokio::test]
async fn pipeline_attaches_comparison_to_played_ply_without_replacing_next_mover_root() {
    use std::sync::Arc;
    use yagoo_pipeline::{analyze_game_collected, PipelineStrategy};
    use yagoo_snapshot::PipelineEvent;
    let mut engine = RecordedEngine::load();
    // The genuine actual-branch queries are exactly the ordinary ply-60 board.
    // Alias their IDs for pipeline scheduling; omitted move/PV outputs are unused.
    for (source, target, include_moves) in [
        ("p60-actual-branch-root", "p60-deep-root", true),
        ("p60-actual-branch-pass", "p60-deep-pass", false),
    ] {
        let mut query = engine.queries[source].clone();
        query.id = target.into();
        query.analysis_pv_len = None;
        query.include_moves_ownership = Some(include_moves);
        engine.queries.insert(target.into(), query);
        let mut response = engine.responses[source].clone();
        response.id = target.into();
        engine.responses.insert(target.into(), response);
    }
    let engine = Arc::new(engine);
    let cfg = yagoo_pipeline::PipelineConfig {
        strategy: PipelineStrategy::DeepOnly,
        from_ply: 60,
        to_ply: Some(60),
        emit_game_aggregate: false,
        ..config()
    };
    let sgf = std::fs::read_to_string(fixture_dir().join("source.sgf")).unwrap();
    let events = analyze_game_collected(&sgf, Arc::clone(&engine), cfg)
        .await
        .unwrap();
    let snapshot = events
        .iter()
        .find_map(|event| match event {
            PipelineEvent::PositionCompleted { snapshot, .. } => Some(snapshot),
            _ => None,
        })
        .unwrap();
    assert_eq!(snapshot.ply, 60);
    assert_eq!(snapshot.to_play, ColorToken::B);
    let comparison = snapshot.comparison.as_ref().unwrap();
    assert_eq!(comparison.mover, ColorToken::W);
    assert_eq!(comparison.root_ply, 59);
    assert!(snapshot.board.white.contains(&"S3".into()));
    assert!(!comparison.context.board.white.contains(&"S3".into()));
    let seen = engine.seen.lock().unwrap();
    assert_eq!(
        seen.iter()
            .find(|query| query.id == "p60-deep-root")
            .unwrap()
            .moves
            .len(),
        60
    );
    assert_eq!(
        seen.iter()
            .find(|query| query.id == "p60-root")
            .unwrap()
            .moves
            .len(),
        59
    );
    let PipelineEvent::ReportCompleted { report, .. } = &events[events.len() - 2] else {
        panic!("report metadata must precede completion");
    };
    assert_eq!(report.compared_move_plies, vec![60]);
    assert_eq!(report.completed_position_plies, vec![60]);
    assert_eq!(report.ranked_moves[0].root_ply, 59);
    assert!((report.ranked_moves[0].score_loss - 6.681_626_325).abs() < 1e-9);
    assert!(matches!(
        events.last(),
        Some(PipelineEvent::GameCompleted { game: None, .. })
    ));
}

#[tokio::test]
async fn recorded_status_transitions_drive_group_priority_with_explicit_provenance() {
    let record = record();
    let positions = replay_main_line(&record).unwrap();
    let comparison =
        analyze_move_comparison(&record, &positions[44], &RecordedEngine::load(), &config())
            .await
            .unwrap()
            .unwrap();
    let transitions: Vec<_> = comparison
        .group_tempo
        .iter()
        .filter(|entry| entry.actual_status != entry.preferred_status)
        .collect();
    assert_ne!(transitions.len(), 0);
    let ledger = comparison.ledger_diff.as_ref().unwrap();
    for transition in transitions {
        let line = ledger
            .ledger
            .iter()
            .find(|line| line.id.as_deref() == Some(&transition.group_id))
            .unwrap();
        assert_eq!(
            line.tempo,
            Some(yagoo_snapshot::LedgerTempo::BranchPassProbes)
        );
        assert!(line.tempo_changes.contains(transition));
    }
    assert_eq!(
        comparison
            .context
            .actual_branch
            .as_ref()
            .unwrap()
            .pass_query_id
            .as_deref(),
        Some("p44-actual-branch-pass")
    );
    assert_eq!(
        comparison
            .context
            .preferred_branch
            .as_ref()
            .unwrap()
            .pass_query_id
            .as_deref(),
        Some("p44-ai-branch-pass")
    );
    let intersections: std::collections::HashSet<_> = ledger
        .ledger
        .iter()
        .flat_map(|line| &line.intersections)
        .collect();
    assert_eq!(intersections.len(), 361);
    assert_eq!(
        ledger
            .ledger
            .iter()
            .map(|line| line.intersections.len())
            .sum::<usize>(),
        361
    );
}
