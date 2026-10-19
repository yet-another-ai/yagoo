//! Constructed-position unit tests for clustering + tempo status.

use super::*;
use crate::schema::{
    BoardSnapshot, CandidateSnapshot, ChainSnapshot, ColorToken, EngineAnalysis,
    OwnershipConvention, PositionSnapshot, SCHEMA_VERSION,
};

fn empty_own(n: usize) -> Vec<f64> {
    vec![0.0; n]
}

fn snap_shell(size: u8, to_play: ColorToken) -> PositionSnapshot {
    PositionSnapshot {
        schema_version: SCHEMA_VERSION,
        ply: 1,
        to_play,
        last_move: None,
        ownership_convention: OwnershipConvention::BlackPositive,
        board: BoardSnapshot {
            size,
            black: vec![],
            white: vec![],
        },
        chains: vec![],
        groups: vec![],
        root: None,
        pass_probe: None,
        pass_probe_skipped: None,
        candidates: vec![],
        pv_ends: vec![],
        phase: Some("deep".into()),
    }
}

fn eng(own: Vec<f64>, stdev: Option<Vec<f64>>) -> EngineAnalysis {
    EngineAnalysis {
        visits: Some(100),
        winrate: Some(0.5),
        score_lead: Some(0.0),
        score_stdev: None,
        utility: None,
        ownership: Some(own),
        ownership_stdev: stdev,
        policy: None,
    }
}

fn cand(mv: &str, own: Vec<f64>) -> CandidateSnapshot {
    CandidateSnapshot {
        move_: mv.into(),
        order: Some(0),
        visits: Some(50),
        winrate: Some(0.5),
        score_lead: Some(0.0),
        score_stdev: None,
        prior: Some(0.1),
        utility: None,
        lcb: None,
        pv: Some(vec![mv.into()]),
        pv_visits: None,
        ownership: Some(own),
        ownership_stdev: None,
    }
}

fn idx(gtp: &str, size: u8) -> usize {
    Point::parse_gtp(gtp, size).unwrap().unwrap().index(size)
}

/// Alive / settled black group: high root ownership, pass still high, scenarios move together gently.
#[test]
fn alive_settled_group() {
    let size = 9_u8;
    let n = 81;
    let mut root = empty_own(n);
    let mut pass = empty_own(n);
    let mut c1 = empty_own(n);
    let mut c2 = empty_own(n);
    // Black stones A9,B9,C9 form a living group; empties A8,B8 share fate.
    // Root/pass stay high (settled) while candidates pull ownership enough to exceed ε.
    for gtp in ["A9", "B9", "C9", "A8", "B8"] {
        let i = idx(gtp, size);
        root[i] = 0.92;
        pass[i] = 0.85; // still safe if opponent plays first → settled
        c1[i] = 0.55;
        c2[i] = 0.50;
    }
    // Unrelated noisy corner — opposite swing so it does not merge.
    for gtp in ["H1", "J1", "J2"] {
        let i = idx(gtp, size);
        root[i] = -0.1;
        pass[i] = -0.8;
        c1[i] = 0.2;
        c2[i] = -0.5;
    }

    let mut snap = snap_shell(size, ColorToken::B);
    snap.board.black = vec!["A9".into(), "B9".into(), "C9".into()];
    snap.chains = vec![ChainSnapshot {
        color: ColorToken::B,
        stones: vec!["A9".into(), "B9".into(), "C9".into()],
        liberties: vec!["A8".into(), "B8".into(), "C8".into()],
        liberty_count: 3,
    }];
    snap.root = Some(eng(root, Some(vec![0.05; n])));
    snap.pass_probe = Some(eng(pass, None));
    snap.candidates = vec![cand("D5", c1), cand("E5", c2)];

    let groups = compute_groups(&snap);
    let alive = groups
        .iter()
        .find(|g| g.members.black_stones.contains(&"A9".into()))
        .expect("alive group");
    assert_eq!(alive.kind, GroupKind::Simple);
    assert_eq!(alive.status, Some(GroupStatus::Settled));
    assert_eq!(alive.source, Some(GroupSource::Pipeline));
    assert!(alive.members.black_stones.len() >= 3);
    assert!(alive.g_minus.unwrap() >= 0.8);
    // Label must be a member stone (never an empty / territory point).
    assert!(
        alive.members.black_stones.contains(&alive.group_id)
            || alive.members.white_stones.contains(&alive.group_id),
        "group_id {} is not a member stone",
        alive.group_id
    );
}

