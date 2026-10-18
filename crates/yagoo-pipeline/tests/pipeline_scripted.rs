use std::sync::Arc;
use yagoo_katago::AnalysisClient;
use yagoo_pipeline::{analyze_game_collected, DeepSelectConfig, PipelineConfig, PipelineStrategy};
use yagoo_snapshot::{AnalysisPhase, OwnershipConvention, PipelineEvent, SCHEMA_VERSION};

fn root_line(id: &str, visits: u64) -> String {
    format!(
        r#"{{"id":"{id}","isDuringSearch":false,"rootInfo":{{"visits":{visits},"winrate":0.55,"scoreLead":1.5}},"ownership":[0.2,-0.1,0.0],"ownershipStdev":[0.05,0.05,0.1],"policy":[0.1,0.2,0.3],"moveInfos":[{{"move":"C3","visits":40,"order":0,"winrate":0.56,"scoreLead":1.6,"prior":0.1,"pv":["C3","G7"],"ownership":[0.3,-0.1,0.0]}},{{"move":"G7","visits":20,"order":1,"winrate":0.52,"scoreLead":0.5,"prior":0.08,"pv":["G7"]}}]}}"#
    )
}

fn root_line_vals(id: &str, visits: u64, wr: f64, sl: f64, own: &str) -> String {
    format!(
        r#"{{"id":"{id}","isDuringSearch":false,"rootInfo":{{"visits":{visits},"winrate":{wr},"scoreLead":{sl}}},"ownership":{own},"ownershipStdev":[0.05,0.05,0.1],"policy":[0.1,0.2,0.3],"moveInfos":[{{"move":"C3","visits":40,"order":0,"winrate":{wr},"scoreLead":{sl},"prior":0.1,"pv":["C3"],"ownership":{own}}}]}}"#
    )
}

fn partial_then_final(id: &str) -> Vec<String> {
    vec![
        format!(
            r#"{{"id":"{id}","isDuringSearch":true,"rootInfo":{{"visits":10,"winrate":0.5,"scoreLead":0.0}},"ownership":[0.0,0.0,0.0]}}"#
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
        PipelineEvent::DeepPliesSelected {
            mode,
            plies,
            ..
        } if mode == "range" && plies == &[0, 1]
    )));
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
async fn scan_then_deep_auto_picks_swing_ply() {
    // 3 positions (plies 0,1,2). Scan roots with a big winrate swing into ply 2.
    // Deep only ply 2: root + pass.
    let own0 = "[0.0,0.0,0.0]";
    let own1 = "[0.01,0.0,0.0]";
    let own2 = "[0.02,0.0,0.0]";
    let lines = vec![
        root_line_vals("p0-scan-root", 50, 0.50, 0.0, own0),
        root_line_vals("p1-scan-root", 50, 0.51, 0.2, own1),
        root_line_vals("p2-scan-root", 50, 0.70, 1.0, own2), // wr Δ 0.19 vs ply1
        root_line("p2-deep-root", 200),
        root_line("p2-deep-pass", 200),
    ];
    let client = Arc::new(AnalysisClient::scripted(lines));
    // Three moves so plies 0..=2 exist (setup + 2 moves? wait: setup=0, after B=1, after W=2)
    let sgf = "(;SZ[9]KM[7.5];B[cc];W[gg])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::ScanThenDeep,
        scan_visits: 50,
        root_visits: 200,
        from_ply: 0,
        to_ply: Some(2),
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        deepen_all: false,
        deep_select: DeepSelectConfig::default(),
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

    let selected = events.iter().find_map(|e| match e {
        PipelineEvent::DeepPliesSelected {
            mode,
            plies,
            reasons,
            ..
        } => Some((mode.as_str(), plies.clone(), reasons.clone())),
        _ => None,
    });
    let (mode, plies, reasons) = selected.expect("deep_plies_selected");
    assert_eq!(mode, "swing");
    assert_eq!(plies, vec![2]);
    assert_eq!(reasons.len(), 1);
    assert!(reasons[0].winrate_delta >= 0.05);

    let deep_plies: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            PipelineEvent::PositionCompleted {
                phase: AnalysisPhase::Deep,
                snapshot,
                ..
            } => Some(snapshot.ply),
            _ => None,
        })
        .collect();
    assert_eq!(deep_plies, vec![2]);
}

