use super::{
    encode_v7, fail, play, process, replay, response, symmetry, terminal, utility, AnalysisEngine,
    AnalysisQuery, AnalysisUpdate, Color, Evaluation, FeatureRules, GameState, KatagoResult,
    LocalBoxFuture, NnEvaluator, Node, SearchEngine, UpdateCallback, V7Features,
};
use std::collections::{HashMap, HashSet, VecDeque};

/// Reservations live only for one batch, so cancellation/failure cannot leave
/// virtual losses in a persistent tree or cache.
pub(super) struct Reservations {
    edges: HashSet<(usize, usize)>,
    visits: Vec<u32>,
}
impl Reservations {
    pub(super) fn new(nodes: usize) -> Self {
        Self {
            edges: HashSet::new(),
            visits: vec![0; nodes],
        }
    }
    fn reserve(&mut self, leaf: &Leaf) {
        if let Some(edge) = leaf.edge {
            self.edges.insert(edge);
        }
        for &index in &leaf.path {
            self.visits[index] += 1;
        }
    }
}

#[derive(Debug)]
pub(super) struct Leaf {
    path: Vec<usize>,
    pub(super) game: GameState,
    edge: Option<(usize, usize)>,
}

fn select_edge(
    nodes: &[Node],
    cursor: usize,
    reservations: &Reservations,
) -> Option<(usize, Option<usize>)> {
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
    let parent_visits = node.visits + reservations.visits[cursor];
    let cpuct = 1.1 + (1.0 + f64::from(node.visits) / 19652.0).ln();
    let mut selected = None;
    let mut best = f64::NEG_INFINITY;
    for (mv, &prior) in node
        .eval
        .policy
        .iter()
        .enumerate()
        .filter(|(_, p)| **p > 0.0)
    {
        if reservations.edges.contains(&(cursor, mv)) {
            continue;
        }
        let child = node
            .children
            .iter()
            .find(|(m, _)| *m == mv)
            .map(|(_, i)| *i);
        let (q, n) = child.map_or((fpu, 0), |i| {
            let pending = reservations.visits[i];
            let visits = nodes[i].visits + pending;
            // Each pending traversal is temporarily a loss for this parent.
            (
                (sign * nodes[i].utility_sum - f64::from(pending)) / f64::from(visits.max(1)),
                visits,
            )
        });
        let score = q + cpuct * prior * f64::from(parent_visits).sqrt() / (1.0 + f64::from(n));
        if score > best {
            best = score;
            selected = Some((mv, child));
        }
    }
    selected
}

pub(super) fn select_leaf(
    nodes: &[Node],
    reservations: &Reservations,
) -> Result<Option<Leaf>, String> {
    let mut path = Vec::new();
    let mut cursor = 0;
    loop {
        path.push(cursor);
        if nodes[cursor].eval.raw.is_none() {
            return Ok(Some(Leaf {
                path,
                game: nodes[cursor].game.clone(),
                edge: None,
            }));
        }
        let Some((mv, child)) = select_edge(nodes, cursor, reservations) else {
            return Ok(None);
        };
        if let Some(child) = child {
            cursor = child;
        } else {
            let game = play(&nodes[cursor].game, mv)?;
            return Ok(Some(Leaf {
                path,
                game,
                edge: Some((cursor, mv)),
            }));
        }
    }
}

#[derive(Default)]
struct Cache {
    values: HashMap<Vec<u32>, Evaluation>,
    order: VecDeque<Vec<u32>>,
}
impl Cache {
    fn key(input: &V7Features, game: &GameState) -> Vec<u32> {
        input
            .spatial
            .iter()
            .chain(&input.global)
            .map(|x| x.to_bits())
            .chain(input.legal.iter().map(|b| u32::from(*b)))
            .chain([u32::from(game.to_play() == Color::Black)])
            .collect()
    }
    fn insert(&mut self, key: Vec<u32>, value: Evaluation) {
        if self.values.contains_key(&key) {
            return;
        }
        if self.values.len() >= 256 {
            if let Some(old) = self.order.pop_front() {
                self.values.remove(&old);
            }
        }
        self.order.push_back(key.clone());
        self.values.insert(key, value);
    }
}

