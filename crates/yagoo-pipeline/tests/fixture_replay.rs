//! Replay recorded KataGo responses for the bundled 19×19 sample.
//!
//! Fixtures are produced locally via `mise run fixtures:regen` (real CPU KataGo).
//! CI only replays the committed `responses.json.gz` — it never downloads models.

use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;

use yagoo_katago::AnalysisClient;
use yagoo_pipeline::{analyze_game_collected, DeepSelectConfig, PipelineConfig, PipelineStrategy};
use yagoo_snapshot::{AnalysisPhase, GroupSnapshot, GroupStatus, PipelineEvent};

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-19x19")
}

fn load_responses() -> Vec<String> {
    let path = fixture_dir().join("responses.json.gz");
    let bytes = std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "missing recorded fixture at {}: {e}\n\
             regenerate locally with `mise run fixtures:regen` (never in CI)",
            path.display()
        )
    });
    let mut decoder = flate2::read::GzDecoder::new(bytes.as_slice());
    let mut s = String::new();
    decoder
        .read_to_string(&mut s)
        .expect("gunzip responses.json.gz");
    let lines: Vec<String> = serde_json::from_str(&s).expect("parse responses.json.gz");
    assert!(
        !lines.is_empty(),
        "responses.json.gz is empty — run mise run fixtures:regen"
    );
    // Guard against accidentally committing the failed-recording stub.
    assert!(
        !lines[0].contains("Must specify an array of [player,location] pairs"),
        "fixture looks like a KataGo error stub, not a real recording"
    );
    lines
}

fn load_sample_sgf() -> String {
    // Prefer the docs sample (canonical); fall back to a copy under fixtures if needed.
    let docs = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/public/app/sample.sgf");
    std::fs::read_to_string(&docs).unwrap_or_else(|_| {
        let local = fixture_dir().join("sample.sgf");
        std::fs::read_to_string(&local).unwrap_or_else(|e| {
            panic!(
                "sample.sgf not found at {} or {}: {e}",
                docs.display(),
                local.display()
            )
        })
    })
}

fn fixture_pipeline_config() -> PipelineConfig {
    // Must match scripts/regen-fixtures.sh defaults.
    PipelineConfig {
        strategy: PipelineStrategy::ScanThenDeep,
        scan_visits: 100,
        root_visits: 500,
        top_k: 5,
        from_ply: 0,
        to_ply: None,
        report_during_search_every: None,
        include_pv_ends: false,
        emit_game_aggregate: false,
        deepen_all: false,
        deep_select: DeepSelectConfig {
            max_deep_plies: 8,
            ..DeepSelectConfig::default()
        },
        ..PipelineConfig::default()
    }
}

