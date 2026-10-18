//! Contract tests use a deliberately biased deterministic evaluator. Browser
//! smoke separately validates the real exported neural model and multi-row ORT.
use futures::{executor::block_on, future::LocalBoxFuture};
use std::cell::RefCell;
use yagoo_core::nn_features::V7Features;
use yagoo_katago::{AnalysisQueryBuilder, AnalysisUpdate};
use yagoo_pipeline::AnalysisEngine;
use yagoo_search::{NnEvaluator, Postprocess, RawHeads, SearchEngine, SearchOptions};

#[derive(Default)]
struct Evaluator {
    batches: RefCell<Vec<Vec<V7Features>>>,
    fail_at: Option<usize>,
    prefer_pass: bool,
}
impl NnEvaluator for Evaluator {
    fn evaluate_batch<'a>(
        &'a self,
        inputs: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>> {
        Box::pin(async move {
            let mut batches = self.batches.borrow_mut();
            batches.push(inputs.to_vec());
            if self.fail_at == Some(batches.len()) {
                return Err("injected inference failure".into());
            }
            Ok(inputs
                .iter()
                .map(|_| {
                    let mut policy = vec![0.0; 6 * 362];
                    policy[0] = 4.0;
                    policy[361] = if self.prefer_pass { 10.0 } else { -30.0 };
                    RawHeads {
                        policy,
                        value: vec![0.0, 0.0, 0.0],
                        miscvalue: vec![0.0; 10],
                        ownership: vec![0.5; 361],
                        scorebelief_logprobs: vec![],
                        seki: vec![],
                        futurepos: vec![],
                    }
                })
                .collect())
        })
    }
}
fn engine(symmetries: usize, batch: usize) -> SearchEngine<Evaluator> {
    SearchEngine {
        evaluator: Evaluator::default(),
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

#[test]
fn root_averages_probabilities_after_inverse_transform_in_two_real_batches() {
    let engine = engine(8, 4);
    let query = AnalysisQueryBuilder::new("symmetry")
        .board_size(9)
        .max_visits(1)
        .build();
    let result = block_on(engine.analyze(&query)).unwrap();
    let policy = result.policy.unwrap();
    for corner in [8, 72, 80] {
        assert!((policy[corner] - policy[0]).abs() < 1e-12);
    }
    assert!(policy[0] > policy[40]);
    assert!((policy.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    assert_eq!(
        engine
            .evaluator
            .batches
            .borrow()
            .iter()
            .map(Vec::len)
            .collect::<Vec<_>>(),
        [4, 4]
    );
    assert_eq!(result.root_info.unwrap().visits, Some(1));
}

#[test]
fn leaf_batches_reserve_distinct_moves_and_obey_remaining_budget() {
    let engine = engine(1, 4);
    let query = AnalysisQueryBuilder::new("batch")
        .board_size(9)
        .max_visits(8)
        .build();
    let result = block_on(engine.analyze(&query)).unwrap();
    assert_eq!(result.root_info.unwrap().visits, Some(8));
    let batches = engine.evaluator.batches.borrow();
    assert_eq!(batches.iter().map(Vec::len).collect::<Vec<_>>(), [1, 4, 3]);
    for i in 0..4 {
        for j in i + 1..4 {
            assert_ne!(batches[1][i].spatial, batches[1][j].spatial);
        }
    }
    assert_eq!(
        result
            .move_infos
            .iter()
            .flatten()
            .map(|m| m.visits.unwrap_or(0))
            .sum::<u64>(),
        7
    );
}

#[test]
fn failed_batch_never_emits_final_or_leaks_reservations_to_next_query() {
    let mut engine = engine(1, 4);
    engine.evaluator.fail_at = Some(2);
    let query = AnalysisQueryBuilder::new("failure")
        .board_size(9)
        .max_visits(8)
        .build();
    let mut finals = 0;
    let result = block_on(engine.analyze_streaming(&query, &mut |update| {
        if matches!(update, AnalysisUpdate::Final(_)) {
            finals += 1;
        }
        Ok(())
    }));
    assert!(result.is_err());
    assert_eq!(finals, 0);
    engine.evaluator.fail_at = None;
    let result = block_on(engine.analyze(&query)).unwrap();
    assert_eq!(result.root_info.unwrap().visits, Some(8));
}

#[test]
fn mixed_batches_score_second_pass_without_inference_or_further_continuations() {
    let mut engine = engine(1, 4);
    engine.evaluator.prefer_pass = true;
    let query = AnalysisQueryBuilder::new("ending")
        .board_size(9)
        .rules("chinese")
        .push_move(yagoo_core::Color::Black, "pass")
        .max_visits(8)
        .build();
    let result = block_on(engine.analyze(&query)).unwrap();
    assert_eq!(result.root_info.unwrap().visits, Some(8));
    let candidates = result.move_infos.unwrap();
    let pass = candidates.iter().find(|m| m.move_ == "pass").unwrap();
    assert_eq!(pass.score_lead, Some(-7.5));
    assert_eq!(pass.winrate, Some(0.0));
    assert_eq!(pass.ownership.as_ref().unwrap(), &vec![0.0; 81]);
    assert_eq!(pass.pv.as_ref().unwrap(), &["pass"]);
    assert!(
        pass.visits.unwrap() > 1,
        "Already scored terminal nodes must be revisitable"
    );
    assert_eq!(candidates.iter().map(|m| m.visits.unwrap()).sum::<u64>(), 7);
    let batches = engine.evaluator.batches.borrow();
    assert_eq!(batches[0].len(), 1);
    assert_eq!(
        batches[1].len(),
        3,
        "First leaf batch contains one terminal and three neural leaves"
    );
    // Apart from the root, every actual NN row must contain a played stone.
    for input in batches.iter().skip(1).flatten() {
        assert!(input.spatial[361..3 * 361].iter().any(|v| *v != 0.0));
    }
}
