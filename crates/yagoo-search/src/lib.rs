//! Experimental, deterministic PUCT analysis over a real V7 neural evaluator.
//! This is not KataGo's complete search implementation; see docs/browser-engine.md.
#![allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
use futures::future::LocalBoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
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

pub trait NnEvaluator {
    fn evaluate<'a>(
        &'a self,
        input: &'a V7Features,
    ) -> LocalBoxFuture<'a, Result<RawHeads, String>>;
}

pub struct SearchEngine<E> {
    pub evaluator: E,
    pub postprocess: Postprocess,
}

#[derive(Clone)]
struct Evaluation {
    policy: Vec<f64>,
    winrate: f64,
    lead: f64,
    ownership: Vec<f64>,
    raw: RawHeads,
}

struct Node {
    game: GameState,
    eval: Evaluation,
    children: Vec<(usize, usize)>,
    visits: u32,
    win_sum: f64,
    lead_sum: f64,
    utility_sum: f64,
    utility_sq_sum: f64,
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
            utility_sq_sum: 0.0,
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
    if game.consecutive_passes() >= 2 {
        return Err("Terminal scoring and Japanese encore are not implemented".into());
    }
    Ok((game, rules))
}

fn process(
    raw: RawHeads,
    game: &GameState,
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
    let value = softmax(&raw.value)?;
    let current_win = value[0] + 0.5 * value[2];
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
        lead: sign * f64::from(raw.miscvalue[2]) * post.lead_multiplier,
        ownership,
        raw,
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
    let children_weight: f64 = node
        .children
        .iter()
        .map(|(_, i)| f64::from(nodes[*i].visits).powi(2))
        .sum();
    let own_weight = if children_weight == 0.0 || weight < minimum {
        weight
    } else {
        weight / f64::from(node.visits.max(1))
    };
    for ((m, s), x) in mean
        .iter_mut()
        .zip(square.iter_mut())
        .zip(&node.eval.ownership)
    {
        *m += own_weight * x;
        *s += own_weight * x * x;
    }
    if own_weight < weight {
        for (_, child) in &node.children {
            let w =
                (weight - own_weight) * f64::from(nodes[*child].visits).powi(2) / children_weight;
            tree_ownership(nodes, *child, w, minimum, mean, square);
        }
    }
}

