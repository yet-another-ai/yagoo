//! `yagoo analyze` — stream NDJSON snapshot events from an SGF.

use clap::{Parser, Subcommand, ValueEnum};
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use yagoo_katago::AnalysisClient;
use yagoo_pipeline::{analyze_game, DeepSelectConfig, PipelineConfig, PipelineStrategy};
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
        /// First ply (0 = setup position). Optional range filter for scan + deep.
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
        /// Opt-in during-search `stagePartial` events (off by default).
        #[arg(long, default_value_t = false)]
        partials: bool,
        /// Seconds for KataGo `reportDuringSearchEvery` (requires `--partials`).
        #[arg(long, default_value_t = 0.5)]
        report_every: f64,
        /// Deepen every ply in the scanned range (skip swing auto-pick).
        #[arg(long, default_value_t = false)]
        deepen_all: bool,
        /// |\Delta winrate| threshold for swing selection (fraction).
        #[arg(long, default_value_t = 0.05)]
        swing_wr: f64,
        /// |\Delta scoreLead| threshold for swing selection (points).
        #[arg(long, default_value_t = 3.0)]
        swing_sl: f64,
        /// Mean |Δownership| threshold for swing selection.
        #[arg(long, default_value_t = 0.08)]
        swing_own: f64,
        /// Max plies to deepen after ranking by swing magnitude.
        #[arg(long, default_value_t = 24)]
        max_deep_plies: usize,
        /// Testing only: JSON array of engine response lines (`.json` or `.json.gz`).
        #[arg(long, hide = true)]
        scripted_fixture: Option<PathBuf>,
        /// Record raw KataGo stdout lines as a JSON array (local fixture regen).
        #[arg(long)]
        record_fixture: Option<PathBuf>,
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
            partials,
            report_every,
            deepen_all,
            swing_wr,
            swing_sl,
            swing_own,
            max_deep_plies,
            scripted_fixture,
            record_fixture,
        } => {
            let sgf_text = tokio::fs::read_to_string(&sgf).await?;
            let client = if let Some(fix) = scripted_fixture {
                let lines = load_scripted_fixture(&fix)?;
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
                AnalysisClient::spawn_with_recording(katago, &args, record_fixture.is_some())?
            };
            let client = Arc::new(client);

            let pipeline_cfg = PipelineConfig {
                strategy: strategy.into(),
                root_visits: visits,
                scan_visits,
                top_k,
                from_ply: from,
                to_ply: to,
                include_pv_ends: pv_ends,
                report_during_search_every: if partials { Some(report_every) } else { None },
                emit_game_aggregate: final_json.is_some(),
                deepen_all,
                deep_select: DeepSelectConfig {
                    winrate_threshold: swing_wr,
                    score_lead_threshold: swing_sl,
                    ownership_threshold: swing_own,
                    max_deep_plies,
                },
                ..PipelineConfig::default()
            };

            let mut out = open_output(&output).await?;
            let mut aggregate: Option<GameSnapshot> = None;
            let mut stream = analyze_game(&sgf_text, Arc::clone(&client), pipeline_cfg);
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

            if let Some(path) = record_fixture {
                let lines = client.recorded_lines().await;
                let trimmed: Vec<String> = lines.iter().map(|l| trim_response_line(l)).collect();
                write_scripted_fixture(&path, &trimmed)?;
                eprintln!(
                    "recorded {} KataGo response lines → {}",
                    trimmed.len(),
                    path.display()
                );
            }
        }
    }
    Ok(())
}

fn load_scripted_fixture(path: &Path) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let bytes = std::fs::read(path)?;
    let raw = if path.extension().is_some_and(|e| e == "gz")
        || path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".json.gz"))
    {
        let mut decoder = flate2::read::GzDecoder::new(bytes.as_slice());
        let mut s = String::new();
        std::io::Read::read_to_string(&mut decoder, &mut s)?;
        s
    } else {
        String::from_utf8(bytes)?
    };
    Ok(serde_json::from_str(&raw)?)
}

fn write_scripted_fixture(path: &Path, lines: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_vec(lines)?;
    if path.extension().is_some_and(|e| e == "gz")
        || path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".json.gz"))
    {
        use std::io::Write;
        let file = std::fs::File::create(path)?;
        let mut encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        encoder.write_all(&json)?;
        encoder.finish()?;
    } else {
        std::fs::write(path, json)?;
    }
    Ok(())
}

/// Drop bulky fields the pipeline does not need for groups / swing selection.
fn trim_response_line(line: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(line) else {
        return line.to_owned();
    };
    if let Some(obj) = v.as_object_mut() {
        obj.remove("policy");
        obj.remove("humanPolicy");
        if let Some(moves) = obj.get_mut("moveInfos").and_then(|m| m.as_array_mut()) {
            for m in moves {
                if let Some(mo) = m.as_object_mut() {
                    mo.remove("ownershipStdev");
                    // Keep ownership on candidates — needed for groups.
                }
            }
        }
        // Round floating arrays slightly to shrink fixtures.
        for key in ["ownership", "ownershipStdev"] {
            if let Some(arr) = obj.get_mut(key).and_then(|a| a.as_array_mut()) {
                for x in arr {
                    if let Some(n) = x.as_f64() {
                        *x = serde_json::json!((n * 1000.0).round() / 1000.0);
                    }
                }
            }
        }
        if let Some(moves) = obj.get_mut("moveInfos").and_then(|m| m.as_array_mut()) {
            for m in moves {
                if let Some(own) = m
                    .as_object_mut()
                    .and_then(|mo| mo.get_mut("ownership"))
                    .and_then(|a| a.as_array_mut())
                {
                    for x in own {
                        if let Some(n) = x.as_f64() {
                            *x = serde_json::json!((n * 1000.0).round() / 1000.0);
                        }
                    }
                }
            }
        }
    }
    serde_json::to_string(&v).unwrap_or_else(|_| line.to_owned())
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
