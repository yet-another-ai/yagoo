//! Compare played move p at its complete, historical root p-1.

use crate::{AnalysisEngine, PipelineConfig, PipelineError, PipelineResult};
use yagoo_core::{GameState, Point};
use yagoo_katago::{AnalysisQuery, AnalysisQueryBuilder, AnalysisResponse};
use yagoo_sgf::{move_to_gtp, GameRecord, ReplayedPosition};
use yagoo_snapshot::{
    best_candidate, board_from_game, candidate_has_comparison_evidence, candidates_from_response,
    chains_from_game, compute_groups, compute_move_comparison, engine_from_response,
    trace_candidate_pv, ColorToken, ComparisonBranch, ComparisonCandidateSource, ComparisonContext,
    ComparisonEvidence, MoveComparison, PositionSnapshot, PvEndSnapshot,
};

/// Analyze the move that produced `position`, never the next player's move.
/// Every query retains setup, move history, ko and the effective rules.
/// Optional probe failures are recorded as limitations; unavailable core evidence
/// returns `None`. Engine errors on core queries propagate to the caller.
#[allow(clippy::too_many_lines)]
pub async fn analyze_move_comparison(
    record: &GameRecord,
    position: &ReplayedPosition,
    engine: &dyn AnalysisEngine,
    config: &PipelineConfig,
) -> PipelineResult<Option<MoveComparison>> {
    let Some(last_move) = &position.last_move else {
        return Ok(None);
    };
    let Some(root_ply) = position.ply.checked_sub(1) else {
        return Ok(None);
    };
    let mut root_state = position.state.clone();
    root_state.undo()?;
    let actual_move = move_to_gtp(last_move, record.size);
    let mover = ColorToken::from(root_state.to_play());
    let prefix = format!("p{}", position.ply);
    let root_query = query(&format!("{prefix}-root"), &root_state, record, config);
    let root_response = engine.analyze(&root_query).await?;
    let Some(root_analysis) = engine_from_response(&root_response) else {
        return Ok(None);
    };
    let mut snapshot = PositionSnapshot::empty_shell(
        root_ply,
        mover,
        board_from_game(&root_state),
        chains_from_game(&root_state),
    );
    snapshot.root = Some(root_analysis.clone());
    // Retain all returned candidates here: actual may be outside the UI's top K.
    snapshot.candidates = candidates_from_response(&root_response, usize::MAX);
    let Some(preferred) = best_candidate(&snapshot).cloned() else {
        return Ok(None);
    };
    if !candidate_has_comparison_evidence(&preferred, record.size) {
        return Ok(None);
    }
    let mut limitations = vec![
        "Finite-visit estimates; losses are not calibrated mistake severity.".into(),
        "Branch status changes describe pass sensitivity, not sente or gote.".into(),
    ];
    let mut actual = snapshot
        .candidates
        .iter()
        .find(|c| c.move_ == actual_move)
        .cloned();
    let mut actual_source = ComparisonCandidateSource::RootCandidate;
    let mut actual_query_id = root_query.id.clone();
    let mut actual_root_hash = position_hash(&root_response);
    // Equality is the same branch, even if its visit count is low. Re-searching it
    // and subtracting independent estimates would manufacture a nonzero loss.
    if actual_move == preferred.move_ {
        actual = Some(preferred.clone());
    } else if actual.as_ref().is_none_or(|candidate| {
        !candidate_has_comparison_evidence(candidate, record.size)
            || candidate.visits.unwrap_or(0) < config.comparison_min_visits
    }) {
        let mut forced = query(
            &format!("{prefix}-actual-forced"),
            &root_state,
            record,
            config,
        );
        forced.allow_moves = Some(serde_json::json!([{
            "player": root_state.to_play().to_string(),
            "moves": [actual_move],
            "untilDepth": 1,
        }]));
        let response = engine.analyze(&forced).await?;
        actual = candidates_from_response(&response, usize::MAX)
            .into_iter()
            .find(|candidate| candidate.move_ == actual_move);
        actual_source = ComparisonCandidateSource::Forced;
        actual_query_id = forced.id;
        actual_root_hash = position_hash(&response);
    }
    let Some(actual) =
        actual.filter(|candidate| candidate_has_comparison_evidence(candidate, record.size))
    else {
        return Ok(None);
    };
    if actual.visits.unwrap_or(0) < config.comparison_min_visits
        || preferred.visits.unwrap_or(0) < config.comparison_min_visits
    {
        limitations.push(
            "At least one branch remains below the configured candidate-visit threshold.".into(),
        );
    }
    let root_hash = position_hash(&root_response);
    if root_hash.is_none() || actual_root_hash.is_none() {
        limitations.push(
            "Engine omitted a root hash; root identity is established by the query history.".into(),
        );
    }
    let pass_id = format!("{prefix}-root-pass");
    snapshot.pass_probe = pass_probe(
        &pass_id,
        &root_state,
        record,
        engine,
        config,
        &mut limitations,
    )
    .await;
    let pass_query_id = snapshot.pass_probe.as_ref().map(|_| pass_id);
    snapshot
        .candidates
        .sort_by_key(|candidate| candidate.order.unwrap_or(u32::MAX));
    snapshot.candidates.truncate(config.top_k.max(1));
    snapshot.groups = compute_groups(&snapshot);

    let mut actual_branch = None;
    let mut preferred_branch = None;
    if config.comparison_branch_probes {
        actual_branch = branch(
            &format!("{prefix}-actual-branch"),
            &root_state,
            &actual.move_,
            record,
            engine,
            config,
            &mut limitations,
        )
        .await;
        preferred_branch = if actual.move_ == preferred.move_ {
            actual_branch.clone()
        } else {
            branch(
                &format!("{prefix}-ai-branch"),
                &root_state,
                &preferred.move_,
                record,
                engine,
                config,
                &mut limitations,
            )
            .await
        };
    } else {
        limitations
            .push("Branch pass probes disabled; group status transitions are unassessed.".into());
    }
    let pv_id = format!("{prefix}-ai-pv-end");
    let preferred_pv_end = if config.comparison_pv_end {
        pv_end(
            &pv_id,
            &root_state,
            &preferred,
            record,
            engine,
            config,
            &mut limitations,
        )
        .await
    } else {
        limitations
            .push("Preferred PV endpoint disabled; sacrifice evidence is incomplete.".into());
        None
    };
    let preferred_pv_query_id = preferred_pv_end.as_ref().map(|_| pv_id);
    let evidence = ComparisonEvidence {
        root_query_id: root_query.id,
        actual_query_id,
        actual_source,
        requested_visits: config.root_visits,
        minimum_candidate_visits: config.comparison_min_visits,
        root_visits: root_analysis.visits,
        actual_visits: actual.visits,
        ai_visits: preferred.visits,
        root_hash,
        actual_root_hash,
        limitations,
    };
    let mut lineage_candidates = snapshot.candidates.clone();
    if let Some(candidate) = lineage_candidates
        .iter_mut()
        .find(|candidate| candidate.move_ == actual.move_)
    {
        *candidate = actual.clone();
    } else {
        lineage_candidates.push(actual.clone());
    }
    let pv_lineages = lineage_candidates
        .iter()
        .filter_map(|candidate| trace_candidate_pv(root_ply, &root_state, candidate))
        .collect();
    Ok(compute_move_comparison(
        position.ply,
        ComparisonContext {
            root_ply,
            mover,
            board: snapshot.board,
            groups: snapshot.groups,
            root: root_analysis,
            pass_probe: snapshot.pass_probe,
            pass_query_id,
            actual,
            preferred,
            actual_branch,
            preferred_branch,
            preferred_pv_end,
            preferred_pv_query_id,
            root_candidates: lineage_candidates,
            pv_lineages,
        },
        evidence,
    ))
}

