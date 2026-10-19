//! Small semantic checks with known values, independent of search move ordering.
use super::*;
use yagoo_katago::AnalysisQueryBuilder;

fn raw() -> RawHeads {
    RawHeads {
        policy: vec![0.0; 6 * 362],
        value: vec![2.0, -1.0, 0.0],
        miscvalue: vec![0.5; 10],
        ownership: vec![0.5; 361],
        scorebelief_logprobs: vec![],
        seki: vec![],
        futurepos: vec![],
    }
}

fn complete_raw() -> RawHeads {
    let mut value = raw();
    value.scorebelief_logprobs = vec![-(842.0_f32).ln(); 842];
    value.seki = (0..4 * 361).map(|i| i as f32 / 1000.0).collect();
    value.futurepos = (0..2 * 361).map(|i| i as f32 / 1000.0).collect();
    value
}

#[test]
fn extra_heads_remain_an_identity_sample_with_the_querys_own_perspective() {
    let mut root = node(1, 0.0);
    root.game = GameState::new(9, Ruleset::Japanese).unwrap();
    root.game.play_pass().unwrap(); // pass probe: White, although parent was Black
    root.eval.raw = Some(complete_raw());
    let query = AnalysisQueryBuilder::new("pass-probe")
        .board_size(9)
        .build();
    let nodes = vec![root];
    let response = response(&nodes, &query, false).unwrap();
    let sample = response.neural.unwrap();
    assert_eq!(sample.to_play, PlayerToken::W);
    assert_eq!(sample.sample_symmetry, "identity");
    assert_eq!(sample.aggregation, "none");
    assert_eq!((sample.board_size, sample.model_board_size), (9, 19));
    assert_eq!(sample.score_belief_log_probs.len(), 842);
    assert!((sample.score_bin_first_center + 420.5).abs() < f64::EPSILON);
    assert_eq!(sample.seki_logits.len(), 1444);
    assert_eq!(sample.futurepos_pretanh.len(), 722);
    // A padded 9x9 board keeps stride 19, not 9, and channels stay independent.
    assert!((sample.futurepos_pretanh[19 + 8] - 0.027).abs() < 1e-6);
    assert!((sample.seki_logits[3 * 361] - 1.083).abs() < 1e-6);
    assert!(super::response(&nodes, &query, true)
        .unwrap()
        .neural
        .is_none());
    let mut terminal = nodes;
    terminal[0].eval.raw = None;
    assert!(super::response(&terminal, &query, false)
        .unwrap()
        .neural
        .is_none());
}

#[test]
fn malformed_or_unnormalized_extra_heads_are_rejected() {
    let game = GameState::new(9, Ruleset::Japanese).unwrap();
    let post = Postprocess {
        scoremean_multiplier: 20.0,
        scorestdev_multiplier: 20.0,
        lead_multiplier: 20.0,
    };
    for field in 0..4 {
        let mut raw = complete_raw();
        match field {
            0 => {
                raw.scorebelief_logprobs.pop();
            }
            1 => {
                raw.seki.pop();
            }
            2 => {
                raw.futurepos.pop();
            }
            _ => raw.scorebelief_logprobs.fill(0.0),
        }
        assert!(process(raw, &game, FeatureRules::Chinese, &[true; 82], &post).is_err());
    }
    assert!(process(
        complete_raw(),
        &game,
        FeatureRules::Chinese,
        &[true; 82],
        &post
    )
    .is_ok());
}

#[test]
fn value_and_lead_follow_rule_dependent_no_result_postprocessing() {
    // Expected from upstream nneval.cpp: win/loss/no-result softmax, no-result
    // excluded under positional area rules, and conditional lead made absolute.
    for (rules, expected_win, expected_lead) in [
        (
            FeatureRules::Chinese,
            0.900_892_334_173_636_8,
            8.858_048_006_154_055,
        ),
        (
            FeatureRules::Japanese,
            0.900_892_334_173_636_8,
            8.858_048_006_154_055,
        ),
        (FeatureRules::ChineseOgs, 0.952_574_126_822_433_4, 10.0),
    ] {
        for player in [Color::Black, Color::White] {
            let mut game = GameState::new(9, Ruleset::Japanese).unwrap();
            game.set_to_play(player);
            let post = Postprocess {
                scoremean_multiplier: 20.0,
                scorestdev_multiplier: 20.0,
                lead_multiplier: 20.0,
            };
            let result = process(raw(), &game, rules, &[true; 82], &post).unwrap();
            let (win, lead) = if player == Color::Black {
                (expected_win, expected_lead)
            } else {
                (1.0 - expected_win, -expected_lead)
            };
            assert!((result.winrate - win).abs() < 1e-12);
            assert!((result.lead - lead).abs() < 1e-12);
        }
    }
}

