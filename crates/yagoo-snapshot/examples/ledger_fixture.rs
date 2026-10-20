//! Enrich one recorded deep snapshot without running an engine or changing evidence.
//! Usage: cargo run -p yagoo-snapshot --example ledger_fixture -- input.ndjson 50 output.json

use std::{env, error::Error, fs};
use yagoo_snapshot::{
    best_candidate, compute_ledger, AnalysisPhase, LedgerBaseline, PipelineEvent,
};

fn main() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<_> = env::args().skip(1).collect();
    if arguments.len() != 3 {
        return Err("expected input.ndjson ply output.json".into());
    }
    let ply: u32 = arguments[1].parse()?;
    for line in fs::read_to_string(&arguments[0])?.lines() {
        let event: PipelineEvent = serde_json::from_str(line)?;
        if let PipelineEvent::PositionCompleted {
            phase: AnalysisPhase::Deep,
            mut snapshot,
            ..
        } = event
        {
            if snapshot.ply != ply {
                continue;
            }
            snapshot.ledger = best_candidate(&snapshot)
                .and_then(|candidate| compute_ledger(&snapshot, candidate, LedgerBaseline::Pass));
            if snapshot.ledger.is_none() {
                return Err("recorded snapshot lacks ledger evidence".into());
            }
            fs::write(&arguments[2], serde_json::to_string_pretty(&snapshot)?)?;
            return Ok(());
        }
    }
    Err("deep ply not found in recording".into())
}
