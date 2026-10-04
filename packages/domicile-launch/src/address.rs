//! Turns the argument to `domicile open-url` into a URL.
//!
//! Some programs (e.g. `cargo doc --open`) pass `BROWSER` a path instead of a
//! URL. The engine does not share the caller's working directory, so relative
//! paths become `file://` URLs here, as [`crate::shell_path`] does for
//! `load-shell`.

use std::path::Path;

/// Returns `target` if it is a URL, or else a `file://` URL for it relative to
/// `here`.
///
/// Only the scheme (RFC 3986) is checked. The engine parses and rejects
/// invalid URLs.
pub fn url_for(target: &str, here: &Path) -> String {
    match has_scheme(target) {
        true => target.to_string(),
        false => format!("file://{}", escaped(&here.join(target).to_string_lossy())),
    }
}

/// Whether `word` starts with a URL scheme and its colon.
fn has_scheme(word: &str) -> bool {
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

/// Percent-encodes every byte of `path` except unreserved ones and `/`.
fn escaped(path: &str) -> String {
    path.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}