fn ownership(nodes: &[Node], index: usize) -> (Vec<f64>, Vec<f64>) {
    let mut mean = vec![0.0; nodes[index].eval.ownership.len()];
    let mut square = mean.clone();
    tree_ownership(
        nodes,
        index,
        1.0,
        0.005 / f64::from(nodes[index].visits.max(1)).powf(0.75),
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
        let mut pv = vec![gtp(&root.game, *mv)];
        let mut cursor = *index;
        while pv.len() < query.analysis_pv_len.unwrap_or(16).min(64) as usize {
            if let Some((next_move, child)) = best_child(nodes, cursor) {
                pv.push(gtp(&nodes[cursor].game, next_move));
                cursor = child;
            } else {
                break;
            }
        }
        let variance =
            (node.mean(node.utility_sq_sum) - node.mean(node.utility_sum).powi(2)).max(0.0);
        let (candidate_own, candidate_stdev) = if query.include_moves_ownership == Some(true) {
            ownership(nodes, *index)
        } else {
            (vec![], vec![])
        };
        let mut info = json!({ "move": gtp(&root.game, *mv), "order": order, "visits": node.visits,
            "winrate": node.mean(node.win_sum), "scoreLead": node.mean(node.lead_sum), "prior": root.eval.policy[*mv],
            "utility": node.mean(node.utility_sum), "lcb": node.mean(node.utility_sum) - 1.96 * (variance / f64::from(node.visits.max(1))).sqrt(), "pv": pv });
        if query.include_moves_ownership == Some(true) {
            info["ownership"] = json!(candidate_own);
        }
        if query.include_moves_ownership_stdev == Some(true) {
            info["ownershipStdev"] = json!(candidate_stdev);
        }
        infos.push(info);
    }
    let mut value = json!({ "id": query.id, "isDuringSearch": partial,
        "rootInfo": { "visits": root.visits, "winrate": root.mean(root.win_sum), "scoreLead": root.mean(root.lead_sum), "utility": root.mean(root.utility_sum) },
        "moveInfos": infos, "raw": { "perspective": "toPlay", "scoreBeliefLogProbs": root.eval.raw.scorebelief_logprobs,
            "seki": root.eval.raw.seki, "futurepos": root.eval.raw.futurepos } });
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

type SelectedLeaf = (Vec<usize>, GameState, Option<(usize, usize)>);

/// Follow PUCT edges until an unexpanded move is found.
fn select_leaf(nodes: &[Node], game: &GameState) -> Result<SelectedLeaf, String> {
    let mut path = Vec::new();
    if nodes.is_empty() {
        return Ok((path, game.clone(), None));
    }
    let mut cursor = 0;
    loop {
        path.push(cursor);
        let node = &nodes[cursor];
        let sign = if node.game.to_play() == Color::Black {
            1.0
        } else {
            -1.0
        };
        let mass: f64 = node
            .children
            .iter()
            .map(|(m, _)| node.eval.policy[*m])
            .sum();
        let fpu = sign * utility(node.eval.winrate, node.eval.lead) - 0.2 * mass.sqrt();
        let cpuct = 1.1 + (1.0 + f64::from(node.visits) / 19652.0).ln();
        let mut selected = None;
        let mut best = f64::NEG_INFINITY;
        for (mv, prior) in node
            .eval
            .policy
            .iter()
            .enumerate()
            .filter(|(_, p)| **p > 0.0)
        {
            let child = node
                .children
                .iter()
                .find(|(m, _)| *m == mv)
                .map(|(_, i)| *i);
            let (q, n) = child.map_or((fpu, 0), |i| {
                (sign * nodes[i].mean(nodes[i].utility_sum), nodes[i].visits)
            });
            let score = q + cpuct * prior * f64::from(node.visits).sqrt() / (1.0 + f64::from(n));
            if score > best {
                best = score;
                selected = Some((mv, child));
            }
        }
        let (mv, child) = selected.ok_or("No legal search move")?;
        if let Some(child) = child {
            cursor = child;
        } else {
            let next = play(&node.game, mv)?;
            if next.consecutive_passes() >= 2 {
                return Err("Search reached two passes: terminal scoring and Japanese encore are not implemented; no final analysis produced".into());
            }
            return Ok((path, next, Some((cursor, mv))));
        }
    }
}

impl<E: NnEvaluator> AnalysisEngine for SearchEngine<E> {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            for scale in [
                self.postprocess.scoremean_multiplier,
                self.postprocess.scorestdev_multiplier,
                self.postprocess.lead_multiplier,
            ] {
                if !scale.is_finite() || scale <= 0.0 {
                    return Err(fail(&query.id, "Invalid neural postprocessing scale"));
                }
            }
            let (game, rules) = replay(query).map_err(|e| fail(&query.id, e))?;
            let visits = query.max_visits.unwrap_or(200);
            if !(1..=10_000).contains(&visits) {
                return Err(fail(&query.id, "Browser visit budget must be 1..10000"));
            }
            let mut nodes: Vec<Node> = Vec::new();
            let mut cache = HashMap::<Vec<u32>, Evaluation>::new();
            let mut cache_order = VecDeque::new();
            for visit in 0..visits {
                let (mut path, next_game, edge) =
                    select_leaf(&nodes, &game).map_err(|e| fail(&query.id, e))?;
                let evaluation = if edge.is_none() && !nodes.is_empty() {
                    nodes[*path.last().expect("search path")].eval.clone()
                } else {
                    let input =
                        encode_v7(&next_game, rules, query.komi.unwrap_or(7.5) as f32, false)
                            .map_err(|e| fail(&query.id, e))?;
                    let mut key: Vec<u32> = input
                        .spatial
                        .iter()
                        .chain(&input.global)
                        .map(|x| x.to_bits())
                        .chain(input.legal.iter().map(|b| u32::from(*b)))
                        .collect();
                    // Cached evaluations are black-positive, unlike the relative NN inputs.
                    key.push(u32::from(next_game.to_play() == Color::Black));
                    if let Some(value) = cache.get(&key) {
                        value.clone()
                    } else {
                        let raw = self
                            .evaluator
                            .evaluate(&input)
                            .await
                            .map_err(|e| fail(&query.id, e))?;
                        let value = process(raw, &next_game, &input.legal, &self.postprocess)
                            .map_err(|e| fail(&query.id, e))?;
                        if cache.len() >= 256 {
                            if let Some(old) = cache_order.pop_front() {
                                cache.remove(&old);
                            }
                        }
                        cache_order.push_back(key.clone());
                        cache.insert(key, value.clone());
                        value
                    }
                };
                if nodes.is_empty() || edge.is_some() {
                    let index = nodes.len();
                    nodes.push(Node::new(next_game, evaluation.clone()));
                    path.push(index);
                    if let Some((parent, mv)) = edge {
                        nodes[parent].children.push((mv, index));
                    }
                }
                let u = utility(evaluation.winrate, evaluation.lead);
                for index in path {
                    let node = &mut nodes[index];
                    node.visits += 1;
                    node.win_sum += evaluation.winrate;
                    node.lead_sum += evaluation.lead;
                    node.utility_sum += u;
                    node.utility_sq_sum += u * u;
                }
                if query.report_during_search_every.is_some()
                    && visit > 0
                    && visit % 8 == 0
                    && visit + 1 < visits
                {
                    on_update(AnalysisUpdate::Partial(response(&nodes, query, true)?))?;
                }
            }
            on_update(AnalysisUpdate::Final(response(&nodes, query, false)?))
        })
    }
}

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
        let result = process(heads(), &game, &input.legal, &post()).unwrap();
        assert_eq!(result.policy.len(), 82);
        assert_eq!(result.policy[0], 0.0);
        assert!((result.policy.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        assert_eq!(result.ownership.len(), 81);
        assert!(result.winrate < 0.5);
        assert!(result.ownership[1] < 0.0);
        assert!((result.lead + 10.0).abs() < 1e-12);
    }
    #[test]
    fn nonfinite_extra_head_is_rejected() {
        let game = GameState::new(9, Ruleset::Japanese).unwrap();
        let mut raw = heads();
        raw.scorebelief_logprobs.push(f32::NEG_INFINITY);
        assert!(process(raw, &game, &[true; 82], &post()).is_err());
    }
    #[test]
    fn terminal_history_and_unsupported_rules_are_explicit_errors() {
        let query = AnalysisQueryBuilder::new("terminal")
            .board_size(9)
            .push_move(Color::Black, "pass")
            .push_move(Color::White, "pass")
            .build();
        assert!(replay(&query).unwrap_err().contains("Terminal scoring"));
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
        let mut evaluation = process(heads(), &game, &input.legal, &post()).unwrap();
        evaluation.policy.fill(0.0);
        evaluation.policy[81] = 1.0;
        let mut root = Node::new(game.clone(), evaluation);
        root.visits = 1;
        assert!(select_leaf(&[root], &game)
            .unwrap_err()
            .contains("two passes"));
    }
}
