//! Tempo sensitivity: \(g^+\) / \(g^-\) / \(\Delta\) / status.

use crate::schema::{ColorToken, GroupStatus, GroupStrength};

use super::params::GroupParams;

/// First-move / second-move strengths for side \(p\) given who is to play at root.
///
/// \(g^{p,+}\) = strength when \(p\) plays first;
/// \(g^{p,-}\) = strength when the opponent plays first (pass probe).
#[must_use]
pub fn side_strengths(
    side: ColorToken,
    to_play: ColorToken,
    root: &GroupStrength,
    pass: &GroupStrength,
) -> (f64, f64) {
    let g_root = strength_of(side, root).unwrap_or(0.0);
    let g_pass = strength_of(side, pass).unwrap_or(0.0);
    if side == to_play {
        (g_root, g_pass)
    } else {
        (g_pass, g_root)
    }
}

fn strength_of(side: ColorToken, s: &GroupStrength) -> Option<f64> {
    match side {
        ColorToken::B => s.black,
        ColorToken::W => s.white,
    }
}

/// Classify status from initial tempo thresholds (no Path-B seki head yet).
#[must_use]
pub fn classify_status(
    g_plus: f64,
    g_minus: f64,
    certainty: f64,
    params: &GroupParams,
) -> GroupStatus {
    let t_set = params.settled_threshold;
    let t_tempo = params.tempo_threshold;
    let band = params.seki_band;

    if g_plus <= -t_set {
        return GroupStatus::Dead;
    }
    if g_minus >= t_set {
        return GroupStatus::Settled;
    }
    if g_plus >= t_tempo && g_minus <= -t_tempo {
        return GroupStatus::TempoCritical;
    }
    // Likely seki: both |g±| small, high certainty. (Seki head deferred — Path B.)
    if g_plus.abs() < band && g_minus.abs() < band && certainty >= params.seki_certainty {
        return GroupStatus::LikelySeki;
    }
    GroupStatus::Weak
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn to_play_black_uses_root_as_g_plus() {
        let root = GroupStrength {
            black: Some(0.9),
            white: None,
        };
        let pass = GroupStrength {
            black: Some(0.1),
            white: None,
        };
        let (gp, gm) = side_strengths(ColorToken::B, ColorToken::B, &root, &pass);
        assert!((gp - 0.9).abs() < 1e-9);
        assert!((gm - 0.1).abs() < 1e-9);
    }

    #[test]
    fn dead_when_g_plus_very_negative() {
        let p = GroupParams::default();
        assert_eq!(classify_status(-0.9, -0.95, 0.9, &p), GroupStatus::Dead);
    }

    #[test]
    fn settled_when_g_minus_high() {
        let p = GroupParams::default();
        assert_eq!(classify_status(0.95, 0.85, 0.9, &p), GroupStatus::Settled);
    }

    #[test]
    fn tempo_critical_symmetric_swing() {
        let p = GroupParams::default();
        assert_eq!(
            classify_status(0.5, -0.5, 0.6, &p),
            GroupStatus::TempoCritical
        );
    }
}
