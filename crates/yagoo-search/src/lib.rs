//! EXPERIMENTAL deterministic PUCT analysis over a real V7 neural evaluator.
//! Not KataGo's complete search; see docs/browser-engine.md and PR #7 follow-ups.
#![allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
use futures::future::LocalBoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::json;
mod search;
mod symmetry;
mod terminal;
use yagoo_core::{
    nn_features::{encode_v7, FeatureRules, V7Features, NN_AREA, NN_LEN},
    Color, GameState, Point, Ruleset,
};
use yagoo_katago::{
    AnalysisQuery, AnalysisResponse, AnalysisUpdate, KatagoError, KatagoResult, PlayerToken,
};
use yagoo_pipeline::{AnalysisEngine, UpdateCallback};

#[derive(Clone, Deserialize, Serialize)]
pub struct Postprocess {
    pub scoremean_multiplier: f64,
    pub scorestdev_multiplier: f64,
    pub lead_multiplier: f64,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct RawHeads {
    pub policy: Vec<f32>,
    pub value: Vec<f32>,
    pub miscvalue: Vec<f32>,
    pub ownership: Vec<f32>,
    #[serde(default)]
    pub scorebelief_logprobs: Vec<f32>,
    #[serde(default)]
    pub seki: Vec<f32>,
    #[serde(default)]
    pub futurepos: Vec<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootContext {
    pub query_id: String,
    pub board_size: u8,
    pub to_play: PlayerToken,
}

pub trait NnEvaluator {
    /// Root lifecycle notification, including terminal roots that bypass inference.
    /// Browser implementations release the previous ephemeral GPU activation lease.
    fn begin_root(&self, _context: &RootContext) -> Result<(), String> {
        Ok(())
    }

    /// One asynchronous inference call, preserving the input row order.
    fn evaluate_batch<'a>(
        &'a self,
        inputs: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>>;

    /// The first row is the root identity sample; remaining rows may be symmetries.
    /// Implementations may retain GPU activations without serializing them to Rust.
    fn evaluate_root_batch<'a>(
        &'a self,
        inputs: &'a [V7Features],
    ) -> LocalBoxFuture<'a, Result<Vec<RawHeads>, String>> {
        self.evaluate_batch(inputs)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchOptions {
    pub root_symmetries: usize,
    pub batch_size: usize,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            root_symmetries: 1,
            batch_size: 1,
        }
    }
}

pub struct SearchEngine<E> {
    pub evaluator: E,
    pub postprocess: Postprocess,
    pub options: SearchOptions,
}

#[derive(Clone)]
struct Evaluation {
    policy: Vec<f64>,
    winrate: f64,
    lead: f64,
    ownership: Vec<f64>,
    raw: Option<RawHeads>,
}

struct Node {
    game: GameState,
    eval: Evaluation,
    children: Vec<(usize, usize)>,
    visits: u32,
    win_sum: f64,
    lead_sum: f64,
    utility_sum: f64,
}

impl Node {
    fn new(game: GameState, eval: Evaluation) -> Self {
        Self {
            game,
            eval,
            children: Vec::new(),
            visits: 0,
            win_sum: 0.0,
            lead_sum: 0.0,
            utility_sum: 0.0,
        }
    }
    fn mean(&self, sum: f64) -> f64 {
        sum / f64::from(self.visits.max(1))
    }
}

fn fail(id: &str, error: impl Into<String>) -> KatagoError {
    KatagoError::Engine {
        id: id.into(),
        error: error.into(),
    }
}
fn color(p: PlayerToken) -> Color {
    if p == PlayerToken::B {
        Color::Black
    } else {
        Color::White
    }
}
fn utility(winrate: f64, lead: f64) -> f64 {
    2.0 * winrate - 1.0 + 0.1 * (lead / 20.0).atan() * (2.0 / std::f64::consts::PI)
}

