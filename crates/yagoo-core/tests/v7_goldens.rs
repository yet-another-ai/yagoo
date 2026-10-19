use serde::Deserialize;
use yagoo_core::{
    nn_features::{encode_v7, FeatureRules},
    GameState, Point, Ruleset,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    size: u8,
    rules: String,
    komi: f32,
    moves: Vec<Option<[u8; 2]>>,
    spatial: Vec<usize>,
    global_input: Vec<f32>,
}

#[test]
fn matches_upstream_v7_goldens() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/v7.json")).unwrap();
    for f in fixtures {
        let (rules, feature_rules) = match f.rules.as_str() {
            "chinese" => (Ruleset::Japanese, FeatureRules::Chinese),
            "chinese-ogs" => (Ruleset::Chinese, FeatureRules::ChineseOgs),
            "japanese" => (Ruleset::Japanese, FeatureRules::Japanese),
            _ => panic!("unexpected fixture rules"),
        };
        let mut game = GameState::new(f.size, rules).unwrap();
        for mv in f.moves {
            if let Some([x, y]) = mv {
                game.play(Point::new(x, y)).unwrap();
            } else {
                game.play_pass().unwrap();
            }
        }
        let actual = encode_v7(&game, feature_rules, f.komi, false).unwrap();
        let spatial: Vec<_> = actual
            .spatial
            .iter()
            .enumerate()
            .filter_map(|(i, v)| (*v != 0.0).then_some(i))
            .collect();
        assert_eq!(spatial, f.spatial, "{} spatial", f.name);
        assert_eq!(actual.global, f.global_input, "{} global", f.name);
    }
}
