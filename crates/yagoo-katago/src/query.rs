//! Build Analysis Engine queries for a position.

use crate::types::{AnalysisQuery, MoveListEntry, OverrideSettings, PlayerToken};
use yagoo_core::{Color, GameState, Point};

/// Fluent builder for [`AnalysisQuery`].
#[derive(Clone, Debug)]
pub struct AnalysisQueryBuilder {
    query: AnalysisQuery,
}

impl AnalysisQueryBuilder {
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            query: AnalysisQuery {
                id: id.into(),
                initial_player: None,
                initial_stones: Vec::new(),
                moves: Vec::new(),
                rules: Some("chinese".into()),
                komi: Some(7.5),
                board_x_size: Some(19),
                board_y_size: Some(19),
                max_visits: Some(500),
                report_during_search_every: None,
                analysis_pv_len: None,
                include_ownership: Some(true),
                include_ownership_stdev: Some(true),
                include_moves_ownership: Some(true),
                include_moves_ownership_stdev: None,
                include_policy: Some(true),
                include_pv_visits: Some(true),
                avoid_moves: None,
                allow_moves: None,
                focus_moves: None,
                override_settings: None,
            },
        }
    }

    /// Board size (square).
    #[must_use]
    pub fn board_size(mut self, size: u8) -> Self {
        let s = u32::from(size);
        self.query.board_x_size = Some(s);
        self.query.board_y_size = Some(s);
        self
    }

    #[must_use]
    pub fn komi(mut self, komi: f64) -> Self {
        self.query.komi = Some(komi);
        self
    }

    #[must_use]
    pub fn rules(mut self, rules: impl Into<String>) -> Self {
        self.query.rules = Some(rules.into());
        self
    }

    #[must_use]
    pub fn max_visits(mut self, visits: u32) -> Self {
        self.query.max_visits = Some(visits);
        self
    }

    /// Emit during-search progress every `seconds` (KataGo analysis field).
    #[must_use]
    pub fn report_during_search_every(mut self, seconds: f64) -> Self {
        self.query.report_during_search_every = Some(seconds);
        self
    }

    #[must_use]
    pub fn include_moves_ownership(mut self, on: bool) -> Self {
        self.query.include_moves_ownership = Some(on);
        self
    }

    #[must_use]
    pub fn include_ownership(mut self, on: bool) -> Self {
        self.query.include_ownership = Some(on);
        self.query.include_ownership_stdev = Some(on);
        self
    }

    #[must_use]
    pub fn initial_player(mut self, color: Color) -> Self {
        self.query.initial_player = Some(PlayerToken::from_color(color));
        self
    }

    #[must_use]
    pub fn initial_stones(mut self, stones: Vec<(Color, Point)>) -> Self {
        let size = u8::try_from(self.query.board_x_size.unwrap_or(19)).unwrap_or(19);
        self.query.initial_stones = stones
            .into_iter()
            .map(|(c, p)| (PlayerToken::from_color(c), p.to_gtp(size)))
            .collect();
        self
    }

    #[must_use]
    pub fn moves_gtp(mut self, moves: Vec<MoveListEntry>) -> Self {
        self.query.moves = moves;
        self
    }

    /// Append a GTP move (or `"pass"`).
    #[must_use]
    pub fn push_move(mut self, color: Color, gtp: impl Into<String>) -> Self {
        self.query
            .moves
            .push((PlayerToken::from_color(color), gtp.into()));
        self
    }

    /// Append a pass probe move for the side that would play next.
    #[must_use]
    pub fn append_pass_probe(mut self, side_to_pass: Color) -> Self {
        self.query
            .moves
            .push((PlayerToken::from_color(side_to_pass), "pass".into()));
        self
    }

    #[must_use]
    pub fn include_moves_ownership_stdev(mut self, on: bool) -> Self {
        self.query.include_moves_ownership_stdev = Some(on);
        self
    }

    #[must_use]
    pub fn analysis_pv_len(mut self, len: u32) -> Self {
        self.query.analysis_pv_len = Some(len);
        self
    }

    #[must_use]
    pub fn allow_moves(mut self, value: serde_json::Value) -> Self {
        self.query.allow_moves = Some(value);
        self
    }

    #[must_use]
    pub fn avoid_moves(mut self, value: serde_json::Value) -> Self {
        self.query.avoid_moves = Some(value);
        self
    }

    #[must_use]
    pub fn focus_moves(mut self, value: serde_json::Value) -> Self {
        self.query.focus_moves = Some(value);
        self
    }

    #[must_use]
    pub fn override_settings(mut self, settings: OverrideSettings) -> Self {
        self.query.override_settings = Some(settings);
        self
    }

    /// Prefer black-positive winrates / ownership in engine reports.
    #[must_use]
    pub fn report_as_black(mut self) -> Self {
        let mut map = self.query.override_settings.take().unwrap_or_default();
        map.insert(
            "reportAnalysisWinratesAs".into(),
            serde_json::Value::String("BLACK".into()),
        );
        self.query.override_settings = Some(map);
        self
    }

    /// Fill stones currently on a [`GameState`] as `initialStones`, empty `moves`.
    #[must_use]
    pub fn from_game_state(mut self, game: &GameState) -> Self {
        let size = game.board().size();
        self = self.board_size(size).initial_player(game.to_play());
        let mut stones = Vec::new();
        for color in [Color::Black, Color::White] {
            for p in game.stones(color) {
                stones.push((color, p));
            }
        }
        self.initial_stones(stones)
    }

    #[must_use]
    pub fn build(self) -> AnalysisQuery {
        self.query
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_core::{GameState, Point, Ruleset};

    #[test]
    fn builds_teaching_defaults() {
        let q = AnalysisQueryBuilder::new("pos-1")
            .report_as_black()
            .max_visits(800)
            .push_move(Color::Black, "D4")
            .push_move(Color::White, "Q16")
            .build();
        assert_eq!(q.id, "pos-1");
        assert_eq!(q.max_visits, Some(800));
        assert_eq!(q.include_ownership, Some(true));
        assert_eq!(q.moves.len(), 2);
        let settings = q.override_settings.unwrap();
        assert_eq!(
            settings.get("reportAnalysisWinratesAs").unwrap().as_str(),
            Some("BLACK")
        );
    }

    #[test]
    fn from_game_state_lists_setup_stones() {
        let mut g = GameState::new(9, Ruleset::Chinese).unwrap();
        g.setup_stone(Point::new(2, 2), Color::Black).unwrap();
        g.set_to_play(Color::White);
        let q = AnalysisQueryBuilder::new("s").from_game_state(&g).build();
        assert_eq!(q.board_x_size, Some(9));
        assert_eq!(q.initial_player, Some(PlayerToken::W));
        assert_eq!(q.initial_stones.len(), 1);
        assert_eq!(q.moves.len(), 0);
    }
}
