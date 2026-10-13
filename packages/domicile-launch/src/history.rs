//! The engine's browsing history, which the History app searches and deletes
//! from, and the browsing data it clears.
//!
//! The same shapes cross three hops, as [`crate::extensions`] does: the
//! engine's command socket, the control socket and `domicile-app-host`. Times
//! are milliseconds since the epoch, fractional as `chrome.history` gives them.

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// How long the engine may take to clear browsing data. Clearing a large cache
/// or every site's storage takes far longer than any other command.
pub const CLEAR_WITHIN: Duration = Duration::from_secs(60);

/// A history search: rows whose URL or title has `text`, last visited before
/// `end_time`, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryQuery {
    pub text: String,
    pub end_time: f64,
    pub max_results: u32,
}

/// One page in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryItem {
    pub url: String,
    pub title: String,
    /// The page's favicon as a `data:` URL, or none when the engine has none.
    /// An app page cannot load `chrome://favicon2`.
    pub favicon: Option<String>,
}

/// Which browsing data to clear.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowsingData {
    /// The earliest time to clear from.
    pub since: f64,
    /// The kinds of data, such as `cookies`, which the engine checks.
    pub types: Vec<String>,
    /// The origins to clear, or none for every origin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<String>>,
}
