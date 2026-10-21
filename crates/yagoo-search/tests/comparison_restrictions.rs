//! Constructed neural outputs exercise real search and pipeline query execution.
//! They are not model recordings, strength measurements, or sacrifice calibration.
use futures::{executor::block_on, future::LocalBoxFuture};
use std::cell::{Cell, RefCell};
use yagoo_core::{
    nn_features::{V7Features, NN_AREA, NN_LEN},
    Point,
};
use yagoo_katago::{AnalysisQuery, AnalysisResponse, AnalysisUpdate, KatagoResult, PlayerToken};
use yagoo_pipeline::{analyze_move_comparison, AnalysisEngine, PipelineConfig, UpdateCallback};
use yagoo_search::{NnEvaluator, Postprocess, RawHeads, RootContext, SearchEngine, SearchOptions};
use yagoo_snapshot::{trace_candidate_pv, ColorToken, ComparisonCandidateSource};

fn index(coordinate: &str) -> usize {
    Point::parse_gtp(coordinate, 5)
        .unwrap()
        .unwrap()
        .index(NN_LEN)
}

#[derive(Default)]
struct ConstructedEvaluator {
    root_is_black: Cell<bool>,
}

impl NnEvaluator for ConstructedEvaluator {
    fn begin_root(&self, context: &RootContext) -> Result<(), String> {
        self.root_is_black.set(context.to_play == PlayerToken::B);
        Ok(())
    }

    fn evaluate_batch<'a>(
        &'a self,
        inputs: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>> {
        Box::pin(async move {
            Ok(inputs
                .iter()
                .map(|input| {
                    let mut policy = vec![0.0; 6 * (NN_AREA + 1)];
                    // With occupied points masked, the preferred line legally
                    // captures the original B2/C2 stones: E5 B3 E4 C3.
                    for (coordinate, logit) in
                        [("E5", 80.0), ("B3", 60.0), ("E4", 40.0), ("C3", 20.0)]
                    {
                        policy[index(coordinate)] = logit;
                    }
                    policy[NN_AREA] = -30.0;

                    // Deliberate root/pass variation creates a teaching group
                    // through compute_groups. Three correlated points satisfy
                    // its minimum size; only B2/C2 are original black stones.
                    // Chinese komi 7.5 makes global[5] positive for White.
                    let desired_black = if self.root_is_black.get() { -2.0 } else { 2.0 };
                    let current_sign = if input.global[5] > 0.0 { -1.0 } else { 1.0 };
                    let mut ownership = vec![0.0; NN_AREA];
                    for coordinate in ["B2", "C2", "B3"] {
                        ownership[index(coordinate)] = desired_black * current_sign;
                    }
                    RawHeads {
                        policy,
                        value: vec![0.0; 3],
                        miscvalue: vec![0.0; 10],
                        ownership,
                        scorebelief_logprobs: vec![],
                        seki: vec![],
                        futurepos: vec![],
                    }
                })
                .collect())
        })
    }
}

struct RecordingSearch {
    search: SearchEngine<ConstructedEvaluator>,
    completed: RefCell<Vec<(AnalysisQuery, AnalysisResponse)>>,
}

impl RecordingSearch {
    fn new() -> Self {
        Self {
            search: SearchEngine {
                evaluator: ConstructedEvaluator::default(),
                postprocess: Postprocess {
                    scoremean_multiplier: 20.0,
                    scorestdev_multiplier: 20.0,
                    lead_multiplier: 20.0,
                },
                options: SearchOptions {
                    root_symmetries: 1,
                    batch_size: 1,
                },
            },
            completed: RefCell::new(vec![]),
        }
    }
}

impl AnalysisEngine for RecordingSearch {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            self.search
                .analyze_streaming(query, &mut |update| {
                    if let AnalysisUpdate::Final(response) = &update {
                        self.completed
                            .borrow_mut()
                            .push((query.clone(), response.clone()));
                    }
                    on_update(update)
                })
                .await
        })
    }
}

#[test]
fn pipeline_executes_forced_actual_and_saving_queries_through_search() {
    let record =
        yagoo_sgf::parse_sgf("(;SZ[5]KM[7.5]RU[chinese]AB[bd][cd]AW[ad][be][ce][dd];B[ee])")
            .unwrap();
    let positions = yagoo_sgf::replay_main_line(&record).unwrap();
    let config = PipelineConfig {
        root_visits: 64,
        comparison_min_visits: 16,
        comparison_saving_probes: 2,
        comparison_branch_probes: false,
        ..PipelineConfig::default()
    };
    let engine = RecordingSearch::new();
    let comparison = block_on(analyze_move_comparison(
        &record,
        &positions[1],
        &engine,
        &config,
    ))
    .unwrap()
    .unwrap();
    assert_eq!(comparison.actual_move, "E1");
    assert_eq!(comparison.ai_move, "E5");
    assert_eq!(
        comparison.evidence.actual_source,
        ComparisonCandidateSource::Forced
    );
    assert_eq!(
        comparison.evidence.root_hash,
        comparison.evidence.actual_root_hash
    );
    let root_hash = comparison.evidence.root_hash.as_ref().unwrap();
    assert!(root_hash.starts_with("yagoo-browser-root-v1:"));
    assert!(comparison.context.groups.iter().any(|group| {
        group.members.black_stones == ["B2", "C2"] && group.members.white_stones.is_empty()
    }));
    let preferred_line =
        trace_candidate_pv(0, &positions[0].state, &comparison.context.preferred).unwrap();
    for stone in ["B2", "C2"] {
        assert!(preferred_line
            .captures
            .iter()
            .any(|capture| capture.color == ColorToken::B && capture.stone == stone));
    }

    let probes = &comparison.context.saving_probes;
    assert_eq!(
        probes
            .iter()
            .map(|probe| probe.candidate.move_.as_str())
            .collect::<Vec<_>>(),
        ["B3", "C3"]
    );
    for probe in probes {
        assert_eq!(probe.root_hash.as_ref(), Some(root_hash));
        assert_eq!(
            probe.query_id,
            format!("p1-saving-{}", probe.candidate.move_)
        );
        assert!(probe.candidate.visits.unwrap() >= config.comparison_min_visits);
        assert!(trace_candidate_pv(0, &positions[0].state, &probe.candidate).is_some());
        assert!(comparison
            .context
            .pv_lineages
            .iter()
            .any(|line| line.move_ == probe.candidate.move_));
    }

    let completed = engine.completed.borrow();
    let (root_query, _) = completed
        .iter()
        .find(|(query, _)| query.id == "p1-root")
        .unwrap();
    assert!(root_query.allow_moves.is_none());
    for (id, forced_move) in [
        ("p1-actual-forced", "E1"),
        ("p1-saving-B3", "B3"),
        ("p1-saving-C3", "C3"),
    ] {
        let (query, response) = completed.iter().find(|(query, _)| query.id == id).unwrap();
        assert_eq!(query.initial_stones, root_query.initial_stones);
        assert_eq!(query.initial_player, root_query.initial_player);
        assert_eq!(query.moves, root_query.moves);
        assert_eq!(query.rules, root_query.rules);
        assert_eq!(query.komi, root_query.komi);
        assert_eq!(
            query.allow_moves,
            Some(serde_json::json!([{
                "player":"B", "moves":[forced_move], "untilDepth":1,
            }]))
        );
        assert_eq!(
            response.root_info.as_ref().unwrap().this_hash.as_ref(),
            Some(root_hash)
        );
        let candidates = response.move_infos.as_ref().unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].move_, forced_move);
        assert_eq!(candidates[0].visits, Some(63));
    }
}
