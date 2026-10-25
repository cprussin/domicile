//! The protocol between `domicile <command>` and a running desktop.
//!
//! One JSON request line in, one response line out, per connection. This uses
//! the same newline-delimited JSON framing as the host protocol.
//!
//! Lines come from a socket, so [`answer`] parses them strictly and refuses
//! anything else.

use std::path::{Path, PathBuf};

use domicile_protocol::Theme;
use serde::{Deserialize, Serialize};

use crate::extensions::InstalledExtension;
use crate::history::{BrowsingData, HistoryItem, HistoryQuery};
use crate::media_devices::{MediaDevices, MediaKind};
use crate::site_data::SiteData;
use crate::site_permissions::{SitePermission, SiteSettings};

/// The file a built shell's declared options are written to, beside its
/// module. See `docs/WRITING-A-SHELL.md#options`.
pub const OPTIONS: &str = "options.json";

/// A request to a running desktop.
///
/// Each variant needs a matching CLI verb in [`crate::cli`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    /// Report the shell this desktop is running.
    WhichShell,
    /// Serve this shell instead.
    ///
    /// The client resolves the paths (see [`crate::shell_path::Shell`])
    /// because the desktop does not share its working directory.
    LoadShell { root: PathBuf, module: PathBuf },
    /// Open this URL in a browser window. The client converts paths with
    /// [`crate::address`].
    OpenUrl { url: String },
    /// Open this URL in an app window: a browser window the shell draws
    /// without an address bar. See `docs/architecture/WEB-APPS.md`.
    OpenApp { url: String },
    /// Run the app module `module` under `root` in an app window. The client
    /// resolves both ([`crate::app_entry`]). See
    /// `docs/architecture/APP-MODULES.md`.
    RunApp { root: PathBuf, module: PathBuf },
    /// Write a PNG of the whole desk to this absolute path, or, with no
    /// `file`, take the shell's interactive screenshot.
    ///
    /// The client makes the path absolute, as for `LoadShell`. See
    /// `SystemRequest::Screenshot` for where the interactive one is saved.
    Screenshot { file: Option<PathBuf> },
    /// Send this command to the shell, as a `send-shell` keybinding would.
    SendShell { command: Vec<String> },
    /// Report the files the Settings app edits. Asked by
    /// `domicile-app-host`, which reads and writes them itself.
    SettingsFiles,
    /// Report every permission's default and every site's own setting. The
    /// engine keeps them.
    SitePermissions,
    /// Store one site's setting in the engine.
    SetSitePermission { site: SitePermission },
    /// Load the unpacked extension in this absolute directory into the
    /// engine's profile. It stays until uninstalled.
    LoadUnpacked { directory: PathBuf },
    /// Uninstall an extension the config did not install.
    UninstallExtension { id: String },
    /// Report the ids of the extensions the config installed, which only the
    /// config uninstalls.
    ConfigExtensions,
    /// Report the engine's cameras and microphones, most preferred first.
    MediaDevices,
    /// Give this device to sites that ask for a `kind` without naming one.
    SetMediaDevice { kind: MediaKind, id: String },
    /// Report every extension installed in the engine's profile.
    Extensions,
    /// Enable or disable an extension.
    SetExtensionEnabled { id: String, enabled: bool },
    /// Search the engine's history.
    History(HistoryQuery),
    /// Report when a page was visited.
    Visits { url: String },
    /// Delete the visits made at these times.
    DeleteHistory { visits: Vec<f64> },
    /// Clear the engine's browsing data.
    ClearBrowsingData(BrowsingData),
    /// Report every host that stores data in the engine's profile.
    SiteData,
    /// Clear everything one host stores.
    ClearSiteData { host: String },
    /// Turn the touchpads' disable-while-typing on, off or over, or with no
    /// `to`, report it. See `docs/RUNNING-A-DESKTOP.md#disable-while-typing`.
    DisableWhileTyping {
        #[serde(default)]
        to: Option<Switch>,
    },
    /// Set the desktop's light or dark theme, or with no `to`, report it. The
    /// compositor owns the theme, so this works with any shell.
    Theme {
        #[serde(default)]
        to: Option<ThemeChange>,
    },
}

