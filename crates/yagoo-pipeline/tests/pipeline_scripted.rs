use std::sync::Arc;
use yagoo_katago::AnalysisClient;
use yagoo_pipeline::{analyze_game_collected, PipelineConfig, PipelineStrategy};
use yagoo_snapshot::{AnalysisPhase, OwnershipConvention, PipelineEvent, SCHEMA_VERSION};

fn root_line(id: &str, visits: u64) -> String {
    format!(
        r#"{{"id":"{id}","isDuringSearch":false,"rootInfo":{{"visits":{visits},"winrate":0.55,"scoreLead":1.5,"ownership":[0.2,-0.1,0.0],"ownershipStdev":[0.05,0.05,0.1],"policy":[0.1,0.2,0.3]}},"moveInfos":[{{"move":"C3","visits":40,"order":0,"winrate":0.56,"scoreLead":1.6,"prior":0.1,"pv":["C3","G7"],"ownership":[0.3,-0.1,0.0]}},{{"move":"G7","visits":20,"order":1,"winrate":0.52,"scoreLead":0.5,"prior":0.08,"pv":["G7"]}}],"policy":[0.1,0.2,0.3]}}"#
    )
}

fn partial_then_final(id: &str) -> Vec<String> {
    vec![
        format!(
            r#"{{"id":"{id}","isDuringSearch":true,"rootInfo":{{"visits":10,"winrate":0.5,"scoreLead":0.0,"ownership":[0.0,0.0,0.0]}}}}"#
        ),
        root_line(id, 100),
    ]
}

#[tokio::test]
async fn deep_only_emits_ordered_events_and_black_positive() {
    // ply 0 and 1; each: root + pass → 4 queries. Include one partial on first root.
    let mut lines = Vec::new();
    lines.extend(partial_then_final("p0-deep-root"));
    lines.push(root_line("p0-deep-pass", 100));
    lines.push(root_line("p1-deep-root", 100));
    lines.push(root_line("p1-deep-pass", 100));

    let client = Arc::new(AnalysisClient::scripted(lines));
    let sgf = "(;SZ[9]KM[6.5]RU[Chinese];B[cc])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::DeepOnly,
        root_visits: 100,
        from_ply: 0,
        to_ply: Some(1),
        report_during_search_every: Some(0.1),
        include_pv_ends: false,
        emit_game_aggregate: true,
        ..PipelineConfig::default()
    };

    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    assert!(matches!(
        events.first(),
        Some(PipelineEvent::GameStarted { .. })
    ));
    assert!(events.iter().any(|e| matches!(
        e,
        PipelineEvent::StagePartial {
            stage: yagoo_snapshot::AnalysisStage::Root,
            ..
        }
    )));
    assert!(events.iter().any(|e| matches!(
        e,
        PipelineEvent::PhaseStarted {
            phase: AnalysisPhase::Deep,
            ..
        }
    )));

    let completed: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            PipelineEvent::PositionCompleted { snapshot, .. } => Some(snapshot.as_ref()),
            _ => None,
        })
        .collect();
    assert_eq!(completed.len(), 2);
    assert_eq!(
        completed[0].ownership_convention,
        OwnershipConvention::BlackPositive
    );
    assert_eq!(completed[0].schema_version, SCHEMA_VERSION);
    assert!(completed[0].root.is_some());
    assert!(completed[0].pass_probe.is_some());
    assert_ne!(completed[0].candidates.len(), 0);
    assert_eq!(completed[1].board.black.len(), 1);

    assert!(matches!(
        events.last(),
        Some(PipelineEvent::GameCompleted { game: Some(_), .. })
    ));
}

#[tokio::test]
async fn scan_then_deep_runs_two_phases() {
    // 1 position (ply 0 only): scan root + deep root + deep pass = 3
    let lines = vec![
        root_line("p0-scan-root", 50),
        root_line("p0-deep-root", 200),
        root_line("p0-deep-pass", 200),
    ];
    let client = Arc::new(AnalysisClient::scripted(lines));
    let sgf = "(;SZ[9]KM[7.5])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::ScanThenDeep,
        scan_visits: 50,
        root_visits: 200,
        from_ply: 0,
        to_ply: Some(0),
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    let phases: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            PipelineEvent::PhaseStarted { phase, .. } => Some(*phase),
            _ => None,
        })
        .collect();
    assert_eq!(phases, vec![AnalysisPhase::Scan, AnalysisPhase::Deep]);
}

#[tokio::test]
async fn skips_pass_probe_after_pass_move() {
    // Positions: ply0, ply1 (after B pass). Deep on ply1 should skip pass probe.
    // Queries: p0 root, p0 pass, p1 root  (no p1 pass) = 3
    let lines = vec![
        root_line("p0-deep-root", 80),
        root_line("p0-deep-pass", 80),
        root_line("p1-deep-root", 80),
    ];
    let client = Arc::new(AnalysisClient::scripted(lines));
    let sgf = "(;SZ[9];B[])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::DeepOnly,
        root_visits: 80,
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    let ply1 = events.iter().find_map(|e| match e {
        PipelineEvent::PositionCompleted { snapshot, .. } if snapshot.ply == 1 => {
            Some(snapshot.as_ref())
        }
        _ => None,
    });
    let snap = ply1.expect("ply 1 snapshot");
    assert_eq!(
        snap.pass_probe_skipped,
        Some(yagoo_snapshot::PassProbeSkipReason::PreviousWasPass)
    );
    assert!(snap.pass_probe.is_none());
}