fn backup(nodes: &mut [Node], path: &[usize], evaluation: &Evaluation) {
    let u = utility(evaluation.winrate, evaluation.lead);
    for &index in path {
        let node = &mut nodes[index];
        node.visits += 1;
        node.win_sum += evaluation.winrate;
        node.lead_sum += evaluation.lead;
        node.utility_sum += u;
        node.utility_sq_sum += u * u;
    }
}

impl<E: NnEvaluator> SearchEngine<E> {
    async fn evaluate_root(
        &self,
        game: &GameState,
        rules: FeatureRules,
        komi: f32,
    ) -> Result<Evaluation, String> {
        if let Some(value) = terminal::evaluate(game, rules, komi)? {
            return Ok(value);
        }
        let input = encode_v7(game, rules, komi, false)?;
        let inputs: Vec<_> = (0..self.options.root_symmetries)
            .map(|s| symmetry::input(&input, game.board().size(), s))
            .collect();
        let mut evaluations = Vec::new();
        for (chunk_index, chunk) in inputs.chunks(self.options.batch_size).enumerate() {
            let rows = self.evaluator.evaluate_batch(chunk).await?;
            if rows.len() != chunk.len() {
                return Err("Evaluator returned the wrong batch length".into());
            }
            for (row, raw) in rows.into_iter().enumerate() {
                let symmetry = chunk_index * self.options.batch_size + row;
                let raw = symmetry::output(raw, game.board().size(), symmetry)?;
                evaluations.push(process(raw, game, &input.legal, &self.postprocess)?);
            }
        }
        let weight = 1.0 / evaluations.len() as f64;
        let mut result = evaluations[0].clone();
        result.policy.fill(0.0);
        result.ownership.fill(0.0);
        result.winrate = 0.0;
        result.lead = 0.0;
        // Average probabilities and tanh ownership, never unnormalized logits.
        // Optional raw extra heads retain the identity-orientation NN sample.
        for evaluation in evaluations {
            result.winrate += weight * evaluation.winrate;
            result.lead += weight * evaluation.lead;
            for (out, value) in result.policy.iter_mut().zip(evaluation.policy) {
                *out += weight * value;
            }
            for (out, value) in result.ownership.iter_mut().zip(evaluation.ownership) {
                *out += weight * value;
            }
        }
        Ok(result)
    }

    async fn evaluate_nonterminal(
        &self,
        leaves: &[&Leaf],
        rules: FeatureRules,
        komi: f32,
        cache: &mut Cache,
    ) -> Result<Vec<Evaluation>, String> {
        let inputs: Vec<_> = leaves
            .iter()
            .map(|leaf| encode_v7(&leaf.game, rules, komi, false))
            .collect::<Result<_, _>>()?;
        let keys: Vec<_> = inputs
            .iter()
            .zip(leaves)
            .map(|(input, leaf)| Cache::key(input, &leaf.game))
            .collect();
        // Preserve hits used by this batch even if inserting a miss evicts them.
        let mut resolved: HashMap<_, _> = keys
            .iter()
            .filter_map(|key| {
                cache
                    .values
                    .get(key)
                    .map(|value| (key.clone(), value.clone()))
            })
            .collect();
        let mut pending_keys = HashSet::new();
        let unique: Vec<_> = keys
            .iter()
            .enumerate()
            .filter(|(_, key)| {
                !cache.values.contains_key(*key) && pending_keys.insert((*key).clone())
            })
            .map(|(i, _)| i)
            .collect();
        if !unique.is_empty() {
            let batch: Vec<_> = unique.iter().map(|&i| inputs[i].clone()).collect();
            let rows = self.evaluator.evaluate_batch(&batch).await?;
            if rows.len() != batch.len() {
                return Err("Evaluator returned the wrong batch length".into());
            }
            for (&i, raw) in unique.iter().zip(rows) {
                let value = process(raw, &leaves[i].game, &inputs[i].legal, &self.postprocess)?;
                resolved.insert(keys[i].clone(), value.clone());
                cache.insert(keys[i].clone(), value);
            }
        }
        keys.iter()
            .map(|key| {
                resolved
                    .get(key)
                    .cloned()
                    .ok_or_else(|| "Missing batch evaluation".into())
            })
            .collect()
    }