#[test]
fn group_id_is_member_stone_not_empty() {
    let size = 9_u8;
    let n = 81;
    let mut root = empty_own(n);
    let mut pass = empty_own(n);
    let mut c1 = empty_own(n);
    let mut c2 = empty_own(n);
    // Alive black corner + empties that would sort before A9 (A1..A8) if empties
    // were allowed into the id.
    for gtp in ["A9", "B9", "C9", "A8", "B8"] {
        let i = idx(gtp, size);
        root[i] = 0.95;
        pass[i] = 0.90;
        c1[i] = 0.2;
        c2[i] = 0.1;
    }
    for gtp in ["H1", "J1", "J2"] {
        let i = idx(gtp, size);
        root[i] = -0.2;
        pass[i] = 0.4;
        c1[i] = -0.6;
        c2[i] = 0.5;
    }

    let mut snap = snap_shell(size, ColorToken::B);
    snap.board.black = vec![
        "A9".into(),
        "B9".into(),
        "C9".into(),
        "A8".into(),
        "B8".into(),
    ];
    snap.chains = vec![ChainSnapshot {
        color: ColorToken::B,
        stones: vec!["A9".into(), "B9".into(), "C9".into()],
        liberties: vec!["A8".into(), "B8".into(), "C8".into()],
        liberty_count: 3,
    }];
    snap.root = Some(eng(root, Some(vec![0.05; n])));
    snap.pass_probe = Some(eng(pass, None));
    snap.candidates = vec![cand("D5", c1), cand("E5", c2)];

    let groups = compute_groups(&snap);
    assert_ne!(groups.len(), 0, "expected at least one teaching group");
    for g in &groups {
        let stones: Vec<&String> = g
            .members
            .black_stones
            .iter()
            .chain(g.members.white_stones.iter())
            .collect();
        assert!(
            stones.iter().any(|s| s.as_str() == g.group_id),
            "group_id {} not in member stones {:?}; empties={:?}",
            g.group_id,
            stones,
            g.members.empty
        );
        assert!(
            !g.members.empty.iter().any(|e| e == &g.group_id),
            "group_id must not be an empty point ({})",
            g.group_id
        );
    }
    // Largest chain anchor should win over stray empties like A1.
    let alive = groups
        .iter()
        .find(|g| g.members.black_stones.contains(&"A9".into()))
        .expect("alive");
    assert_eq!(alive.group_id, "A9");
}

/// Dead white stones sitting in black territory: g+ very negative.
#[test]
fn dead_group_in_opponent_area() {
    let size = 9_u8;
    let n = 81;
    let mut root = empty_own(n);
    let mut pass = empty_own(n);
    let mut c1 = empty_own(n);
    let mut c2 = empty_own(n);
    // Black-positive ownership: white stones deep in black area look dead.
    // Need enough scenario motion to clear ε while g+ stays ≤ -0.8.
    for gtp in ["A1", "B1", "A2"] {
        let i = idx(gtp, size);
        root[i] = 0.90;
        pass[i] = 0.95;
        c1[i] = 0.55;
        c2[i] = 0.50;
    }
    // Second independent swing elsewhere.
    for gtp in ["J9", "H9", "J8"] {
        let i = idx(gtp, size);
        root[i] = 0.0;
        pass[i] = 0.5;
        c1[i] = -0.5;
        c2[i] = 0.2;
    }

    let mut snap = snap_shell(size, ColorToken::W);
    snap.board.white = vec!["A1".into(), "B1".into(), "A2".into()];
    snap.chains = vec![ChainSnapshot {
        color: ColorToken::W,
        stones: vec!["A1".into(), "B1".into(), "A2".into()],
        liberties: vec![],
        liberty_count: 0,
    }];
    snap.root = Some(eng(root, Some(vec![0.05; n])));
    snap.pass_probe = Some(eng(pass, None));
    snap.candidates = vec![cand("D5", c1), cand("E5", c2)];

    let groups = compute_groups(&snap);
    let dead = groups
        .iter()
        .find(|g| g.members.white_stones.contains(&"A1".into()))
        .expect("dead group");
    assert_eq!(dead.status, Some(GroupStatus::Dead));
    assert!(dead.strength.as_ref().unwrap().white.unwrap() < -0.5);
}