fn deep_groups_by_ply(events: &[PipelineEvent]) -> Vec<(u32, Vec<GroupSnapshot>)> {
    events
        .iter()
        .filter_map(|e| match e {
            PipelineEvent::PositionCompleted {
                phase: AnalysisPhase::Deep,
                snapshot,
                ..
            } => Some((snapshot.ply, snapshot.groups.clone())),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn replay_recorded_fixture_groups_snapshot_and_sanity() {
    let lines = load_responses();
    let sgf = load_sample_sgf();
    let client = Arc::new(AnalysisClient::scripted(lines));
    let events = analyze_game_collected(&sgf, client, fixture_pipeline_config())
        .await
        .expect("replay analyze_game");

    let deep = deep_groups_by_ply(&events);
    assert!(
        !deep.is_empty(),
        "expected at least one deepened ply with groups"
    );

    // --- Snapshot: stable group ids / kind / status / stone sets ---
    let snapshot_path = fixture_dir().join("groups-snapshot.json");
    let expected: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&snapshot_path).unwrap_or_else(|e| {
            panic!(
                "missing groups-snapshot.json at {}: {e}",
                snapshot_path.display()
            )
        }),
    )
    .expect("parse groups-snapshot.json");

    let mut actual_map = serde_json::Map::new();
    for (ply, groups) in &deep {
        actual_map.insert(
            ply.to_string(),
            serde_json::to_value(summarize_groups(groups)).unwrap(),
        );
    }
    let expected_map = expected
        .get("groupsByPly")
        .and_then(|v| v.as_object())
        .expect("groupsByPly in snapshot");

    assert_eq!(
        actual_map.keys().collect::<Vec<_>>(),
        expected_map.keys().collect::<Vec<_>>(),
        "deep plies with groups must match committed snapshot"
    );
    for (ply, exp) in expected_map {
        let got = actual_map
            .get(ply)
            .unwrap_or_else(|| panic!("missing ply {ply} in replay"));
        assert_groups_summary_eq(ply, got, exp);
    }

    // --- Sanity on real judgments ---
    for (ply, groups) in &deep {
        for g in groups {
            let stone_n = g.members.black_stones.len() + g.members.white_stones.len();
            // Lone stone in open space must not be labelled seki.
            if stone_n <= 1 {
                assert_ne!(
                    g.status,
                    Some(GroupStatus::LikelySeki),
                    "ply {ply} group {}: lone stone judged seki",
                    g.group_id
                );
            }
            // Pipeline provenance.
            assert_eq!(
                g.source,
                Some(yagoo_snapshot::GroupSource::Pipeline),
                "ply {ply} group {}",
                g.group_id
            );
        }

        // Corner teaching positions in the sample: Q16 / D4 / etc. when present as
        // multi-stone same-color groups with high |g±| should be Settled (alive), not Dead/Seki.
        for g in groups {
            let cornerish = g
                .members
                .black_stones
                .iter()
                .chain(g.members.white_stones.iter())
                .any(|c| is_near_corner_gtp(c));
            let mono = g.members.black_stones.is_empty() ^ g.members.white_stones.is_empty();
            let stones = g.members.black_stones.len() + g.members.white_stones.len();
            if cornerish && mono && stones >= 4 {
                if let (Some(gp), Some(gm)) = (g.g_plus, g.g_minus) {
                    // Strongly alive on both tempi → Settled.
                    if gp >= 0.8 && gm >= 0.8 {
                        assert_eq!(
                            g.status,
                            Some(GroupStatus::Settled),
                            "ply {ply} corner group {} strongly alive but status={:?}",
                            g.group_id,
                            g.status
                        );
                    }
                    // Strongly dead on both tempi → Dead (not seki).
                    if gp <= -0.8 && gm <= -0.8 {
                        assert_eq!(
                            g.status,
                            Some(GroupStatus::Dead),
                            "ply {ply} corner group {} strongly dead but status={:?}",
                            g.group_id,
                            g.status
                        );
                    }
                }
            }
        }
    }
}

/// Compact, order-stable summary used for the committed snapshot file.
fn summarize_groups(groups: &[GroupSnapshot]) -> Vec<serde_json::Value> {
    groups
        .iter()
        .map(|g| {
            serde_json::json!({
                "groupId": g.group_id,
                "kind": g.kind,
                "status": g.status,
                "blackStones": g.members.black_stones,
                "whiteStones": g.members.white_stones,
                "gPlus": g.g_plus.map(round3),
                "gMinus": g.g_minus.map(round3),
                "certainty": g.certainty.map(round3),
            })
        })
        .collect()
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Exact match on ids / kind / status / stone sets; ±0.002 on rounded floats
/// (Python vs Rust half-even can differ by one ulp at 1e-3).
fn assert_groups_summary_eq(ply: &str, got: &serde_json::Value, exp: &serde_json::Value) {
    let got_arr = got.as_array().expect("got array");
    let exp_arr = exp.as_array().expect("exp array");
    assert_eq!(
        got_arr.len(),
        exp_arr.len(),
        "ply {ply}: group count {} vs {}",
        got_arr.len(),
        exp_arr.len()
    );
    for (i, (g, e)) in got_arr.iter().zip(exp_arr.iter()).enumerate() {
        for key in ["groupId", "kind", "status", "blackStones", "whiteStones"] {
            assert_eq!(g.get(key), e.get(key), "ply {ply} group[{i}].{key}");
        }
        for key in ["gPlus", "gMinus", "certainty"] {
            match (
                g.get(key).and_then(serde_json::Value::as_f64),
                e.get(key).and_then(serde_json::Value::as_f64),
            ) {
                (None, None) => {}
                (Some(a), Some(b)) => {
                    assert!(
                        (a - b).abs() <= 0.002,
                        "ply {ply} group[{i}].{key}: {a} vs {b}"
                    );
                }
                (a, b) => panic!("ply {ply} group[{i}].{key}: {a:?} vs {b:?}"),
            }
        }
    }
}

fn is_near_corner_gtp(coord: &str) -> bool {
    // GTP letters skip I; 19×19 uses A–T without I, ranks 1–19.
    let Some((col, row)) = split_gtp(coord) else {
        return false;
    };
    let near_col = col <= 3 || col >= 15;
    let near_row = row <= 4 || row >= 16;
    near_col && near_row
}

fn split_gtp(coord: &str) -> Option<(u8, u8)> {
    let bytes = coord.as_bytes();
    if bytes.len() < 2 {
        return None;
    }
    let mut i = 0;
    let c = bytes[i] as char;
    i += 1;
    if !c.is_ascii_alphabetic() {
        return None;
    }
    let letter = c.to_ascii_uppercase();
    if letter == 'I' {
        return None;
    }
    let col = if letter < 'I' {
        (letter as u8) - b'A'
    } else {
        (letter as u8) - b'A' - 1
    };
    let row: u8 = std::str::from_utf8(&bytes[i..]).ok()?.parse().ok()?;
    Some((col, row))
}