#[tokio::test]
async fn scan_then_deep_auto_picks_ownership_only_swing() {
    // Flat winrate / scoreLead; ownership mean |Δ| ≥ 0.08 into ply 2.
    let own0 = "[0.0,0.0,0.0,0.0]";
    let own1 = "[0.0,0.0,0.0,0.0]";
    let own2 = "[0.2,0.2,0.2,0.2]"; // mean abs Δ vs ply1 = 0.2
    let lines = vec![
        root_line_vals("p0-scan-root", 50, 0.50, 1.0, own0),
        root_line_vals("p1-scan-root", 50, 0.50, 1.0, own1),
        root_line_vals("p2-scan-root", 50, 0.50, 1.0, own2),
        root_line("p2-deep-root", 200),
        root_line("p2-deep-pass", 200),
    ];
    let client = Arc::new(AnalysisClient::scripted(lines));
    let sgf = "(;SZ[9]KM[7.5];B[cc];W[gg])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::ScanThenDeep,
        scan_visits: 50,
        root_visits: 200,
        from_ply: 0,
        to_ply: Some(2),
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        deepen_all: false,
        deep_select: DeepSelectConfig::default(),
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    let selected = events.iter().find_map(|e| match e {
        PipelineEvent::DeepPliesSelected {
            mode,
            plies,
            reasons,
            ..
        } => Some((mode.as_str(), plies.clone(), reasons.clone())),
        _ => None,
    });
    let (mode, plies, reasons) = selected.expect("deep_plies_selected");
    assert_eq!(mode, "swing");
    assert_eq!(plies, vec![2]);
    assert_eq!(reasons.len(), 1);
    assert!(reasons[0].winrate_delta < 0.05);
    assert!(reasons[0].score_lead_delta < 3.0);
    assert!(reasons[0].ownership_delta >= 0.08);

    // Scan snapshots must carry top-level ownership into EngineAnalysis.
    let scan_ply2 = events.iter().find_map(|e| match e {
        PipelineEvent::PositionCompleted {
            phase: AnalysisPhase::Scan,
            snapshot,
            ..
        } if snapshot.ply == 2 => Some(snapshot.as_ref()),
        _ => None,
    });
    let own = scan_ply2
        .expect("scan ply 2")
        .root
        .as_ref()
        .and_then(|r| r.ownership.as_ref())
        .expect("ownership on scan snapshot");
    assert_eq!(own.len(), 4);
    assert!((own[0] - 0.2).abs() < 1e-9);
}

#[tokio::test]
async fn deepen_all_deepens_every_scanned_ply() {
    // 2 plies; no meaningful swings required because deepen_all.
    let lines = vec![
        root_line("p0-scan-root", 40),
        root_line("p1-scan-root", 40),
        root_line("p0-deep-root", 100),
        root_line("p0-deep-pass", 100),
        root_line("p1-deep-root", 100),
        root_line("p1-deep-pass", 100),
    ];
    let client = Arc::new(AnalysisClient::scripted(lines));
    let sgf = "(;SZ[9];B[cc])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::ScanThenDeep,
        deepen_all: true,
        from_ply: 0,
        to_ply: Some(1),
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    assert!(events.iter().any(|e| matches!(
        e,
        PipelineEvent::DeepPliesSelected {
            mode,
            plies,
            ..
        } if mode == "all" && plies == &[0, 1]
    )));
    let deep_plies: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            PipelineEvent::PositionCompleted {
                phase: AnalysisPhase::Deep,
                snapshot,
                ..
            } => Some(snapshot.ply),
            _ => None,
        })
        .collect();
    assert_eq!(deep_plies, vec![0, 1]);
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

#[tokio::test]
async fn from_to_filters_scan_and_selection() {
    // Full game has plies 0..=3; filter to 1..=2. Swing into ply 2 only within filter.
    let own = "[0.0,0.0,0.0]";
    let lines = vec![
        root_line_vals("p1-scan-root", 50, 0.50, 0.0, own),
        root_line_vals("p2-scan-root", 50, 0.66, 5.0, own), // wr+sl swing
        root_line("p2-deep-root", 100),
        root_line("p2-deep-pass", 100),
    ];
    let client = Arc::new(AnalysisClient::scripted(lines));
    let sgf = "(;SZ[9];B[cc];W[gg];B[ee])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::ScanThenDeep,
        from_ply: 1,
        to_ply: Some(2),
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    let scan_plies: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            PipelineEvent::PositionCompleted {
                phase: AnalysisPhase::Scan,
                snapshot,
                ..
            } => Some(snapshot.ply),
            _ => None,
        })
        .collect();
    assert_eq!(scan_plies, vec![1, 2]);
    assert!(events.iter().any(|e| matches!(
        e,
        PipelineEvent::DeepPliesSelected { plies, .. } if plies == &[2]
    )));
}
