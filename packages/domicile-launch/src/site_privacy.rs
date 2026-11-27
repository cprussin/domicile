//! What a site changed of its privacy in a browser profile, as the engine
//! lists and sets it for the Settings app: its own ad blocking, and its own
//! protections beside it.
//!
//! The same shape crosses three hops, as [`crate::site_permissions`] does:
//! the engine's command socket ([`crate::command`]), the control socket
//! ([`crate::control`]) and the app host ([`crate::app_host`]). The engine
//! keeps it in `components/domicile/browser/site_privacy.h`; see
//! `docs/architecture/AD-BLOCKING.md`.

use std::collections::BTreeMap;

use domicile_config::AdBlocking;
use serde::{Deserialize, Deserializer, Serialize};

/// A protection a site turns on or off of its own, beside its ad blocking:
/// the engine's `PageProtection`, by the config key it overrides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiteProtection {
    HideDeviceDetails,
    RemoveTrackingFromLinks,
    HideCookieBanners,
}

/// One site with ad blocking or protections of its own in one browser
/// profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePrivacy {
    /// The browser profile's id.
    pub profile: String,
    /// The site, such as `nytimes.com`: a page's registrable domain, or its
    /// host when it has none.
    pub site: String,
    /// `None` for a site with only protections of its own.
    pub block_ads_and_trackers: Option<AdBlocking>,
    /// Each protection the site has on or off of its own.
    #[serde(default)]
    pub protections: BTreeMap<SiteProtection, bool>,
}

/// A change to one site in one browser profile. Whatever it leaves out is
/// left as it is; a `None` value goes back to the profile's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePrivacyChange {
    pub profile: String,
    pub site: String,
    /// Unset leaves the site's ad blocking; `Some(None)` goes back to the
    /// profile's.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub block_ads_and_trackers: Option<Option<AdBlocking>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub protections: BTreeMap<SiteProtection, Option<bool>>,
}

/// A field that is there, even as `null`: `Some(None)`, where a missing one
/// is `None` by `#[serde(default)]`.
fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}
