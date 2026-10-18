//! Async JSON-lines Analysis Engine client.

use crate::error::{KatagoError, KatagoResult};
use crate::types::{AnalysisQuery, AnalysisResponse};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

enum Transport {
    Process {
        stdin: ChildStdin,
        stdout: BufReader<ChildStdout>,
        child: Box<Child>,
    },
    Scripted {
        responses: Vec<String>,
        cursor: usize,
        written: Vec<String>,
    },
}

impl Transport {
    async fn write_line(&mut self, line: &str) -> KatagoResult<()> {
        match self {
            Self::Process { stdin, .. } => {
                stdin.write_all(line.as_bytes()).await?;
                stdin.write_all(b"\n").await?;
                stdin.flush().await?;
                Ok(())
            }
            Self::Scripted { written, .. } => {
                written.push(line.to_owned());
                Ok(())
            }
        }
    }

    async fn read_line(&mut self) -> KatagoResult<Option<String>> {
        match self {
            Self::Process { stdout, child, .. } => {
                let mut buf = String::new();
                let n = stdout.read_line(&mut buf).await?;
                if n == 0 {
                    let _ = child.try_wait()?;
                    return Err(KatagoError::ProcessExited);
                }
                if buf.ends_with('\n') {
                    buf.pop();
                    if buf.ends_with('\r') {
                        buf.pop();
                    }
                }
                Ok(Some(buf))
            }
            Self::Scripted {
                responses, cursor, ..
            } => {
                if *cursor >= responses.len() {
                    return Ok(None);
                }
                let line = responses[*cursor].clone();
                *cursor += 1;
                Ok(Some(line))
            }
        }
    }
}

/// One update from a streaming analysis query.
#[derive(Clone, Debug)]
pub enum AnalysisUpdate {
    /// `isDuringSearch: true` progress report.
    Partial(AnalysisResponse),
    /// Final response for the query id.
    Final(AnalysisResponse),
}

/// Client for one `katago analysis` process (or a scripted stand-in).
///
/// Queries are single-flight (one in-flight query at a time per client). Spawn
/// multiple clients for process-level concurrency.
pub struct AnalysisClient {
    transport: Mutex<Transport>,
}

impl AnalysisClient {
    /// Spawn `katago analysis` with the given program and args (e.g. config + model).
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
        Ok(Self {
            transport: Mutex::new(Transport::Process {
                stdin,
                stdout: BufReader::new(stdout),
                child: Box::new(child),
            }),
        })
    }

    /// Scripted client that returns prepared JSON lines in order (for tests / CI).
    #[must_use]
    pub fn scripted(responses: Vec<String>) -> Self {
        Self {
            transport: Mutex::new(Transport::Scripted {
                responses,
                cursor: 0,
                written: Vec::new(),
            }),
        }
    }

    /// Lines written by a scripted client (test helper).
    pub async fn scripted_writes(&self) -> Vec<String> {
        let guard = self.transport.lock().await;
        match &*guard {
            Transport::Scripted { written, .. } => written.clone(),
            Transport::Process { .. } => Vec::new(),
        }
    }

    /// Send one query and wait for the matching finished response (skips partials).
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

    /// Stream during-search partials then the final response for `query`.
    ///
    /// Callback is invoked in order. Holds the client lock for the whole query
    /// (single-flight).
    pub async fn analyze_streaming<F>(
        &self,
        query: &AnalysisQuery,
        mut on_update: F,
    ) -> KatagoResult<()>
    where
        F: FnMut(AnalysisUpdate) -> KatagoResult<()>,
    {
        let line = serde_json::to_string(query)?;
        let mut guard = self.transport.lock().await;
        guard.write_line(&line).await?;

        loop {
            let Some(resp_line) = guard.read_line().await? else {
                return Err(KatagoError::ProcessExited);
            };
            let resp: AnalysisResponse = serde_json::from_str(&resp_line)?;
            if resp.id != query.id {
                continue;
            }
            if let Some(err) = resp.error.clone() {
                return Err(KatagoError::Engine {
                    id: resp.id,
                    error: err,
                });
            }
            if resp.is_during_search.unwrap_or(false) {
                on_update(AnalysisUpdate::Partial(resp))?;
                continue;
            }
            on_update(AnalysisUpdate::Final(resp))?;
            return Ok(());
        }
    }

    /// Parse a response JSON string (fixture helper).
    pub fn parse_response(json: &str) -> KatagoResult<AnalysisResponse> {
        Ok(serde_json::from_str(json)?)
    }
}
