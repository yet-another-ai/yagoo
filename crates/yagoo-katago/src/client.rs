//! Async JSON-lines Analysis Engine client.
//!
//! **Concurrency model (decided):** one KataGo `analysis` process per client.
//! Multiple in-flight queries are multiplexed by response `id` (query demux).
//! Do **not** spawn multiple processes for parallelism — that does not fit a
//! future Web UI.

use crate::error::{KatagoError, KatagoResult};
use crate::types::{AnalysisQuery, AnalysisResponse, AnalysisUpdate};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as SyncMutex, Weak};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{sleep, Duration};

enum RouteMsg {
    Update(Box<AnalysisUpdate>),
    Failed(KatagoError),
}

enum StdinTransport {
    Process(ChildStdin),
    Scripted,
    #[cfg(test)]
    Test(Box<dyn tokio::io::AsyncWrite + Unpin + Send>),
}

struct WriteCommand {
    line: String,
    written: Option<oneshot::Sender<()>>,
}

struct Route {
    logical_id: String,
    tx: mpsc::UnboundedSender<RouteMsg>,
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
    writer: mpsc::UnboundedSender<WriteCommand>,
    scripted_written: SyncMutex<Vec<String>>,
    routes: SyncMutex<HashMap<String, Route>>,
    /// Static scripted fixtures may arrive before their logical query is registered.
    /// Real wire responses always follow registration; unknown wire IDs are discarded.
    orphans: SyncMutex<VecDeque<AnalysisResponse>>,
    scripted: bool,
    next_id: AtomicU64,
    stdout: Mutex<StdoutTransport>,
}

struct QueryGuard {
    inner: Arc<Inner>,
    wire_id: String,
}

