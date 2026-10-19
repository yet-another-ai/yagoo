use yagoo_snapshot::{
    BoardSnapshot, ColorToken, EngineAnalysis, OwnershipConvention, PositionSnapshot,
    SCHEMA_VERSION,
};

#[test]
fn position_snapshot_json_roundtrip_and_convention() {
    let snap = PositionSnapshot {
        schema_version: SCHEMA_VERSION,
        ply: 3,
        to_play: ColorToken::W,
        last_move: Some("D4".into()),
        ownership_convention: OwnershipConvention::BlackPositive,
        board: BoardSnapshot {
            size: 19,
            black: vec!["D4".into()],
            white: vec![],
        },
        chains: vec![],
        root: Some(EngineAnalysis {
            visits: Some(800),
            winrate: Some(0.51),
            score_lead: Some(1.25),
            score_stdev: None,
            utility: None,
            ownership: Some(vec![0.2, -0.5]),
            ownership_stdev: Some(vec![0.1, 0.2]),
            policy: None,
            neural: None,
        }),
        pass_probe: None,
        pass_probe_skipped: None,
        candidates: vec![],
        pv_ends: vec![],
        phase: Some("deep".into()),
    };
    let json = serde_json::to_string_pretty(&snap).unwrap();
    assert!(json.contains("black_positive") || json.contains("blackPositive"));
    // serde rename_all camelCase on enum: BlackPositive -> "blackPositive" with default serde
    // We used rename_all = "snake_case" on the enum → "black_positive"
    assert!(json.contains("black_positive"));
    let back: PositionSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(back, snap);
    assert_eq!(
        back.ownership_convention,
        OwnershipConvention::BlackPositive
    );
    // Black-positive: positive ownership favors Black.
    assert!(back.root.unwrap().ownership.unwrap()[0] > 0.0);
}
