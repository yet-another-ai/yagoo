use super::*;
use axum::body::Body;
use http_body_util::BodyExt;
use std::{collections::HashMap, io::Read, sync::Mutex};
use tokio::task::LocalSet;
use tower::ServiceExt;
use yagoo_katago::AnalysisResponse;
use yagoo_pipeline::{analyze_game_collected, DeepSelectConfig};

struct Recording {
    responses: HashMap<String, AnalysisResponse>,
    queries: Mutex<Vec<AnalysisQuery>>,
}

impl Recording {
    fn load() -> Self {
        let bytes =
            include_bytes!("../../../yagoo-pipeline/tests/fixtures/sample-19x19/responses.json.gz");
        let mut json = String::new();
        flate2::read::GzDecoder::new(bytes.as_slice())
            .read_to_string(&mut json)
            .unwrap();
        let lines: Vec<String> = serde_json::from_str(&json).unwrap();
        let responses = lines
            .into_iter()
            .map(|line| {
                let response: AnalysisResponse = serde_json::from_str(&line).unwrap();
                (response.id.clone(), response)
            })
            .collect();
        Self {
            responses,
            queries: Mutex::new(Vec::new()),
        }
    }
}

impl AnalysisEngine for Recording {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            self.queries.lock().unwrap().push(query.clone());
            let id = query
                .id
                .split_once(':')
                .map_or(query.id.as_str(), |(_, id)| id);
            let key = if id == "interactive-root" {
                "p0-scan-root"
            } else {
                id
            };
            let mut response = self.responses.get(key).expect("recorded query").clone();
            response.id.clone_from(&query.id);
            // A noisy engine must not leak unsolicited intermediate results.
            if query.id.starts_with("request-") {
                let mut partial = response.clone();
                partial.is_during_search = Some(true);
                on_update(AnalysisUpdate::Partial(partial))?;
            }
            on_update(AnalysisUpdate::Final(response))
        })
    }
}

fn config() -> PipelineConfig {
    PipelineConfig {
        scan_visits: 200,
        root_visits: 500,
        top_k: 5,
        emit_game_aggregate: false,
        deep_select: DeepSelectConfig {
            max_deep_plies: 8,
            ..DeepSelectConfig::default()
        },
        ..PipelineConfig::default()
    }
}

fn request(method: Method, path: &str, body: impl Into<Body>) -> Request {
    Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:8710")
        .header("origin", "http://localhost:5173")
        .header("content-type", "application/json")
        .body(body.into())
        .unwrap()
}

async fn events(response: Response) -> Vec<String> {
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec())
        .unwrap()
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.trim().to_owned())
        .collect()
}

#[tokio::test]
async fn concurrent_sse_runs_equal_recorded_ndjson_and_use_unique_queries() {
    LocalSet::new()
        .run_until(async {
            let engine = Arc::new(Recording::load());
            let sgf = include_str!("../../../../docs/public/app/sample.sgf");
            let expected = analyze_game_collected(sgf, Arc::clone(&engine), config())
                .await
                .unwrap()
                .iter()
                .map(|e| serde_json::to_string(e).unwrap())
                .collect::<Vec<_>>();
            engine.queries.lock().unwrap().clear();
            let app = router(
                Arc::clone(&engine),
                Some(sgf.into()),
                config(),
                ServeOptions::new(8710, vec![]).unwrap(),
            );
            let get = app
                .clone()
                .oneshot(request(Method::GET, "/analyze", Body::empty()))
                .await
                .unwrap();
            let post = app
                .oneshot(request(
                    Method::POST,
                    "/analyze",
                    serde_json::json!({"sgf": sgf}).to_string(),
                ))
                .await
                .unwrap();
            let (first, second) = tokio::join!(events(get), events(post));
            for actual in [&first, &second] {
                assert_eq!(actual.len(), expected.len());
                for (i, (actual, expected)) in actual.iter().zip(&expected).enumerate() {
                    assert!(actual == expected, "SSE event {i} differs from CLI JSON");
                }
            }
            assert!(!first
                .iter()
                .any(|e| e.contains("\"type\":\"stagePartial\"")));
            let queries = engine.queries.lock().unwrap();
            let ids: std::collections::HashSet<_> = queries.iter().map(|q| &q.id).collect();
            assert_eq!(ids.len(), queries.len());
            assert!(queries.iter().any(|q| q.id.starts_with("request-1:")));
            assert!(queries.iter().any(|q| q.id.starts_with("request-2:")));
        })
        .await;
}