/// How [`Request::DisableWhileTyping`] changes the setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Switch {
    On,
    Off,
    Toggle,
}

/// How [`Request::Theme`] changes the theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeChange {
    Light,
    Dark,
    Toggle,
}

/// The files the Settings app edits, as the desktop found them at startup.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingsFiles {
    /// The config file, or none when the desktop runs the defaults.
    pub config: Option<PathBuf>,
    /// The JSON a module config evaluated to, which the compositor reads.
    pub evaluated: Option<PathBuf>,
    /// The shell's source file: an entry the desktop builds, or a module it
    /// serves as is. None for a package, which has no file to edit.
    pub shell: Option<PathBuf>,
    /// Where the served shell's declared options are: `options.json` beside
    /// its module. The file is missing for a shell that declares none.
    pub options: Option<PathBuf>,
}

/// A desktop's response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    /// The absolute path of the module the desktop is serving.
    ///
    /// Answers both `which-shell` and a successful `load-shell`.
    Shell { module: PathBuf },

    /// The engine passed the address to the shell.
    ///
    /// The shell decides whether and where to open it, and does not report
    /// back.
    Opened,

    /// The compositor wrote the screenshot to this file.
    Captured { file: PathBuf },

    /// The user dismissed the shell's screenshot dialog.
    Canceled,

    /// The user copied the screenshot to the clipboard from the shell's
    /// dialog, so no file was saved.
    Copied,

    /// The compositor sent the command to every page listening for one.
    ///
    /// The shell does not report whether it knew the command.
    Sent,

    /// Answers `settings_files`.
    SettingsFiles { files: SettingsFiles },

    /// Answers `site_permissions`.
    SitePermissions(SiteSettings),

    /// The engine stored the site's setting, the preferred media device or
    /// whether the extension is enabled.
    Stored,

    /// The engine loaded the unpacked extension, which has this id.
    LoadedUnpacked { id: String },

    /// The engine uninstalled the extension.
    Uninstalled,

    /// Answers `config_extensions`.
    ConfigExtensions { ids: Vec<String> },

    /// Answers `media_devices`.
    MediaDevices(MediaDevices),

    /// Answers `extensions`.
    Extensions { extensions: Vec<InstalledExtension> },

    /// Answers `history`.
    History { items: Vec<HistoryItem> },

    /// Answers `visits`.
    Visits { times: Vec<f64> },

    /// The engine deleted the visits.
    Deleted,

    /// The engine cleared the browsing data or the host's site data.
    Cleared,

    /// Answers `site_data`.
    SiteData { sites: Vec<SiteData> },

    /// Whether the touchpads rest while a keyboard types, after the request.
    DisableWhileTyping { enabled: bool },

    /// The desktop's theme, after the request.
    Theme { theme: Theme },

    /// The request was unknown or could not be carried out.
    ///
    /// The protocol has no version number. A client from a different build
    /// gets this refusal, naming the request. For engine failures, `why` is the
    /// engine's message, shown in the user's terminal.
    Refused { why: String },
}

/// Encodes a message as one newline-terminated JSON line.
pub fn to_line<T: Serialize>(message: &T) -> String {
    let mut line = serde_json::to_string(message).expect("control messages always serialize");
    line.push('\n');
    line
}

/// Parses one response line, without its trailing newline.
pub fn parse_response(line: &str) -> Result<Response, serde_json::Error> {
    serde_json::from_str(line)
}

/// Tells the engine to serve a shell.
///
/// [`crate::command_socket::load_shell`] in a desktop; a closure in tests.
pub type LoadShell<'a> = &'a dyn Fn(&Path, &Path) -> Result<(), String>;

/// Tells the engine to open an address in the shell.
///
/// [`crate::command_socket::open_url`] or [`crate::command_socket::open_app`]
/// in a desktop; a closure in tests.
pub type OpenUrl<'a> = &'a dyn Fn(&str) -> Result<(), String>;

