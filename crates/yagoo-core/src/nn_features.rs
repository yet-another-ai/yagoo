//! KataGo V7 inputs for ordinary Chinese / Japanese play, in NCHW order.
//!
//! Ported from MIT-licensed KataGo d91ea855 (see THIRD_PARTY_NOTICES.md).
//! Encore, suicide, button, tax-all and asymmetric play are rejected by the
//! browser query adapter. They must never silently receive zero-filled features.
use crate::{Board, Color, CoreError, GameState, Point, Stone};
use std::collections::BTreeSet;

pub const NN_LEN: u8 = 19;
pub const NN_AREA: usize = 361;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeatureRules {
    Chinese,
    ChineseOgs,
    Japanese,
}

#[derive(Clone, Debug)]
pub struct V7Features {
    pub spatial: Vec<f32>,
    pub global: Vec<f32>,
    /// Board order followed by pass; excludes suicide, ko and superko.
    pub legal: Vec<bool>,
}

fn points(board: &Board) -> impl Iterator<Item = Point> {
    let size = board.size();
    (0..size).flat_map(move |y| (0..size).map(move |x| Point::new(x, y)))
}

fn stone(board: &Board, p: Point) -> Stone {
    board.get(p).expect("board point")
}

/// Benson pass-alive regions plus safe/unsafe territory, matching calculateArea.
#[must_use]
pub fn area(board: &Board) -> Vec<Stone> {
    let n = usize::from(board.size()).pow(2);
    let mut result = vec![Stone::Empty; n];
    let chains = board.all_chains();
    let mut chain_at = vec![usize::MAX; n];
    for (i, chain) in chains.iter().enumerate() {
        for p in &chain.stones {
            chain_at[p.index(board.size())] = i;
        }
    }
    for color in [Color::Black, Color::White] {
        fill_area_for_color(board, color, &chains, &chain_at, &mut result);
    }
    for p in points(board) {
        if result[p.index(board.size())].is_empty() {
            result[p.index(board.size())] = stone(board, p);
        }
    }
    result
}

fn fill_area_for_color(
    board: &Board,
    color: Color,
    chains: &[crate::Chain],
    chain_at: &[usize],
    result: &mut [Stone],
) {
    let n = usize::from(board.size()).pow(2);
    let own = Stone::from_color(color);
    let mut seen = vec![false; n];
    // (points, adjacent chains, vital chains, internal count, contains opponent)
    let mut regions = Vec::new();
    for start in points(board) {
        if seen[start.index(board.size())] || !stone(board, start).is_empty() {
            continue;
        }
        let mut stack = vec![start];
        let mut cells = Vec::new();
        let mut borders = BTreeSet::new();
        let mut vital: Option<BTreeSet<usize>> = None;
        let mut internal = 0;
        let mut opponent = false;
        while let Some(p) = stack.pop() {
            let idx = p.index(board.size());
            if seen[idx] {
                continue;
            }
            seen[idx] = true;
            cells.push(p);
            let mut adjacent = BTreeSet::new();
            for q in p.neighbors(board.size()) {
                if stone(board, q) == own {
                    adjacent.insert(chain_at[q.index(board.size())]);
                } else if !seen[q.index(board.size())] {
                    stack.push(q);
                }
            }
            borders.extend(&adjacent);
            internal += usize::from(adjacent.is_empty());
            opponent |= stone(board, p) == Stone::from_color(color.opponent());
            // Legacy V7 non-suicide rules: occupied opposing points do not
            // remove vital chains. Rules-v3 pass-alive override is not enabled.
            if stone(board, p).is_empty() {
                vital = Some(vital.map_or_else(
                    || adjacent.clone(),
                    |v| v.intersection(&adjacent).copied().collect(),
                ));
            }
        }
        regions.push((
            cells,
            borders,
            vital.unwrap_or_default(),
            internal,
            opponent,
        ));
    }
    let mut alive: BTreeSet<usize> = chains
        .iter()
        .enumerate()
        .filter(|(_, c)| c.color == color)
        .map(|(i, _)| i)
        .collect();
    loop {
        let dead: Vec<_> = alive
            .iter()
            .copied()
            .filter(|i| {
                regions
                    .iter()
                    .filter(|(_, border, vital, _, _)| {
                        border.is_subset(&alive) && vital.contains(i)
                    })
                    .count()
                    < 2
            })
            .collect();
        if dead.is_empty() {
            break;
        }
        for i in dead {
            alive.remove(&i);
        }
    }
    for i in &alive {
        for p in &chains[*i].stones {
            result[p.index(board.size())] = own;
        }
    }
    let has_own = chains.iter().any(|c| c.color == color);
    for (cells, border, _, internal, opponent) in regions {
        if has_own && ((!opponent) || (internal <= 1 && border.is_subset(&alive))) {
            for p in cells {
                result[p.index(board.size())] = own;
            }
        }
    }
}

