//! Synthetic neural outputs test search mechanics, never model calibration.
use futures::{executor::block_on, future::LocalBoxFuture};
use std::cell::RefCell;
use yagoo_core::{
    nn_features::{V7Features, NN_AREA},
    Color, GameState, Point, Ruleset,
};
use yagoo_katago::{AnalysisQuery, AnalysisQueryBuilder, AnalysisUpdate};
use yagoo_pipeline::AnalysisEngine;
use yagoo_search::{NnEvaluator, Postprocess, RawHeads, SearchEngine, SearchOptions};

#[derive(Default)]
struct Synthetic {
    inputs: RefCell<Vec<Vec<V7Features>>>,
}
impl NnEvaluator for Synthetic {
    fn evaluate_batch<'a>(
        &'a self,
        inputs: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>> {
        Box::pin(async move {
            self.inputs.borrow_mut().push(inputs.to_vec());
            Ok(inputs
                .iter()
                .map(|_| {
                    let mut policy = vec![-1.0e35; 6 * 362];
                    policy[0] = 1.0e35; // Excluded favorite; unrestricted alternatives underflow.
                    RawHeads {
                        policy,
                        value: vec![0.0; 3],
                        miscvalue: vec![0.0; 10],
                        ownership: vec![0.0; 361],
                        scorebelief_logprobs: vec![],
                        seki: vec![],
                        futurepos: vec![],
                    }
                })
                .collect())
        })
    }
}
fn engine(symmetries: usize, batch: usize) -> SearchEngine<Synthetic> {
    SearchEngine {
        evaluator: Synthetic::default(),
        postprocess: Postprocess {
            scoremean_multiplier: 20.0,
            scorestdev_multiplier: 20.0,
            lead_multiplier: 20.0,
        },
        options: SearchOptions {
            root_symmetries: symmetries,
            batch_size: batch,
        },
    }
}
fn allowed(query: &mut AnalysisQuery, player: &str, moves: &[&str]) {
    query.allow_moves = Some(serde_json::json!([{"player":player,"moves":moves,"untilDepth":1}]));
}
fn query() -> AnalysisQuery {
    AnalysisQueryBuilder::new("synthetic-root")
        .board_size(5)
        .max_visits(33)
        .include_moves_ownership(true)
        .build()
}

#[test]
fn forced_underflow_move_controls_expansion_with_symmetry_batching_and_unrestricted_descendants() {
    for (symmetries, batch, coordinate) in [(1, 1, "C3"), (8, 4, "C3"), (8, 4, "B4")] {
        let engine = engine(symmetries, batch);
        let mut query = query();
        allowed(&mut query, "B", &[coordinate]);
        let point = Point::parse_gtp(coordinate, 5).unwrap().unwrap();
        let response = block_on(engine.analyze(&query)).unwrap();
        let candidates = response.move_infos.unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].move_, coordinate);
        assert_eq!(candidates[0].visits, Some(32));
        assert_eq!(candidates[0].prior, Some(1.0));
        assert_eq!(candidates[0].ownership.as_ref().unwrap().len(), 25);
        let pv = candidates[0].pv.as_ref().unwrap();
        assert!(pv.len() > 1);
        assert_ne!(
            pv[1], coordinate,
            "descendants must not inherit the root restriction"
        );
        let policy = response.policy.unwrap();
        assert_eq!(policy[point.index(5)], 1.0);
        assert_eq!(policy.iter().filter(|p| **p != 0.0).count(), 1);
        // The first non-root NN batch really contains the forced played stone.
        let root_batches = symmetries.div_ceil(batch);
        let inputs = engine.evaluator.inputs.borrow();
        assert_eq!(
            inputs[root_batches].len(),
            1,
            "singleton root edge can fill only one reservation"
        );
        assert_eq!(
            inputs[root_batches][0].spatial[2 * NN_AREA + point.index(19)],
            1.0
        );
    }
}

#[test]
fn allowed_set_intersects_full_history_legality_and_normalizes_coordinates() {
    let engine = engine(8, 4);
    let mut query = query();
    query.initial_stones = vec![(yagoo_katago::PlayerToken::B, "C3".into())];
    allowed(&mut query, "B", &["C3", " b4 ", "B4"]);
    let response = block_on(engine.analyze(&query)).unwrap();
    let candidates = response.move_infos.unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].move_, "B4");
    assert_eq!(candidates[0].prior, Some(1.0));
}

#[test]
fn multiple_allowed_moves_normalize_without_forbidden_probability_or_visits() {
    let engine = engine(1, 4);
    let mut query = query();
    allowed(&mut query, "B", &["B3", "C3", "C3"]);
    let response = block_on(engine.analyze(&query)).unwrap();
    let policy = response.policy.unwrap();
    assert_eq!(policy[11], 0.5);
    assert_eq!(policy[12], 0.5);
    assert_eq!(policy.iter().sum::<f64>(), 1.0);
    let candidates = response.move_infos.unwrap();
    assert_eq!(candidates.len(), 2);
    assert!(candidates
        .iter()
        .all(|candidate| ["B3", "C3"].contains(&candidate.move_.as_str())));
    assert_eq!(
        candidates
            .iter()
            .map(|candidate| candidate.visits.unwrap())
            .sum::<u64>(),
        32
    );
}