struct PendingEngine {
    started: mpsc::UnboundedSender<String>,
    dropped: mpsc::UnboundedSender<String>,
}

struct DropNotice(mpsc::UnboundedSender<String>, String);
impl Drop for DropNotice {
    fn drop(&mut self) {
        let _ = self.0.send(self.1.clone());
    }
}

impl AnalysisEngine for PendingEngine {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        _: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            let _notice = DropNotice(self.dropped.clone(), query.id.clone());
            self.started.send(query.id.clone()).unwrap();
            futures::future::pending().await
        })
    }
}

fn pending() -> (
    Arc<PendingEngine>,
    mpsc::UnboundedReceiver<String>,
    mpsc::UnboundedReceiver<String>,
) {
    let (started, starts) = mpsc::unbounded_channel();
    let (dropped, drops) = mpsc::unbounded_channel();
    (Arc::new(PendingEngine { started, dropped }), starts, drops)
}

#[tokio::test]
async fn dropping_http_body_cancels_waiting_query_and_allows_repeat() {
    // A liveness guard, never a throughput/performance threshold.
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        LocalSet::new().run_until(async {
            let (engine, mut starts, mut drops) = pending();
            let app = router(
                engine,
                None,
                config(),
                ServeOptions::new(8710, vec![]).unwrap(),
            );
            for id in 1..=2 {
                let response = app
                    .clone()
                    .oneshot(request(
                        Method::POST,
                        "/analyze-position",
                        r#"{"sgf":"(;SZ[9])","ply":0}"#,
                    ))
                    .await
                    .unwrap();
                assert_eq!(
                    starts.recv().await.unwrap(),
                    format!("request-{id}:interactive-root")
                );
                drop(response);
                assert_eq!(
                    drops.recv().await.unwrap(),
                    format!("request-{id}:interactive-root")
                );
            }
        }),
    )
    .await
    .expect("body disconnect cancels the pending engine future");
}

