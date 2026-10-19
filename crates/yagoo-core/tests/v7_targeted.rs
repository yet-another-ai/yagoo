use serde::Deserialize;
use yagoo_core::{
    nn_features::{encode_v7, validate_history, FeatureRules},
    Color, GameState, Ruleset,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    size: u8,
    rules: String,
    komi: f32,
    initial: Vec<(String, String)>,
    moves: Vec<(String, String)>,
    to_play: String,
    expected: serde_json::Value,
    expected_reject: Option<String>,
    rejected_next: Option<(String, String)>,
}
fn color(s: &str) -> Color {
    if s == "B" {
        Color::Black
    } else {
        Color::White
    }
}

#[test]
fn official_cpp_ko_ladder_history_and_unsupported_boundaries() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("fixtures/v7-targeted.json")).unwrap();
    for f in cases {
        let rules = match f.rules.as_str() {
            "chinese" => FeatureRules::Chinese,
            "chinese-ogs" => FeatureRules::ChineseOgs,
            "japanese" => FeatureRules::Japanese,
            _ => panic!("rules"),
        };
        let mut game = GameState::new(
            f.size,
            if rules == FeatureRules::ChineseOgs {
                Ruleset::Chinese
            } else {
                Ruleset::Japanese
            },
        )
        .unwrap();
        for (c, p) in f.initial {
            game.setup_stone(
                yagoo_core::Point::parse_gtp(&p, f.size).unwrap().unwrap(),
                color(&c),
            )
            .unwrap();
        }
        game.set_to_play(color(&f.to_play));
        for (c, p) in f.moves {
            assert_eq!(game.to_play(), color(&c));
            game.play_gtp(&p).unwrap();
        }
        let result = encode_v7(&game, rules, f.komi, false);
        if let Some(message) = f.expected_reject {
            assert!(result.unwrap_err().contains(&message), "{}", f.name);
            continue;
        }
        let input = result.unwrap_or_else(|e| panic!("{}: {e}", f.name));
        let spatial: Vec<usize> = input
            .spatial
            .iter()
            .enumerate()
            .filter_map(|(i, v)| (*v != 0.0).then_some(i))
            .collect();
        let expected: Vec<usize> = serde_json::from_value(f.expected["spatial"].clone()).unwrap();
        assert_eq!(spatial, expected, "{} spatial", f.name);
        let global: Vec<f32> = serde_json::from_value(f.expected["globalInput"].clone()).unwrap();
        assert_eq!(input.global, global, "{} global", f.name);
        let legal: Vec<bool> = serde_json::from_value(f.expected["legal"].clone()).unwrap();
        assert_eq!(input.legal, legal, "{} legal", f.name);
        if let Some((c, p)) = f.rejected_next {
            assert_eq!(game.to_play(), color(&c));
            game.play_gtp(&p).unwrap();
            assert!(
                validate_history(&game, rules).is_err(),
                "{} must reject searched child",
                f.name
            );
        }
    }
}
