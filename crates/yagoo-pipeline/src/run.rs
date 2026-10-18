//! Streaming pipeline runner.

use crate::config::{PipelineConfig, PipelineStrategy};
use crate::error::{PipelineError, PipelineResult};
use async_stream::try_stream;
use futures::stream::Stream;
use std::collections::BTreeMap;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::mpsc;
use yagoo_core::Color;
use yagoo_katago::{AnalysisClient, AnalysisQueryBuilder, AnalysisUpdate};
use yagoo_sgf::{
    filter_ply_range, move_to_gtp, parse_sgf, replay_main_line, GameRecord, ReplayedPosition,
};
use yagoo_snapshot::{
    board_from_game, candidates_from_response, chains_from_game, engine_from_response,
    AnalysisPhase, AnalysisStage, ColorToken, GameSnapshot, OwnershipConvention,
    PassProbeSkipReason, PipelineEvent, PositionSnapshot, PvEndSnapshot, SCHEMA_VERSION,
};

/// Boxed stream of pipeline events.
pub type EventStream = Pin<Box<dyn Stream<Item = PipelineResult<PipelineEvent>> + Send>>;

type Tx = mpsc::UnboundedSender<PipelineEvent>;

/// Analyze an SGF string, yielding [`PipelineEvent`]s progressively.
pub fn analyze_game(sgf: &str, client: Arc<AnalysisClient>, config: PipelineConfig) -> EventStream {
    let sgf = sgf.to_owned();
    Box::pin(try_stream! {
        let (tx, mut rx) = mpsc::unbounded_channel::<PipelineEvent>();
        let client_task = Arc::clone(&client);
        let join = tokio::spawn(async move {
            match drive(&sgf, client_task, config, tx.clone()).await {
                Ok(()) => {}
                Err(e) => {
                    let _ = tx.send(PipelineEvent::Error {
                        v: SCHEMA_VERSION,
                        message: e.to_string(),
                        ply: None,
                    });
                }
            }
        });

        while let Some(ev) = rx.recv().await {
            yield ev;
        }
        join.await.map_err(|e| PipelineError::Message(e.to_string()))?;
    })
}

/// Collect all events (convenience for tests / aggregate CLI).
pub async fn analyze_game_collected(
    sgf: &str,
    client: Arc<AnalysisClient>,
    config: PipelineConfig,
) -> PipelineResult<Vec<PipelineEvent>> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sgf = sgf.to_owned();
    let drive_result = drive(&sgf, client, config, tx).await;
    let mut events = Vec::new();
    while let Some(ev) = rx.recv().await {
        events.push(ev);
    }
    drive_result?;
    Ok(events)
}

