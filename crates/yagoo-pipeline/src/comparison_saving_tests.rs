//! Constructed collection/legality tests, not engine calibration recordings.
use super::*;
use crate::UpdateCallback;
use futures::future::LocalBoxFuture;
use std::sync::Mutex;
use yagoo_core::{Color, Ruleset};
use yagoo_katago::{AnalysisUpdate, KatagoError, KatagoResult};
use yagoo_snapshot::RootStoneCapture;

fn point(gtp: &str, size: u8) -> Point {
    Point::parse_gtp(gtp, size).unwrap().unwrap()
}

fn candidate(move_: &str, pv: &[&str], size: u8) -> CandidateSnapshot {
    serde_json::from_value(serde_json::json!({
        "move": move_, "visits":64, "order":0, "winrate":0.5, "scoreLead":0.0,
        "ownership":vec![0.0; usize::from(size).pow(2)], "pv":pv,
    }))
    .unwrap()
}

fn group(color: ColorToken, stones: &[&str]) -> GroupSnapshot {
    let (black, white) = if color == ColorToken::B {
        (stones, &[][..])
    } else {
        (&[][..], stones)
    };
    serde_json::from_value(serde_json::json!({
        "groupId":stones[0], "kind":"simple",
        "members":{"blackStones":black,"whiteStones":white,"empty":[]},
    }))
    .unwrap()
}

fn two_liberty_position() -> (
    GameState,
    GroupSnapshot,
    CandidateSnapshot,
    CandidatePvLineage,
) {
    let mut root = GameState::new(5, Ruleset::Chinese).unwrap();
    for (color, stones) in [
        (Color::Black, vec!["B2", "C2"]),
        (Color::White, vec!["A2", "B1", "C1", "D2"]),
    ] {
        for stone in stones {
            root.setup_stone(point(stone, 5), color).unwrap();
        }
    }
    let preferred = candidate("E5", &["E5", "B3", "E4", "C3"], 5);
    let line = trace_candidate_pv(0, &root, &preferred).unwrap();
    (root, group(ColorToken::B, &["B2", "C2"]), preferred, line)
}

#[test]
fn legal_liberty_order_is_stable_capped_and_skips_sufficient_existing_evidence() {
    let (root, group, preferred, line) = two_liberty_position();
    let groups = [group];
    let mut config = PipelineConfig::default();
    assert_eq!(
        saving_probe_moves(&root, &groups, &preferred, &line, &[], &config),
        ["B3", "C3"]
    );
    config.comparison_saving_probes = 1;
    assert_eq!(
        saving_probe_moves(&root, &groups, &preferred, &line, &[], &config),
        ["B3"]
    );
    config.comparison_saving_probes = 0;
    assert_eq!(
        saving_probe_moves(&root, &groups, &preferred, &line, &[], &config),
        Vec::<String>::new()
    );
    config.comparison_saving_probes = 2;
    let mut existing = candidate("B3", &["B3", "E1"], 5);
    assert_eq!(
        saving_probe_moves(
            &root,
            &groups,
            &preferred,
            &line,
            &[existing.clone()],
            &config
        ),
        ["C3"]
    );
    existing.visits = Some(15);
    assert_eq!(
        saving_probe_moves(&root, &groups, &preferred, &line, &[existing], &config),
        ["B3", "C3"]
    );
}

#[test]
fn mixed_partial_and_undersampled_preferred_groups_do_not_trigger_probes() {
    let (root, original, preferred, line) = two_liberty_position();
    let config = PipelineConfig::default();
    let mut mixed = original.clone();
    mixed.members.white_stones.push("A2".into());
    assert_eq!(
        saving_probe_moves(&root, &[mixed], &preferred, &line, &[], &config),
        Vec::<String>::new()
    );
    let mut partial = line.clone();
    partial.captures.retain(|capture| capture.stone != "C2");
    assert_eq!(
        saving_probe_moves(
            &root,
            std::slice::from_ref(&original),
            &preferred,
            &partial,
            &[],
            &config
        ),
        Vec::<String>::new()
    );
    let mut sparse = preferred;
    sparse.visits = Some(15);
    assert_eq!(
        saving_probe_moves(&root, &[original], &sparse, &line, &[], &config),
        Vec::<String>::new()
    );
}

#[test]
fn configuration_cannot_remove_the_eight_query_hard_cap() {
    let mut root = GameState::new(9, Ruleset::Chinese).unwrap();
    let stones = ["B2", "E2", "H2"];
    for stone in stones {
        root.setup_stone(point(stone, 9), Color::Black).unwrap();
    }
    let preferred = candidate("J9", &["J9"], 9);
    // Deliberately supplied lineage isolates the selection cap; production always
    // obtains lineage from trace_candidate_pv, not a recording or this test input.
    let mut line = trace_candidate_pv(0, &root, &preferred).unwrap();
    line.captures = stones
        .iter()
        .map(|stone| RootStoneCapture {
            color: ColorToken::B,
            stone: (*stone).into(),
            ply_offset: 1,
        })
        .collect();
    let config = PipelineConfig {
        comparison_saving_probes: usize::MAX,
        ..PipelineConfig::default()
    };
    let moves = saving_probe_moves(
        &root,
        &[group(ColorToken::B, &stones)],
        &preferred,
        &line,
        &[],
        &config,
    );
    assert_eq!(moves.len(), 8);
    assert_eq!(&moves[..3], ["B3", "E3", "H3"]);
}

