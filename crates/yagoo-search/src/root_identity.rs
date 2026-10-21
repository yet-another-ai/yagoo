//! Browser-only root identity, independent of query IDs and search controls.
//!
//! The v1 byte layout is domain, size, feature/core rules, big-endian f64 komi
//! bits, setup cells/player, big-endian u64 move count, colored tagged moves,
//! current cells/player, tagged ko point, and consecutive passes. Cells are
//! row-major (empty=0, Black=1, White=2); points are tagged 0=None or 1,x,y.
//! Complete history retains superko and pass context without relying on the
//! core's positional hash. This digest is not a native KataGo hash.

use sha2::{Digest, Sha256};
use yagoo_core::{nn_features::FeatureRules, Board, Color, GameState, Point, Ruleset, Stone};

const DOMAIN: &[u8] = b"yagoo-browser-root-v1\0";
const PREFIX: &str = "yagoo-browser-root-v1:";

pub(super) fn root_identity(
    game: &GameState,
    rules: FeatureRules,
    komi: f64,
) -> Result<String, String> {
    if !komi.is_finite() {
        return Err("Root identity requires finite komi".into());
    }
    let mut digest = Sha256::new();
    digest.update(DOMAIN);
    digest.update([
        game.board().size(),
        match rules {
            FeatureRules::Chinese => 0,
            FeatureRules::ChineseOgs => 1,
            FeatureRules::Japanese => 2,
        },
        match game.rules() {
            Ruleset::Chinese => 0,
            Ruleset::Japanese => 1,
        },
    ]);
    let normalized_komi = if komi == 0.0 { 0.0 } else { komi };
    digest.update(normalized_komi.to_bits().to_be_bytes());
    hash_board(&mut digest, game.initial_board())?;
    digest.update([color_byte(game.initial_player())]);
    let move_count = u64::try_from(game.moves().len()).map_err(|error| error.to_string())?;
    digest.update(move_count.to_be_bytes());
    for &(color, point) in game.moves() {
        digest.update([color_byte(color)]);
        hash_point(&mut digest, point);
    }
    hash_board(&mut digest, game.board())?;
    digest.update([color_byte(game.to_play())]);
    hash_point(&mut digest, game.ko_point());
    digest.update([game.consecutive_passes()]);
    Ok(format!("{PREFIX}{:x}", digest.finalize()))
}

fn color_byte(color: Color) -> u8 {
    match color {
        Color::Black => 1,
        Color::White => 2,
    }
}

fn hash_board(digest: &mut Sha256, board: &Board) -> Result<(), String> {
    for y in 0..board.size() {
        for x in 0..board.size() {
            let cell = match board
                .get(Point::new(x, y))
                .map_err(|error| error.to_string())?
            {
                Stone::Empty => 0,
                Stone::Black => 1,
                Stone::White => 2,
            };
            digest.update([cell]);
        }
    }
    Ok(())
}