/// Tells the engine to run an app module.
///
/// [`crate::command_socket::run_app`] in a desktop; a closure in tests.
pub type RunApp<'a> = &'a dyn Fn(&Path, &Path) -> Result<(), String>;

/// Tells the compositor to take a screenshot, into the file if one is given.
///
/// [`crate::compositor_socket::screenshot`] in a desktop; a closure in tests.
pub type Screenshot<'a> = &'a dyn Fn(Option<&Path>) -> Result<Shot, String>;

/// Tells the compositor to send the shell a command.
///
/// [`crate::compositor_socket::send_shell`] in a desktop; a closure in tests.
pub type SendShell<'a> = &'a dyn Fn(&[String]) -> Result<(), String>;

/// Asks the engine for every permission's default and every site's own
/// setting.
///
/// [`crate::command_socket::site_permissions`] in a desktop; a closure in
/// tests.
pub type SitePermissions<'a> = &'a dyn Fn() -> Result<SiteSettings, String>;

/// Tells the engine to store a site's setting.
///
/// [`crate::command_socket::set_site_permission`] in a desktop; a closure in
/// tests.
pub type SetSitePermission<'a> = &'a dyn Fn(&SitePermission) -> Result<(), String>;

/// Tells the engine to load an unpacked extension, returning its id.
///
/// [`crate::command_socket::load_unpacked`] in a desktop; a closure in tests.
pub type LoadUnpacked<'a> = &'a dyn Fn(&Path) -> Result<String, String>;

/// Tells the engine to uninstall an extension.
///
/// [`crate::command_socket::uninstall_extension`] in a desktop; a closure in
/// tests.
pub type UninstallExtension<'a> = &'a dyn Fn(&str) -> Result<(), String>;

/// Asks the engine for the ids of the extensions the config installed.
///
/// [`crate::command_socket::config_extensions`] in a desktop; a closure in
/// tests.
pub type ConfigExtensions<'a> = &'a dyn Fn() -> Result<Vec<String>, String>;

/// Asks the engine for its cameras and microphones.
///
/// [`crate::command_socket::media_devices`] in a desktop; a closure in tests.
pub type ListMediaDevices<'a> = &'a dyn Fn() -> Result<MediaDevices, String>;

/// Tells the engine which device sites get when they name none.
///
/// [`crate::command_socket::set_media_device`] in a desktop; a closure in
/// tests.
pub type SetMediaDevice<'a> = &'a dyn Fn(MediaKind, &str) -> Result<(), String>;

/// Asks the engine for every extension installed in its profile.
///
/// [`crate::command_socket::extensions`] in a desktop; a closure in tests.
pub type ListExtensions<'a> = &'a dyn Fn() -> Result<Vec<InstalledExtension>, String>;

/// Tells the engine to enable or disable an extension.
///
/// [`crate::command_socket::set_extension_enabled`] in a desktop; a closure in
/// tests.
pub type SetExtensionEnabled<'a> = &'a dyn Fn(&str, bool) -> Result<(), String>;

/// Asks the engine for the history rows a search finds.
///
/// [`crate::command_socket::history`] in a desktop; a closure in tests.
pub type SearchHistory<'a> = &'a dyn Fn(&HistoryQuery) -> Result<Vec<HistoryItem>, String>;

/// Asks the engine when a page was visited.
///
/// [`crate::command_socket::visits`] in a desktop; a closure in tests.
pub type ListVisits<'a> = &'a dyn Fn(&str) -> Result<Vec<f64>, String>;

/// Tells the engine to delete visits.
///
/// [`crate::command_socket::delete_history`] in a desktop; a closure in tests.
pub type DeleteHistory<'a> = &'a dyn Fn(&[f64]) -> Result<(), String>;

/// Tells the engine to clear browsing data.
///
/// [`crate::command_socket::clear_browsing_data`] in a desktop; a closure in
/// tests.
pub type ClearBrowsingData<'a> = &'a dyn Fn(&BrowsingData) -> Result<(), String>;

