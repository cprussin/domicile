//! A site's own ad blocking in a browser profile, as the engine lists and
//! sets it for the Settings app.
//!
//! The same shape crosses three hops, as [`crate::site_permissions`] does:
//! the engine's command socket ([`crate::command`]), the control socket
//! ([`crate::control`]) and the app host ([`crate::app_host`]). The engine
//! keeps it in `components/domicile/browser/site_privacy.h`; see
//! `docs/architecture/AD-BLOCKING.md`.

use domicile_config::AdBlocking;
use serde::{Deserialize, Serialize};

/// One site with its own ad blocking in one browser profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePrivacy {
    /// The browser profile's id.
    pub profile: String,
    /// The site, such as `nytimes.com`: a page's registrable domain, or its
    /// host when it has none.
    pub site: String,
    pub block_ads_and_trackers: AdBlocking,
}

/// A change to one site's ad blocking in one browser profile: `None` goes
/// back to the profile's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePrivacyChange {
    pub profile: String,
    pub site: String,
    pub block_ads_and_trackers: Option<AdBlocking>,
}
