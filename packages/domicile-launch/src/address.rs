//! What `domicile open-url` hands the engine, from the word it was given.
//!
//! `BROWSER` is handed a URL by most programs and a path by some —
//! `cargo doc --open` is one — and a path is relative to a working directory
//! the engine does not share. So it is made a `file://` URL here, in front of
//! whoever typed it, the way [`crate::shell_path`] resolves `load-shell`'s.

use std::path::Path;

/// `target` as a URL: itself where it already is one, and the file it names
/// from `here` where it is not.
///
/// A URL is a word that starts with a scheme (RFC 3986: a letter, then
/// letters, digits, `+`, `-` or `.`, then `:`). Nothing else is checked: the
/// engine is what parses it, and one it cannot is refused there, by name.
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

/// A path, percent-encoded to go after `file://`: every byte but the
/// unreserved ones and `/`.
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