fn softmax(values: &[f32]) -> Result<Vec<f64>, String> {
    if values.is_empty() || values.iter().any(|x| !x.is_finite()) {
        return Err("Nonfinite or empty neural output".into());
    }
    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut result: Vec<_> = values.iter().map(|x| f64::from(*x - max).exp()).collect();
    let sum: f64 = result.iter().sum();
    for x in &mut result {
        *x /= sum;
    }
    Ok(result)
}

#[allow(clippy::too_many_lines)]
fn replay(query: &AnalysisQuery) -> Result<(GameState, FeatureRules), String> {
    if query.avoid_moves.is_some() || query.allow_moves.is_some() || query.focus_moves.is_some() {
        return Err("Browser search does not implement move restriction queries".into());
    }
    if let Some(overrides) = &query.override_settings {
        for (key, value) in overrides {
            if key != "reportAnalysisWinratesAs" || value != "BLACK" {
                return Err(format!("Unsupported browser search override: {key}"));
            }
        }
    }
    let rules = match query
        .rules
        .as_deref()
        .unwrap_or("chinese")
        .to_ascii_lowercase()
        .as_str()
    {
        "chinese" => FeatureRules::Chinese,
        "chinese-ogs" | "chinese-kgs" => FeatureRules::ChineseOgs,
        "japanese" | "korean" => FeatureRules::Japanese,
        name => return Err(format!("Browser V7 does not yet support rules '{name}'")),
    };
    let x = query.board_x_size.unwrap_or(19);
    if !(2..=19).contains(&x) || query.board_y_size.unwrap_or(x) != x {
        return Err("Browser model supports square boards from 2 to 19".into());
    }
    let mut game = GameState::new(
        x as u8,
        if rules == FeatureRules::ChineseOgs {
            Ruleset::Chinese
        } else {
            Ruleset::Japanese
        },
    )
    .map_err(|e| e.to_string())?;
    for (c, coord) in &query.initial_stones {
        let p = Point::parse_gtp(coord, x as u8)
            .map_err(|e| e.to_string())?
            .ok_or("Setup cannot contain pass")?;
        if !game.board().get(p).map_err(|e| e.to_string())?.is_empty() {
            return Err("Duplicate setup point".into());
        }
        game.setup_stone(p, color(*c)).map_err(|e| e.to_string())?;
    }
    game.set_to_play(color(
        query
            .initial_player
            .or_else(|| query.moves.first().map(|m| m.0))
            .unwrap_or(PlayerToken::B),
    ));
    for (c, coord) in &query.moves {
        if game.to_play() != color(*c) {
            return Err("Non-alternating history is not supported".into());
        }
        if game.consecutive_passes() >= 2 {
            return Err("Moves after the normal phase ends are not supported".into());
        }
        game.play_gtp(coord).map_err(|e| e.to_string())?;
    }
    if game.consecutive_passes() >= 2 && rules == FeatureRules::Japanese {
        return Err(
            "Japanese encore legality, features and territory scoring are not implemented".into(),
        );
    }
    yagoo_core::nn_features::validate_history(&game, rules)?;
    Ok((game, rules))
}

