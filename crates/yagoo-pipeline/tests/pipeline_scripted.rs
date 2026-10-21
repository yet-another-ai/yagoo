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
async fn opening_setup_support_matches_browser_sgf_cases() {
    #[derive(serde::Deserialize)]
    struct Case {
        description: String,
        sgf: String,
        name: Option<String>,
    }
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("../../../data/openings-sgf-cases.json")).unwrap();
    for case in cases {
        // Scripted responses exercise event/aggregate wiring, never an engine or model.
        let client = Arc::new(AnalysisClient::scripted(vec![
            root_line("p0-deep-root", 10),
            root_line("p0-deep-pass", 10),
        ]));
        let config = PipelineConfig {
            strategy: PipelineStrategy::DeepOnly,
            to_ply: Some(0),
            include_pv_ends: false,
            include_comparison: false,
            emit_game_aggregate: true,
            ..PipelineConfig::default()
        };
        let events = analyze_game_collected(&case.sgf, client, config)
            .await
            .unwrap_or_else(|error| panic!("{}: {error}", case.description));
        let PipelineEvent::OpeningMatched {
            match_: opening, ..
        } = &events[1]
        else {
            panic!("{}: expected opening event", case.description);
        };
        assert_eq!(
            opening.as_ref().map(|value| value.name.as_str()),
            case.name.as_deref(),
            "{}",
            case.description,
        );
        let PipelineEvent::GameCompleted {
            game: Some(game), ..
        } = events.last().unwrap()
        else {
            panic!("{}: expected aggregate", case.description);
        };
        assert_eq!(&game.opening, opening, "{}", case.description);
    }
}

