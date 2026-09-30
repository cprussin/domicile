//! Which of the machine's applications a launcher is offered.
//!
//! Every desktop entry the XDG data directories hold is an application, which
//! on a real machine is every package's idea of what belongs in a menu. So
//! what is offered is the desk's to say, here, as globs over desktop file IDs
//! — the entry's path under `applications/`, a `/` read as `-`.
//!
//! A bookmark is the other thing a launcher offers beside them: a name and a
//! URL the desk opens itself, rather than a program handing it to a browser.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer};

use crate::files::Omit;

/// What a launcher's applications are chosen from.
///
/// Compared, like [`crate::FilesConfig`]: a reload asks what moved.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ApplicationsConfig {
    /// The desktop file IDs left out, by `files.omit`'s rules: a pattern that
    /// starts with `!` takes an ID back, and the last pattern to match one
    /// decides it. So `["*", "!launcher-*"]` is a desk that offers only its
    /// own.
    ///
    /// **SAYING NOTHING OMITS NOTHING**, unlike `files.omit`: an entry is
    /// already something its package meant to be launched.
    pub omit: Omit,
    /// The URLs a launcher offers by name, matched like an application.
    pub bookmarks: Vec<Bookmark>,
}

/// A URL a launcher offers by name.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bookmark {
    /// What a launcher's row says, and what a query is matched against.
    pub name: String,
    /// What choosing it opens: an `http` or `https` URL.
    #[serde(deserialize_with = "web_url")]
    pub url: String,
    /// Which of the bookmark's URLs `url` is, `Home` say, for a launcher's row
    /// to say beside the name.
    #[serde(default)]
    pub label: Option<String>,
    /// A word, `!mp` say, and what choosing it opens instead when a launcher's
    /// query holds that word.
    #[serde(default)]
    pub shortcodes: BTreeMap<String, Shortcode>,
}

/// What a bookmark opens when a launcher's query holds one of its shortcodes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shortcode {
    /// What choosing the bookmark opens: an `http` or `https` URL.
    #[serde(deserialize_with = "web_url")]
    pub url: String,
    /// Which of the bookmark's URLs this is, for a launcher's row to say.
    #[serde(default)]
    pub label: Option<String>,
}

/// A URL a launcher can open as a page and draw a site's icon from, which is
/// one with a scheme it browses: `calendar.google.com` alone is refused here
/// rather than crashing the page that draws it.
fn web_url<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let url = String::deserialize(deserializer)?;
    let lower = url.to_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    match rest {
        Some(host) if !host.is_empty() => Ok(url),
        _ => Err(serde::de::Error::custom(format!(
            "`{url}` is not an http or https URL"
        ))),
    }
}

impl Default for ApplicationsConfig {
    fn default() -> Self {
        ApplicationsConfig {
            omit: Omit::try_from(Vec::new()).expect("no patterns is no globs to get wrong"),
            bookmarks: Vec::new(),
        }
    }
}
