use thiserror::Error;

pub type PipelineResult<T> = Result<T, PipelineError>;

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error(transparent)]
    Sgf(#[from] yagoo_sgf::SgfError),

    #[error(transparent)]
    Core(#[from] yagoo_core::CoreError),

    #[error(transparent)]
    Katago(#[from] yagoo_katago::KatagoError),

    #[error("pipeline: {0}")]
    Message(String),
}
