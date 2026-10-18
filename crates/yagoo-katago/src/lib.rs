//! Async client for `katago analysis` (JSON-lines over stdio).
//!
//! CI tests use recorded fixture JSON — they do **not** require a KataGo binary.

#![forbid(unsafe_code)]

mod client;
mod error;
mod query;
mod types;

pub use client::AnalysisClient;
pub use error::{KatagoError, KatagoResult};
pub use query::AnalysisQueryBuilder;
pub use types::{
    AnalysisQuery, AnalysisResponse, MoveInfo, MoveListEntry, OverrideSettings, PlayerToken,
    RootInfo,
};

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
