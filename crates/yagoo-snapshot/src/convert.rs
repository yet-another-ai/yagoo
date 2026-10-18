//! Convert engine / board state into snapshot schema.

use crate::schema::{BoardSnapshot, CandidateSnapshot, ChainSnapshot, ColorToken, EngineAnalysis};
use yagoo_core::{Color, GameState, Stone};
use yagoo_katago::{AnalysisResponse, MoveInfo, RootInfo};

#[must_use]
pub fn board_from_game(game: &GameState) -> BoardSnapshot {
    let size = game.board().size();
    let mut black = Vec::new();
    let mut white = Vec::new();
    for y in 0..size {
        for x in 0..size {
            let p = yagoo_core::Point::new(x, y);
            match game.board().get(p).ok().and_then(Stone::color) {
                Some(Color::Black) => black.push(p.to_gtp(size)),
                Some(Color::White) => white.push(p.to_gtp(size)),
                None => {}
            }
        }
    }
    BoardSnapshot { size, black, white }
}

#[must_use]
pub fn chains_from_game(game: &GameState) -> Vec<ChainSnapshot> {
    let size = game.board().size();
    game.board()
        .all_chains()
        .into_iter()
        .map(|c| ChainSnapshot {
            color: ColorToken::from(c.color),
            stones: c.stones.iter().map(|p| p.to_gtp(size)).collect(),
            liberties: c.liberties.iter().map(|p| p.to_gtp(size)).collect(),
            liberty_count: c.liberty_count(),
        })
        .collect()
}

#[must_use]
pub fn engine_from_root(root: &RootInfo, policy_fallback: Option<&[f64]>) -> EngineAnalysis {
    EngineAnalysis {
        visits: root.visits,
        winrate: root.winrate,
        score_lead: root.score_lead,
        score_stdev: None,
        utility: root.utility,
        ownership: root.ownership.clone(),
        ownership_stdev: root.ownership_stdev.clone(),
        policy: root
            .policy
            .clone()
            .or_else(|| policy_fallback.map(<[f64]>::to_vec)),
    }
}

#[must_use]
pub fn engine_from_response(resp: &AnalysisResponse) -> Option<EngineAnalysis> {
    resp.root_info
        .as_ref()
        .map(|r| engine_from_root(r, resp.policy.as_deref()))
}

#[must_use]
pub fn candidates_from_response(resp: &AnalysisResponse, top_k: usize) -> Vec<CandidateSnapshot> {
    let Some(infos) = resp.move_infos.as_ref() else {
        return Vec::new();
    };
    infos
        .iter()
        .take(top_k)
        .map(candidate_from_move_info)
        .collect()
}

#[must_use]
pub fn candidate_from_move_info(m: &MoveInfo) -> CandidateSnapshot {
    CandidateSnapshot {
        move_: m.move_.clone(),
        order: m.order,
        visits: m.visits,
        winrate: m.winrate,
        score_lead: m.score_lead,
        score_stdev: m.score_stdev,
        prior: m.prior,
        utility: m.utility,
        lcb: m.lcb,
        pv: m.pv.clone(),
        pv_visits: m.pv_visits.clone(),
        ownership: m.ownership.clone(),
        ownership_stdev: m.ownership_stdev.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_core::{GameState, Point, Ruleset};
    use yagoo_katago::AnalysisClient;

    #[test]
    fn board_and_chains_roundtrip_shapes() {
        let mut g = GameState::new(9, Ruleset::Chinese).unwrap();
        g.setup_stone(Point::new(2, 2), Color::Black).unwrap();
        g.setup_stone(Point::new(3, 2), Color::Black).unwrap();
        let board = board_from_game(&g);
        assert_eq!(board.black.len(), 2);
        let chains = chains_from_game(&g);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].stones.len(), 2);
        assert_eq!(chains[0].liberty_count, 6);
    }

    #[test]
    fn engine_from_fixture() {
        let json = r#"{
          "id":"t","rootInfo":{"visits":500,"ownership":[0.1,-0.2],
          "ownershipStdev":[0.05,0.1],"winrate":0.5,"scoreLead":1.0},
          "moveInfos":[{"move":"D4","visits":10,"order":0,"ownership":[0.2]}]
        }"#;
        let resp = AnalysisClient::parse_response(json).unwrap();
        let eng = engine_from_response(&resp).unwrap();
        assert_eq!(eng.visits, Some(500));
        assert_eq!(eng.ownership.as_ref().unwrap().len(), 2);
        let cands = candidates_from_response(&resp, 8);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].move_, "D4");
    }
}
