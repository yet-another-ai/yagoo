//! Async JSON-lines Analysis Engine client.
//!
//! **Concurrency model (decided):** one KataGo `analysis` process per client.
//! Multiple in-flight queries are multiplexed by response `id` (query demux).
//! Do **not** spawn multiple processes for parallelism — that does not fit a
//! future Web UI.

use crate::error::{KatagoError, KatagoResult};
use crate::types::{AnalysisQuery, AnalysisResponse};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::{Arc, Weak};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{sleep, Duration};

/// One update from a streaming analysis query.
#[derive(Clone, Debug)]
pub enum AnalysisUpdate {
    /// `isDuringSearch: true` progress report (only when requested).
    Partial(AnalysisResponse),
    /// Final response for the query id.
    Final(AnalysisResponse),
}

enum RouteMsg {
    Update(Box<AnalysisUpdate>),
    Failed(KatagoError),
}

enum StdinTransport {
    Process(ChildStdin),
    Scripted,
}

enum StdoutTransport {
    Process {
        stdout: BufReader<ChildStdout>,
        _child: Box<Child>,
    },
    Scripted {
        responses: Vec<String>,
        cursor: usize,
    },
}

struct Inner {
    stdin: Mutex<StdinTransport>,
    scripted_written: Mutex<Vec<String>>,
    /// Raw stdout lines (process mode only), for fixture recording.
    recorded_lines: Mutex<Vec<String>>,
    record: bool,
    routes: Mutex<HashMap<String, mpsc::UnboundedSender<RouteMsg>>>,
    /// Responses that arrived before their route was registered.
    orphans: Mutex<VecDeque<AnalysisResponse>>,
    stdout: Mutex<StdoutTransport>,
}

/// Client for **one** `katago analysis` process (or a scripted stand-in).
///
/// In-flight queries are demuxed by response `id`. Share via [`Clone`] / [`Arc`];
/// never open a second process for concurrency.
#[derive(Clone)]
pub struct AnalysisClient {
    inner: Arc<Inner>,
}

impl AnalysisClient {
    /// Spawn `katago analysis` with the given program and args.
    pub fn spawn(
        program: impl AsRef<std::ffi::OsStr>,
        args: &[impl AsRef<std::ffi::OsStr>],
    ) -> KatagoResult<Self> {
        Self::spawn_with_recording(program, args, false)
    }

    /// Like [`Self::spawn`], optionally recording every stdout JSON line for fixtures.
    pub fn spawn_with_recording(
        program: impl AsRef<std::ffi::OsStr>,
        args: &[impl AsRef<std::ffi::OsStr>],
        record: bool,
    ) -> KatagoResult<Self> {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| KatagoError::Io(std::io::Error::other("katago stdin missing")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| KatagoError::Io(std::io::Error::other("katago stdout missing")))?;
        let inner = Arc::new(Inner {
            stdin: Mutex::new(StdinTransport::Process(stdin)),
            scripted_written: Mutex::new(Vec::new()),
            recorded_lines: Mutex::new(Vec::new()),
            record,
            routes: Mutex::new(HashMap::new()),
            orphans: Mutex::new(VecDeque::new()),
            stdout: Mutex::new(StdoutTransport::Process {
                stdout: BufReader::new(stdout),
                _child: Box::new(child),
            }),
        });
        Self::start_reader(Arc::downgrade(&inner));
        Ok(Self { inner })
    }

    /// Scripted client for tests / CI. Demux by `id` like a real process.
    #[must_use]
    pub fn scripted(responses: Vec<String>) -> Self {
        let inner = Arc::new(Inner {
            stdin: Mutex::new(StdinTransport::Scripted),
            scripted_written: Mutex::new(Vec::new()),
            recorded_lines: Mutex::new(Vec::new()),
            record: false,
            routes: Mutex::new(HashMap::new()),
            orphans: Mutex::new(VecDeque::new()),
            stdout: Mutex::new(StdoutTransport::Scripted {
                responses,
                cursor: 0,
            }),
        });
        Self::start_reader(Arc::downgrade(&inner));
        Self { inner }
    }

    fn start_reader(weak: Weak<Inner>) {
        tokio::spawn(async move {
            loop {
                let Some(inner) = weak.upgrade() else {
                    break;
                };
                let line = {
                    let mut stdout = inner.stdout.lock().await;
                    match read_line(&mut stdout).await {
                        Ok(Some(line)) => line,
                        Ok(None) => {
                            drop(stdout);
                            // Scripted fixture exhausted, or process EOF.
                            // If routes remain, wait briefly for registration races.
                            let pending = !inner.routes.lock().await.is_empty();
                            if !pending {
                                // Idle: keep task alive until client drops.
                                sleep(Duration::from_millis(20)).await;
                                continue;
                            }
                            sleep(Duration::from_millis(5)).await;
                            continue;
                        }
                        Err(_) => {
                            let mut routes = inner.routes.lock().await;
                            for (_, tx) in routes.drain() {
                                let _ = tx.send(RouteMsg::Failed(KatagoError::ProcessExited));
                            }
                            break;
                        }
                    }
                };

                if inner.record {
                    inner.recorded_lines.lock().await.push(line.clone());
                }

                let resp: AnalysisResponse = match serde_json::from_str(&line) {
                    Ok(r) => r,
                    Err(e) => {
                        let mut routes = inner.routes.lock().await;
                        for (_, tx) in routes.drain() {
                            let _ = tx.send(RouteMsg::Failed(KatagoError::Io(
                                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
                            )));
                        }
                        break;
                    }
                };

                dispatch_response(&inner, resp).await;
            }
        });
    }

