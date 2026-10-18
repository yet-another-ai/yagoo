use yagoo_katago::{AnalysisClient, AnalysisQueryBuilder, KatagoError};

#[tokio::test]
async fn parses_fixture_response() {
    let json = include_str!("fixtures/analysis_response.json");
    let resp = AnalysisClient::parse_response(json).unwrap();
    assert_eq!(resp.id, "fixture-1");
    let root = resp.root_info.as_ref().unwrap();
    assert_eq!(root.visits, Some(500));
    assert_eq!(root.ownership.as_ref().unwrap().len(), 3);
    assert_eq!(root.ownership_stdev.as_ref().unwrap().len(), 3);
    let moves = resp.move_infos.as_ref().unwrap();
    assert_eq!(moves[0].gtp_move(), "D4");
    assert_eq!(moves[0].visits, Some(120));
    assert_eq!(moves[0].pv.as_ref().unwrap()[1], "Q16");
    assert!(moves[0].ownership.is_some());
    assert!(moves[0].ownership_stdev.is_some());
    assert_eq!(moves[1].gtp_move(), "Q16");
}

#[tokio::test]
async fn scripted_client_roundtrip() {
    let json = include_str!("fixtures/analysis_response.json");
    let client = AnalysisClient::scripted(vec![json.to_owned()]);
    let query = AnalysisQueryBuilder::new("fixture-1")
        .report_as_black()
        .max_visits(500)
        .build();
    let resp = client.analyze(&query).await.unwrap();
    assert_eq!(resp.id, "fixture-1");
    let writes = client.scripted_writes().await;
    assert_eq!(writes.len(), 1);
    assert!(writes[0].contains("\"id\":\"fixture-1\""));
    assert!(writes[0].contains("includeOwnership"));
}

#[tokio::test]
async fn skips_during_search_updates() {
    let partial = r#"{"id":"x","isDuringSearch":true,"rootInfo":{"visits":10}}"#;
    let final_json = include_str!("fixtures/analysis_response.json").replace("fixture-1", "x");
    let client = AnalysisClient::scripted(vec![partial.into(), final_json]);
    let query = AnalysisQueryBuilder::new("x").build();
    let resp = client.analyze(&query).await.unwrap();
    assert_eq!(resp.root_info.unwrap().visits, Some(500));
}

#[tokio::test]
async fn engine_error_surfaces() {
    let client = AnalysisClient::scripted(vec![r#"{"id":"bad","error":"unknown field"}"#.into()]);
    let query = AnalysisQueryBuilder::new("bad").build();
    let err = client.analyze(&query).await.unwrap_err();
    match err {
        KatagoError::Engine { id, error } => {
            assert_eq!(id, "bad");
            assert!(error.contains("unknown"));
        }
        other => panic!("unexpected {other:?}"),
    }
}