fn query(
    id: &str,
    state: &GameState,
    record: &GameRecord,
    config: &PipelineConfig,
) -> AnalysisQuery {
    AnalysisQueryBuilder::new(id)
        .from_game_state(state)
        .komi(record.komi)
        .rules(
            config
                .rules_override
                .clone()
                .or_else(|| record.rules.clone())
                .unwrap_or_else(|| "chinese".into()),
        )
        .max_visits(config.root_visits)
        .report_as_black()
        .include_ownership(true)
        .include_moves_ownership(true)
        .include_moves_ownership_stdev(config.include_moves_ownership_stdev)
        .analysis_pv_len(15)
        .build()
}

fn position_hash(response: &AnalysisResponse) -> Option<String> {
    response.root_info.as_ref()?.this_hash.clone()
}

async fn pass_probe(
    id: &str,
    state: &GameState,
    record: &GameRecord,
    engine: &dyn AnalysisEngine,
    config: &PipelineConfig,
    limitations: &mut Vec<String>,
) -> Option<yagoo_snapshot::EngineAnalysis> {
    if state.consecutive_passes() > 0 {
        limitations.push(format!("{id}: skipped after a pass; status unassessed."));
        return None;
    }
    let mut passed = state.clone();
    if passed.play_pass().is_err() {
        return None;
    }
    match engine.analyze(&query(id, &passed, record, config)).await {
        Ok(response) => engine_from_response(&response),
        Err(error) => {
            limitations.push(format!("{id}: unavailable ({error})."));
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn branch(
    prefix: &str,
    root: &GameState,
    move_: &str,
    record: &GameRecord,
    engine: &dyn AnalysisEngine,
    config: &PipelineConfig,
    limitations: &mut Vec<String>,
) -> Option<ComparisonBranch> {
    let mut state = root.clone();
    if let Err(error) = play_gtp(&mut state, move_) {
        limitations.push(format!("{prefix}: illegal branch ({error})."));
        return None;
    }
    let root_query_id = format!("{prefix}-root");
    let root = match engine
        .analyze(&query(&root_query_id, &state, record, config))
        .await
    {
        Ok(response) => engine_from_response(&response)?,
        Err(error) => {
            limitations.push(format!("{prefix}: unavailable ({error})."));
            return None;
        }
    };
    let pass_id = format!("{prefix}-pass");
    let pass_probe = pass_probe(&pass_id, &state, record, engine, config, limitations).await;
    let pass_query_id = pass_probe.as_ref().map(|_| pass_id);
    Some(ComparisonBranch {
        to_play: ColorToken::from(state.to_play()),
        board: board_from_game(&state),
        root,
        pass_probe,
        root_query_id,
        pass_query_id,
    })
}

async fn pv_end(
    id: &str,
    root: &GameState,
    preferred: &yagoo_snapshot::CandidateSnapshot,
    record: &GameRecord,
    engine: &dyn AnalysisEngine,
    config: &PipelineConfig,
    limitations: &mut Vec<String>,
) -> Option<PvEndSnapshot> {
    let pv = preferred
        .pv
        .as_ref()
        .filter(|pv| pv.first() == Some(&preferred.move_))?;
    let mut state = root.clone();
    for move_ in pv {
        if let Err(error) = play_gtp(&mut state, move_) {
            limitations.push(format!("{id}: invalid PV ({error})."));
            return None;
        }
    }
    match engine.analyze(&query(id, &state, record, config)).await {
        Ok(response) => Some(PvEndSnapshot {
            from_move: preferred.move_.clone(),
            pv: pv.clone(),
            analysis: engine_from_response(&response)?,
        }),
        Err(error) => {
            limitations.push(format!("{id}: unavailable ({error})."));
            None
        }
    }
}

fn play_gtp(state: &mut GameState, move_: &str) -> PipelineResult<()> {
    if move_.eq_ignore_ascii_case("pass") {
        state.play_pass()?;
    } else {
        if !move_.is_ascii()
            || move_.len() < 2
            || !move_
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
        {
            return Err(PipelineError::Message(format!("invalid GTP move {move_}")));
        }
        let point = Point::parse_gtp(move_, state.board().size())?
            .ok_or_else(|| PipelineError::Message(format!("invalid GTP move {move_}")))?;
        state.play(point)?;
    }
    Ok(())
}