fn node(visits: u32, own: f64) -> Node {
    let game = GameState::new(2, Ruleset::Japanese).unwrap();
    let mut node = Node::new(
        game,
        Evaluation {
            policy: vec![0.2; 5],
            winrate: 0.6,
            lead: 2.0,
            ownership: vec![own; 4],
            raw: Some(raw()),
        },
    );
    node.visits = visits;
    node.win_sum = 0.6 * f64::from(visits);
    node.lead_sum = 2.0 * f64::from(visits);
    node.utility_sum = utility(0.6, 2.0) * f64::from(visits);
    node
}

#[test]
fn tree_ownership_uses_squared_child_weights_and_normalized_variance() {
    let mut nodes = vec![node(4, 0.0), node(2, 1.0), node(1, -1.0)];
    nodes[0].children = vec![(0, 1), (1, 2)];
    let (mean, stdev) = ownership(&nodes, 0);
    // Unit parent NN weight: parent 1/4, children 3/4 split 4:1.
    for (mean, stdev) in mean.iter().zip(&stdev) {
        assert!((mean - 0.45).abs() < 1e-12);
        assert!((stdev * stdev - 0.5475).abs() < 1e-12);
    }

    // A tiny branch's mass returns to its parent rather than disappearing.
    nodes[0].visits = 12;
    nodes[0].eval.ownership.fill(0.25);
    nodes[1].visits = 10;
    nodes[1].eval.ownership.fill(0.5);
    let mut mean = vec![0.0; 4];
    let mut square = vec![0.0; 4];
    tree_ownership(&nodes, 0, 1.0, 0.95, &mut mean, &mut square);
    for value in mean {
        assert!((value - 0.476_897_689_768_976_9).abs() < 1e-12);
    }
}

#[test]
fn candidate_stdev_is_independent_and_unsupported_lcb_is_absent() {
    let mut nodes = vec![node(3, 0.0), node(2, 1.0), node(1, -1.0)];
    nodes[0].children = vec![(0, 1)];
    nodes[1].children = vec![(1, 2)];
    let query = AnalysisQueryBuilder::new("stdev")
        .board_size(2)
        .include_moves_ownership(false)
        .include_moves_ownership_stdev(true)
        .build();
    let result = response(&nodes, &query, false).unwrap();
    let candidate = &result.move_infos.unwrap()[0];
    assert!(candidate.ownership.is_none());
    assert_eq!(candidate.ownership_stdev.as_ref().unwrap(), &[1.0; 4]);
    assert!(candidate.lcb.is_none());
    assert_eq!(candidate.winrate, Some(0.6));
}

#[test]
fn pv_length_and_visit_arrays_refer_to_the_same_nodes() {
    let mut nodes = vec![node(4, 0.0), node(3, 0.0), node(2, 0.0), node(1, 0.0)];
    nodes[0].children = vec![(0, 1)];
    nodes[1].children = vec![(1, 2)];
    nodes[2].children = vec![(2, 3)];
    for (limit, expected_pv, expected_visits) in [
        (1, vec!["A2"], vec![3]),
        (2, vec!["A2", "B2"], vec![3, 2]),
        (3, vec!["A2", "B2", "A1"], vec![3, 2, 1]),
    ] {
        let query = AnalysisQueryBuilder::new("pv")
            .board_size(2)
            .analysis_pv_len(limit)
            .build();
        let result = response(&nodes, &query, false).unwrap();
        let candidate = &result.move_infos.unwrap()[0];
        assert_eq!(candidate.pv.as_ref().unwrap(), &expected_pv);
        assert_eq!(candidate.pv_visits.as_ref().unwrap(), &expected_visits);
    }
    let mut query = AnalysisQueryBuilder::new("pv-disabled").build();
    query.include_pv_visits = Some(false);
    let result = response(&nodes, &query, false).unwrap();
    assert!(result.move_infos.unwrap()[0].pv_visits.is_none());
}