#[tokio::test]
async fn opening_precedes_analysis_and_uses_full_game_outside_requested_range() {
    let client = Arc::new(AnalysisClient::scripted(vec![
        root_line("p4-deep-root", 10),
        root_line("p4-deep-pass", 10),
    ]));
    let config = PipelineConfig {
        strategy: PipelineStrategy::DeepOnly,
        from_ply: 4,
        to_ply: Some(4),
        include_pv_ends: false,
        include_comparison: false,
        emit_game_aggregate: true,
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected("(;SZ[19];B[dd];W[cc];B[dc];W[ce])", client, config)
        .await
        .unwrap();
    let PipelineEvent::OpeningMatched {
        match_: Some(opening),
        ..
    } = &events[1]
    else {
        panic!("opening must follow gameStarted, before engine work");
    };
    assert_eq!(
        opening.joseki.as_deref(),
        Some("3-3 invasion: block and extend")
    );
    assert_eq!(opening.deviation_ply, Some(4));
    let PipelineEvent::GameCompleted {
        game: Some(game), ..
    } = events.last().unwrap()
    else {
        panic!("expected aggregate");
    };
    assert_eq!(game.opening.as_ref(), Some(opening));
}

#[tokio::test]
async fn whole_board_deviation_uses_full_game_before_filtered_analysis() {
    let client = Arc::new(AnalysisClient::scripted(vec![
        root_line("p7-deep-root", 10),
        root_line("p7-deep-pass", 10),
    ]));
    let config = PipelineConfig {
        strategy: PipelineStrategy::DeepOnly,
        from_ply: 7,
        to_ply: Some(7),
        include_pv_ends: false,
        include_comparison: false,
        emit_game_aggregate: true,
        ..PipelineConfig::default()
    };
    // W[jj] at move 6 differs from the authored W[qn] sample continuation.
    // The opening prefix and its deviation both precede the analyzed range.
    let events = analyze_game_collected(
        "(;SZ[19];B[pd];W[dd];B[pp];W[dp];B[pj];W[jj];B[fc])",
        client,
        config,
    )
    .await
    .unwrap();
    assert!(matches!(&events[0], PipelineEvent::GameStarted { .. }));
    let PipelineEvent::OpeningMatched {
        match_: Some(opening),
        ..
    } = &events[1]
    else {
        panic!("whole-board opening must precede engine analysis");
    };
    assert_eq!(opening.name, "Sanrensei");
    assert_eq!(opening.joseki, None);
    assert_eq!(opening.deviation_ply, Some(6));
    assert_eq!(opening.source, "yagoo-starter-1 (Apache-2.0)");
    let PipelineEvent::GameCompleted {
        game: Some(game), ..
    } = events.last().unwrap()
    else {
        panic!("expected aggregate");
    };
    assert_eq!(game.opening.as_ref(), Some(opening));
    assert_eq!(game.positions.len(), 1);
    assert_eq!(game.positions[0].ply, 7);
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
        include_comparison: false,
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

    let PipelineEvent::ReportCompleted { report, .. } = &events[events.len() - 2] else {
        panic!("report metadata must precede gameCompleted");
    };
    assert_eq!(report.completed_position_plies, vec![0, 1]);
    assert_eq!(report.missing_comparison_plies, vec![1]);
    assert_eq!(report.ranked_moves.len(), 0);
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
        include_comparison: false,
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
        include_comparison: false,
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
        include_comparison: false,
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
        include_comparison: false,
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
        include_comparison: false,
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

/// Deep phase attaches teaching groups (块) when scenario ownership differs.
#[tokio::test]
async fn deep_phase_emits_pipeline_groups() {
    let n = 81_usize;
    // Root: black-ish corner around A9 (index 0) / B9 (1) / A8 (9).
    let mut root = vec![0.0_f64; n];
    let mut pass = vec![0.0_f64; n];
    let mut cand = vec![0.0_f64; n];
    for &i in &[0usize, 1, 9, 10] {
        root[i] = 0.55;
        pass[i] = -0.45;
        cand[i] = 0.75;
    }
    // Second region with orthogonal fate (bottom-right).
    for &i in &[80usize, 79, 71] {
        root[i] = -0.2;
        pass[i] = 0.4;
        cand[i] = -0.6;
    }
    let own_json = |v: &[f64]| {
        format!(
            "[{}]",
            v.iter()
                .map(|x| format!("{x}"))
                .collect::<Vec<_>>()
                .join(",")
        )
    };
    let root_s = own_json(&root);
    let pass_s = own_json(&pass);
    let cand_s = own_json(&cand);
    let stdev = format!("[{}]", vec!["0.1"; n].join(","));
    let policy = format!("[{}]", vec!["0.01"; n].join(","));

    let root_line = format!(
        r#"{{"id":"p0-deep-root","isDuringSearch":false,"rootInfo":{{"visits":100,"winrate":0.55,"scoreLead":1.0}},"ownership":{root_s},"ownershipStdev":{stdev},"policy":{policy},"moveInfos":[{{"move":"C3","visits":40,"order":0,"winrate":0.56,"scoreLead":1.2,"prior":0.1,"pv":["C3"],"ownership":{cand_s}}}]}}"#
    );
    let pass_line = format!(
        r#"{{"id":"p0-deep-pass","isDuringSearch":false,"rootInfo":{{"visits":100,"winrate":0.45,"scoreLead":-1.0}},"ownership":{pass_s},"ownershipStdev":{stdev},"policy":{policy},"moveInfos":[]}}"#
    );

    let client = Arc::new(AnalysisClient::scripted(vec![root_line, pass_line]));
    // Setup stones matching the clustered corner so the group has stones.
    let sgf = "(;SZ[9]KM[6.5]AB[aa][ba][ab][bb])";
    let cfg = PipelineConfig {
        strategy: PipelineStrategy::DeepOnly,
        root_visits: 100,
        from_ply: 0,
        to_ply: Some(0),
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        include_comparison: false,
        ..PipelineConfig::default()
    };
    let events = analyze_game_collected(sgf, client, cfg).await.unwrap();
    let snap = events.iter().find_map(|e| match e {
        PipelineEvent::PositionCompleted {
            phase: AnalysisPhase::Deep,
            snapshot,
            ..
        } => Some(snapshot.as_ref()),
        _ => None,
    });
    let snap = snap.expect("deep snapshot");
    assert!(
        !snap.groups.is_empty(),
        "expected teaching groups from correlated ownership"
    );
    assert!(snap
        .groups
        .iter()
        .all(|g| { g.source == Some(yagoo_snapshot::GroupSource::Pipeline) }));
    assert!(snap
        .groups
        .iter()
        .any(|g| { !g.members.black_stones.is_empty() || !g.members.white_stones.is_empty() }));
}
