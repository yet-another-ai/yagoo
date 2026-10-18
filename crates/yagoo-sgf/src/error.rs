use thiserror::Error;
use yagoo_core::CoreError;

pub type SgfResult<T> = Result<T, SgfError>;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SgfError {
    #[error("empty SGF input")]
    Empty,

    #[error("unexpected end of SGF input")]
    UnexpectedEof,

    #[error("expected `{0}` in SGF")]
    Expected(&'static str),

    #[error("invalid SGF property value `{0}`")]
    InvalidValue(String),

    #[error("unsupported board size {0}")]
    UnsupportedSize(u8),

    #[error(transparent)]
    Core(#[from] CoreError),
}
