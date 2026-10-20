//! Loopback HTTP transport. The pipeline stays local; only serialized events cross
//! the bounded channel into Hyper's response body.
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderValue, Method, StatusCode, Uri},
    middleware::{self, Next},
    response::{sse::Event, IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use futures::{future::LocalBoxFuture, StreamExt};
use serde::Deserialize;
use std::{convert::Infallible, net::Ipv4Addr, sync::Arc};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use yagoo_katago::{AnalysisClient, AnalysisQuery, AnalysisUpdate, KatagoResult};
use yagoo_pipeline::{
    analyze_game, complete_position, prepare_position, AnalysisEngine, InteractivePositionRequest,
    PipelineConfig, PreparedPosition, UpdateCallback,
};
use yagoo_snapshot::{PipelineEvent, SCHEMA_VERSION};

type HttpError = (StatusCode, String);
type EventSender = mpsc::Sender<Result<Event, Infallible>>;

#[derive(Clone)]
pub struct ServeOptions {
    port: u16,
    origins: Vec<HeaderValue>,
}

impl ServeOptions {
    pub fn new(port: u16, mut origins: Vec<String>) -> Result<Self, Box<dyn std::error::Error>> {
        if origins.is_empty() {
            origins = vec![
                "http://localhost:5173".into(),
                "http://127.0.0.1:5173".into(),
            ];
        }
        let origins = origins
            .into_iter()
            .map(|origin| {
                let uri: Uri = origin.parse()?;
                if !matches!(uri.scheme_str(), Some("http" | "https"))
                    || uri.host().is_none()
                    || uri
                        .authority()
                        .is_some_and(|a| a.as_str().contains(['@', '*']))
                    || uri.path_and_query().is_some_and(|p| p.as_str() != "/")
                    || origin.ends_with('/')
                {
                    return Err(
                        "expected an exact HTTP(S) origin, without a path or wildcard".into(),
                    );
                }
                Ok(HeaderValue::from_str(&origin)?)
            })
            .collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;
        Ok(Self { port, origins })
    }
}

#[derive(Clone)]
struct AppState {
    jobs: mpsc::Sender<Job>,
    slots: Arc<Semaphore>,
    default_sgf: Option<String>,
    options: ServeOptions,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchRequest {
    sgf: String,
}

enum Work {
    Batch(String),
    Position(Box<PreparedPosition>),
}

struct Job {
    work: Work,
    events: EventSender,
    _slot: OwnedSemaphorePermit,
}

/// Namespace logical IDs while retaining one shared process and its wire demux.
struct RequestEngine<E> {
    engine: Arc<E>,
    id: u64,
    partials: bool,
}

impl<E: AnalysisEngine> AnalysisEngine for RequestEngine<E> {
    fn analyze_streaming<'a>(
        &'a self,
        query: &'a AnalysisQuery,
        on_update: &'a mut UpdateCallback<'_>,
    ) -> LocalBoxFuture<'a, KatagoResult<()>> {
        Box::pin(async move {
            let mut query = query.clone();
            query.id = format!("request-{}:{}", self.id, query.id);
            self.engine
                .analyze_streaming(&query, &mut |update| {
                    if self.partials || !matches!(update, AnalysisUpdate::Partial(_)) {
                        on_update(update)?;
                    }
                    Ok(())
                })
                .await
        })
    }
}

pub async fn run(
    client: Arc<AnalysisClient>,
    sgf: Option<String>,
    config: PipelineConfig,
    mut options: ServeOptions,
) -> Result<(), Box<dyn std::error::Error>> {
    // No non-loopback bind option: origin permission never exposes the listener.
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, options.port)).await?;
    options.port = listener.local_addr()?.port();
    eprintln!("Native analysis: http://127.0.0.1:{}/analyze", options.port);
    tokio::task::LocalSet::new()
        .run_until(async move {
            let app = router(client, sgf, config, options);
            tokio::select! {
                result = axum::serve(listener, app) => result,
                result = tokio::signal::ctrl_c() => result,
            }
        })
        .await?;
    Ok(())
}

