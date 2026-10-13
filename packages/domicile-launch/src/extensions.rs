//! The extensions installed in the engine's profile, which the Settings app
//! lists, enables and disables.
//!
//! The same shape crosses three hops, as [`crate::media_devices`] does: the
//! engine's command socket, the control socket and the Settings app's native
//! messaging host.

use serde::{Deserialize, Serialize};

/// One installed extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledExtension {
    pub id: String,
    pub name: String,
    pub description: String,
    /// The manifest's version, such as `1.0`.
    pub version: String,
    pub enabled: bool,
    /// The extension's options page, or none when it has no options page.
    pub options_url: Option<String>,
}