fn ladder_play(
    board: &Board,
    p: Point,
    color: Color,
    ko: Option<Point>,
) -> Option<(Board, Option<Point>)> {
    if ko == Some(p) {
        return None;
    }
    let mut next = board.clone();
    let captures = next.place_with_captures(p, color).ok()?;
    let chain = next.chain_at(p)?;
    let ko = if captures.len() == 1 && chain.stones.len() == 1 && chain.liberties.len() == 1 {
        Some(captures[0])
    } else {
        None
    };
    Some((next, ko))
}

// A continuous-atari ladder search. Ko escapes belong to the defender.
fn captured(
    board: &Board,
    target: Point,
    defender: Color,
    defend: bool,
    ko: Option<Point>,
    depth: usize,
    budget: &mut usize,
) -> Result<bool, String> {
    if *budget == 0 || depth > 2 * usize::from(board.size()).pow(2) {
        return Err(
            "ladder feature search exceeded its safety bound; position not evaluated".into(),
        );
    }
    *budget -= 1;
    let Some(chain) = board.chain_at(target).filter(|c| c.color == defender) else {
        return Ok(true);
    };
    if (defend && chain.liberties.len() >= 2) || (!defend && chain.liberties.len() >= 3) {
        return Ok(false);
    }
    if !defend && chain.liberties.len() <= 1 {
        return Ok(true);
    }
    if defend && ko.is_some() {
        return Ok(false);
    }
    let mut moves: BTreeSet<Point> = chain.liberties.iter().copied().collect();
    if defend {
        for p in &chain.stones {
            for q in p.neighbors(board.size()) {
                if let Some(enemy) = board
                    .chain_at(q)
                    .filter(|c| c.color != defender && c.liberties.len() == 1)
                {
                    moves.insert(enemy.liberties[0]);
                }
            }
        }
    } else if chain.liberties.len() == 2 {
        let a = chain.liberties[0];
        let b = chain.liberties[1];
        if !a.neighbors(board.size()).any(|q| q == b) {
            let a_open = a
                .neighbors(board.size())
                .filter(|q| stone(board, *q).is_empty())
                .count();
            let b_open = b
                .neighbors(board.size())
                .filter(|q| stone(board, *q).is_empty())
                .count();
            if a_open >= 3 && b_open >= 3 {
                return Ok(false);
            }
            if a_open >= 3 {
                moves.remove(&b);
            }
            if b_open >= 3 {
                moves.remove(&a);
            }
        }
    }
    for p in moves {
        if let Some((next, next_ko)) = ladder_play(
            board,
            p,
            if defend {
                defender
            } else {
                defender.opponent()
            },
            ko,
        ) {
            let result = captured(&next, target, defender, !defend, next_ko, depth + 1, budget)?;
            if result != defend {
                return Ok(result);
            }
        }
    }
    Ok(defend)
}

fn ladders(
    board: &Board,
    opp: Color,
    out: &mut [f32],
    plane: usize,
    attacks: bool,
) -> Result<(), String> {
    for chain in board.all_chains() {
        let target = chain.stones[0];
        let mut working = Vec::new();
        let mut budget = 100_000;
        let caught = match chain.liberties.len() {
            1 => captured(board, target, chain.color, true, None, 0, &mut budget)?,
            2 => {
                for p in &chain.liberties {
                    if let Some((next, _)) = ladder_play(board, *p, chain.color.opponent(), None) {
                        if captured(&next, target, chain.color, true, None, 0, &mut budget)? {
                            working.push(*p);
                        }
                    }
                }
                !working.is_empty()
            }
            _ => false,
        };
        if caught {
            for p in &chain.stones {
                out[plane * NN_AREA + p.index(NN_LEN)] = 1.0;
            }
            if attacks && chain.color == opp {
                for p in working {
                    out[17 * NN_AREA + p.index(NN_LEN)] = 1.0;
                }
            }
        }
    }
    Ok(())
}

