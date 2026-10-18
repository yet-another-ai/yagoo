//! Legacy b18 area scoring, following upstream BoardHistory's TAX_NONE path.
use super::{Evaluation, FeatureRules, GameState};
use yagoo_core::{nn_features::area, Point, Stone};

pub(super) fn evaluate(
    game: &GameState,
    rules: FeatureRules,
    komi: f32,
) -> Result<Option<Evaluation>, String> {
    if game.consecutive_passes() < 2 {
        return Ok(None);
    }
    if rules == FeatureRules::Japanese {
        return Err("Japanese encore legality, features and territory scoring are not implemented; no final analysis produced".into());
    }
    if !komi.is_finite() {
        return Err("Terminal scoring requires finite komi".into());
    }
    let ownership: Vec<f64> = area(game.board())
        .iter()
        .map(|stone| match stone {
            Stone::Black => 1.0,
            Stone::White => -1.0,
            Stone::Empty => 0.0,
        })
        .collect();
    let mut black_setup = 0;
    let mut white_setup = 0;
    for y in 0..game.board().size() {
        for x in 0..game.board().size() {
            match game
                .initial_board()
                .get(Point::new(x, y))
                .expect("board point")
            {
                Stone::Black => black_setup += 1,
                Stone::White => white_setup += 1,
                Stone::Empty => {}
            }
        }
    }
    // Chinese and Chinese-OGS both use WHB_N. Consecutive black moves are
    // rejected by replay, matching the oracle's explicit handicap inference mode.
    let bonus = if white_setup == 0 && black_setup > 1 {
        f64::from(black_setup)
    } else {
        0.0
    };
    let lead = ownership.iter().sum::<f64>() - f64::from(komi) - bonus;
    let winrate = if lead > 0.0 {
        1.0
    } else if lead < 0.0 {
        0.0
    } else {
        0.5
    };
    Ok(Some(Evaluation {
        policy: vec![0.0; ownership.len() + 1],
        ownership,
        lead,
        winrate,
        raw: None,
    }))
}