fn router<E: AnalysisEngine + 'static>(
    client: Arc<E>,
    sgf: Option<String>,
    config: PipelineConfig,
    options: ServeOptions,
) -> Router {
    let (jobs, mut requests) = mpsc::channel::<Job>(4);
    tokio::task::spawn_local(async move {
        let mut id = 0;
        while let Some(job) = requests.recv().await {
            id += 1;
            let engine = Arc::new(RequestEngine {
                engine: Arc::clone(&client),
                id,
                partials: config.report_during_search_every.is_some(),
            });
            let config = config.clone();
            tokio::task::spawn_local(async move {
                let Job {
                    work,
                    events,
                    _slot,
                } = job;
                // Body drop closes the channel even while the engine is awaiting
                // its first response. Dropping drive cancels its query future.
                tokio::select! {
                    biased;
                    () = events.closed() => {},
                    () = drive(work, engine, config, &events) => {},
                }
            });
        }
    });
    let state = AppState {
        jobs,
        slots: Arc::new(Semaphore::new(4)),
        default_sgf: sgf,
        options,
    };
    Router::new()
        .route("/health", get(|| async { "yagoo-native/1" }))
        .route("/analyze", get(default_analysis).post(batch_analysis))
        .route("/analyze-position", post(position_analysis))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), access_policy))
        .with_state(state)
}

async fn access_policy(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok());
    let port = state.options.port;
    if !matches!(host, Some(h) if h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"))
    {
        return (StatusCode::FORBIDDEN, "invalid local Host").into_response();
    }
    let origin = headers.get(header::ORIGIN).cloned();
    if origin
        .as_ref()
        .is_some_and(|o| !state.options.origins.contains(o))
        || (origin.is_none()
            && headers
                .get("sec-fetch-site")
                .is_some_and(|s| s != "same-origin" && s != "none"))
    {
        return (
            StatusCode::FORBIDDEN,
            "browser origin is not allowed; use --allow-origin",
        )
            .into_response();
    }
    let mut response = if request.method() == Method::OPTIONS {
        if origin.is_none() {
            return (
                StatusCode::FORBIDDEN,
                "preflight requires an allowed origin",
            )
                .into_response();
        }
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    if let Some(origin) = origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type"),
        );
        headers.insert(
            "access-control-allow-private-network",
            HeaderValue::from_static("true"),
        );
    }
    response
}

async fn default_analysis(State(state): State<AppState>) -> Result<Response, HttpError> {
    let sgf = state
        .default_sgf
        .clone()
        .ok_or_else(|| bad_request("POST {sgf} or start with an SGF path"))?;
    enqueue(&state, Work::Batch(sgf))
}

async fn batch_analysis(
    State(state): State<AppState>,
    Json(body): Json<BatchRequest>,
) -> Result<Response, HttpError> {
    enqueue(&state, Work::Batch(body.sgf))
}

async fn position_analysis(
    State(state): State<AppState>,
    Json(body): Json<InteractivePositionRequest>,
) -> Result<Response, HttpError> {
    let position = prepare_position(&body).map_err(|error| bad_request(error.to_string()))?;
    enqueue(&state, Work::Position(Box::new(position)))
}

fn bad_request(message: impl Into<String>) -> HttpError {
    (StatusCode::BAD_REQUEST, message.into())
}

fn enqueue(state: &AppState, work: Work) -> Result<Response, HttpError> {
    let slot = Arc::clone(&state.slots).try_acquire_owned().map_err(|_| {
        (
            StatusCode::TOO_MANY_REQUESTS,
            "four analyses already active".into(),
        )
    })?;
    let (events, receiver) = mpsc::channel(8);
    state
        .jobs
        .try_send(Job {
            work,
            events,
            _slot: slot,
        })
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "analysis dispatcher unavailable".into(),
            )
        })?;
    let stream = futures::stream::unfold(receiver, |mut receiver| async {
        receiver.recv().await.map(|event| (event, receiver))
    });
    Ok(Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::default())
        .into_response())
}

async fn drive<E: AnalysisEngine + 'static>(
    work: Work,
    engine: Arc<E>,
    config: PipelineConfig,
    events: &EventSender,
) {
    match work {
        Work::Batch(sgf) => {
            let mut stream = analyze_game(&sgf, engine, config);
            while let Some(event) = stream.next().await {
                let event = event.unwrap_or_else(|e| error_event(e.to_string()));
                if !send(events, &event).await {
                    break;
                }
            }
        }
        Work::Position(prepared) => {
            let event = complete_position(*prepared, engine.as_ref(), config.top_k)
                .await
                .unwrap_or_else(|error| error_event(error.to_string()));
            send(events, &event).await;
        }
    }
}

fn error_event(message: String) -> PipelineEvent {
    PipelineEvent::Error {
        v: SCHEMA_VERSION,
        message,
        ply: None,
    }
}

async fn send(events: &EventSender, event: &PipelineEvent) -> bool {
    // Identical serialized JSON to the CLI's NDJSON writer, with SSE framing only.
    let event = Event::default()
        .json_data(event)
        .expect("PipelineEvent serializes");
    events.send(Ok(event)).await.is_ok()
}

#[cfg(test)]
mod tests;