async fn drive(
    sgf: &str,
    client: Arc<AnalysisClient>,
    config: PipelineConfig,
    tx: Tx,
) -> PipelineResult<()> {
    let record = parse_sgf(sgf)?;
    let all = replay_main_line(&record)?;
    let positions = filter_ply_range(&all, config.from_ply, config.to_ply);
    if positions.is_empty() {
        return Err(PipelineError::Message(
            "no positions in selected ply range".into(),
        ));
    }

    let strategy_name = match config.strategy {
        PipelineStrategy::ScanThenDeep => "scan_then_deep",
        PipelineStrategy::DeepOnly => "deep_only",
    };

    send(
        &tx,
        PipelineEvent::GameStarted {
            v: SCHEMA_VERSION,
            size: record.size,
            komi: record.komi,
            rules: record.rules.clone(),
            move_count: u32::try_from(record.moves.len()).unwrap_or(u32::MAX),
            position_count: u32::try_from(positions.len()).unwrap_or(u32::MAX),
            strategy: strategy_name.into(),
        },
    )?;

    let mut snapshots: BTreeMap<u32, PositionSnapshot> = BTreeMap::new();

    match config.strategy {
        PipelineStrategy::ScanThenDeep => {
            run_phase(
                AnalysisPhase::Scan,
                config.scan_visits,
                PhaseMode::Scan,
                &record,
                &positions,
                &client,
                &config,
                &tx,
                &mut snapshots,
            )
            .await?;
            run_phase(
                AnalysisPhase::Deep,
                config.root_visits,
                PhaseMode::Deep,
                &record,
                &positions,
                &client,
                &config,
                &tx,
                &mut snapshots,
            )
            .await?;
        }
        PipelineStrategy::DeepOnly => {
            run_phase(
                AnalysisPhase::Deep,
                config.root_visits,
                PhaseMode::Deep,
                &record,
                &positions,
                &client,
                &config,
                &tx,
                &mut snapshots,
            )
            .await?;
        }
    }

    let game = if config.emit_game_aggregate {
        Some(Box::new(GameSnapshot {
            schema_version: SCHEMA_VERSION,
            size: record.size,
            komi: record.komi,
            rules: record.rules.clone(),
            ownership_convention: OwnershipConvention::BlackPositive,
            positions: snapshots.into_values().collect(),
        }))
    } else {
        None
    };

    send(
        &tx,
        PipelineEvent::GameCompleted {
            v: SCHEMA_VERSION,
            game,
        },
    )?;
    Ok(())
}

#[derive(Clone, Copy)]
enum PhaseMode {
    Scan,
    Deep,
}