/// Asks the engine for every host that stores data.
///
/// [`crate::command_socket::site_data`] in a desktop; a closure in tests.
pub type ListSiteData<'a> = &'a dyn Fn() -> Result<Vec<SiteData>, String>;

/// Tells the engine to clear everything a host stores.
///
/// [`crate::command_socket::clear_site_data`] in a desktop; a closure in tests.
pub type ClearSiteData<'a> = &'a dyn Fn(&str) -> Result<(), String>;

/// Tells the engine whether the touchpads rest while a keyboard types, or with
/// none only asks, and returns whether they do.
///
/// [`crate::command_socket::disable_while_typing`] in a desktop; a closure in
/// tests.
pub type DisableWhileTyping<'a> = &'a dyn Fn(Option<bool>) -> Result<bool, String>;

/// Tells the compositor the theme, or with none only asks, and returns the
/// theme.
///
/// [`crate::compositor_socket::theme`] in a desktop; a closure in tests.
pub type Theming<'a> = &'a dyn Fn(Option<Theme>) -> Result<Theme, String>;

/// What a request can learn about or do to the running desktop.
///
/// The dials reach the engine and the compositor; they are injected so
/// [`answer`] can be tested without sockets.
pub struct Desktop<'a> {
    /// The shell module being served.
    pub module: &'a Path,
    pub files: &'a SettingsFiles,
    pub load: LoadShell<'a>,
    pub open: OpenUrl<'a>,
    pub open_app: OpenUrl<'a>,
    pub run_app: RunApp<'a>,
    pub capture: Screenshot<'a>,
    pub send: SendShell<'a>,
    pub permissions: SitePermissions<'a>,
    pub set_permission: SetSitePermission<'a>,
    pub load_unpacked: LoadUnpacked<'a>,
    pub uninstall_extension: UninstallExtension<'a>,
    pub config_extensions: ConfigExtensions<'a>,
    pub media_devices: ListMediaDevices<'a>,
    pub set_media_device: SetMediaDevice<'a>,
    pub extensions: ListExtensions<'a>,
    pub set_extension_enabled: SetExtensionEnabled<'a>,
    pub history: SearchHistory<'a>,
    pub visits: ListVisits<'a>,
    pub delete_history: DeleteHistory<'a>,
    pub clear_browsing_data: ClearBrowsingData<'a>,
    pub site_data: ListSiteData<'a>,
    pub clear_site_data: ClearSiteData<'a>,
    pub disable_while_typing: DisableWhileTyping<'a>,
    pub theme: Theming<'a>,
}

/// How a screenshot the compositor took ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Shot {
    /// Saved as this file.
    Saved(PathBuf),
    /// Put on the clipboard from the shell's dialog, and not saved.
    Copied,
    /// The user dismissed the shell's screenshot dialog.
    Canceled,
}

