//! Convert engine / board state into snapshot schema.

use crate::schema::{BoardSnapshot, CandidateSnapshot, ChainSnapshot, ColorToken, EngineAnalysis};
use yagoo_core::{Color, GameState, Stone};
use yagoo_katago::{AnalysisResponse, MoveInfo};

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

/// Build [`EngineAnalysis`] from a full Analysis Engine response.
///
/// Root scalars come from `rootInfo`; ownership / ownershipStdev / policy are
/// read from the **top level** of the response (KataGo protocol).
#[must_use]
pub fn engine_from_response(resp: &AnalysisResponse) -> Option<EngineAnalysis> {
    let root = resp.root_info.as_ref()?;
    Some(EngineAnalysis {
        visits: root.visits,
        winrate: root.winrate,
        score_lead: root.score_lead,
        score_stdev: None,
        utility: root.utility,
        ownership: resp.ownership.clone(),
        ownership_stdev: resp.ownership_stdev.clone(),
        policy: resp.policy.clone(),
        neural: resp.neural.clone(),
    })
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
          "id":"t",
          "rootInfo":{"visits":500,"winrate":0.5,"scoreLead":1.0},
          "ownership":[0.1,-0.2],
          "ownershipStdev":[0.05,0.1],
          "policy":[0.2,0.3,0.5],
          "moveInfos":[{"move":"D4","visits":10,"order":0,"ownership":[0.2]}]
        }"#;
        let resp = AnalysisClient::parse_response(json).unwrap();
        let eng = engine_from_response(&resp).unwrap();
        assert_eq!(eng.visits, Some(500));
        assert_eq!(eng.ownership.as_ref().unwrap().len(), 2);
        assert_eq!(eng.ownership_stdev.as_ref().unwrap().len(), 2);
        assert_eq!(eng.policy.as_ref().unwrap().len(), 3);
        let cands = candidates_from_response(&resp, 8);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].move_, "D4");
    }

    #[test]
    fn ownership_nested_under_root_info_is_ignored() {
        // Realistic mistake: nesting ownership in rootInfo (not KataGo's layout).
        let json = r#"{
          "id":"t",
          "rootInfo":{"visits":10,"winrate":0.5,"scoreLead":0.0,
            "ownership":[0.9,0.9],"ownershipStdev":[0.1,0.1],"policy":[1.0]},
          "moveInfos":[]
        }"#;
        let resp = AnalysisClient::parse_response(json).unwrap();
        let eng = engine_from_response(&resp).unwrap();
        assert!(eng.ownership.is_none());
        assert!(eng.ownership_stdev.is_none());
        assert!(eng.policy.is_none());
        // Nested arrays land in rootInfo's unknown extras only if RootInfo
        // used flatten; without that they are dropped by serde — either way
        // they must not appear on EngineAnalysis.
        assert!(resp.ownership.is_none());
    }

    #[test]
    fn neural_sample_survives_snapshot_conversion_without_activations() {
        let raw = serde_json::json!({ "id": "p0-pass", "rootInfo": {"visits": 1},
            "neural": { "sampleToPlay": "W", "sampleSymmetry": "identity", "aggregation": "none", "tensorLayout": "CHW",
                "boardSize": 9, "modelBoardSize": 19, "scoreBeliefLogProbs": vec![-(842.0_f32).ln(); 842],
                "scoreBinFirstCenter": -420.5, "sekiLogits": vec![0.0; 1444], "futurePositionPreTanh": vec![0.0; 722] } });
        let response: AnalysisResponse = serde_json::from_value(raw).unwrap();
        let snapshot = engine_from_response(&response).unwrap();
        assert_eq!(snapshot.neural, response.neural);
        let encoded = serde_json::to_string(&snapshot).unwrap();
        assert!(encoded.contains("sampleToPlay"));
        assert!(!encoded.contains("trunk"));
        let decoded: EngineAnalysis = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, snapshot);
    }
}