fn process(
    raw: RawHeads,
    game: &GameState,
    rules: FeatureRules,
    legal: &[bool],
    post: &Postprocess,
) -> Result<Evaluation, String> {
    if raw.policy.len() != 6 * 362
        || raw.value.len() != 3
        || raw.miscvalue.len() != 10
        || raw.ownership.len() != 361
    {
        return Err("Neural outputs do not match b18 raw-head shapes".into());
    }
    let has_extra =
        !raw.scorebelief_logprobs.is_empty() || !raw.seki.is_empty() || !raw.futurepos.is_empty();
    if has_extra
        && (raw.scorebelief_logprobs.len() != 842
            || raw.seki.len() != 4 * NN_AREA
            || raw.futurepos.len() != 2 * NN_AREA)
    {
        return Err(
            "Extra neural heads must be scorebelief[842], seki[4,19,19], futurepos[2,19,19]".into(),
        );
    }
    if raw
        .policy
        .iter()
        .chain(&raw.value)
        .chain(&raw.miscvalue)
        .chain(&raw.ownership)
        .chain(&raw.scorebelief_logprobs)
        .chain(&raw.seki)
        .chain(&raw.futurepos)
        .any(|x| !x.is_finite())
    {
        return Err("Nonfinite model output".into());
    }
    if has_extra
        && (raw
            .scorebelief_logprobs
            .iter()
            .map(|x| f64::from(*x).exp())
            .sum::<f64>()
            - 1.0)
            .abs()
            > 0.002
    {
        return Err("Score-belief log probabilities are not normalized".into());
    }
    let size = game.board().size();
    let n = usize::from(size).pow(2);
    let mut logits: Vec<f32> = (0..n)
        .map(|i| raw.policy[Point::from_index(i, size).expect("point").index(NN_LEN)])
        .collect();
    logits.push(raw.policy[NN_AREA]);
    for (value, valid) in logits.iter_mut().zip(legal) {
        if !valid {
            *value = -1e30;
        }
    }
    let policy = softmax(&logits)?;
    // Positional-superko area rules cannot produce no-result games. Upstream
    // excludes that logit before normalizing, not after the three-way softmax.
    let value = softmax(if rules == FeatureRules::ChineseOgs {
        &raw.value[..2]
    } else {
        &raw.value
    })?;
    let no_result = value.get(2).copied().unwrap_or(0.0);
    let current_win = value[0] + 0.5 * no_result;
    let sign = if game.to_play() == Color::Black {
        1.0
    } else {
        -1.0
    };
    let ownership = (0..n)
        .map(|i| {
            sign * f64::from(
                raw.ownership[Point::from_index(i, size).expect("point").index(NN_LEN)],
            )
            .tanh()
        })
        .collect();
    Ok(Evaluation {
        policy,
        winrate: if sign > 0.0 {
            current_win
        } else {
            1.0 - current_win
        },
        // The raw lead is conditional on a result; no-result contributes zero.
        lead: sign * f64::from(raw.miscvalue[2]) * post.lead_multiplier * (1.0 - no_result),
        ownership,
        raw: Some(raw),
    })
}

fn play(game: &GameState, mv: usize) -> Result<GameState, String> {
    let mut next = game.clone();
    if let Some(p) = Point::from_index(mv, game.board().size()) {
        next.play(p).map_err(|e| e.to_string())?;
    } else {
        next.play_pass().map_err(|e| e.to_string())?;
    }
    Ok(next)
}

fn gtp(game: &GameState, mv: usize) -> String {
    Point::from_index(mv, game.board().size())
        .map_or_else(|| "pass".into(), |p| p.to_gtp(game.board().size()))
}

fn best_child(nodes: &[Node], index: usize) -> Option<(usize, usize)> {
    nodes[index]
        .children
        .iter()
        .copied()
        .max_by_key(|(_, child)| nodes[*child].visits)
}

fn tree_ownership(
    nodes: &[Node],
    index: usize,
    weight: f64,
    minimum: f64,
    mean: &mut [f64],
    square: &mut [f64],
) {
    let node = &nodes[index];
    let children_square_weight: f64 = node
        .children
        .iter()
        .map(|(_, i)| f64::from(nodes[*i].visits).powi(2))
        .sum();
    let children_weight: f64 = node
        .children
        .iter()
        .map(|(_, i)| f64::from(nodes[*i].visits))
        .sum();
    // This search assigns one unit of weight to each NN evaluation. Native
    // KataGo can use uncertainty-dependent NN weights, which are not implemented.
    let mut own_weight = if children_square_weight == 0.0 || weight < minimum {
        weight
    } else {
        weight / (children_weight + 1.0)
    };
    if own_weight < weight {
        let descendant_weight = weight - own_weight;
        for (_, child) in &node.children {
            let w = descendant_weight * f64::from(nodes[*child].visits).powi(2)
                / children_square_weight;
            if w < minimum * 0.01 {
                // Return pruned mass to this node, retaining normalization.
                own_weight += w;
            } else {
                tree_ownership(nodes, *child, w, minimum, mean, square);
            }
        }
    }
    for ((m, s), x) in mean
        .iter_mut()
        .zip(square.iter_mut())
        .zip(&node.eval.ownership)
    {
        *m += own_weight * x;
        *s += own_weight * x * x;
    }
}

