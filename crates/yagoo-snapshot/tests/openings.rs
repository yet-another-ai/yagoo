use serde::Deserialize;
use yagoo_core::{Color, GameState, Point, Ruleset};
use yagoo_snapshot::{match_opening, GameSnapshot, OpeningMatch, PipelineEvent};

#[derive(Deserialize)]
struct Case {
    description: String,
    moves: Vec<(String, Option<[u8; 2]>)>,
    name: Option<String>,
    joseki: Option<String>,
    deviation: Option<u32>,
}

fn oriented([mut x, mut y]: [u8; 2], symmetry: u8) -> Point {
    if symmetry >= 4 {
        x = 18 - x;
    }
    for _ in 0..symmetry % 4 {
        (x, y) = (18 - y, x);
    }
    Point::new(x, y)
}

#[test]
fn shared_cases_cover_all_eight_symmetries_and_both_colors() {
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("../../../data/openings-cases.json")).unwrap();
    for case in cases {
        for symmetry in 0..8 {
            for swap in [false, true] {
                let moves: Vec<_> = case
                    .moves
                    .iter()
                    .map(|(color, point)| {
                        (
                            if (color == "B") == swap {
                                Color::White
                            } else {
                                Color::Black
                            },
                            point.map(|p| oriented(p, symmetry)),
                        )
                    })
                    .collect();
                let actual = match_opening(19, false, &moves);
                assert_eq!(
                    actual.as_ref().map(|m| &m.name),
                    case.name.as_ref(),
                    "{} / symmetry {symmetry} / swapped {swap}",
                    case.description,
                );
                if let Some(actual) = actual {
                    assert_eq!(actual.joseki, case.joseki, "{}", case.description);
                    assert_eq!(actual.deviation_ply, case.deviation, "{}", case.description);
                    assert_eq!(actual.source, "yagoo-starter-1 (Apache-2.0)");
                }
            }
        }
    }
}

#[test]
fn every_catalogue_line_is_legal_and_recognized() {
    let book: serde_json::Value =
        serde_json::from_str(include_str!("../../../data/openings.json")).unwrap();
    for line in book["lines"].as_array().unwrap() {
        let raw: Vec<(String, u8, u8)> = serde_json::from_value(line["moves"].clone()).unwrap();
        let moves: Vec<_> = raw
            .iter()
            .map(|(c, x, y)| {
                (
                    if c == "B" { Color::Black } else { Color::White },
                    Some(Point::new(*x, *y)),
                )
            })
            .collect();
        let mut game = GameState::new(19, Ruleset::Chinese).unwrap();
        for (color, point) in &moves {
            assert_eq!(game.to_play(), *color);
            game.play(point.unwrap()).unwrap();
        }
        let matched = match_opening(19, false, &moves).unwrap();
        assert_eq!(matched.name, line["name"].as_str().unwrap());
        assert_eq!(matched.joseki.as_deref(), line["joseki"].as_str());
    }
}

#[test]
fn setup_size_invalid_points_and_horizon_are_conservative() {
    let moves = [
        (Color::Black, Some(Point::new(3, 2))),
        (Color::White, Some(Point::new(5, 2))),
        (Color::Black, Some(Point::new(4, 3))),
    ];
    assert!(match_opening(19, true, &moves).is_none());
    assert!(match_opening(9, false, &moves).is_none());
    assert!(match_opening(19, false, &[(Color::Black, Some(Point::new(19, 3)))]).is_none());
    let mut late = vec![(Color::Black, Some(Point::new(9, 9))); 30];
    late.extend(moves);
    assert!(match_opening(19, false, &late).is_none());
}

#[test]
fn opening_wire_roundtrips_and_old_aggregate_remains_readable() {
    let event = PipelineEvent::OpeningMatched {
        v: 1,
        match_: Some(OpeningMatch {
            name: "4-4 point".into(),
            joseki: Some("3-3 invasion: block and extend".into()),
            deviation_ply: Some(6),
            source: "yagoo-starter-1 (Apache-2.0)".into(),
        }),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"type\":\"openingMatched\""));
    assert!(json.contains("\"deviationPly\":6"));
    assert_eq!(serde_json::from_str::<PipelineEvent>(&json).unwrap(), event);
    let old = r#"{"schemaVersion":1,"size":19,"komi":7.5,"ownershipConvention":"black_positive","positions":[]}"#;
    assert!(serde_json::from_str::<GameSnapshot>(old)
        .unwrap()
        .opening
        .is_none());
}