/// V7 normal-play features. Territory encore positions return an explicit error.
#[allow(clippy::too_many_lines)]
pub fn encode_v7(
    game: &GameState,
    rules: FeatureRules,
    komi: f32,
    conservative_pass: bool,
) -> Result<V7Features, String> {
    let board = game.board();
    if board.size() > NN_LEN || !komi.is_finite() {
        return Err("V7 requires a board at most 19 and finite komi".into());
    }
    if rules == FeatureRules::Japanese && game.consecutive_passes() >= 2 {
        return Err("Japanese encore is not implemented by the browser engine".into());
    }
    let mut f = V7Features {
        spatial: vec![0.0; 22 * NN_AREA],
        global: vec![0.0; 19],
        legal: Vec::new(),
    };
    let pla = game.to_play();
    for p in points(board) {
        let pos = p.index(NN_LEN);
        f.spatial[pos] = 1.0;
        if let Some(c) = stone(board, p).color() {
            f.spatial[(if c == pla { 1 } else { 2 }) * NN_AREA + pos] = 1.0;
        }
        let legality = game.clone().play(p);
        if matches!(
            legality,
            Err(CoreError::Superko(_) | CoreError::SimpleKo(_))
        ) {
            f.spatial[6 * NN_AREA + pos] = 1.0;
        }
        f.legal.push(legality.is_ok());
    }
    f.legal.push(true);
    for c in board.all_chains() {
        if (1..=3).contains(&c.liberties.len()) {
            for p in c.stones {
                f.spatial[(2 + c.liberties.len()) * NN_AREA + p.index(NN_LEN)] = 1.0;
            }
        }
    }
    let suppress =
        conservative_pass && game.consecutive_passes() >= 1 && rules != FeatureRules::Japanese;
    let count = if suppress {
        0
    } else if game.consecutive_passes() >= 2 {
        1
    } else {
        5
    };
    let count = count.min(game.moves().len());
    for (i, (_, p)) in game.moves().iter().rev().take(count).enumerate() {
        if let Some(p) = p {
            f.spatial[(9 + i) * NN_AREA + p.index(NN_LEN)] = 1.0;
        } else {
            f.global[i] = 1.0;
        }
    }
    ladders(board, pla.opponent(), &mut f.spatial, 14, true)?;
    ladders(
        game.recent_board(count.min(1)),
        pla.opponent(),
        &mut f.spatial,
        15,
        false,
    )?;
    ladders(
        game.recent_board(count.min(2)),
        pla.opponent(),
        &mut f.spatial,
        16,
        false,
    )?;
    if rules != FeatureRules::Japanese {
        let ownership = area(board);
        for p in points(board) {
            if let Some(c) = ownership[p.index(board.size())].color() {
                f.spatial[(if c == pla { 18 } else { 19 }) * NN_AREA + p.index(NN_LEN)] = 1.0;
            }
        }
    }
    let mut white_komi = komi;
    let mut black_setup = 0_u16;
    let mut white_setup = 0_u16;
    for p in points(game.initial_board()) {
        match stone(game.initial_board(), p) {
            Stone::Black => black_setup += 1,
            Stone::White => white_setup += 1,
            Stone::Empty => {}
        }
    }
    if rules == FeatureRules::Japanese {
        white_komi += f32::from(black_setup) - f32::from(white_setup);
        for (c, p) in game.moves() {
            if p.is_some() {
                white_komi += if *c == Color::Black { 1.0 } else { -1.0 };
            }
        }
        f.global[9] = 1.0;
        f.global[10] = 1.0;
    } else if black_setup > 1 && white_setup == 0 {
        white_komi += f32::from(black_setup);
    }
    let limit = f32::from(board.size()).powi(2) + 1.0;
    let self_komi =
        (white_komi * if pla == Color::White { 1.0 } else { -1.0 }).clamp(-limit, limit);
    f.global[5] = self_komi / 20.0;
    if rules == FeatureRules::ChineseOgs {
        f.global[6] = 1.0;
        f.global[7] = 0.5;
    }
    f.global[14] = f32::from(u8::from(game.consecutive_passes() >= 1 && !suppress));
    if rules != FeatureRules::Japanese {
        let parity = f32::from(board.size() % 2);
        let floor = ((self_komi - parity) / 2.0).floor() * 2.0 + parity;
        let delta = (self_komi - floor).clamp(0.0, 2.0);
        f.global[18] = if delta < 0.5 {
            delta
        } else if delta < 1.5 {
            1.0 - delta
        } else {
            delta - 2.0
        };
    }
    Ok(f)
}
