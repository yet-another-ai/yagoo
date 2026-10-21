//! The pipeline uses only a current-player allowlist at depth one.
//! Reject other restriction forms rather than silently broadening their scope.
use super::{encode_v7, AnalysisQuery, FeatureRules, GameState, PlayerToken, Point};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootAllowMoves {
    player: PlayerToken,
    moves: Vec<String>,
    until_depth: u32,
}

pub(super) fn root_mask(
    query: &AnalysisQuery,
    game: &GameState,
    rules: FeatureRules,
    komi: f32,
) -> Result<Option<Vec<bool>>, String> {
    let Some(value) = &query.allow_moves else {
        return Ok(None);
    };
    let mut entries: Vec<RootAllowMoves> = serde_json::from_value(value.clone())
        .map_err(|error| format!("Invalid root allowMoves: {error}"))?;
    if entries.len() != 1 {
        return Err("Browser allowMoves requires exactly one current-player record".into());
    }
    let entry = entries.remove(0);
    if entry.player != PlayerToken::from_color(game.to_play()) || entry.until_depth != 1 {
        return Err(
            "Browser allowMoves supports only the current root player and untilDepth=1".into(),
        );
    }
    if entry.moves.is_empty() || game.consecutive_passes() >= 2 {
        return Err("Root allowMoves requires moves in a nonterminal position".into());
    }
    let size = game.board().size();
    let area = usize::from(size).pow(2);
    let legal = encode_v7(game, rules, komi, false)?.legal;
    let mut mask = vec![false; area + 1];
    for coordinate in &entry.moves {
        let coordinate = coordinate.trim();
        // Guard the general parser's single-letter arithmetic before using it.
        if !coordinate.is_ascii()
            || !coordinate
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
        {
            return Err("Invalid coordinate in root allowMoves".into());
        }
        let point = Point::parse_gtp(coordinate, size).map_err(|error| error.to_string())?;
        let index = point.map_or(area, |point| point.index(size));
        mask[index] = legal[index];
    }
    if !mask.iter().any(|allowed| *allowed) {
        return Err("Root allowMoves contains no legal moves".into());
    }
    Ok(Some(mask))
}