#[test]
fn malformed_unsupported_and_illegal_only_restrictions_fail_before_inference() {
    let engine = engine(1, 4);
    for restriction in [
        serde_json::json!([]),
        serde_json::json!({}),
        serde_json::json!(null),
        serde_json::json!([{"player":"W","moves":["C3"],"untilDepth":1}]),
        serde_json::json!([{"player":"B","moves":["C3"],"untilDepth":2}]),
        serde_json::json!([{"player":"B","moves":[],"untilDepth":1}]),
        serde_json::json!([{"player":"B","moves":["!3"],"untilDepth":1}]),
        serde_json::json!([{"player":"B","moves":["Z9"],"untilDepth":1}]),
        serde_json::json!([{"player":"B","moves":["C3"],"untilDepth":"1"}]),
        serde_json::json!([{"player":"B","moves":["C3"],"untilDepth":1,"extra":true}]),
        serde_json::json!([{"player":"B","moves":["C3"],"untilDepth":1},{"player":"W","moves":["C3"],"untilDepth":1}]),
    ] {
        let mut query = query();
        query.allow_moves = Some(restriction);
        assert!(block_on(engine.analyze(&query)).is_err());
    }
    for use_focus in [false, true] {
        let mut query = query();
        if use_focus {
            query.focus_moves = Some(serde_json::json!(["C3"]));
        } else {
            query.avoid_moves = Some(serde_json::json!([]));
        }
        assert!(block_on(engine.analyze(&query)).is_err());
    }
    let mut occupied = query();
    occupied.initial_stones = vec![(yagoo_katago::PlayerToken::B, "C3".into())];
    allowed(&mut occupied, "B", &["C3"]);
    assert!(block_on(engine.analyze(&occupied)).is_err());
    let mut terminal = query();
    terminal.moves = vec![
        (yagoo_katago::PlayerToken::B, "pass".into()),
        (yagoo_katago::PlayerToken::W, "pass".into()),
    ];
    allowed(&mut terminal, "B", &["C3"]);
    assert!(block_on(engine.analyze(&terminal)).is_err());
    assert_eq!(engine.evaluator.inputs.borrow().len(), 0);
}

#[test]
fn active_ko_is_not_bypassed_and_a_forced_pass_can_finish_the_game() {
    let engine = engine(1, 4);
    let mut game = GameState::new(5, Ruleset::Chinese).unwrap();
    for (color, stones) in [
        (Color::Black, vec!["A2", "B1", "C2"]),
        (Color::White, vec!["B2", "A3", "C3", "B4"]),
    ] {
        for stone in stones {
            game.setup_stone(Point::parse_gtp(stone, 5).unwrap().unwrap(), color)
                .unwrap();
        }
    }
    game.play_gtp("B3").unwrap();
    let mut ko = AnalysisQueryBuilder::new("ko")
        .from_game_state(&game)
        .rules("chinese-ogs")
        .max_visits(8)
        .build();
    allowed(&mut ko, "W", &["B2"]);
    assert!(block_on(engine.analyze(&ko))
        .unwrap_err()
        .to_string()
        .contains("no legal moves"));
    assert_eq!(engine.evaluator.inputs.borrow().len(), 0);
    let mut pass = AnalysisQueryBuilder::new("pass")
        .board_size(5)
        .rules("chinese")
        .push_move(Color::Black, "pass")
        .max_visits(8)
        .build();
    allowed(&mut pass, "W", &["pass"]);
    let response = block_on(engine.analyze(&pass)).unwrap();
    let candidates = response.move_infos.unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].move_, "pass");
    assert_eq!(candidates[0].visits, Some(7));
}

#[test]
fn identity_matches_unrestricted_forced_partial_final_and_budget_variations() {
    let engine = engine(1, 4);
    let mut query = query();
    let original = block_on(engine.analyze(&query))
        .unwrap()
        .root_info
        .unwrap()
        .this_hash
        .unwrap();
    assert!(original.starts_with("yagoo-browser-root-v1:"));
    query.id = "different-id".into();
    query.max_visits = Some(20);
    query.report_during_search_every = Some(0.5);
    allowed(&mut query, "B", &["C3"]);
    let mut hashes = vec![];
    block_on(engine.analyze_streaming(&query, &mut |event| {
        let response = match event {
            AnalysisUpdate::Partial(value) | AnalysisUpdate::Final(value) => value,
        };
        hashes.push(response.root_info.unwrap().this_hash.unwrap());
        Ok(())
    }))
    .unwrap();
    assert!(hashes.len() > 1, "partial and final identities are covered");
    assert!(hashes.iter().all(|hash| *hash == original));
}
