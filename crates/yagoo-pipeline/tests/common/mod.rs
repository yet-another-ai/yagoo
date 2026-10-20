//! Offline replay of unchanged real KataGo responses. Never launches an engine.
use futures::future::LocalBoxFuture;
use std::{collections::BTreeMap, io::Read, path::PathBuf, sync::Mutex};
use yagoo_katago::{AnalysisQuery, AnalysisResponse, AnalysisUpdate, KatagoError, KatagoResult};
use yagoo_pipeline::{AnalysisEngine, PipelineConfig, UpdateCallback};

pub fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/comparison-19x19")
}

pub fn config() -> PipelineConfig {
    PipelineConfig {
        root_visits: 64,
        // Preserve p44's genuine two-visit actual candidate. Production defaults
        // to 16 and would force it; that additional response is not in this corpus.
        comparison_min_visits: 1,
        ..PipelineConfig::default()
    }
}

pub struct RecordedEngine {
    pub responses: BTreeMap<String, AnalysisResponse>,
    pub queries: BTreeMap<String, AnalysisQuery>,
    pub seen: Mutex<Vec<AnalysisQuery>>,
}

impl RecordedEngine {
    pub fn load() -> Self {
        let bytes = std::fs::read(fixture_dir().join("responses.json.gz")).unwrap();
        let mut raw = String::new();
        flate2::read::GzDecoder::new(bytes.as_slice())
            .read_to_string(&mut raw)
            .unwrap();
        let lines: Vec<String> = serde_json::from_str(&raw).unwrap();
        let responses = lines
            .iter()
            .map(|line| {
                let response: AnalysisResponse = serde_json::from_str(line).unwrap();
                (response.id.clone(), response)
            })
            .collect();
        let queries = std::fs::read_to_string(fixture_dir().join("queries.ndjson"))
            .unwrap()
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let query: AnalysisQuery = serde_json::from_str(line).unwrap();
                (query.id.clone(), query)
            })
            .collect();
        Self {
            responses,
            queries,
            seen: Mutex::new(vec![]),
        }
    }
}

impl AnalysisEngine for RecordedEngine {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        callback: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            self.seen.lock().unwrap().push(query.clone());
            let Some(expected) = self.queries.get(&query.id) else {
                return Err(KatagoError::Engine {
                    id: query.id.clone(),
                    error: "query was not recorded".into(),
                });
            };
            // Replay is valid only for the same complete game state and budget.
            assert_eq!(query.moves, expected.moves, "full history: {}", query.id);
            assert_eq!(query.initial_stones, expected.initial_stones);
            assert_eq!(query.board_x_size, expected.board_x_size);
            assert_eq!(query.board_y_size, expected.board_y_size);
            assert_eq!(query.komi, expected.komi);
            assert_eq!(
                query.rules.as_deref().map(str::to_ascii_lowercase),
                expected.rules.as_deref().map(str::to_ascii_lowercase)
            );
            assert_eq!(query.max_visits, expected.max_visits);
            assert_eq!(query.allow_moves, expected.allow_moves);
            assert_eq!(
                query.include_moves_ownership,
                expected.include_moves_ownership
            );
            assert_eq!(query.analysis_pv_len, expected.analysis_pv_len);
            let response = self
                .responses
                .get(&query.id)
                .ok_or_else(|| KatagoError::Engine {
                    id: query.id.clone(),
                    error: "response intentionally unavailable in test".into(),
                })?
                .clone();
            callback(AnalysisUpdate::Final(response))
        })
    }
}
