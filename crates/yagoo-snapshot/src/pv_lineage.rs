//! Track original root stones through a legal PV without confusing replacements
//! at the same coordinate with surviving stones.
use crate::{board_from_game, BoardSnapshot, CandidateSnapshot, ColorToken};
use serde::{Deserialize, Serialize};
use yagoo_core::{GameState, Point, Stone};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootStoneCapture {
    pub color: ColorToken,
    pub stone: String,
    /// One-based number of PV moves already played.
    pub ply_offset: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidatePvLineage {
    pub root_ply: u32,
    #[serde(rename = "move")]
    pub move_: String,
    pub pv: Vec<String>,
    pub board: BoardSnapshot,
    pub captures: Vec<RootStoneCapture>,
}

/// The caller supplies the complete historical root, including ko and setup.
/// Invalid/truncated-at-an-illegal-move PVs produce no lineage.
#[must_use]
pub fn trace_candidate_pv(
    root_ply: u32,
    root: &GameState,
    candidate: &CandidateSnapshot,
) -> Option<CandidatePvLineage> {
    let pv = candidate
        .pv
        .as_ref()
        .filter(|pv| pv.first() == Some(&candidate.move_))?;
    let size = root.board().size();
    let board = board_from_game(root);
    let mut original = Vec::new();
    for (color, stones) in [(ColorToken::B, board.black), (ColorToken::W, board.white)] {
        for stone in stones {
            original.push((color, Point::parse_gtp(&stone, size).ok()??, stone));
        }
    }
    let mut state = root.clone();
    let mut captures = Vec::new();
    for (index, move_) in pv.iter().enumerate() {
        if move_.eq_ignore_ascii_case("pass") {
            state.play_pass().ok()?;
        } else {
            if !move_.is_ascii()
                || !move_
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphabetic)
            {
                return None;
            }
            state.play(Point::parse_gtp(move_, size).ok()??).ok()?;
        }
        original.retain(|(color, point, stone)| {
            let present = state
                .board()
                .get(*point)
                .ok()
                .and_then(Stone::color)
                .map(ColorToken::from)
                == Some(*color);
            if !present {
                captures.push(RootStoneCapture {
                    color: *color,
                    stone: stone.clone(),
                    ply_offset: index + 1,
                });
            }
            present
        });
    }
    Some(CandidatePvLineage {
        root_ply,
        move_: candidate.move_.clone(),
        pv: pv.clone(),
        board: board_from_game(&state),
        captures,
    })
}
