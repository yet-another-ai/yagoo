//! Yagoo core library.
//!
//! This crate is a scaffolding stub. Teaching modules (fate communities, tempo
//! sensitivity, score distribution, and the rest) will land here later. See
//! `docs/` for the design.

#![forbid(unsafe_code)]

/// Crate version string from Cargo.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_semverish() {
        assert_ne!(VERSION, "");
        assert!(VERSION.contains('.'));
    }
}
