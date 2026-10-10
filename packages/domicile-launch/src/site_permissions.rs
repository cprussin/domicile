//! A site's stored permission, as the engine reports and sets it.
//!
//! The same shape crosses three hops: the engine's command socket
//! ([`crate::command`]), the control socket ([`crate::control`]) and the
//! Settings app's native messaging host ([`crate::settings`]). The names match
//! the shell's `WEBVIEW_PERMISSIONS` and the engine's
//! `components/domicile/browser/site_permissions.h`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Every permission's default and every site's own setting.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteSettings {
    /// What a site with no setting of its own gets.
    pub defaults: BTreeMap<Permission, Setting>,
    pub sites: Vec<SitePermission>,
}

/// One permission one site has a stored setting for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePermission {
    /// The site's origin, such as `https://meet.example`.
    pub origin: String,
    pub permission: Permission,
    pub setting: Setting,
}

/// A permission a site can be granted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    Camera,
    Microphone,
    Location,
    Notifications,
    Clipboard,
    Midi,
}

/// What a site gets when it asks. Setting a permission's default removes the
/// site's own setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Setting {
    Ask,
    Allow,
    Block,
}
