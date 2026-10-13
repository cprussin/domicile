//! The protocol the supervisor uses to send `load-shell`, `open-url`, the
//! Settings app's site permissions, extensions and media devices, and the
//! History app's history and browsing data to the engine.
//!
//! One JSON line each way per connection:
//!
//! ```text
//! {"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
//! {"type":"loaded"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"open_url","version":1,"url":"https://example.com/"}
//! {"type":"open_url","version":1,"url":"https://example.com/","app":true}
//! {"type":"opened"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"site_permissions","version":1}
//! {"type":"site_permissions","defaults":{"camera":"ask",…},"sites":[{"origin":"https://meet.example","permission":"camera","setting":"allow"}]}
//!
//! {"type":"set_site_permission","version":1,"origin":"https://meet.example","permission":"camera","setting":"block"}
//! {"type":"set"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"load_unpacked","version":1,"directory":"/home/me/src/my-extension"}
//! {"type":"loaded_unpacked","id":"…"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"uninstall_extension","version":1,"id":"…"}
//! {"type":"uninstalled"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"config_extensions","version":1}
//! {"type":"config_extensions","ids":["…"]}
//!
//! {"type":"media_devices","version":1}
//! {"type":"media_devices","cameras":[{"id":"/dev/video2","name":"USB Camera"}],"microphones":[…]}
//!
//! {"type":"set_media_device","version":1,"kind":"camera","id":"/dev/video2"}
//! {"type":"set"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"extensions","version":1}
//! {"type":"extensions","extensions":[{"id":"…","name":"…","description":"…","version":"1.0","enabled":true,"options_url":"chrome-extension://…/options.html"}]}
//! {"type":"refused","why":"…"}
//!
//! {"type":"set_extension_enabled","version":1,"id":"…","enabled":false}
//! {"type":"set"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"history","version":1,"text":"…","end_time":1700000000123.5,"max_results":100}
//! {"type":"history","items":[{"url":"…","title":"…","favicon":"data:…"}]}   |   {"type":"refused","why":"…"}
//!
//! {"type":"visits","version":1,"url":"https://example.com/"}
//! {"type":"visits","times":[1700000000123.5]}   |   {"type":"refused","why":"…"}
//!
//! {"type":"delete_history","version":1,"visits":[1700000000123.5]}
//! {"type":"deleted"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"clear_browsing_data","version":1,"since":0,"types":["cookies"],"origins":["https://example.com"]}
//! {"type":"cleared"}   |   {"type":"refused","why":"…"}
//! ```
//!
//! `options_url` is left out for an extension without an options page, and
//! `favicon` for a history row without a favicon. `origins` is left out to
//! clear every origin. Times are milliseconds since the epoch, fractional.
//!
//! The engine side is C++ in the fork
//! (`components/domicile/browser/command_protocol.cc`, tested in
//! `command_protocol_unittest.cc`) and is released separately
//! (`packages/domicile-engine/engine-release.nix`). Nothing shares code
//! between the two, so the tests here assert the exact bytes.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::extensions::InstalledExtension;
use crate::history::{BrowsingData, HistoryItem, HistoryQuery};
use crate::media_devices::{MediaDevices, MediaKind};
use crate::site_permissions::{Permission, Setting, SitePermission, SiteSettings};

/// The protocol version the supervisor sends and the engine checks.
///
/// Versioned per [`DATA.md`](/docs/guidelines/DATA.md) because the pinned
/// engine is often older than `domicile`. The engine refuses versions it does
/// not support. Bump this when a request changes in a way an older engine
/// would misread.
const VERSION: u32 = 1;

/// The engine's reply.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Reply {
    /// The engine is serving the shell.
    Loaded,
    /// The engine passed the address to the shell.
    Opened,
    /// Every permission's default and every site's own setting.
    SitePermissions(SiteSettings),
    /// The engine stored a site's setting, a preferred media device or
    /// whether an extension is enabled.
    Set,
    /// The engine loaded an unpacked extension, which has this id.
    LoadedUnpacked { id: String },
    /// The engine uninstalled an extension.
    Uninstalled,
    /// The ids of the extensions the desk's config installed.
    ConfigExtensions { ids: Vec<String> },
    /// Each kind's media devices, most preferred first.
    MediaDevices(MediaDevices),
    /// Every extension installed in the engine's profile.
    Extensions { extensions: Vec<InstalledExtension> },
    /// The history rows a search found, newest first.
    History { items: Vec<HistoryItem> },
    /// When a page was visited, in milliseconds since the epoch.
    Visits { times: Vec<f64> },
    /// The engine deleted the visits.
    Deleted,
    /// The engine cleared the browsing data.
    Cleared,
    /// The engine refused, with its reason.
    Refused { why: String },
}

/// The request to serve the shell `module` from `root`.
///
/// `root` must be absolute; the engine refuses relative paths. Resolve user
/// input with [`crate::shell_path`] first.
pub fn load_shell_line(root: &Path, module: &Path) -> String {
    line(&Command::LoadShell {
        module,
        root,
        version: VERSION,
    })
}

/// The request to serve the app module `module` under `root` and open an app
/// window on it. See `docs/architecture/APP-MODULES.md`.
pub fn run_app_line(root: &Path, module: &Path) -> String {
    line(&Command::RunApp {
        module,
        root,
        version: VERSION,
    })
}