#[allow(clippy::too_many_arguments)]
async fn run_phase(
    phase: AnalysisPhase,
    visits: u32,
    mode: PhaseMode,
    record: &GameRecord,
    positions: &[ReplayedPosition],
    client: &AnalysisClient,
    config: &PipelineConfig,
    tx: &Tx,
    snapshots: &mut BTreeMap<u32, PositionSnapshot>,
) -> PipelineResult<()> {
    send(
        tx,
        PipelineEvent::PhaseStarted {
            v: SCHEMA_VERSION,
            phase,
            visits,
        },
    )?;

    for pos in positions {
        analyze_position(
            phase, visits, mode, record, pos, client, config, tx, snapshots,
        )
        .await?;
    }

    send(
        tx,
        PipelineEvent::PhaseCompleted {
            v: SCHEMA_VERSION,
            phase,
        },
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn analyze_position(
    phase: AnalysisPhase,
    visits: u32,
    mode: PhaseMode,
    record: &GameRecord,
    pos: &ReplayedPosition,
    client: &AnalysisClient,
    config: &PipelineConfig,
    tx: &Tx,
    snapshots: &mut BTreeMap<u32, PositionSnapshot>,
) -> PipelineResult<()> {
    let to_play = pos.state.to_play();
    send(
        tx,
        PipelineEvent::PositionStarted {
            v: SCHEMA_VERSION,
            ply: pos.ply,
            to_play: to_play.to_string(),
            phase,
        },
    )?;

    let mut snap = snapshots.remove(&pos.ply).unwrap_or_else(|| {
        let mut s = PositionSnapshot::empty_shell(
            pos.ply,
            ColorToken::from(to_play),
            board_from_game(&pos.state),
            chains_from_game(&pos.state),
        );
        if let Some(mv) = &pos.last_move {
            s.last_move = Some(move_to_gtp(mv, record.size));
        }
        s
    });
    // Refresh board/chains each phase (stable, but keeps snapshot self-contained).
    snap.board = board_from_game(&pos.state);
    snap.chains = chains_from_game(&pos.state);
    snap.phase = Some(match phase {
        AnalysisPhase::Scan => "scan".into(),
        AnalysisPhase::Deep => "deep".into(),
    });

    let rules = config
        .rules_override
        .clone()
        .or_else(|| record.rules.clone())
        .unwrap_or_else(|| "chinese".into());

    let include_moves_own = matches!(mode, PhaseMode::Deep);
    let root_id = format!("p{}-{}-root", pos.ply, snap.phase.as_deref().unwrap_or("x"));
    let mut root_builder = AnalysisQueryBuilder::new(&root_id)
        .from_game_state(&pos.state)
        .komi(record.komi)
        .rules(rules.clone())
        .max_visits(visits)
        .report_as_black()
        .include_ownership(true)
        .include_moves_ownership(include_moves_own)
        .include_moves_ownership_stdev(include_moves_own && config.include_moves_ownership_stdev);
    if let Some(secs) = config.report_during_search_every {
        root_builder = root_builder.report_during_search_every(secs);
    }
    let root_query = root_builder.build();

    let mut final_root = None;
    client
        .analyze_streaming(&root_query, |update| {
            match update {
                AnalysisUpdate::Partial(resp) => {
                    let visits_n = resp.root_info.as_ref().and_then(|r| r.visits);
                    let _ = send(
                        tx,
                        PipelineEvent::StagePartial {
                            v: SCHEMA_VERSION,
                            ply: pos.ply,
                            phase,
                            stage: AnalysisStage::Root,
                            visits: visits_n,
                            root: engine_from_response(&resp),
                        },
                    );
                }
                AnalysisUpdate::Final(resp) => {
                    final_root = Some(resp);
                }
            }
            Ok(())
        })
        .await?;

    let root_resp = final_root.ok_or_else(|| {
        PipelineError::Message(format!("missing final root response for ply {}", pos.ply))
    })?;
    snap.root = engine_from_response(&root_resp);
    if include_moves_own {
        snap.candidates = candidates_from_response(&root_resp, config.top_k);
    }
    send(
        tx,
        PipelineEvent::StageCompleted {
            v: SCHEMA_VERSION,
            ply: pos.ply,
            phase,
            stage: AnalysisStage::Root,
            analysis: snap.root.clone(),
            skipped: None,
        },
    )?;

    if matches!(mode, PhaseMode::Deep) {
        run_pass_probe(
            phase, visits, record, pos, to_play, &rules, client, config, tx, &mut snap,
        )
        .await?;

        if config.include_pv_ends {
            run_pv_ends(
                phase, record, pos, &rules, client, config, tx, &mut snap, &root_resp,
            )
            .await?;
        }
    } else {
        snap.pass_probe_skipped = Some(PassProbeSkipReason::DisabledInPhase);
        send(
            tx,
            PipelineEvent::StageCompleted {
                v: SCHEMA_VERSION,
                ply: pos.ply,
                phase,
                stage: AnalysisStage::PassProbe,
                analysis: None,
                skipped: Some("disabled_in_phase".into()),
            },
        )?;
    }

    send(
        tx,
        PipelineEvent::PositionCompleted {
            v: SCHEMA_VERSION,
            phase,
            snapshot: Box::new(snap.clone()),
        },
    )?;
    snapshots.insert(pos.ply, snap);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_pass_probe(
    phase: AnalysisPhase,
    visits: u32,
    record: &GameRecord,
    pos: &ReplayedPosition,
    to_play: Color,
    rules: &str,
    client: &AnalysisClient,
    config: &PipelineConfig,
    tx: &Tx,
    snap: &mut PositionSnapshot,
) -> PipelineResult<()> {
    if pos.state.consecutive_passes() >= 1 {
        snap.pass_probe_skipped = Some(PassProbeSkipReason::PreviousWasPass);
        snap.pass_probe = None;
        send(
            tx,
            PipelineEvent::StageCompleted {
                v: SCHEMA_VERSION,
                ply: pos.ply,
                phase,
                stage: AnalysisStage::PassProbe,
                analysis: None,
                skipped: Some("previous_was_pass".into()),
            },
        )?;
        return Ok(());
    }

    let id = format!("p{}-deep-pass", pos.ply);
    let mut builder = AnalysisQueryBuilder::new(&id)
        .from_game_state(&pos.state)
        .komi(record.komi)
        .rules(rules.to_owned())
        .max_visits(visits)
        .report_as_black()
        .include_ownership(true)
        .include_moves_ownership(false)
        .append_pass_probe(to_play);
    if let Some(secs) = config.report_during_search_every {
        builder = builder.report_during_search_every(secs);
    }
    let query = builder.build();

    let mut final_resp = None;
    client
        .analyze_streaming(&query, |update| {
            match update {
                AnalysisUpdate::Partial(resp) => {
                    let visits_n = resp.root_info.as_ref().and_then(|r| r.visits);
                    let _ = send(
                        tx,
                        PipelineEvent::StagePartial {
                            v: SCHEMA_VERSION,
                            ply: pos.ply,
                            phase,
                            stage: AnalysisStage::PassProbe,
                            visits: visits_n,
                            root: engine_from_response(&resp),
                        },
                    );
                }
                AnalysisUpdate::Final(resp) => final_resp = Some(resp),
            }
            Ok(())
        })
        .await?;

    let resp = final_resp.ok_or_else(|| {
        PipelineError::Message(format!("missing pass-probe response for ply {}", pos.ply))
    })?;
    snap.pass_probe = engine_from_response(&resp);
    snap.pass_probe_skipped = None;
    send(
        tx,
        PipelineEvent::StageCompleted {
            v: SCHEMA_VERSION,
            ply: pos.ply,
            phase,
            stage: AnalysisStage::PassProbe,
            analysis: snap.pass_probe.clone(),
            skipped: None,
        },
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_pv_ends(
    phase: AnalysisPhase,
    record: &GameRecord,
    pos: &ReplayedPosition,
    rules: &str,
    client: &AnalysisClient,
    config: &PipelineConfig,
    tx: &Tx,
    snap: &mut PositionSnapshot,
    root_resp: &yagoo_katago::AnalysisResponse,
) -> PipelineResult<()> {
    let Some(infos) = root_resp.move_infos.as_ref() else {
        return Ok(());
    };
    let n = config.pv_end_count.min(config.top_k).min(infos.len());
    snap.pv_ends.clear();
    for (i, info) in infos.iter().take(n).enumerate() {
        let Some(pv) = info.pv.as_ref() else {
            continue;
        };
        if pv.is_empty() {
            continue;
        }
        // Play out PV on a clone of the game state.
        let mut g = pos.state.clone();
        for gtp in pv {
            if gtp.eq_ignore_ascii_case("pass") {
                g.play_pass()?;
            } else {
                let point = yagoo_core::Point::parse_gtp(gtp, record.size)?
                    .ok_or_else(|| PipelineError::Message(format!("bad PV move {gtp}")))?;
                g.play(point)?;
            }
        }

        let id = format!("p{}-deep-pv{i}", pos.ply);
        let query = AnalysisQueryBuilder::new(&id)
            .from_game_state(&g)
            .komi(record.komi)
            .rules(rules.to_owned())
            .max_visits(config.pv_end_visits)
            .report_as_black()
            .include_ownership(true)
            .include_moves_ownership(false)
            .build();
        let resp = client.analyze(&query).await?;
        let analysis = engine_from_response(&resp).ok_or_else(|| {
            PipelineError::Message(format!("PV-end missing rootInfo for ply {}", pos.ply))
        })?;
        snap.pv_ends.push(PvEndSnapshot {
            from_move: info.move_.clone(),
            pv: pv.clone(),
            analysis: analysis.clone(),
        });
        send(
            tx,
            PipelineEvent::StageCompleted {
                v: SCHEMA_VERSION,
                ply: pos.ply,
                phase,
                stage: AnalysisStage::PvEnd,
                analysis: Some(analysis),
                skipped: None,
            },
        )?;
    }
    Ok(())
}

fn send(tx: &Tx, ev: PipelineEvent) -> PipelineResult<()> {
    tx.send(ev)
        .map_err(|_| PipelineError::Message("event consumer dropped".into()))
}