    async fn evaluate_leaves(
        &self,
        leaves: &[Leaf],
        rules: FeatureRules,
        komi: f32,
        cache: &mut Cache,
    ) -> Result<Vec<Evaluation>, String> {
        let mut values: Vec<_> = leaves
            .iter()
            .map(|leaf| terminal::evaluate(&leaf.game, rules, komi))
            .collect::<Result<_, _>>()?;
        let pending: Vec<_> = leaves
            .iter()
            .enumerate()
            .filter(|(i, _)| values[*i].is_none())
            .collect();
        if !pending.is_empty() {
            let neural: Vec<_> = pending.iter().map(|(_, leaf)| *leaf).collect();
            let results = self
                .evaluate_nonterminal(&neural, rules, komi, cache)
                .await?;
            for ((index, _), value) in pending.into_iter().zip(results) {
                values[index] = Some(value);
            }
        }
        Ok(values
            .into_iter()
            .map(|v| v.expect("resolved leaf"))
            .collect())
    }

    fn validate(&self, query: &AnalysisQuery) -> Result<u32, String> {
        for scale in [
            self.postprocess.scoremean_multiplier,
            self.postprocess.scorestdev_multiplier,
            self.postprocess.lead_multiplier,
        ] {
            if !scale.is_finite() || scale <= 0.0 {
                return Err("Invalid neural postprocessing scale".into());
            }
        }
        if !matches!(self.options.root_symmetries, 1 | 8)
            || !(1..=4).contains(&self.options.batch_size)
        {
            return Err("Root symmetries must be 1 or 8; neural batch size must be 1..4".into());
        }
        let visits = query.max_visits.unwrap_or(200);
        if !(1..=10_000).contains(&visits) {
            return Err("Browser visit budget must be 1..10000".into());
        }
        Ok(visits)
    }
}

impl<E: NnEvaluator> AnalysisEngine for SearchEngine<E> {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            let error = |e| fail(&query.id, e);
            let visits = self.validate(query).map_err(error)?;
            let (game, rules) = replay(query).map_err(error)?;
            let komi = query.komi.unwrap_or(7.5) as f32;
            let root = self
                .evaluate_root(&game, rules, komi)
                .await
                .map_err(error)?;
            let mut nodes = vec![Node::new(game, root.clone())];
            backup(&mut nodes, &[0], &root);
            if root.raw.is_none() {
                return on_update(AnalysisUpdate::Final(response(&nodes, query, false)?));
            }
            let mut cache = Cache::default();
            let mut last_partial = 1;
            while nodes[0].visits < visits {
                let slots = self
                    .options
                    .batch_size
                    .min((visits - nodes[0].visits) as usize);
                let mut reservations = Reservations::new(nodes.len());
                let mut leaves = Vec::new();
                for _ in 0..slots {
                    let Some(leaf) = select_leaf(&nodes, &reservations).map_err(error)? else {
                        break;
                    };
                    reservations.reserve(&leaf);
                    leaves.push(leaf);
                }
                if leaves.is_empty() {
                    return Err(error("No legal search path".into()));
                }
                let values = self
                    .evaluate_leaves(&leaves, rules, komi, &mut cache)
                    .await
                    .map_err(error)?;
                for (mut leaf, value) in leaves.into_iter().zip(values) {
                    if let Some((parent, mv)) = leaf.edge {
                        let index = nodes.len();
                        nodes.push(Node::new(leaf.game, value.clone()));
                        nodes[parent].children.push((mv, index));
                        leaf.path.push(index);
                    }
                    backup(&mut nodes, &leaf.path, &value);
                }
                if query.report_during_search_every.is_some()
                    && nodes[0].visits >= last_partial + 8
                    && nodes[0].visits < visits
                {
                    on_update(AnalysisUpdate::Partial(response(&nodes, query, true)?))?;
                    last_partial = nodes[0].visits;
                }
            }
            on_update(AnalysisUpdate::Final(response(&nodes, query, false)?))
        })
    }
}