/// Two disconnected black chains that share fate (remote binding / one 块).
#[test]
fn two_chains_one_group() {
    let size = 9_u8;
    let n = 81;
    let mut root = empty_own(n);
    let mut pass = empty_own(n);
    let mut c1 = empty_own(n);
    let mut c2 = empty_own(n);
    // Chain A: A9,B9  — Chain B: A7,B7 — gap at A8,B8 not in group → remote parts.
    // Empties excluded so connectivity yields two parts.
    for gtp in ["A9", "B9", "A7", "B7"] {
        let i = idx(gtp, size);
        root[i] = 0.4;
        pass[i] = -0.5; // tempo-ish
        c1[i] = 0.7; // candidate saves
        c2[i] = 0.6;
    }
    // Distractor region with orthogonal fate.
    for gtp in ["J1", "H1", "J2"] {
        let i = idx(gtp, size);
        root[i] = -0.2;
        pass[i] = 0.3;
        c1[i] = -0.6;
        c2[i] = -0.5;
    }

    let mut snap = snap_shell(size, ColorToken::B);
    snap.board.black = vec!["A9".into(), "B9".into(), "A7".into(), "B7".into()];
    snap.chains = vec![
        ChainSnapshot {
            color: ColorToken::B,
            stones: vec!["A9".into(), "B9".into()],
            liberties: vec![],
            liberty_count: 0,
        },
        ChainSnapshot {
            color: ColorToken::B,
            stones: vec!["A7".into(), "B7".into()],
            liberties: vec![],
            liberty_count: 0,
        },
    ];
    snap.root = Some(eng(root, Some(vec![0.1; n])));
    snap.pass_probe = Some(eng(pass, None));
    snap.candidates = vec![cand("C5", c1), cand("D5", c2)];

    let groups = compute_groups(&snap);
    let g = groups
        .iter()
        .find(|g| {
            g.members.black_stones.contains(&"A9".into())
                && g.members.black_stones.contains(&"A7".into())
        })
        .expect("merged 块");
    assert!(g.chains.len() >= 2);
    assert!(g.parts.len() >= 2);
    // May be bound (if confidence passes) or simple with weak binding.
    assert!(matches!(g.kind, GroupKind::Bound | GroupKind::Simple));
}

/// Contested / seki-like: both colors, small |g±|, high certainty → likely_seki or contested weak.
#[test]
fn contested_seki_like() {
    let size = 9_u8;
    let n = 81;
    let mut root = empty_own(n);
    let mut pass = empty_own(n);
    let mut c1 = empty_own(n);
    let mut c2 = empty_own(n);
    // Mutual life points around A9/B9 — ownership near 0, small swings.
    for gtp in ["A9", "B9", "A8", "B8", "C9"] {
        let i = idx(gtp, size);
        root[i] = 0.05;
        pass[i] = -0.05;
        c1[i] = 0.12;
        c2[i] = -0.10;
    }
    // Distractor
    for gtp in ["J1", "H1", "J2"] {
        let i = idx(gtp, size);
        root[i] = 0.5;
        pass[i] = 0.1;
        c1[i] = 0.8;
        c2[i] = 0.2;
    }

    let mut snap = snap_shell(size, ColorToken::B);
    snap.board.black = vec!["A9".into(), "B9".into()];
    snap.board.white = vec!["A8".into(), "B8".into(), "C9".into()];
    snap.chains = vec![
        ChainSnapshot {
            color: ColorToken::B,
            stones: vec!["A9".into(), "B9".into()],
            liberties: vec![],
            liberty_count: 0,
        },
        ChainSnapshot {
            color: ColorToken::W,
            stones: vec!["A8".into(), "B8".into()],
            liberties: vec![],
            liberty_count: 0,
        },
        ChainSnapshot {
            color: ColorToken::W,
            stones: vec!["C9".into()],
            liberties: vec![],
            liberty_count: 0,
        },
    ];
    snap.root = Some(eng(root, Some(vec![0.08; n])));
    snap.pass_probe = Some(eng(pass, None));
    snap.candidates = vec![cand("D4", c1), cand("E4", c2)];

    let groups = compute_groups(&snap);
    let g = groups
        .iter()
        .find(|g| !g.members.black_stones.is_empty() && !g.members.white_stones.is_empty())
        .expect("contested group");
    assert_eq!(g.kind, GroupKind::Contested);
    assert!(matches!(
        g.status,
        Some(GroupStatus::LikelySeki | GroupStatus::Weak)
    ));
}

#[test]
fn scan_like_snapshot_without_scenarios_yields_no_groups() {
    let size = 9_u8;
    let n = 81;
    let mut snap = snap_shell(size, ColorToken::B);
    snap.root = Some(eng(empty_own(n), None));
    // No pass / candidates → cannot correlate.
    assert_eq!(compute_groups(&snap), []);
}
