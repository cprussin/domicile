//! Which installed applications and bookmarks a launcher offers.
//!
//! Every desktop entry in the XDG data directories is an application. The
//! config filters them with globs over desktop file IDs: the entry's path
//! under `applications/`, with `/` read as `-`. A bookmark is a name and a URL
//! the desk opens itself. See `docs/LAUNCHER.md`.

use serde::{Deserialize, Deserializer};

use crate::files::Omit;

/// What a launcher's applications are chosen from.
///
/// `PartialEq` lets a reload detect a change, as for [`crate::FilesConfig`].
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ApplicationsConfig {
    /// Desktop file IDs to leave out, with `files.omit`'s rules: a pattern
    /// starting with `!` takes an ID back, and the last matching pattern wins.
    /// `["*", "!launcher-*"]` offers only IDs starting with `launcher-`.
    ///
    /// The default omits nothing, unlike `files.omit`: a package installs an
    /// entry so that it can be launched.
    pub omit: Omit,
    /// URLs a launcher offers by name, matched like an application.
    pub bookmarks: Vec<Bookmark>,
}

/// A URL a launcher offers by name.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bookmark {
    /// The launcher row's label, which queries match against.
    pub name: String,
    /// The page to open: an `http` or `https` URL.
    #[serde(deserialize_with = "web_url")]
    pub url: String,
}

/// Accepts only `http` and `https` URLs.
///
/// The launcher opens the URL as a page and loads the site's icon from it. A
/// bare `calendar.google.com` would crash the page that draws it.
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
