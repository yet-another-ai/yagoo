//! `yagoo analyze` — stream NDJSON snapshot events from an SGF.

use clap::{Parser, Subcommand, ValueEnum};
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use yagoo_katago::AnalysisClient;
use yagoo_pipeline::{analyze_game, PipelineConfig, PipelineStrategy};
use yagoo_snapshot::{GameSnapshot, PipelineEvent};

#[derive(Debug, Parser)]
#[command(name = "yagoo", version, about = "Yagoo Go teaching analysis CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Analyze an SGF: stream NDJSON events; optionally write a final aggregate JSON.
    Analyze {
        /// Input SGF path.
        sgf: PathBuf,
        /// NDJSON event stream output (default: stdout). Use `-` for stdout.
        #[arg(short, long, default_value = "-")]
        output: PathBuf,
        /// Optional aggregated `GameSnapshot` JSON written when the stream completes.
        #[arg(long)]
        final_json: Option<PathBuf>,
        /// KataGo binary (required unless `--scripted-fixture` is set).
        #[arg(long, env = "YAGOO_KATAGO")]
        katago: Option<PathBuf>,
        /// Model weights path (`.bin.gz` or engine-accepted path).
        #[arg(long, env = "YAGOO_MODEL")]
        model: Option<PathBuf>,
        /// KataGo analysis config `.cfg`.
        #[arg(long, env = "YAGOO_ANALYSIS_CONFIG")]
        config: Option<PathBuf>,
        /// Extra args appended after `analysis -model … -config …`.
        #[arg(long, num_args = 0..)]
        katago_extra: Vec<String>,
        /// Deep-phase root visits.
        #[arg(long, default_value_t = 800)]
        visits: u32,
        /// Scan-phase visits (`scan_then_deep` only).
        #[arg(long, default_value_t = 100)]
        scan_visits: u32,
        /// Top-K candidates to retain from moveInfos.
        #[arg(long, default_value_t = 6)]
        top_k: usize,
        /// First ply (0 = setup position).
        #[arg(long, default_value_t = 0)]
        from: u32,
        /// Last ply inclusive (default: end of game).
        #[arg(long)]
        to: Option<u32>,
        /// Prioritization strategy.
        #[arg(long, value_enum, default_value_t = StrategyArg::ScanThenDeep)]
        strategy: StrategyArg,
        /// Query PV-end ownership for top candidates (deep phase).
        #[arg(long, default_value_t = false)]
        pv_ends: bool,
        /// Disable during-search partial events.
        #[arg(long, default_value_t = false)]
        no_partials: bool,
        /// Seconds for KataGo `reportDuringSearchEvery`.
        #[arg(long, default_value_t = 0.5)]
        report_every: f64,
        /// Testing only: JSON array of engine response lines.
        #[arg(long, hide = true)]
        scripted_fixture: Option<PathBuf>,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum StrategyArg {
    ScanThenDeep,
    DeepOnly,
}

impl From<StrategyArg> for PipelineStrategy {
    fn from(s: StrategyArg) -> Self {
        match s {
            StrategyArg::ScanThenDeep => Self::ScanThenDeep,
            StrategyArg::DeepOnly => Self::DeepOnly,
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Analyze {
            sgf,
            output,
            final_json,
            katago,
            model,
            config,
            katago_extra,
            visits,
            scan_visits,
            top_k,
            from,
            to,
            strategy,
            pv_ends,
            no_partials,
            report_every,
            scripted_fixture,
        } => {
            let sgf_text = tokio::fs::read_to_string(&sgf).await?;
            let client = if let Some(fix) = scripted_fixture {
                let raw = tokio::fs::read_to_string(&fix).await?;
                let lines: Vec<String> = serde_json::from_str(&raw)?;
                AnalysisClient::scripted(lines)
            } else {
                let katago = katago.ok_or("missing --katago (or YAGOO_KATAGO)")?;
                let model = model.ok_or("missing --model (or YAGOO_MODEL)")?;
                let config = config.ok_or("missing --config (or YAGOO_ANALYSIS_CONFIG)")?;
                let mut args = vec![
                    "analysis".into(),
                    "-model".into(),
                    path_str(&model),
                    "-config".into(),
                    path_str(&config),
                ];
                args.extend(katago_extra);
                AnalysisClient::spawn(katago, &args)?
            };

            let pipeline_cfg = PipelineConfig {
                strategy: strategy.into(),
                root_visits: visits,
                scan_visits,
                top_k,
                from_ply: from,
                to_ply: to,
                include_pv_ends: pv_ends,
                report_during_search_every: if no_partials {
                    None
                } else {
                    Some(report_every)
                },
                emit_game_aggregate: final_json.is_some(),
                ..PipelineConfig::default()
            };

            let mut out = open_output(&output).await?;
            let mut aggregate: Option<GameSnapshot> = None;
            let mut stream = analyze_game(&sgf_text, Arc::new(client), pipeline_cfg);
            while let Some(item) = stream.next().await {
                let ev = item.map_err(|e| e.to_string())?;
                if let PipelineEvent::GameCompleted { game, .. } = &ev {
                    aggregate = game.as_ref().map(|g| (**g).clone());
                }
                let line = serde_json::to_string(&ev)?;
                out.write_all(line.as_bytes()).await?;
                out.write_all(b"\n").await?;
                out.flush().await?;
            }

            if let (Some(path), Some(game)) = (final_json, aggregate) {
                let pretty = serde_json::to_vec_pretty(&game)?;
                tokio::fs::write(path, pretty).await?;
            }
        }
    }
    Ok(())
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

async fn open_output(
    path: &Path,
) -> std::io::Result<Box<dyn tokio::io::AsyncWrite + Unpin + Send>> {
    if path == Path::new("-") {
        Ok(Box::new(tokio::io::stdout()))
    } else {
        Ok(Box::new(tokio::fs::File::create(path).await?))
    }
}