fn ownership(nodes: &[Node], index: usize) -> (Vec<f64>, Vec<f64>) {
    let mut mean = vec![0.0; nodes[index].eval.ownership.len()];
    let mut square = mean.clone();
    tree_ownership(
        nodes,
        index,
        1.0,
        0.5 / f64::from(nodes[index].visits.max(1)).powf(0.75),
        &mut mean,
        &mut square,
    );
    let stdev = square
        .into_iter()
        .zip(&mean)
        .map(|(s, m)| (s - m * m).max(0.0).sqrt())
        .collect();
    (mean, stdev)
}

fn response(
    nodes: &[Node],
    query: &AnalysisQuery,
    partial: bool,
) -> KatagoResult<AnalysisResponse> {
    let root = &nodes[0];
    let (own, stdev) = ownership(nodes, 0);
    let mut candidates = root.children.clone();
    candidates.sort_by(|(_, a), (_, b)| nodes[*b].visits.cmp(&nodes[*a].visits));
    let mut infos = Vec::new();
    for (order, (mv, index)) in candidates.iter().enumerate() {
        let node = &nodes[*index];
        // The candidate itself counts toward the requested length. Validation
        // accepts the native protocol's 1..=1000 range; only visited nodes appear.
        let pv_limit = query.analysis_pv_len.unwrap_or(15) as usize;
        let mut pv = Vec::new();
        let mut pv_visits = Vec::new();
        if pv_limit > 0 {
            pv.push(gtp(&root.game, *mv));
            pv_visits.push(node.visits);
            let mut cursor = *index;
            while pv.len() < pv_limit {
                if let Some((next_move, child)) = best_child(nodes, cursor) {
                    pv.push(gtp(&nodes[cursor].game, next_move));
                    pv_visits.push(nodes[child].visits);
                    cursor = child;
                } else {
                    break;
                }
            }
        }
        let (candidate_own, candidate_stdev) = if query.include_moves_ownership == Some(true)
            || query.include_moves_ownership_stdev == Some(true)
        {
            ownership(nodes, *index)
        } else {
            (vec![], vec![])
        };
        // A utility confidence bound is not the protocol's winrate LCB.
        // Leave lcb absent until a justified confidence estimate is implemented.
        let mut info = json!({ "move": gtp(&root.game, *mv), "order": order, "visits": node.visits,
            "winrate": node.mean(node.win_sum), "scoreLead": node.mean(node.lead_sum), "prior": root.eval.policy[*mv],
            "utility": node.mean(node.utility_sum), "pv": pv });
        if query.include_pv_visits == Some(true) {
            info["pvVisits"] = json!(pv_visits);
        }
        if query.include_moves_ownership == Some(true) {
            info["ownership"] = json!(candidate_own);
        }
        if query.include_moves_ownership_stdev == Some(true) {
            info["ownershipStdev"] = json!(candidate_stdev);
        }
        infos.push(info);
    }
    let mut value = json!({ "id": query.id, "isDuringSearch": partial,
        "isTerminal": root.eval.raw.is_none(),
        "rootInfo": { "visits": root.visits, "winrate": root.mean(root.win_sum), "scoreLead": root.mean(root.lead_sum), "utility": root.mean(root.utility_sum) },
        "moveInfos": infos });
    if let Some(raw) = &root.eval.raw {
        if !partial && !raw.scorebelief_logprobs.is_empty() {
            value["neural"] = json!(yagoo_katago::RootNeuralOutput {
                to_play: PlayerToken::from_color(root.game.to_play()),
                sample_symmetry: "identity".into(),
                aggregation: "none".into(),
                tensor_layout: "CHW".into(),
                board_size: root.game.board().size(),
                model_board_size: NN_LEN,
                score_belief_log_probs: raw.scorebelief_logprobs.clone(),
                score_bin_first_center: -420.5,
                seki_logits: raw.seki.clone(),
                futurepos_pretanh: raw.futurepos.clone(),
            });
        }
    }
    if query.include_policy == Some(true) {
        value["policy"] = json!(root.eval.policy);
    }
    if query.include_ownership == Some(true) {
        value["ownership"] = json!(own);
    }
    if query.include_ownership_stdev == Some(true) {
        value["ownershipStdev"] = json!(stdev);
    }
    serde_json::from_value(value).map_err(Into::into)
}

