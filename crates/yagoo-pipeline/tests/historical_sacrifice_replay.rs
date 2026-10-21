//! Genuine historical-game negative/boundary screens; no models or timing gates.
#[allow(dead_code)]
mod common;

use common::RecordedEngine;
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};
use yagoo_katago::{AnalysisQuery, AnalysisResponse};
use yagoo_pipeline::{analyze_move_comparison, PipelineConfig};
use yagoo_sgf::{parse_sgf, replay_main_line};
use yagoo_snapshot::{MoveComparison, SacrificeAssessmentStatus, SacrificeReason};

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sacrifice-historical")
}

fn pipeline_id(id: &str, prefix: &str, ply: usize) -> Option<String> {
    let suffix = id.strip_prefix(prefix)?;
    Some(format!(
        "p{ply}-{}",
        match suffix {
            "pass" => "root-pass",
            "pv-end" => "ai-pv-end",
            other => other,
        }
    ))
}

fn engine(case: &str, ply: usize, folders: &[&str]) -> RecordedEngine {
    let prefix = format!("{case}-");
    let mut queries = BTreeMap::new();
    let mut responses = BTreeMap::new();
    for folder in folders {
        let dir = fixture_dir().join(folder);
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["state"], "complete");
        for line in std::fs::read_to_string(dir.join("queries.ndjson"))
            .unwrap()
            .lines()
        {
            let mut query: AnalysisQuery = serde_json::from_str(line).unwrap();
            if let Some(id) = pipeline_id(&query.id, &prefix, ply) {
                query.id.clone_from(&id);
                assert_eq!(queries.insert(id, query), None);
            }
        }
        for line in std::fs::read_to_string(dir.join("responses.ndjson"))
            .unwrap()
            .lines()
        {
            let mut response: AnalysisResponse = serde_json::from_str(line).unwrap();
            if response.root_info.is_none() || response.is_during_search == Some(true) {
                continue;
            }
            if let Some(id) = pipeline_id(&response.id, &prefix, ply) {
                response.id.clone_from(&id);
                assert_eq!(responses.insert(id, response), None);
            }
        }
    }
    RecordedEngine {
        queries,
        responses,
        seen: Mutex::new(vec![]),
    }
}

async fn replay(case: &str, source: &str, ply: usize, visits: u32) -> MoveComparison {
    let folders: &[&str] = if visits == 64 {
        &["screen-64-20261020", "supplement-64-20261020"]
    } else {
        &["screen-256-20261020"]
    };
    let record = parse_sgf(&std::fs::read_to_string(fixture_dir().join(source)).unwrap()).unwrap();
    let positions = replay_main_line(&record).unwrap();
    let config = PipelineConfig {
        root_visits: visits,
        comparison_branch_probes: false,
        ..PipelineConfig::default()
    };
    let engine = engine(case, ply, folders);
    let comparison = analyze_move_comparison(&record, &positions[ply], &engine, &config)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(comparison.evidence.minimum_candidate_visits, 16);
    assert_eq!(comparison.root_ply + 1, u32::try_from(ply).unwrap());
    assert_eq!(
        comparison.evidence.root_hash,
        comparison.evidence.actual_root_hash
    );
    assert_eq!(
        comparison
            .sacrifice_assessment
            .as_ref()
            .unwrap()
            .annotations,
        []
    );
    comparison
}

#[tokio::test]
async fn historical_screens_keep_mixed_groups_and_undersampling_explicit() {
    for (id, source, ply) in [
        ("jowa1835-p59", "akaboshi-jowa-1835.chinese.sgf", 59),
        ("chitetsu1668-p131", "chitetsu-dosaku-1668.chinese.sgf", 131),
        ("dosaku1669-p113", "dosaku-santetsu-1669.chinese.sgf", 113),
        ("dosaku1669-p35", "dosaku-santetsu-1669.chinese.sgf", 35),
        ("dosaku1669-p71", "dosaku-santetsu-1669.chinese.sgf", 71),
        ("dosaku1669-p137", "dosaku-santetsu-1669.chinese.sgf", 137),
    ] {
        let comparison = replay(id, source, ply, 64).await;
        let assessment = comparison.sacrifice_assessment.as_ref().unwrap();
        assert_eq!(
            assessment.status,
            if matches!(ply, 59 | 71) {
                SacrificeAssessmentStatus::Unassessed
            } else {
                SacrificeAssessmentStatus::Assessed
            }
        );
        // Mixed teaching groups cannot be silently narrowed to a captured chain.
        if ply == 131 {
            assert!(assessment
                .checks
                .iter()
                .all(|check| check.reason == SacrificeReason::MixedOrOpponentGroup));
            assert_eq!(comparison.context.saving_probes, []);
        }
        if ply == 35 {
            let line = comparison
                .context
                .pv_lineages
                .iter()
                .find(|line| line.move_ == comparison.ai_move)
                .unwrap();
            // Genuine original C17 is captured at2, then Black replaces it at5.
            assert!(line.board.black.iter().any(|point| point == "C17"));
            assert!(line
                .captures
                .iter()
                .any(|capture| capture.stone == "C17" && capture.ply_offset == 2));
        }
    }
}

#[tokio::test]
async fn independent_deeper_screen_does_not_hide_global_value_instability() {
    let comparison = replay(
        "chitetsu1668-p131",
        "chitetsu-dosaku-1668.chinese.sgf",
        131,
        256,
    )
    .await;
    let context = &comparison.context;
    let endpoint = &context.preferred_pv_end.as_ref().unwrap().analysis;
    let parameters = &comparison.sacrifice_assessment.as_ref().unwrap().parameters;
    assert!(
        context.preferred.winrate.unwrap() - endpoint.winrate.unwrap()
            > parameters.maximum_endpoint_winrate_decline
    );
    assert!(
        context.preferred.score_lead.unwrap() - endpoint.score_lead.unwrap()
            > parameters.maximum_endpoint_score_decline
    );
    let line = context
        .pv_lineages
        .iter()
        .find(|line| line.move_ == comparison.ai_move)
        .unwrap();
    for stone in ["F8", "G8", "G7"] {
        let captures: Vec<_> = line
            .captures
            .iter()
            .filter(|capture| capture.stone == stone)
            .collect();
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].ply_offset, 2);
    }
}
