//! Regenerate derivative comparison snapshots from the unchanged real corpus.
//! Usage: cargo run -p yagoo-pipeline --example comparison_fixture -- output.json
#[path = "../tests/common/mod.rs"]
mod common;

use yagoo_pipeline::analyze_move_comparison;
use yagoo_sgf::{move_to_gtp, parse_sgf, replay_main_line};
use yagoo_snapshot::{
    best_candidate, board_from_game, candidates_from_response, chains_from_game, compute_groups,
    compute_ledger, ColorToken, LedgerBaseline, PositionSnapshot,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("expected output.json")?;
    let record = parse_sgf(&std::fs::read_to_string(
        common::fixture_dir().join("source.sgf"),
    )?)?;
    let positions = replay_main_line(&record)?;
    let engine = common::RecordedEngine::load();
    let mut snapshots = vec![];
    for ply in [43_usize, 44, 50, 60, 96] {
        let position = &positions[ply];
        let comparison = analyze_move_comparison(&record, position, &engine, &common::config())
            .await?
            .ok_or("missing comparison")?;
        let mut snapshot = PositionSnapshot::empty_shell(
            position.ply,
            ColorToken::from(position.state.to_play()),
            board_from_game(&position.state),
            chains_from_game(&position.state),
        );
        snapshot.last_move = position
            .last_move
            .as_ref()
            .map(|mv| move_to_gtp(mv, record.size));
        snapshot.phase = Some("deep".into());
        if let Some(branch) = &comparison.context.actual_branch {
            snapshot.root = Some(branch.root.clone());
            snapshot.pass_probe.clone_from(&branch.pass_probe);
            snapshot.candidates =
                candidates_from_response(&engine.responses[&branch.root_query_id], 6);
            snapshot.groups = compute_groups(&snapshot);
            snapshot.ledger = best_candidate(&snapshot)
                .and_then(|candidate| compute_ledger(&snapshot, candidate, LedgerBaseline::Pass));
        }
        snapshot.comparison = Some(comparison);
        snapshots.push(snapshot);
    }
    std::fs::write(path, serde_json::to_vec(&snapshots)?)?;
    Ok(())
}
