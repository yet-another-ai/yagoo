//! Replay historical candidate screens through the production comparison/detector.
//! Never starts an engine and never fills missing responses with invented values.
//! Usage: cargo run -p yagoo-pipeline --example sacrifice_screen -- RECORDING OUTPUT [SUPPLEMENT ...]
use futures::future::LocalBoxFuture;
use serde::Deserialize;
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use yagoo_katago::{AnalysisQuery, AnalysisResponse, AnalysisUpdate, KatagoError, KatagoResult};
use yagoo_pipeline::{analyze_move_comparison, AnalysisEngine, PipelineConfig, UpdateCallback};
use yagoo_sgf::{parse_sgf, replay_main_line};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    state: String,
    visits: u32,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    id: String,
    sgf: String,
    actual_ply: usize,
}

struct Recording {
    queries: BTreeMap<String, AnalysisQuery>,
    responses: BTreeMap<String, AnalysisResponse>,
}

impl Recording {
    fn load(folders: &[&Path]) -> Result<Self, Box<dyn std::error::Error>> {
        let mut result = Self {
            queries: BTreeMap::new(),
            responses: BTreeMap::new(),
        };
        for folder in folders {
            let config = std::fs::read_to_string(folder.join("analysis.cfg"))?;
            if !config.lines().any(|line| {
                line.split_once('=').is_some_and(|(key, value)| {
                    key.trim() == "reportAnalysisWinratesAs" && value.trim() == "BLACK"
                })
            }) {
                return Err(
                    "recording configuration must explicitly report BLACK perspective".into(),
                );
            }
            for line in std::fs::read_to_string(folder.join("queries.ndjson"))?.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                let query: AnalysisQuery = serde_json::from_str(line)?;
                if result.queries.insert(query.id.clone(), query).is_some() {
                    return Err("duplicate query ID in recordings".into());
                }
            }
            for line in std::fs::read_to_string(folder.join("responses.ndjson"))?.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                let response: AnalysisResponse = serde_json::from_str(line)?;
                if response.is_during_search == Some(true)
                    || (response.warning.is_some() && response.root_info.is_none())
                {
                    continue;
                }
                if result
                    .responses
                    .insert(response.id.clone(), response)
                    .is_some()
                {
                    return Err("duplicate final response ID in recordings".into());
                }
            }
        }
        Ok(result)
    }
}

struct Replay<'a> {
    recording: &'a Recording,
    case: &'a Case,
    used: Mutex<BTreeMap<String, String>>,
    attempted: Mutex<Vec<AnalysisQuery>>,
}

impl AnalysisEngine for Replay<'_> {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        callback: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            let error = |message: &str| KatagoError::Engine {
                id: query.id.clone(),
                error: message.into(),
            };
            let prefix = format!("p{}-", self.case.actual_ply);
            let suffix = query
                .id
                .strip_prefix(&prefix)
                .ok_or_else(|| error("wrong played ply"))?;
            let suffix = match suffix {
                "root-pass" => "pass",
                "ai-pv-end" => "pv-end",
                other => other,
            };
            let recorded_id = format!("{}-{suffix}", self.case.id);
            let mut recorded_query = query.clone();
            recorded_query.id.clone_from(&recorded_id);
            self.attempted.lock().unwrap().push(recorded_query);
            let expected = self
                .recording
                .queries
                .get(&recorded_id)
                .ok_or_else(|| error(&format!("missing recorded query {recorded_id}")))?;
            // Optional extra diagnostic outputs do not alter the requested position.
            // The effective perspective is established by the checked recording config.
            if query.moves != expected.moves
                || query.initial_stones != expected.initial_stones
                || query.initial_player.or(Some(yagoo_katago::PlayerToken::B))
                    != expected
                        .initial_player
                        .or(Some(yagoo_katago::PlayerToken::B))
                || query.board_x_size != expected.board_x_size
                || query.board_y_size != expected.board_y_size
                || query.komi != expected.komi
                || query.rules.as_deref().map(str::to_ascii_lowercase)
                    != expected.rules.as_deref().map(str::to_ascii_lowercase)
                || query.max_visits != expected.max_visits
                || query.allow_moves != expected.allow_moves
                || query.avoid_moves != expected.avoid_moves
                || query.focus_moves != expected.focus_moves
                || query.include_ownership != expected.include_ownership
                || query.include_moves_ownership != expected.include_moves_ownership
                || query.analysis_pv_len != expected.analysis_pv_len
                || expected.override_settings.as_ref().is_some_and(|settings| {
                    settings
                        .iter()
                        .any(|(key, value)| key != "reportAnalysisWinratesAs" || value != "BLACK")
                })
            {
                return Err(error(&format!(
                    "recorded query differs from production request: {recorded_id}"
                )));
            }
            let mut response = self
                .recording
                .responses
                .get(&recorded_id)
                .ok_or_else(|| error(&format!("missing recorded response {recorded_id}")))?
                .clone();
            self.used
                .lock()
                .unwrap()
                .insert(query.id.clone(), recorded_id);
            // Keep logical pipeline IDs distinct from raw provenance in the report map.
            response.id.clone_from(&query.id);
            callback(AnalysisUpdate::Final(response))
        })
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        return Err("expected RECORDING OUTPUT [SUPPLEMENT ...]".into());
    }
    let folder = Path::new(&args[0]);
    let manifest: Manifest = serde_json::from_slice(&std::fs::read(folder.join("manifest.json"))?)?;
    if manifest.state != "complete" {
        return Err("refusing incomplete recording".into());
    }
    let mut folders = vec![folder];
    folders.extend(args[2..].iter().map(Path::new));
    let recording = Recording::load(&folders)?;
    let config = PipelineConfig {
        root_visits: manifest.visits,
        comparison_branch_probes: false,
        ..PipelineConfig::default()
    };
    let mut cases = vec![];
    for case in &manifest.cases {
        let source = folder.join("sources").join(&case.sgf);
        let source = if source.is_file() {
            source
        } else {
            folder
                .parent()
                .ok_or("recording has no source parent")?
                .join(&case.sgf)
        };
        let record = parse_sgf(&std::fs::read_to_string(source)?)?;
        let positions = replay_main_line(&record)?;
        let replay = Replay {
            recording: &recording,
            case,
            used: Mutex::new(BTreeMap::new()),
            attempted: Mutex::new(vec![]),
        };
        let result = analyze_move_comparison(
            &record,
            positions
                .get(case.actual_ply)
                .ok_or("played ply outside source game")?,
            &replay,
            &config,
        )
        .await;
        let (comparison, error) = match result {
            Ok(value) => (value, None),
            Err(error) => (None, Some(error.to_string())),
        };
        let missing_queries: Vec<_> = replay
            .attempted
            .into_inner()
            .unwrap()
            .into_iter()
            .filter(|query| !recording.responses.contains_key(&query.id))
            .collect();
        cases.push(serde_json::json!({
            "id": case.id, "actualPly": case.actual_ply,
            "queryIdMap": replay.used.into_inner().unwrap(), "comparison": comparison,
            "unavailableReason": error,
            "missingQueries": missing_queries,
        }));
    }
    std::fs::write(
        &args[1],
        serde_json::to_vec_pretty(&serde_json::json!({
            "purpose": "Offline replay through production defaults; no expert positive labels inferred.",
            "comparisonMinimumVisits": config.comparison_min_visits,
            "branchProbes": false, "cases": cases,
        }))?,
    )?;
    Ok(())
}
