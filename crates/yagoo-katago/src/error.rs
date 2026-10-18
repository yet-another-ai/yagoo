use thiserror::Error;

pub type KatagoResult<T> = Result<T, KatagoError>;

#[derive(Debug, Error)]
pub enum KatagoError {
    #[error("I/O error talking to KataGo: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("KataGo reported error for id `{id}`: {error}")]
    Engine { id: String, error: String },

    #[error("KataGo process exited unexpectedly")]
    ProcessExited,

    #[error("response missing field `{0}`")]
    MissingField(&'static str),

    #[error("invalid GTP move in response: `{0}`")]
    InvalidMove(String),
}