#[cfg(test)]
mod output_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_katago::AnalysisQueryBuilder;

    fn heads() -> RawHeads {
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
    fn post() -> Postprocess {
        Postprocess {
            scoremean_multiplier: 20.0,
            scorestdev_multiplier: 20.0,
            lead_multiplier: 20.0,
        }
    }
    #[test]
    fn perspective_and_legal_policy_use_board_size() {
        let mut game = GameState::new(9, Ruleset::Japanese).unwrap();
        game.setup_stone(Point::new(0, 0), Color::Black).unwrap();
        game.set_to_play(Color::White);
        let input = encode_v7(&game, FeatureRules::Chinese, 7.5, false).unwrap();
        let result = process(heads(), &game, FeatureRules::Chinese, &input.legal, &post()).unwrap();
        assert_eq!(result.policy.len(), 82);
        assert_eq!(result.policy[0], 0.0);
        assert!((result.policy.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        assert_eq!(result.ownership.len(), 81);
        assert!(result.winrate < 0.5);
        assert!(result.ownership[1] < 0.0);
        assert!((result.lead + 8.858_048_006_154_055).abs() < 1e-12);
    }
    #[test]
    fn nonfinite_extra_head_is_rejected() {
        let game = GameState::new(9, Ruleset::Japanese).unwrap();
        let mut raw = heads();
        raw.scorebelief_logprobs.push(f32::NEG_INFINITY);
        assert!(process(raw, &game, FeatureRules::Chinese, &[true; 82], &post()).is_err());
    }
    #[test]
    fn terminal_history_and_unsupported_rules_are_explicit_errors() {
        let query = AnalysisQueryBuilder::new("terminal")
            .board_size(9)
            .rules("japanese")
            .push_move(Color::Black, "pass")
            .push_move(Color::White, "pass")
            .build();
        assert!(replay(&query).unwrap_err().contains("encore"));
        let query = AnalysisQueryBuilder::new("rules")
            .rules("tromp-taylor")
            .build();
        assert!(replay(&query).unwrap_err().contains("does not yet support"));
    }
    #[test]
    fn search_does_not_hide_second_pass_or_evaluate_it_as_nonterminal() {
        let mut game = GameState::new(9, Ruleset::Japanese).unwrap();
        game.play_pass().unwrap();
        let input = encode_v7(&game, FeatureRules::Japanese, 6.5, false).unwrap();
        let mut evaluation = process(
            heads(),
            &game,
            FeatureRules::Japanese,
            &input.legal,
            &post(),
        )
        .unwrap();
        evaluation.policy.fill(0.0);
        evaluation.policy[81] = 1.0;
        let mut root = Node::new(game.clone(), evaluation);
        root.visits = 1;
        let leaf = search::select_leaf(&[root], &search::Reservations::new(1))
            .unwrap()
            .unwrap();
        assert!(terminal::evaluate(&leaf.game, FeatureRules::Japanese, 6.5)
            .err()
            .unwrap()
            .contains("encore"));
    }
}
