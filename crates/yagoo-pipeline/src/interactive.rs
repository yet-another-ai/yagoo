//! Root-only interactive analysis, independent of the whole-game scan/deepen run.
use crate::{run::EventStream, AnalysisEngine, PipelineError, PipelineResult};
use serde::Deserialize;
use std::sync::Arc;
use yagoo_katago::{AnalysisQuery, AnalysisQueryBuilder};
use yagoo_sgf::{move_to_gtp, parse_sgf, parse_sgf_tree, replay_main_line};
use yagoo_snapshot::{
    board_from_game, candidates_from_response, chains_from_game, engine_from_response,
    AnalysisPhase, PassProbeSkipReason, PipelineEvent, PositionSnapshot, SCHEMA_VERSION,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InteractivePositionRequest {
    pub sgf: String,
    /// Anchor ply in the original main line, before applying `moves`.
    pub ply: u32,
    /// GTP branch moves (including `pass`), alternating from the anchor's to-play.
    #[serde(default)]
    pub moves: Vec<String>,
    pub visits: Option<u32>,
}

pub struct PreparedPosition {
    pub query: AnalysisQuery,
    pub snapshot: PositionSnapshot,
}

/// Retain setup, PL, every main-line move through the anchor, and the entire
/// branch. Never reconstruct from current stones: that loses ko/pass/NN history.
pub fn prepare_position(body: &InteractivePositionRequest) -> PipelineResult<PreparedPosition> {
    let visits = body.visits.unwrap_or(200);
    if visits == 0 || visits > 100_000 || body.moves.len() > 1_000 {
        return Err(message(
            "visits must be 1..=100000 and branch at most 1000 moves",
        ));
    }
    validate_history(&body.sgf)?;
    let mut record = parse_sgf(&body.sgf)?;
    let anchor = usize::try_from(body.ply).map_err(|_| message("anchor ply overflow"))?;
    if anchor > record.moves.len() {
        return Err(message("anchor ply exceeds main line"));
    }
    record.moves.truncate(anchor);
    let mut pos = replay_main_line(&record)?
        .pop()
        .ok_or_else(|| message("missing anchor"))?;
    let mut last_move = pos.last_move.as_ref().map(|m| move_to_gtp(m, record.size));
    for mv in &body.moves {
        pos.state.play_gtp(mv)?;
        last_move = Some(mv.clone());
    }
    let ply = body
        .ply
        .checked_add(u32::try_from(body.moves.len()).map_err(|_| message("branch overflow"))?)
        .ok_or_else(|| message("ply overflow"))?;
    let query = AnalysisQueryBuilder::new("interactive-root")
        .from_game_state(&pos.state)
        .komi(record.komi)
        .rules(record.rules.unwrap_or_else(|| "chinese".into()))
        .max_visits(visits)
        .report_as_black()
        .build();
    let mut snapshot = PositionSnapshot::empty_shell(
        ply,
        pos.state.to_play().into(),
        board_from_game(&pos.state),
        chains_from_game(&pos.state),
    );
    snapshot.last_move = last_move;
    snapshot.phase = Some("deep".into());
    snapshot.pass_probe_skipped = Some(PassProbeSkipReason::DisabledInPhase);
    Ok(PreparedPosition { query, snapshot })
}

fn validate_history(sgf: &str) -> PipelineResult<()> {
    let root = parse_sgf_tree(sgf)?;
    if root.get("AE").is_some() {
        return Err(message(
            "interactive analysis does not support SGF AE setup edits",
        ));
    }
    let mut node = root.children.first();
    while let Some(current) = node {
        for property in ["AB", "AW", "AE", "PL", "RU", "KM", "SZ"] {
            if current.get(property).is_some() {
                return Err(PipelineError::Message(format!(
                    "interactive analysis does not support non-root SGF {property} edits"
                )));
            }
        }
        node = current.children.first();
    }
    Ok(())
}

/// Exactly one authoritative snapshot (or error), with no pass probe, scan,
/// groups, or during-search partials. Dropping the stream cancels its query.
pub fn analyze_position<E: AnalysisEngine + 'static>(
    request: InteractivePositionRequest,
    engine: Arc<E>,
    top_k: usize,
) -> EventStream {
    Box::pin(futures::stream::once(async move {
        let result = async {
            let prepared = prepare_position(&request)?;
            complete_position(prepared, engine.as_ref(), top_k).await
        }
        .await;
        Ok(result.unwrap_or_else(|e| PipelineEvent::Error {
            v: SCHEMA_VERSION,
            message: e.to_string(),
            ply: None,
        }))
    }))
}

