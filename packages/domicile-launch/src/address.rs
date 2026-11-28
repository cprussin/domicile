//! Turns the web address `domicile open` or `BROWSER` is given into a URL.
//!
//! Some programs (e.g. `cargo doc --open`) pass `BROWSER` a path instead of a
//! URL. The engine does not share the caller's working directory, so relative
//! paths become `file://` URLs here, as [`crate::shell_path`] does for
//! `load-shell`.

use std::path::Path;

use domicile_host::uri::{percent_encoded, PATH};

/// Returns `target` if it is a URL, or else a `file://` URL for it relative to
/// `here`.
///
/// Only the scheme (RFC 3986) is checked. The engine parses and rejects
/// invalid URLs.
pub fn url_for(target: &str, here: &Path) -> String {
    match has_scheme(target) {
        true => target.to_string(),
        false => format!(
            "file://{}",
            percent_encoded(&here.join(target).to_string_lossy(), PATH)
        ),
    }
}

/// Whether `word` starts with a URL scheme and its colon.
pub(crate) fn has_scheme(word: &str) -> bool {
    match word.split_once(':') {
        Some((scheme, _)) => {
            let mut chars = scheme.chars();
            chars
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        }
        None => false,
    }
}