    /// Lines written by a scripted client (test helper).
    pub async fn scripted_writes(&self) -> Vec<String> {
        self.inner.scripted_written.lock().await.clone()
    }

    /// Raw engine stdout lines recorded when spawned with `record: true`.
    pub async fn recorded_lines(&self) -> Vec<String> {
        self.inner.recorded_lines.lock().await.clone()
    }

    /// Send one query and wait for the finished response (ignores partials).
    pub async fn analyze(&self, query: &AnalysisQuery) -> KatagoResult<AnalysisResponse> {
        let mut final_resp = None;
        self.analyze_streaming(query, |update| {
            if let AnalysisUpdate::Final(resp) = update {
                final_resp = Some(resp);
            }
            Ok(())
        })
        .await?;
        final_resp.ok_or(KatagoError::ProcessExited)
    }

    /// Stream optional during-search partials then the final response.
    ///
    /// Concurrent calls on the same client are supported via id demux.
    pub async fn analyze_streaming<F>(
        &self,
        query: &AnalysisQuery,
        mut on_update: F,
    ) -> KatagoResult<()>
    where
        F: FnMut(AnalysisUpdate) -> KatagoResult<()>,
    {
        let (tx, mut rx) = mpsc::unbounded_channel();
        {
            let mut routes = self.inner.routes.lock().await;
            if routes.contains_key(&query.id) {
                return Err(KatagoError::Io(std::io::Error::other(format!(
                    "duplicate in-flight query id `{}`",
                    query.id
                ))));
            }
            routes.insert(query.id.clone(), tx.clone());
        }

        // Deliver any orphaned responses that arrived early for this id.
        {
            let mut orphans = self.inner.orphans.lock().await;
            let mut kept = VecDeque::new();
            while let Some(resp) = orphans.pop_front() {
                if resp.id == query.id {
                    deliver_to_route(&tx, resp);
                } else {
                    kept.push_back(resp);
                }
            }
            *orphans = kept;
        }

        let line = serde_json::to_string(query)?;
        {
            let mut stdin = self.inner.stdin.lock().await;
            match &mut *stdin {
                StdinTransport::Process(stdin) => {
                    stdin.write_all(line.as_bytes()).await?;
                    stdin.write_all(b"\n").await?;
                    stdin.flush().await?;
                }
                StdinTransport::Scripted => {
                    self.inner.scripted_written.lock().await.push(line);
                }
            }
        }

        let result = async {
            while let Some(msg) = rx.recv().await {
                match msg {
                    RouteMsg::Update(update) => match *update {
                        AnalysisUpdate::Partial(resp) => {
                            on_update(AnalysisUpdate::Partial(resp))?;
                        }
                        AnalysisUpdate::Final(resp) => {
                            on_update(AnalysisUpdate::Final(resp))?;
                            return Ok(());
                        }
                    },
                    RouteMsg::Failed(err) => return Err(err),
                }
            }
            Err(KatagoError::ProcessExited)
        }
        .await;

        self.inner.routes.lock().await.remove(&query.id);
        result
    }

    /// Parse a response JSON string (fixture helper).
    pub fn parse_response(json: &str) -> KatagoResult<AnalysisResponse> {
        Ok(serde_json::from_str(json)?)
    }
}

async fn dispatch_response(inner: &Inner, resp: AnalysisResponse) {
    let tx = {
        let routes = inner.routes.lock().await;
        routes.get(&resp.id).cloned()
    };
    let Some(tx) = tx else {
        inner.orphans.lock().await.push_back(resp);
        return;
    };

    if let Some(err) = resp.error.clone() {
        inner.routes.lock().await.remove(&resp.id);
        let _ = tx.send(RouteMsg::Failed(KatagoError::Engine {
            id: resp.id,
            error: err,
        }));
        return;
    }

    if resp.is_during_search.unwrap_or(false) {
        let _ = tx.send(RouteMsg::Update(Box::new(AnalysisUpdate::Partial(resp))));
    } else {
        inner.routes.lock().await.remove(&resp.id);
        let _ = tx.send(RouteMsg::Update(Box::new(AnalysisUpdate::Final(resp))));
    }
}

fn deliver_to_route(tx: &mpsc::UnboundedSender<RouteMsg>, resp: AnalysisResponse) {
    if let Some(err) = resp.error.clone() {
        let _ = tx.send(RouteMsg::Failed(KatagoError::Engine {
            id: resp.id,
            error: err,
        }));
        return;
    }
    if resp.is_during_search.unwrap_or(false) {
        let _ = tx.send(RouteMsg::Update(Box::new(AnalysisUpdate::Partial(resp))));
    } else {
        let _ = tx.send(RouteMsg::Update(Box::new(AnalysisUpdate::Final(resp))));
    }
}

async fn read_line(stdout: &mut StdoutTransport) -> KatagoResult<Option<String>> {
    match stdout {
        StdoutTransport::Process { stdout, .. } => {
            let mut buf = String::new();
            let n = stdout.read_line(&mut buf).await?;
            if n == 0 {
                return Ok(None);
            }
            if buf.ends_with('\n') {
                buf.pop();
                if buf.ends_with('\r') {
                    buf.pop();
                }
            }
            Ok(Some(buf))
        }
        StdoutTransport::Scripted { responses, cursor } => {
            if *cursor >= responses.len() {
                return Ok(None);
            }
            let line = responses[*cursor].clone();
            *cursor += 1;
            Ok(Some(line))
        }
    }
}