#[tokio::test]
async fn tcp_disconnect_cancels_before_the_engine_emits_any_output() {
    use tokio::io::AsyncWriteExt;
    tokio::time::timeout(std::time::Duration::from_secs(10), LocalSet::new().run_until(async {
        let (engine, mut starts, mut drops) = pending();
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = router(engine, None, config(), ServeOptions::new(port, vec![]).unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        let mut socket = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.unwrap();
        let body = r#"{"sgf":"(;SZ[9])","ply":0}"#;
        let request = format!(
            "POST /analyze-position HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len(),
        );
        socket.write_all(request.as_bytes()).await.unwrap();
        let id = starts.recv().await.unwrap();
        drop(socket);
        assert_eq!(drops.recv().await.unwrap(), id);
        server.abort();
    })).await.expect("TCP disconnect drops the engine future");
}

#[tokio::test]
async fn interactive_endpoint_emits_only_one_root_snapshot() {
    LocalSet::new()
        .run_until(async {
            let engine = Arc::new(Recording::load());
            let app = router(
                Arc::clone(&engine),
                None,
                config(),
                ServeOptions::new(8710, vec![]).unwrap(),
            );
            let result = app
                .oneshot(request(
                    Method::POST,
                    "/analyze-position",
                    r#"{"sgf":"(;SZ[19]KM[7.5]PL[W])","ply":0,"moves":["D4","pass"],"visits":123}"#,
                ))
                .await
                .unwrap();
            let values = events(result).await;
            assert_eq!(values.len(), 1);
            let event: PipelineEvent = serde_json::from_str(&values[0]).unwrap();
            let PipelineEvent::PositionCompleted { snapshot, .. } = event else {
                panic!("expected root snapshot");
            };
            assert_eq!(snapshot.ply, 2);
            assert_eq!(snapshot.to_play, yagoo_snapshot::ColorToken::W);
            assert!(snapshot.root.is_some());
            assert_eq!(snapshot.groups, []);
            assert!(snapshot.pass_probe.is_none());
            let queries = engine.queries.lock().unwrap();
            assert_eq!(queries.len(), 1);
            assert_eq!(queries[0].rules.as_deref(), Some("chinese"));
            assert_eq!(queries[0].max_visits, Some(123));
            assert_eq!(
                queries[0].initial_player,
                Some(yagoo_katago::PlayerToken::W)
            );
            assert_eq!(queries[0].moves.len(), 2);
            assert!(queries[0].report_during_search_every.is_none());
        })
        .await;
}

#[tokio::test]
async fn rejects_untrusted_origins_hosts_invalid_positions_and_overload() {
    LocalSet::new()
        .run_until(async {
            let (engine, mut starts, _) = pending();
            let app = router(
                engine,
                None,
                config(),
                ServeOptions::new(8710, vec![]).unwrap(),
            );
            let mut evil = request(Method::POST, "/analyze", r#"{"sgf":"(;SZ[9])"}"#);
            evil.headers_mut().insert(
                header::ORIGIN,
                HeaderValue::from_static("https://evil.example"),
            );
            assert_eq!(
                app.clone().oneshot(evil).await.unwrap().status(),
                StatusCode::FORBIDDEN
            );
            let mut rebound = request(Method::GET, "/health", Body::empty());
            rebound.headers_mut().insert(
                header::HOST,
                HeaderValue::from_static("rebind.example:8710"),
            );
            assert_eq!(
                app.clone().oneshot(rebound).await.unwrap().status(),
                StatusCode::FORBIDDEN
            );
            let preflight = app
                .clone()
                .oneshot(request(Method::OPTIONS, "/analyze", Body::empty()))
                .await
                .unwrap();
            assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
            assert_eq!(
                preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
                "http://localhost:5173"
            );
            assert_eq!(
                app.clone()
                    .oneshot(request(
                        Method::POST,
                        "/analyze-position",
                        r#"{"sgf":"(;SZ[9])","ply":5}"#
                    ))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::BAD_REQUEST
            );
            let mut active = vec![];
            for _ in 0..4 {
                active.push(
                    app.clone()
                        .oneshot(request(
                            Method::POST,
                            "/analyze-position",
                            r#"{"sgf":"(;SZ[9])","ply":0}"#,
                        ))
                        .await
                        .unwrap(),
                );
                starts.recv().await.unwrap();
            }
            assert_eq!(
                app.oneshot(request(
                    Method::POST,
                    "/analyze-position",
                    // Admission precedes parsing/replay, even for bad input.
                    r#"{"sgf":"not SGF","ply":0}"#
                ))
                .await
                .unwrap()
                .status(),
                StatusCode::TOO_MANY_REQUESTS
            );
            drop(active);
        })
        .await;
}

#[test]
fn origin_configuration_requires_exact_origins() {
    for origin in [
        "*",
        "null",
        "file:///tmp/review",
        "https://site.example/path",
        "https://site.example/",
        "https://a@site.example",
    ] {
        assert!(
            ServeOptions::new(8710, vec![origin.into()]).is_err(),
            "{origin}"
        );
    }
    assert!(ServeOptions::new(8710, vec!["https://yet-another-ai.github.io".into()]).is_ok());
}

#[tokio::test]
async fn rejects_malformed_coordinates_and_overlarge_sgf_before_dispatch() {
    LocalSet::new()
        .run_until(async {
            let (engine, mut starts, _) = pending();
            let app = router(
                engine,
                None,
                config(),
                ServeOptions::new(8710, vec![]).unwrap(),
            );
            for mv in ["11", "!1", "@1", "中1"] {
                let body = serde_json::json!({"sgf":"(;SZ[9])", "ply":0, "moves":[mv]});
                let result = app
                    .clone()
                    .oneshot(request(Method::POST, "/analyze-position", body.to_string()))
                    .await
                    .unwrap();
                assert_eq!(result.status(), StatusCode::BAD_REQUEST, "{mv}");
            }
            for sgf in [
                format!("{}{}", "(;".repeat(65), ")".repeat(65)),
                format!("({})", ";".repeat(513)),
            ] {
                for path in ["/analyze", "/analyze-position"] {
                    let body = if path == "/analyze" {
                        serde_json::json!({"sgf":sgf})
                    } else {
                        serde_json::json!({"sgf":sgf, "ply":0})
                    };
                    let result = app
                        .clone()
                        .oneshot(request(Method::POST, path, body.to_string()))
                        .await
                        .unwrap();
                    assert_eq!(result.status(), StatusCode::BAD_REQUEST);
                }
            }
            assert!(matches!(
                starts.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ));
        })
        .await;
}