pub async fn complete_position<E: AnalysisEngine>(
    prepared: PreparedPosition,
    engine: &E,
    top_k: usize,
) -> PipelineResult<PipelineEvent> {
    let PreparedPosition {
        query,
        mut snapshot,
    } = prepared;
    let response = engine.analyze(&query).await?;
    snapshot.root = Some(
        engine_from_response(&response)
            .ok_or_else(|| message("engine response has no rootInfo"))?,
    );
    snapshot.candidates = candidates_from_response(&response, top_k);
    Ok(PipelineEvent::PositionCompleted {
        v: SCHEMA_VERSION,
        phase: AnalysisPhase::Deep,
        snapshot: Box::new(snapshot),
    })
}

fn message(text: &str) -> PipelineError {
    PipelineError::Message(text.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_katago::PlayerToken;

    #[test]
    fn retains_setup_player_passes_and_branch_without_future_mainline() {
        let result = prepare_position(&InteractivePositionRequest {
            sgf: "(;SZ[9]KM[6.5]AB[cc]PL[W];W[ee];B[];W[gg])".into(),
            ply: 2,
            moves: vec!["D4".into(), "pass".into()],
            visits: None,
        })
        .unwrap();
        assert_eq!(result.query.rules.as_deref(), Some("chinese"));
        assert_eq!(result.query.initial_player, Some(PlayerToken::W));
        assert_eq!(
            result.query.initial_stones,
            vec![(PlayerToken::B, "C7".into())]
        );
        assert_eq!(
            result.query.moves,
            vec![
                (PlayerToken::W, "E5".into()),
                (PlayerToken::B, "pass".into()),
                (PlayerToken::W, "D4".into()),
                (PlayerToken::B, "pass".into()),
            ]
        );
        assert_eq!(result.snapshot.ply, 4);
        assert_eq!(result.snapshot.to_play, yagoo_snapshot::ColorToken::W);
        assert_eq!(result.query.report_during_search_every, None);
        assert_eq!(result.snapshot.groups, []);
    }

    #[test]
    fn rejects_immediate_ko_instead_of_rebuilding_from_stones() {
        let request = InteractivePositionRequest {
            sgf: "(;SZ[9]RU[Japanese]AB[cb][bc][cd][dc]AW[db][ec][dd]PL[W];W[cc])".into(),
            ply: 1,
            moves: vec!["D7".into()],
            visits: None,
        };
        assert!(prepare_position(&request)
            .err()
            .unwrap()
            .to_string()
            .contains("ko"));
    }

    #[test]
    fn rejects_bad_anchor_illegal_move_and_zero_budget() {
        for (ply, moves, visits) in [
            (1, vec![], None),
            (0, vec!["Z99".into()], None),
            (0, vec![], Some(0)),
        ] {
            assert!(prepare_position(&InteractivePositionRequest {
                sgf: "(;SZ[9])".into(),
                ply,
                moves,
                visits,
            })
            .is_err());
        }
    }

    #[test]
    fn rejects_midgame_setup_and_player_edits() {
        for property in ["AB[bb]", "AW[bb]", "AE[aa]", "PL[B]", "RU[Japanese]"] {
            let request = InteractivePositionRequest {
                sgf: format!("(;SZ[9];B[aa];{property})"),
                ply: 1,
                moves: vec![],
                visits: None,
            };
            assert!(prepare_position(&request)
                .err()
                .unwrap()
                .to_string()
                .contains("does not support"));
        }
    }
}