struct ScriptedEngine {
    seen: Mutex<Vec<AnalysisQuery>>,
    hash: Option<&'static str>,
    visits: u64,
    invalid_pv: bool,
    fail: bool,
}

impl Default for ScriptedEngine {
    fn default() -> Self {
        Self {
            seen: Mutex::new(vec![]),
            hash: Some("same-root"),
            visits: 64,
            invalid_pv: false,
            fail: false,
        }
    }
}

impl AnalysisEngine for ScriptedEngine {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        callback: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            self.seen.lock().unwrap().push(query.clone());
            if self.fail {
                return Err(KatagoError::Engine {
                    id: query.id.clone(),
                    error: "constructed unavailable response".into(),
                });
            }
            let move_ = query.allow_moves.as_ref().unwrap()[0]["moves"][0]
                .as_str()
                .unwrap();
            let next = if self.invalid_pv { move_ } else { "J1" };
            let response: AnalysisResponse = serde_json::from_value(serde_json::json!({
                "id":query.id, "rootInfo":{"thisHash":self.hash,"visits":64,"winrate":0.5,"scoreLead":0.0},
                "moveInfos":[{"move":move_,"visits":self.visits,"order":0,"winrate":0.5,"scoreLead":0.0,
                    "ownership":vec![0.0;81],"pv":[move_,next]}],
            })).unwrap();
            callback(AnalysisUpdate::Final(response))
        })
    }
}

fn root_with_active_ko() -> (GameState, GroupSnapshot, CandidateSnapshot) {
    let mut root = GameState::new(9, Ruleset::Chinese).unwrap();
    for (color, stones) in [
        (
            Color::Black,
            vec!["A2", "B1", "C2", "E2", "F1", "G1", "G3", "H2"],
        ),
        (Color::White, vec!["B2", "A3", "C3", "B4", "F2", "G2"]),
    ] {
        for stone in stones {
            root.setup_stone(point(stone, 9), color).unwrap();
        }
    }
    root.play(point("B3", 9)).unwrap();
    assert_eq!(root.ko_point(), Some(point("B2", 9)));
    assert_eq!(root.to_play(), Color::White);
    (
        root,
        group(ColorToken::W, &["F2", "G2"]),
        candidate("J9", &["J9", "F3"], 9),
    )
}

#[tokio::test]
async fn probes_preserve_full_history_setup_rules_and_distinct_provenance() {
    let (root, group, preferred) = root_with_active_ko();
    let record = yagoo_sgf::parse_sgf("(;SZ[9]KM[0])").unwrap();
    let config = PipelineConfig {
        root_visits: 64,
        ..PipelineConfig::default()
    };
    let engine = ScriptedEngine::default();
    let mut limitations = vec![];
    let probes = saving_probes(
        "p2",
        &root,
        &[group],
        &preferred,
        &[],
        Some("same-root"),
        &record,
        &engine,
        &config,
        &mut limitations,
    )
    .await;
    assert_eq!(probes.len(), 1);
    assert_eq!(probes[0].query_id, "p2-saving-F3");
    assert_eq!(probes[0].root_hash.as_deref(), Some("same-root"));
    assert_eq!(probes[0].candidate.move_, "F3");
    assert_eq!(limitations, Vec::<String>::new());
    let seen = engine.seen.lock().unwrap();
    let probe = &seen[0];
    let unrestricted = query("p2-root", &root, &record, &config);
    assert_eq!(probe.moves, unrestricted.moves);
    assert_eq!(probe.moves.len(), 1);
    assert_eq!(probe.initial_stones, unrestricted.initial_stones);
    assert_eq!(probe.initial_stones.len(), 14);
    assert_eq!(probe.rules.as_deref(), Some("chinese"));
    assert_eq!(probe.override_settings, unrestricted.override_settings);
    assert_eq!(
        probe.allow_moves,
        Some(serde_json::json!([{"player":"W","moves":["F3"],"untilDepth":1}]))
    );
}

#[tokio::test]
async fn missing_conflicting_or_illegal_probe_evidence_is_explicitly_unavailable() {
    let (root, group, preferred) = root_with_active_ko();
    let record = yagoo_sgf::parse_sgf("(;SZ[9]KM[0])").unwrap();
    let config = PipelineConfig::default();
    for scenario in 0..6 {
        let mut engine = ScriptedEngine::default();
        let root_hash = if scenario == 0 {
            None
        } else {
            Some("same-root")
        };
        match scenario {
            1 => engine.hash = None,
            2 => engine.hash = Some("different-root"),
            3 => engine.visits = 15,
            4 => engine.invalid_pv = true,
            5 => engine.fail = true,
            _ => {}
        }
        let mut limitations = vec![];
        let probes = saving_probes(
            "p2",
            &root,
            std::slice::from_ref(&group),
            &preferred,
            &[],
            root_hash,
            &record,
            &engine,
            &config,
            &mut limitations,
        )
        .await;
        assert!(probes.is_empty(), "scenario {scenario}");
        assert_eq!(limitations.len(), 1, "scenario {scenario}");
        assert_eq!(
            engine.seen.lock().unwrap().len(),
            usize::from(scenario != 0)
        );
    }
}
