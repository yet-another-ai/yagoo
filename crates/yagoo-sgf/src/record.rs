use yagoo_core::{Color, Point, Ruleset};

/// Stones placed before move 1 (`AB` / `AW`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SetupStones {
    pub black: Vec<Point>,
    pub white: Vec<Point>,
}

/// One main-line move (`B` or `W`). `point == None` is a pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MoveRecord {
    pub color: Color,
    pub point: Option<Point>,
}

/// Parsed game focused on root properties + main line.
#[derive(Clone, Debug, PartialEq)]
pub struct GameRecord {
    pub size: u8,
    pub komi: f64,
    pub rules: Option<String>,
    pub ruleset: Ruleset,
    pub handicap: Option<u8>,
    pub setup: SetupStones,
    /// Player to move after setup (usually Black; White after handicap placement
    /// when `HA` is set and only black setup stones are present).
    pub initial_player: Color,
    pub moves: Vec<MoveRecord>,
    pub application: Option<String>,
    pub player_black: Option<String>,
    pub player_white: Option<String>,
}

/// Raw tree node (root or move) used during parsing.
#[derive(Clone, Debug, Default)]
pub struct GameTreeNode {
    pub props: Vec<(String, Vec<String>)>,
    pub children: Vec<GameTreeNode>,
}

impl GameTreeNode {
    #[must_use]
    pub fn get(&self, ident: &str) -> Option<&[String]> {
        self.props
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(ident))
            .map(|(_, v)| v.as_slice())
    }

    #[must_use]
    pub fn get_one(&self, ident: &str) -> Option<&str> {
        self.get(ident)?.first().map(String::as_str)
    }
}