/// The request to open `url` in the shell. The engine validates `url`.
pub fn open_url_line(url: &str) -> String {
    line(&Command::OpenUrl {
        url,
        version: VERSION,
        app: false,
    })
}

/// The request to open `url` in an app window: a browser window the shell
/// draws without an address bar. An engine that predates `app` ignores it and
/// opens a browser window.
pub fn open_app_line(url: &str) -> String {
    line(&Command::OpenUrl {
        url,
        version: VERSION,
        app: true,
    })
}

/// The request for every site's stored permissions.
pub fn site_permissions_line() -> String {
    line(&Command::SitePermissions { version: VERSION })
}

/// The request to store `site`'s setting.
pub fn set_site_permission_line(site: &SitePermission) -> String {
    line(&Command::SetSitePermission {
        version: VERSION,
        origin: &site.origin,
        permission: site.permission,
        setting: site.setting,
    })
}

/// The request to load the unpacked extension in `directory`, which must be
/// absolute.
pub fn load_unpacked_line(directory: &Path) -> String {
    line(&Command::LoadUnpacked {
        version: VERSION,
        directory,
    })
}

/// The request to uninstall extension `id`.
pub fn uninstall_extension_line(id: &str) -> String {
    line(&Command::UninstallExtension {
        version: VERSION,
        id,
    })
}

/// The request for the ids of the extensions the desk's config installed.
pub fn config_extensions_line() -> String {
    line(&Command::ConfigExtensions { version: VERSION })
}

/// The request for the cameras and microphones, most preferred first.
pub fn media_devices_line() -> String {
    line(&Command::MediaDevices { version: VERSION })
}

/// The request to give device `id` to sites that ask for a `kind` without
/// naming one.
pub fn set_media_device_line(kind: MediaKind, id: &str) -> String {
    line(&Command::SetMediaDevice {
        version: VERSION,
        kind,
        id,
    })
}

/// The request for every extension installed in the engine's profile.
pub fn extensions_line() -> String {
    line(&Command::Extensions { version: VERSION })
}

/// The request to enable or disable extension `id`.
pub fn set_extension_enabled_line(id: &str, enabled: bool) -> String {
    line(&Command::SetExtensionEnabled {
        version: VERSION,
        id,
        enabled,
    })
}

/// The request for the history rows `query` finds.
pub fn history_line(query: &HistoryQuery) -> String {
    line(&Command::History {
        version: VERSION,
        text: &query.text,
        end_time: query.end_time,
        max_results: query.max_results,
    })
}

/// The request for the times `url` was visited.
pub fn visits_line(url: &str) -> String {
    line(&Command::Visits {
        version: VERSION,
        url,
    })
}

/// The request to delete the visits made at `visits`, each a time in
/// milliseconds since the epoch.
pub fn delete_history_line(visits: &[f64]) -> String {
    line(&Command::DeleteHistory {
        version: VERSION,
        visits,
    })
}

/// The request to clear `data`.
pub fn clear_browsing_data_line(data: &BrowsingData) -> String {
    line(&Command::ClearBrowsingData {
        version: VERSION,
        since: data.since,
        types: &data.types,
        origins: data.origins.as_deref(),
    })
}

/// Parses one reply line, without its trailing newline.
///
/// An unparseable reply is an error, not a [`Reply::Refused`]: it comes from
/// an incompatible engine, which did not refuse anything.
pub fn reply(line: &str) -> Result<Reply, serde_json::Error> {
    serde_json::from_str(line)
}

/// A request to the engine.
///
/// Field order matches the documented key order, so live lines are easy to
/// compare against the docs.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command<'a> {
    LoadShell {
        version: u32,
        root: &'a Path,
        module: &'a Path,
    },
    RunApp {
        version: u32,
        root: &'a Path,
        module: &'a Path,
    },
    OpenUrl {
        version: u32,
        url: &'a str,
        // Left out when false, so a browser window's line is the one every
        // engine reads.
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        app: bool,
    },
    SitePermissions {
        version: u32,
    },
    SetSitePermission {
        version: u32,
        origin: &'a str,
        permission: Permission,
        setting: Setting,
    },
    LoadUnpacked {
        version: u32,
        directory: &'a Path,
    },
    UninstallExtension {
        version: u32,
        id: &'a str,
    },
    ConfigExtensions {
        version: u32,
    },
    MediaDevices {
        version: u32,
    },
    SetMediaDevice {
        version: u32,
        kind: MediaKind,
        id: &'a str,
    },
    Extensions {
        version: u32,
    },
    SetExtensionEnabled {
        version: u32,
        id: &'a str,
        enabled: bool,
    },
    History {
        version: u32,
        text: &'a str,
        end_time: f64,
        max_results: u32,
    },
    Visits {
        version: u32,
        url: &'a str,
    },
    DeleteHistory {
        version: u32,
        visits: &'a [f64],
    },
    ClearBrowsingData {
        version: u32,
        since: f64,
        types: &'a [String],
        // Left out for every origin.
        #[serde(skip_serializing_if = "Option::is_none")]
        origins: Option<&'a [String]>,
    },
}

/// `command` as one newline-terminated line.
fn line(command: &Command) -> String {
    let mut line =
        serde_json::to_string(command).expect("a command is plain data and always serializes");
    line.push('\n');
    line
}