/// Answers one request line to `desktop`.
pub fn answer(line: &str, desktop: &Desktop) -> String {
    match parse_request(line.trim()) {
        Ok(Request::WhichShell) => to_line(&Response::Shell {
            module: desktop.module.to_path_buf(),
        }),
        // Reply with the resolved path so the user can see which file was
        // loaded.
        Ok(Request::LoadShell { root, module }) => to_line(&match (desktop.load)(&root, &module) {
            Ok(()) => Response::Shell {
                module: root.join(module),
            },
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::OpenUrl { url }) => to_line(&match (desktop.open)(&url) {
            Ok(()) => Response::Opened,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::OpenApp { url }) => to_line(&match (desktop.open_app)(&url) {
            Ok(()) => Response::Opened,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::RunApp { root, module }) => to_line(&match (desktop.run_app)(&root, &module) {
            Ok(()) => Response::Opened,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::Screenshot { file }) => to_line(&match (desktop.capture)(file.as_deref()) {
            Ok(Shot::Saved(file)) => Response::Captured { file },
            Ok(Shot::Copied) => Response::Copied,
            Ok(Shot::Canceled) => Response::Canceled,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SendShell { command }) => to_line(&match (desktop.send)(&command) {
            Ok(()) => Response::Sent,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SettingsFiles) => to_line(&Response::SettingsFiles {
            files: SettingsFiles {
                options: Some(desktop.module.with_file_name(OPTIONS)),
                ..desktop.files.clone()
            },
        }),
        Ok(Request::SitePermissions) => to_line(&match (desktop.permissions)() {
            Ok(settings) => Response::SitePermissions(settings),
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SetSitePermission { site }) => {
            to_line(&match (desktop.set_permission)(&site) {
                Ok(()) => Response::Stored,
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::LoadUnpacked { directory }) => {
            to_line(&match (desktop.load_unpacked)(&directory) {
                Ok(id) => Response::LoadedUnpacked { id },
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::UninstallExtension { id }) => {
            to_line(&match (desktop.uninstall_extension)(&id) {
                Ok(()) => Response::Uninstalled,
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::ConfigExtensions) => to_line(&match (desktop.config_extensions)() {
            Ok(ids) => Response::ConfigExtensions { ids },
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::MediaDevices) => to_line(&match (desktop.media_devices)() {
            Ok(devices) => Response::MediaDevices(devices),
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SetMediaDevice { kind, id }) => {
            to_line(&match (desktop.set_media_device)(kind, &id) {
                Ok(()) => Response::Stored,
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::Extensions) => to_line(&match (desktop.extensions)() {
            Ok(extensions) => Response::Extensions { extensions },
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SetExtensionEnabled { id, enabled }) => {
            to_line(&match (desktop.set_extension_enabled)(&id, enabled) {
                Ok(()) => Response::Stored,
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::History(query)) => to_line(&match (desktop.history)(&query) {
            Ok(items) => Response::History { items },
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::Visits { url }) => to_line(&match (desktop.visits)(&url) {
            Ok(times) => Response::Visits { times },
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::DeleteHistory { visits }) => {
            to_line(&match (desktop.delete_history)(&visits) {
                Ok(()) => Response::Deleted,
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::ClearBrowsingData(data)) => {
            to_line(&match (desktop.clear_browsing_data)(&data) {
                Ok(()) => Response::Cleared,
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::SiteData) => to_line(&match (desktop.site_data)() {
            Ok(sites) => Response::SiteData { sites },
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::ClearSiteData { host }) => to_line(&match (desktop.clear_site_data)(&host) {
            Ok(()) => Response::Cleared,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::DisableWhileTyping { to }) => {
            to_line(&match switched(to, desktop.disable_while_typing) {
                Ok(enabled) => Response::DisableWhileTyping { enabled },
                Err(why) => Response::Refused { why },
            })
        }
        Ok(Request::Theme { to }) => to_line(&match themed(to, desktop.theme) {
            Ok(theme) => Response::Theme { theme },
            Err(why) => Response::Refused { why },
        }),
        Err(why) => to_line(&Response::Refused {
            why: format!(
                "'{}' is not a request this desktop knows: {why}",
                line.trim()
            ),
        }),
    }
}

/// Carries out `to` with `set`. A toggle asks first, since the engine keeps the
/// setting.
fn switched(to: Option<Switch>, set: DisableWhileTyping) -> Result<bool, String> {
    match to {
        None => set(None),
        Some(Switch::On) => set(Some(true)),
        Some(Switch::Off) => set(Some(false)),
        Some(Switch::Toggle) => set(Some(!set(None)?)),
    }
}

/// Carries out `to` with `set`. A toggle asks first, since the compositor keeps
/// the theme.
fn themed(to: Option<ThemeChange>, set: Theming) -> Result<Theme, String> {
    match to {
        None => set(None),
        Some(ThemeChange::Light) => set(Some(Theme::Light)),
        Some(ThemeChange::Dark) => set(Some(Theme::Dark)),
        Some(ThemeChange::Toggle) => set(Some(match set(None)? {
            Theme::Light => Theme::Dark,
            Theme::Dark => Theme::Light,
        })),
    }
}

/// Parses one request line, without its trailing newline.
fn parse_request(line: &str) -> Result<Request, serde_json::Error> {
    serde_json::from_str(line)
}
