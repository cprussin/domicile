//! The data each site stores in the engine's profile, which the Settings app
//! lists and clears.
//!
//! The same shape crosses three hops, as [`crate::site_permissions`] does: the
//! engine's command socket, the control socket and `domicile-app-host`.

use serde::{Deserialize, Serialize};

/// What one host stores: cookies, local storage, IndexedDB and the rest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiteData {
    pub host: String,
    /// On disk, summed over every kind. A float, as the engine writes it, since
    /// it can pass what a JSON integer holds there.
    pub bytes: f64,
    pub cookies: u32,
}