impl Drop for QueryGuard {
    fn drop(&mut self) {
        // Synchronous removal makes the caller's logical ID reusable immediately.
        // The writer owns complete lines, so cancellation never interrupts a JSON write.
        let removed = self
            .inner
            .routes
            .lock()
            .expect("routes lock")
            .remove(&self.wire_id);
        if removed.is_some() {
            let line = serde_json::json!({
                "id": format!("{}-cancel", self.wire_id),
                "action": "terminate", "terminateId": self.wire_id,
            })
            .to_string();
            let _ = self.inner.writer.send(WriteCommand {
                line,
                written: None,
            });
        }
    }
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
        Ok(Self::from_transports(
            StdinTransport::Process(stdin),
            StdoutTransport::Process {
                stdout: BufReader::new(stdout),
                _child: Box::new(child),
            },
            false,
        ))
    }

    /// Scripted client for tests / CI. Demux by `id` like a real process.
    #[must_use]
    pub fn scripted(responses: Vec<String>) -> Self {
        Self::from_transports(
            StdinTransport::Scripted,
            StdoutTransport::Scripted {
                responses,
                cursor: 0,
            },
            true,
        )
    }

    fn from_transports(stdin: StdinTransport, stdout: StdoutTransport, scripted: bool) -> Self {
        let (writer, commands) = mpsc::unbounded_channel();
        let inner = Arc::new(Inner {
            writer,
            scripted_written: SyncMutex::new(Vec::new()),
            routes: SyncMutex::new(HashMap::new()),
            orphans: SyncMutex::new(VecDeque::new()),
            scripted,
            next_id: AtomicU64::new(1),
            stdout: Mutex::new(stdout),
        });
        Self::start_writer(Arc::downgrade(&inner), stdin, commands);
        Self::start_reader(Arc::downgrade(&inner));
        Self { inner }
    }

    fn start_writer(
        weak: Weak<Inner>,
        mut stdin: StdinTransport,
        mut commands: mpsc::UnboundedReceiver<WriteCommand>,
    ) {
        tokio::spawn(async move {
            while let Some(command) = commands.recv().await {
                let Some(inner) = weak.upgrade() else { break };
                let mut line = command.line;
                line.push('\n');
                let result = match &mut stdin {
                    StdinTransport::Process(stdin) => write_line(stdin, &line).await,
                    StdinTransport::Scripted => {
                        inner
                            .scripted_written
                            .lock()
                            .expect("scripted writes lock")
                            .push(line.trim_end_matches('\n').to_owned());
                        Ok(())
                    }
                    #[cfg(test)]
                    StdinTransport::Test(stdin) => write_line(stdin, &line).await,
                };
                if result.is_err() {
                    for (_, route) in inner.routes.lock().expect("routes lock").drain() {
                        let _ = route.tx.send(RouteMsg::Failed(KatagoError::ProcessExited));
                    }
                    break;
                }
                if let Some(written) = command.written {
                    let _ = written.send(());
                }
            }
        });
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
                            let pending = !inner.routes.lock().expect("routes lock").is_empty();
                            if !pending {
                                // Idle: keep task alive until client drops.
                                sleep(Duration::from_millis(20)).await;
                                continue;
                            }
                            sleep(Duration::from_millis(5)).await;
                            continue;
                        }
                        Err(_) => {
                            let mut routes = inner.routes.lock().expect("routes lock");
                            for (_, route) in routes.drain() {
                                let _ = route.tx.send(RouteMsg::Failed(KatagoError::ProcessExited));
                            }
                            break;
                        }
                    }
                };

                let resp: AnalysisResponse = match serde_json::from_str(&line) {
                    Ok(r) => r,
                    Err(e) => {
                        let mut routes = inner.routes.lock().expect("routes lock");
                        for (_, route) in routes.drain() {
                            let _ = route.tx.send(RouteMsg::Failed(KatagoError::Io(
                                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
                            )));
                        }
                        break;
                    }
                };

                dispatch_response(&inner, resp);
            }
        });
    }

    /// Lines written by a scripted client (test helper).
    pub fn scripted_writes(&self) -> impl std::future::Future<Output = Vec<String>> {
        std::future::ready(
            self.inner
                .scripted_written
                .lock()
                .expect("scripted writes lock")
                .clone(),
        )
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
    /// Dropping this future removes its route and queues a best-effort terminate.
    /// An independent writer finishes any pending JSON line before cancellation.
    pub async fn analyze_streaming<F>(
        &self,
        query: &AnalysisQuery,
        mut on_update: F,
    ) -> KatagoResult<()>
    where
        F: FnMut(AnalysisUpdate) -> KatagoResult<()>,
    {
        let wire_id = format!(
            "__yagoo_query_{}",
            self.inner.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let mut wire_query = query.clone();
        wire_query.id.clone_from(&wire_id);
        let line = serde_json::to_string(&wire_query)?;
        let (tx, mut rx) = mpsc::unbounded_channel();
        {
            let mut routes = self.inner.routes.lock().expect("routes lock");
            if routes.values().any(|route| route.logical_id == query.id) {
                return Err(KatagoError::Io(std::io::Error::other(format!(
                    "duplicate in-flight query id `{}`",
                    query.id
                ))));
            }
            routes.insert(
                wire_id.clone(),
                Route {
                    logical_id: query.id.clone(),
                    tx,
                },
            );
        }
        let _guard = QueryGuard {
            inner: Arc::clone(&self.inner),
            wire_id,
        };
        let (written, write_done) = oneshot::channel();
        self.inner
            .writer
            .send(WriteCommand {
                line,
                written: Some(written),
            })
            .map_err(|_| KatagoError::ProcessExited)?;
        write_done.await.map_err(|_| KatagoError::ProcessExited)?;

        // Only the scripted fixture transport permits responses before requests.
        let early = {
            let mut orphans = self.inner.orphans.lock().expect("orphans lock");
            let mut kept = VecDeque::new();
            let mut matching = Vec::new();
            while let Some(resp) = orphans.pop_front() {
                if resp.id == query.id {
                    matching.push(resp);
                } else {
                    kept.push_back(resp);
                }
            }
            *orphans = kept;
            matching
        };
        for response in early {
            dispatch_response(&self.inner, response);
        }

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

    /// Parse a response JSON string (fixture helper).
    pub fn parse_response(json: &str) -> KatagoResult<AnalysisResponse> {
        Ok(serde_json::from_str(json)?)
    }
}

fn dispatch_response(inner: &Inner, mut resp: AnalysisResponse) {
    let destination = {
        let mut routes = inner.routes.lock().expect("routes lock");
        let wire_id = if routes.contains_key(&resp.id) {
            Some(resp.id.clone())
        } else if inner.scripted && !resp.id.starts_with("__yagoo_query_") {
            routes
                .iter()
                .find(|(_, route)| route.logical_id == resp.id)
                .map(|(id, _)| id.clone())
        } else {
            None
        };
        let Some(wire_id) = wire_id else {
            // Keep fixture lookup and buffering under the route lock so query
            // registration cannot race an early scripted response into orphans.
            if inner.scripted && !resp.id.starts_with("__yagoo_query_") {
                inner.orphans.lock().expect("orphans lock").push_back(resp);
            }
            return;
        };
        {
            if resp.error.is_some() || !resp.is_during_search.unwrap_or(false) {
                routes
                    .remove(&wire_id)
                    .map(|route| (route.logical_id, route.tx))
            } else {
                routes
                    .get(&wire_id)
                    .map(|route| (route.logical_id.clone(), route.tx.clone()))
            }
        }
    };
    let Some((logical_id, tx)) = destination else {
        return;
    };
    resp.id = logical_id;
    deliver_to_route(&tx, resp);
}

async fn write_line<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    line: &str,
) -> std::io::Result<()> {
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await
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

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    use crate::AnalysisQueryBuilder;
    use tokio::io::{AsyncReadExt, DuplexStream};

    fn controlled_client(capacity: usize) -> (AnalysisClient, BufReader<DuplexStream>) {
        let (input, peer) = tokio::io::duplex(capacity);
        let client = AnalysisClient::from_transports(
            StdinTransport::Test(Box::new(input)),
            StdoutTransport::Scripted {
                responses: Vec::new(),
                cursor: 0,
            },
            false,
        );
        (client, BufReader::new(peer))
    }

    async fn next_line(peer: &mut BufReader<DuplexStream>) -> serde_json::Value {
        let mut line = String::new();
        peer.read_line(&mut line).await.unwrap();
        serde_json::from_str(&line).unwrap()
    }

    fn respond(client: &AnalysisClient, value: serde_json::Value) {
        dispatch_response(&client.inner, serde_json::from_value(value).unwrap());
    }

    #[tokio::test]
    async fn cancel_mid_write_then_reuse_logical_id_ignores_old_final_and_ack() {
        // A tiny pipe forces write_all to suspend in the middle of the first JSON.
        // This is a functional liveness timeout, not a performance requirement.
        tokio::time::timeout(Duration::from_secs(5), async {
            let (client, mut peer) = controlled_client(8);
            let old_client = client.clone();
            let old = tokio::spawn(async move {
                old_client.analyze(&AnalysisQueryBuilder::new("same").build()).await
            });
            let mut first = [0];
            peer.read_exact(&mut first).await.unwrap();
            assert_eq!(first, [b'{']);
            old.abort();
            assert!(old.await.unwrap_err().is_cancelled());
            assert!(client.inner.routes.lock().unwrap().is_empty());

            let new_client = client.clone();
            let new = tokio::spawn(async move {
                new_client.analyze(&AnalysisQueryBuilder::new("same").build()).await
            });
            let mut rest = String::from("{");
            peer.read_line(&mut rest).await.unwrap();
            let old_wire: serde_json::Value = serde_json::from_str(&rest).unwrap();
            let terminate = next_line(&mut peer).await;
            let new_wire = next_line(&mut peer).await;
            assert_eq!(terminate["action"], "terminate");
            assert_eq!(terminate["terminateId"], old_wire["id"]);
            assert_ne!(old_wire["id"], new_wire["id"]);
            assert!(new_wire.get("action").is_none());

            respond(&client, serde_json::json!({"id": old_wire["id"], "isDuringSearch": true, "rootInfo": {"visits": 2}}));
            respond(&client, serde_json::json!({"id": old_wire["id"], "isDuringSearch": false, "rootInfo": {"visits": 3}}));
            respond(&client, terminate);
            assert_eq!(client.inner.routes.lock().unwrap().len(), 1);
            assert!(client.inner.orphans.lock().unwrap().is_empty());
            respond(&client, serde_json::json!({"id": new_wire["id"], "isDuringSearch": false, "rootInfo": {"visits": 99}}));
            let result = new.await.unwrap().unwrap();
            assert_eq!(result.id, "same");
            assert_eq!(result.root_info.unwrap().visits, Some(99));
            assert!(client.inner.routes.lock().unwrap().is_empty());
        }).await.expect("cancelled query must not corrupt or block the next query");
    }

    #[tokio::test]
    async fn callback_failure_removes_route_and_terminates_only_its_query() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let (client, mut peer) = controlled_client(4096);
            let running_client = client.clone();
            let running = tokio::spawn(async move {
                running_client.analyze_streaming(&AnalysisQueryBuilder::new("reject-update").build(), |_| {
                    Err(KatagoError::MissingField("callback rejected update"))
                }).await
            });
            let query = next_line(&mut peer).await;
            respond(&client, serde_json::json!({"id": query["id"], "isDuringSearch": true, "rootInfo": {"visits": 1}}));
            assert!(matches!(running.await.unwrap(), Err(KatagoError::MissingField("callback rejected update"))));
            let terminate = next_line(&mut peer).await;
            assert_eq!(terminate["terminateId"], query["id"]);
            assert_eq!(terminate["action"], "terminate");
            assert!(client.inner.routes.lock().unwrap().is_empty());
        }).await.expect("callback failure must clean up the live query");
    }
}
