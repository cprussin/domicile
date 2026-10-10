//! The protocol the supervisor uses to send `load-shell`, `open-url` and the
//! Settings app's site permissions and extensions to the engine.
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
//! ```
//!
//! The engine side is C++ in the fork
//! (`components/domicile/browser/command_protocol.cc`, tested in
//! `command_protocol_unittest.cc`) and is released separately
//! (`packages/domicile-engine/engine-release.nix`). Nothing shares code
//! between the two, so the tests here assert the exact bytes.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::site_permissions::{Permission, Setting, SitePermission, SiteSettings};

/// The protocol version the supervisor sends and the engine checks.
///
/// Versioned per [`DATA.md`](/docs/guidelines/DATA.md) because the pinned
/// engine is often older than `domicile`. The engine refuses versions it does
/// not support. Bump this when a request changes in a way an older engine
/// would misread.
const VERSION: u32 = 1;

/// The engine's reply.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Reply {
    /// The engine is serving the shell.
    Loaded,
    /// The engine passed the address to the shell.
    Opened,
    /// Every permission's default and every site's own setting.
    SitePermissions(SiteSettings),
    /// The engine stored a site's setting.
    Set,
    /// The engine loaded an unpacked extension, which has this id.
    LoadedUnpacked { id: String },
    /// The engine uninstalled an extension.
    Uninstalled,
    /// The ids of the extensions the desk's config installed.
    ConfigExtensions { ids: Vec<String> },
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
}

/// `command` as one newline-terminated line.
fn line(command: &Command) -> String {
    let mut line =
        serde_json::to_string(command).expect("a command is plain data and always serializes");
    line.push('\n');
    line
}