fn hash_point(digest: &mut Sha256, point: Option<Point>) {
    if let Some(point) = point {
        digest.update([1, point.x, point.y]);
    } else {
        digest.update([0]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_katago::{AnalysisQuery, AnalysisQueryBuilder, PlayerToken};

    fn query_identity(query: &AnalysisQuery) -> String {
        let (game, rules) = crate::replay(query).unwrap();
        root_identity(&game, rules, query.komi.unwrap_or(7.5)).unwrap()
    }

    #[test]
    fn canonical_empty_root_has_a_stable_digest() {
        let game = GameState::new(2, Ruleset::Japanese).unwrap();
        assert_eq!(
            root_identity(&game, FeatureRules::Chinese, 7.5).unwrap(),
            "yagoo-browser-root-v1:6c3c8e964ce8ff6d851703b15b074f0bb2499fc23016caf545e3b1460316c899"
        );
    }

    #[test]
    fn replay_normalizes_setup_order_spelling_defaults_and_search_controls() {
        let original = AnalysisQueryBuilder::new("original")
            .board_size(9)
            .rules("chinese")
            .initial_player(Color::White)
            .initial_stones(vec![
                (Color::Black, Point::new(0, 0)),
                (Color::White, Point::new(8, 8)),
            ])
            .push_move(Color::White, "D4")
            .push_move(Color::Black, "pass")
            .build();
        let mut equivalent = original.clone();
        equivalent.id = "another-budget-and-output".into();
        equivalent.max_visits = Some(999);
        equivalent.include_moves_ownership = Some(false);
        equivalent.include_policy = Some(false);
        equivalent.analysis_pv_len = Some(1);
        equivalent.rules = None;
        equivalent.komi = None;
        equivalent.initial_stones.reverse();
        equivalent.initial_stones[0].1.make_ascii_lowercase();
        equivalent.moves = vec![
            (PlayerToken::W, "d4".into()),
            (PlayerToken::B, "PASS".into()),
        ];
        assert_eq!(query_identity(&original), query_identity(&equivalent));

        let japanese = AnalysisQueryBuilder::new("japanese")
            .rules("japanese")
            .build();
        let mut korean = japanese.clone();
        korean.rules = Some("KOREAN".into());
        assert_eq!(query_identity(&japanese), query_identity(&korean));
    }

    #[test]
    fn complete_history_distinguishes_transpositions_with_identical_current_boards() {
        let mut first = GameState::new(9, Ruleset::Japanese).unwrap();
        let mut second = first.clone();
        for point in ["A1", "J9", "B1", "J8"] {
            first.play_gtp(point).unwrap();
        }
        for point in ["B1", "J8", "A1", "J9"] {
            second.play_gtp(point).unwrap();
        }
        assert_eq!(first.board(), second.board());
        assert_eq!(first.to_play(), second.to_play());
        assert_eq!(first.ko_point(), second.ko_point());
        assert_ne!(
            root_identity(&first, FeatureRules::Chinese, 7.5).unwrap(),
            root_identity(&second, FeatureRules::Chinese, 7.5).unwrap()
        );
    }

    #[test]
    fn rules_komi_setup_and_player_are_part_of_identity() {
        let game = GameState::new(9, Ruleset::Japanese).unwrap();
        let original = root_identity(&game, FeatureRules::Chinese, 7.5).unwrap();
        for rules in [FeatureRules::ChineseOgs, FeatureRules::Japanese] {
            assert_ne!(root_identity(&game, rules, 7.5).unwrap(), original);
        }
        let other_core_rules = GameState::new(9, Ruleset::Chinese).unwrap();
        assert_ne!(
            root_identity(&other_core_rules, FeatureRules::Chinese, 7.5).unwrap(),
            original
        );
        // Preserve the query's full komi precision, not only its f32 neural input.
        let adjacent_komi = f64::from_bits(7.5_f64.to_bits() + 1);
        assert_ne!(
            root_identity(&game, FeatureRules::Chinese, adjacent_komi).unwrap(),
            original
        );
        let mut white = game.clone();
        white.set_to_play(Color::White);
        assert_ne!(
            root_identity(&white, FeatureRules::Chinese, 7.5).unwrap(),
            original
        );
        let mut setup = game.clone();
        setup.setup_stone(Point::new(0, 0), Color::Black).unwrap();
        assert_ne!(
            root_identity(&setup, FeatureRules::Chinese, 7.5).unwrap(),
            original
        );
        let smaller = GameState::new(8, Ruleset::Japanese).unwrap();
        assert_ne!(
            root_identity(&smaller, FeatureRules::Chinese, 7.5).unwrap(),
            original
        );
    }

    #[test]
    fn pass_history_and_ko_cannot_alias_a_fresh_setup_of_the_same_board() {
        let mut game = GameState::new(5, Ruleset::Japanese).unwrap();
        let before = root_identity(&game, FeatureRules::Chinese, 7.5).unwrap();
        game.play_pass().unwrap();
        game.play_pass().unwrap();
        assert_eq!(game.to_play(), Color::Black);
        assert_eq!(game.board(), game.initial_board());
        assert_ne!(
            root_identity(&game, FeatureRules::Chinese, 7.5).unwrap(),
            before
        );

        let mut ko = GameState::new(5, Ruleset::Japanese).unwrap();
        for (color, points) in [
            (Color::Black, vec![(2, 1), (1, 2), (2, 3), (3, 2)]),
            (Color::White, vec![(3, 1), (4, 2), (3, 3)]),
        ] {
            for (x, y) in points {
                ko.setup_stone(Point::new(x, y), color).unwrap();
            }
        }
        ko.set_to_play(Color::White);
        ko.play(Point::new(2, 2)).unwrap();
        assert_eq!(ko.ko_point(), Some(Point::new(3, 2)));
        let mut fresh = ko.clone();
        fresh.set_to_play(ko.to_play());
        assert_eq!(fresh.board(), ko.board());
        assert_eq!(fresh.to_play(), ko.to_play());
        assert_eq!(fresh.ko_point(), None);
        assert_ne!(
            root_identity(&ko, FeatureRules::Chinese, 7.5).unwrap(),
            root_identity(&fresh, FeatureRules::Chinese, 7.5).unwrap()
        );
    }

    #[test]
    fn zero_is_normalized_and_nonfinite_komi_is_rejected() {
        let game = GameState::new(9, Ruleset::Japanese).unwrap();
        assert_eq!(
            root_identity(&game, FeatureRules::Chinese, 0.0).unwrap(),
            root_identity(&game, FeatureRules::Chinese, -0.0).unwrap()
        );
        for komi in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(root_identity(&game, FeatureRules::Chinese, komi).is_err());
        }
    }
}
