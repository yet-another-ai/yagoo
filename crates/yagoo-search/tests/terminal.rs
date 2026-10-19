//! Expected results come from upstream C++ BoardHistory, not the Rust scorer.
use futures::{executor::block_on, future::LocalBoxFuture};
use serde::Deserialize;
use yagoo_core::nn_features::V7Features;
use yagoo_katago::{AnalysisQuery, AnalysisQueryBuilder, MoveListEntry, PlayerToken};
use yagoo_pipeline::AnalysisEngine;
use yagoo_search::{NnEvaluator, Postprocess, RawHeads, SearchEngine, SearchOptions};

struct NoNetwork;
impl NnEvaluator for NoNetwork {
    fn evaluate_batch<'a>(
        &'a self,
        _: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>> {
        panic!("Terminal/rejected queries must not call a neural network");
    }
}
#[derive(Deserialize)]
struct Fixture {
    name: String,
    size: u8,
    rules: String,
    komi: f64,
    #[serde(default)]
    initial: Vec<MoveListEntry>,
    #[serde(rename = "toPlay")]
    to_play: Option<PlayerToken>,
    moves: Vec<MoveListEntry>,
    expected: serde_json::Value,
}
fn query(f: &Fixture) -> AnalysisQuery {
    let mut q = AnalysisQueryBuilder::new(&f.name)
        .board_size(f.size)
        .rules(&f.rules)
        .komi(f.komi)
        .moves_gtp(f.moves.clone())
        .max_visits(20)
        .build();
    q.initial_stones.clone_from(&f.initial);
    q.initial_player = f.to_play;
    q
}
fn engine() -> SearchEngine<NoNetwork> {
    SearchEngine {
        evaluator: NoNetwork,
        postprocess: Postprocess {
            scoremean_multiplier: 20.0,
            scorestdev_multiplier: 20.0,
            lead_multiplier: 20.0,
        },
        options: SearchOptions {
            root_symmetries: 8,
            batch_size: 4,
        },
    }
}

#[test]
fn area_endings_match_upstream_including_handicap_draw_and_dead_stones() {
    let cases: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/area.json")).unwrap();
    let engine = engine();
    let mut tested = 0;
    for f in cases.iter().filter(|f| f.rules != "japanese") {
        assert_eq!(f.expected["finished"], true, "{}", f.name);
        let result = block_on(engine.analyze(&query(f))).unwrap();
        let root = result.root_info.unwrap();
        let score = f.expected["scoreLead"].as_f64().unwrap();
        assert_eq!(root.score_lead, Some(score), "{}", f.name);
        assert_eq!(
            root.winrate,
            Some(if score > 0.0 {
                1.0
            } else if score < 0.0 {
                0.0
            } else {
                0.5
            }),
            "{}",
            f.name
        );
        let ownership: Vec<f64> = serde_json::from_value(f.expected["ownership"].clone()).unwrap();
        assert_eq!(result.ownership.unwrap(), ownership, "{}", f.name);
        assert_eq!(root.visits, Some(1));
        assert_eq!(result.extra["isTerminal"], true);
        assert!(!result.extra.contains_key("raw"));
        assert_eq!(result.move_infos.unwrap(), []);
        assert!(result.policy.unwrap().iter().all(|v| *v == 0.0));
        tested += 1;
    }
    assert_eq!(tested, 30);
}

#[test]
fn japanese_encore_is_rejected_instead_of_returning_area_scores() {
    let cases: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/area.json")).unwrap();
    let engine = engine();
    for f in cases.iter().filter(|f| f.rules == "japanese") {
        let passes = f.moves.len();
        assert_eq!(f.expected["encorePhase"], (passes / 2).min(2));
        assert_eq!(f.expected["finished"], passes == 6);
        assert!(block_on(engine.analyze(&query(f))).is_err());
    }
}
