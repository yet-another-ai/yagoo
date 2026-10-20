//! Small, engine-independent opening catalogue. See `data/OPENINGS_PROVENANCE.md`.

use crate::OpeningMatch;
use serde::Deserialize;
use std::sync::OnceLock;
use yagoo_core::{Color, Point};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalogue {
    source: String,
    board_size: u8,
    corner_size: u8,
    max_ply: usize,
    lines: Vec<Line>,
}

#[derive(Deserialize)]
struct Line {
    id: String,
    name: String,
    joseki: Option<String>,
    kind: String,
    minimum: usize,
    moves: Vec<(String, u8, u8)>,
}

fn catalogue() -> &'static Catalogue {
    static BOOK: OnceLock<Catalogue> = OnceLock::new();
    BOOK.get_or_init(|| {
        serde_json::from_str(include_str!("../../../data/openings.json"))
            .expect("the bundled opening catalogue is valid JSON")
    })
}

fn transform(mut x: u8, mut y: u8, size: u8, symmetry: u8) -> (u8, u8) {
    if symmetry >= 4 {
        x = size - 1 - x;
    }
    for _ in 0..symmetry % 4 {
        (x, y) = (size - 1 - y, x);
    }
    (x, y)
}

struct Candidate<'a> {
    line: &'a Line,
    matched: usize,
    deviation: Option<u32>,
}

/// Recognize one conservative label in an empty-start game.
///
/// Pass actual played colors and points (not board occupancy). Setup/handicap
/// records must set `has_setup`; their initial positions are outside this book.
/// Corner moves may be interleaved with play elsewhere. Equal-best lines are
/// deliberately unlabelled, and reaching a catalogue leaf is not a deviation.
#[must_use]
pub fn match_opening(
    size: u8,
    has_setup: bool,
    moves: &[(Color, Option<Point>)],
) -> Option<OpeningMatch> {
    let book = catalogue();
    if size != book.board_size || has_setup {
        return None;
    }
    // Reject invalid coordinates before the symmetry arithmetic.
    if moves
        .iter()
        .take(book.max_ply)
        .any(|(_, p)| p.is_some_and(|p| p.x >= size || p.y >= size))
    {
        return None;
    }
    for kind in ["fuseki", "joseki"] {
        let mut candidates = Vec::new();
        for line in book.lines.iter().filter(|line| line.kind == kind) {
            for symmetry in 0..8 {
                for swap in [false, true] {
                    let mut matched = 0;
                    let mut deviation = None;
                    for (i, (color, point)) in moves.iter().take(book.max_ply).enumerate() {
                        if matched == line.moves.len() {
                            break;
                        }
                        let Some(point) = point else {
                            // A pass has no corner location; stop local observation.
                            if kind == "fuseki" {
                                deviation = u32::try_from(i + 1).ok();
                            }
                            break;
                        };
                        let (x, y) = transform(point.x, point.y, size, symmetry);
                        if kind == "joseki" && (x >= book.corner_size || y >= book.corner_size) {
                            continue;
                        }
                        let expected = &line.moves[matched];
                        let black = (*color == Color::Black) != swap;
                        if black == (expected.0 == "B") && (x, y) == (expected.1, expected.2) {
                            matched += 1;
                        } else {
                            deviation = u32::try_from(i + 1).ok();
                            break;
                        }
                    }
                    if matched >= line.minimum {
                        candidates.push(Candidate {
                            line,
                            matched,
                            deviation,
                        });
                    }
                }
            }
        }
        let Some(best_length) = candidates.iter().map(|c| c.matched).max() else {
            continue;
        };
        let best: Vec<_> = candidates
            .iter()
            .filter(|c| c.matched == best_length)
            .collect();
        let first = best[0];
        if best.iter().any(|c| c.line.id != first.line.id) {
            continue;
        }
        // Equivalent orientations may not yet disambiguate a continuation.
        // Only report deviation when every equal-best interpretation agrees.
        let deviation = if best.iter().all(|c| c.deviation == first.deviation) {
            first.deviation
        } else {
            None
        };
        return Some(OpeningMatch {
            name: first.line.name.clone(),
            joseki: first.line.joseki.clone(),
            deviation_ply: deviation,
            source: book.source.clone(),
        });
    }
    None
}
