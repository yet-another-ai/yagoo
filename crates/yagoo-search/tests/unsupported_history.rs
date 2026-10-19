//! Reject unsupported boundaries both at entry and after selecting a legal leaf.
use futures::{executor::block_on, future::LocalBoxFuture};
use std::cell::Cell;
use yagoo_core::{nn_features::V7Features, Point};
use yagoo_katago::{AnalysisQuery, AnalysisUpdate};
use yagoo_pipeline::AnalysisEngine;
use yagoo_search::{NnEvaluator, Postprocess, RawHeads, SearchEngine, SearchOptions};

struct Evaluator {
    calls: Cell<usize>,
    selected: usize,
}
impl NnEvaluator for Evaluator {
    fn evaluate_batch<'a>(
        &'a self,
        inputs: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>> {
        Box::pin(async move {
            self.calls.set(self.calls.get() + 1);
            Ok(inputs
                .iter()
                .map(|_| {
                    let mut policy = vec![-30.0; 6 * 362];
                    policy[self.selected] = 30.0;
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
fn engine(selected: usize) -> SearchEngine<Evaluator> {
    SearchEngine {
        evaluator: Evaluator {
            calls: Cell::new(0),
            selected,
        },
        postprocess: Postprocess {
            scoremean_multiplier: 20.0,
            scorestdev_multiplier: 20.0,
            lead_multiplier: 20.0,
        },
        options: SearchOptions::default(),
    }
}
fn query(f: &serde_json::Value) -> AnalysisQuery {
    serde_json::from_value(serde_json::json!({"id":f["name"],"rules":f["rules"],"komi":f["komi"],"initialStones":f["initial"],"initialPlayer":f["toPlay"],"moves":f["moves"],"boardXSize":f["size"],"boardYSize":f["size"],"maxVisits":2})).unwrap()
}

#[test]
fn no_result_repeated_pass_and_encore_never_receive_a_neural_terminal_estimate() {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../yagoo-core/tests/fixtures/v7-targeted.json"
    ))
    .unwrap();
    for f in cases {
        let rejected = f.get("expectedReject").is_some();
        let next = f.get("rejectedNext");
        if !rejected && next.is_none() {
            continue;
        }
        let selected = next.map_or(361, |m| {
            Point::parse_gtp(
                m[1].as_str().unwrap(),
                u8::try_from(f["size"].as_u64().unwrap()).unwrap(),
            )
            .unwrap()
            .map_or(361, |p| p.index(19))
        });
        let engine = engine(selected);
        let mut final_seen = false;
        let q = query(&f);
        let result = block_on(engine.analyze_streaming(&q, &mut |update| {
            final_seen |= matches!(update, AnalysisUpdate::Final(_));
            Ok(())
        }));
        assert!(result.is_err(), "{}", f["name"]);
        assert!(!final_seen, "{}", f["name"]);
        assert_eq!(
            engine.evaluator.calls.get(),
            usize::from(!rejected),
            "{}",
            f["name"]
        );
        if rejected {
            // A later pass must not hide an already crossed historical boundary.
            let mut resumed = q;
            let player = resumed.moves.last().unwrap().0;
            resumed.moves.push((
                if player == yagoo_katago::PlayerToken::B {
                    yagoo_katago::PlayerToken::W
                } else {
                    yagoo_katago::PlayerToken::B
                },
                "pass".into(),
            ));
            assert!(block_on(engine.analyze(&resumed)).is_err());
            assert_eq!(engine.evaluator.calls.get(), 0);
        }
    }
}
