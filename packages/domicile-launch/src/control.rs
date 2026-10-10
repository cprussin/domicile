//! The protocol between `domicile <command>` and a running desktop.
//!
//! One JSON request line in, one response line out, per connection. This uses
//! the same newline-delimited JSON framing as the host protocol.
//!
//! Lines come from a socket, so [`answer`] parses them strictly and refuses
//! anything else.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::site_permissions::{SitePermission, SiteSettings};

/// A request to a running desktop.
///
/// Each variant needs a matching CLI verb in [`crate::cli`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Write a PNG of the whole desk to this absolute path, or, with no
    /// `file`, take the shell's interactive screenshot.
    ///
    /// The client makes the path absolute, as for `LoadShell`. See
    /// `SystemRequest::Screenshot` for where the interactive one is saved.
    Screenshot { file: Option<PathBuf> },
    /// Send this command to the shell, as a `send-shell` keybinding would.
    SendShell { command: Vec<String> },
    /// Report the files the Settings app edits. Asked by
    /// `domicile-settings-host`, which reads and writes them itself.
    SettingsFiles,
    /// Report every permission's default and every site's own setting. The
    /// engine keeps them.
    SitePermissions,
    /// Store one site's setting in the engine.
    SetSitePermission { site: SitePermission },
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
}

/// A desktop's response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

    /// The compositor sent the command to every page listening for one.
    ///
    /// The shell does not report whether it knew the command.
    Sent,

    /// Answers `settings_files`.
    SettingsFiles { files: SettingsFiles },

    /// Answers `site_permissions`.
    SitePermissions(SiteSettings),

    /// The engine stored the site's setting.
    Stored,

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
/// [`crate::command_socket::open_url`] in a desktop; a closure in tests.
pub type OpenUrl<'a> = &'a dyn Fn(&str) -> Result<(), String>;

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
    pub capture: Screenshot<'a>,
    pub send: SendShell<'a>,
    pub permissions: SitePermissions<'a>,
    pub set_permission: SetSitePermission<'a>,
}

/// How a screenshot the compositor took ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Shot {
    /// Saved as this file.
    Saved(PathBuf),
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
        Ok(Request::Screenshot { file }) => to_line(&match (desktop.capture)(file.as_deref()) {
            Ok(Shot::Saved(file)) => Response::Captured { file },
            Ok(Shot::Canceled) => Response::Canceled,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SendShell { command }) => to_line(&match (desktop.send)(&command) {
            Ok(()) => Response::Sent,
            Err(why) => Response::Refused { why },
        }),
        Ok(Request::SettingsFiles) => to_line(&Response::SettingsFiles {
            files: desktop.files.clone(),
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
        Err(why) => to_line(&Response::Refused {
            why: format!(
                "'{}' is not a request this desktop knows: {why}",
                line.trim()
            ),
        }),
    }
}

/// Parses one request line, without its trailing newline.
fn parse_request(line: &str) -> Result<Request, serde_json::Error> {
    serde_json::from_str(line)
}
