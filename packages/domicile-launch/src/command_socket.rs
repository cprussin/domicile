//! Sends a [`crate::command`] request to the engine's command socket.
//!
//! The supervisor picks the socket path (`--domicile-command-socket`, see
//! [`crate::spawn`]) and the engine binds it. Separate from
//! [`crate::control_socket`] because a dead engine needs different errors from
//! a missing desktop, and because only this protocol crosses a release
//! boundary.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::command::{
    clear_browsing_data_line, config_extensions_line, delete_history_line,
    disable_while_typing_line, extensions_line, history_line, load_shell_line, load_unpacked_line,
    media_devices_line, open_app_line, open_url_line, reply, run_app_line,
    set_extension_enabled_line, set_media_device_line, set_site_permission_line,
    site_permissions_line, uninstall_extension_line, visits_line, Reply, NO_SHELL_WINDOW,
};
use crate::extensions::InstalledExtension;
use crate::history::{BrowsingData, HistoryItem, HistoryQuery};
use crate::media_devices::{MediaDevices, MediaKind};
use crate::site_permissions::{SitePermission, SiteSettings};

/// Why the engine did not carry out a command.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    #[error(
        "the engine of this desktop is not answering at {path}. That is a \
         desktop whose engine has died — the supervisor is about to replace \
         it, and this command arrived in the second between the two — or one \
         whose engine has not finished starting."
    )]
    NoEngine { path: String },

    #[error(
        "the engine took the command and did not answer. It is running and it \
         is not serving its command socket at {path}, so whether it carried \
         the command out is not something this can say."
    )]
    NoAnswer { path: String },

    #[error(
        "the engine at {path} answered something that is not a reply: {said}. \
         An engine from a release that predates this command answers like \
         this; packages/domicile-engine/engine-release.nix is which one this \
         desktop runs."
    )]
    Unreadable { path: String, said: String },

    #[error("the engine refused: {why}")]
    Refused { why: String },

    #[error(
        "the engine refused: {NO_SHELL_WINDOW}. An engine that is starting \
         has none until its first page commits."
    )]
    NoShellWindow,

    #[error("could not reach the engine at {path}: {kind:?}")]
    Failed {
        path: String,
        kind: std::io::ErrorKind,
    },
}

/// Tells the engine at `socket` to serve `module` from `root`.
pub fn load_shell(
    socket: &Path,
    root: &Path,
    module: &Path,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &load_shell_line(root, module),
        Reply::Loaded,
        patience,
    )
}

/// Tells the engine at `socket` to open `url` in the shell.
pub fn open_url(socket: &Path, url: &str, patience: Duration) -> Result<(), CommandError> {
    carry_out(socket, &open_url_line(url), Reply::Opened, patience)
}

/// Tells the engine at `socket` to run the app module `module` under `root`
/// in an app window.
pub fn run_app(
    socket: &Path,
    root: &Path,
    module: &Path,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(socket, &run_app_line(root, module), Reply::Opened, patience)
}

/// Tells the engine at `socket` to open `url` in an app window.
pub fn open_app(socket: &Path, url: &str, patience: Duration) -> Result<(), CommandError> {
    carry_out(socket, &open_app_line(url), Reply::Opened, patience)
}

/// Asks the engine at `socket` for every permission's default and every
/// site's own setting.
pub fn site_permissions(socket: &Path, patience: Duration) -> Result<SiteSettings, CommandError> {
    match answered(socket, &site_permissions_line(), patience)? {
        Reply::SitePermissions(settings) => Ok(settings),
        other => Err(unexpected(socket, &other)),
    }
}

/// Tells the engine at `socket` to store `site`'s setting.
pub fn set_site_permission(
    socket: &Path,
    site: &SitePermission,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &set_site_permission_line(site),
        Reply::Set,
        patience,
    )
}

/// Tells the engine at `socket` to load the unpacked extension in
/// `directory`, and returns its id.
pub fn load_unpacked(
    socket: &Path,
    directory: &Path,
    patience: Duration,
) -> Result<String, CommandError> {
    match answered(socket, &load_unpacked_line(directory), patience)? {
        Reply::LoadedUnpacked { id } => Ok(id),
        other => Err(unexpected(socket, &other)),
    }
}

/// Tells the engine at `socket` to uninstall extension `id`.
pub fn uninstall_extension(
    socket: &Path,
    id: &str,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &uninstall_extension_line(id),
        Reply::Uninstalled,
        patience,
    )
}

/// Asks the engine at `socket` for the ids of the extensions the desk's config
/// installed.
pub fn config_extensions(socket: &Path, patience: Duration) -> Result<Vec<String>, CommandError> {
    match answered(socket, &config_extensions_line(), patience)? {
        Reply::ConfigExtensions { ids } => Ok(ids),
        other => Err(unexpected(socket, &other)),
    }
}

/// Asks the engine at `socket` for its cameras and microphones, most preferred
/// first.
pub fn media_devices(socket: &Path, patience: Duration) -> Result<MediaDevices, CommandError> {
    match answered(socket, &media_devices_line(), patience)? {
        Reply::MediaDevices(devices) => Ok(devices),
        other => Err(unexpected(socket, &other)),
    }
}

/// Tells the engine at `socket` to give device `id` to sites that ask for a
/// `kind` without naming one.
pub fn set_media_device(
    socket: &Path,
    kind: MediaKind,
    id: &str,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &set_media_device_line(kind, id),
        Reply::Set,
        patience,
    )
}

/// Asks the engine at `socket` for every extension installed in its profile.
pub fn extensions(
    socket: &Path,
    patience: Duration,
) -> Result<Vec<InstalledExtension>, CommandError> {
    match answered(socket, &extensions_line(), patience)? {
        Reply::Extensions { extensions } => Ok(extensions),
        other => Err(unexpected(socket, &other)),
    }
}

/// Tells the engine at `socket` to enable or disable extension `id`.
pub fn set_extension_enabled(
    socket: &Path,
    id: &str,
    enabled: bool,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &set_extension_enabled_line(id, enabled),
        Reply::Set,
        patience,
    )
}

/// Asks the engine at `socket` for the history rows `query` finds.
pub fn history(
    socket: &Path,
    query: &HistoryQuery,
    patience: Duration,
) -> Result<Vec<HistoryItem>, CommandError> {
    match answered(socket, &history_line(query), patience)? {
        Reply::History { items } => Ok(items),
        other => Err(unexpected(socket, &other)),
    }
}

/// Asks the engine at `socket` when `url` was visited.
pub fn visits(socket: &Path, url: &str, patience: Duration) -> Result<Vec<f64>, CommandError> {
    match answered(socket, &visits_line(url), patience)? {
        Reply::Visits { times } => Ok(times),
        other => Err(unexpected(socket, &other)),
    }
}

/// Tells the engine at `socket` to delete the visits made at `visits`.
pub fn delete_history(
    socket: &Path,
    visits: &[f64],
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &delete_history_line(visits),
        Reply::Deleted,
        patience,
    )
}

/// Tells the engine at `socket` to clear `data`.
pub fn clear_browsing_data(
    socket: &Path,
    data: &BrowsingData,
    patience: Duration,
) -> Result<(), CommandError> {
    carry_out(
        socket,
        &clear_browsing_data_line(data),
        Reply::Cleared,
        patience,
    )
}

/// Tells the engine at `socket` whether the touchpads rest while a keyboard
/// types, or with no `enabled` only asks, and returns whether they do.
pub fn disable_while_typing(
    socket: &Path,
    enabled: Option<bool>,
    patience: Duration,
) -> Result<bool, CommandError> {
    match answered(socket, &disable_while_typing_line(enabled), patience)? {
        Reply::DisableWhileTyping { enabled } => Ok(enabled),
        other => Err(unexpected(socket, &other)),
    }
}

/// Sends one command and succeeds only if the engine replies `done`.
///
/// A reply meant for another command (e.g. `loaded` for `open_url`) is
/// treated as unreadable.
fn carry_out(
    socket: &Path,
    line: &str,
    done: Reply,
    patience: Duration,
) -> Result<(), CommandError> {
    match answered(socket, line, patience)? {
        answered if answered == done => Ok(()),
        other => Err(unexpected(socket, &other)),
    }
}

/// Sends one command and reads the engine's reply, a refusal as an error.
fn answered(socket: &Path, line: &str, patience: Duration) -> Result<Reply, CommandError> {
    let said = exchange(socket, line, patience)?;
    match reply(said.trim()) {
        Ok(Reply::Refused { why }) if why == NO_SHELL_WINDOW => Err(CommandError::NoShellWindow),
        Ok(Reply::Refused { why }) => Err(CommandError::Refused { why }),
        Ok(answered) => Ok(answered),
        Err(_) => Err(CommandError::Unreadable {
            path: socket.display().to_string(),
            said: said.trim().to_string(),
        }),
    }
}

/// A reply meant for another command.
fn unexpected(socket: &Path, reply: &Reply) -> CommandError {
    CommandError::Unreadable {
        path: socket.display().to_string(),
        said: format!("{reply:?}"),
    }
}

/// Writes one line to the engine and reads one line back.
fn exchange(socket: &Path, line: &str, patience: Duration) -> Result<String, CommandError> {
    let mut stream = UnixStream::connect(socket).map_err(|why| match why.kind() {
        // A missing socket, or a stale one left by a dead engine.
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {
            CommandError::NoEngine {
                path: socket.display().to_string(),
            }
        }
        kind => CommandError::Failed {
            kind,
            path: socket.display().to_string(),
        },
    })?;
    stream
        .set_read_timeout(Some(patience))
        .map_err(|why| unreachable_engine(socket, &why))?;
    stream
        .set_write_timeout(Some(patience))
        .map_err(|why| unreachable_engine(socket, &why))?;
    stream
        .write_all(line.as_bytes())
        .map_err(|why| unreachable_engine(socket, &why))?;
    let mut said = String::new();
    BufReader::new(stream)
        .read_line(&mut said)
        .map_err(|why| unreachable_engine(socket, &why))?;
    match said.trim().is_empty() {
        // The engine closed without replying, as `CommandSocket::Close`
        // does for a peer it gave up on.
        true => Err(CommandError::NoAnswer {
            path: socket.display().to_string(),
        }),
        false => Ok(said),
    }
}

/// Classifies an I/O error talking to the engine.
///
/// As in [`crate::control_socket`], a timeout is `WouldBlock` or `TimedOut`
/// depending on the platform, and a hang-up is `ConnectionReset` or
/// `BrokenPipe` depending on timing. [`exchange`] handles an empty read.
fn unreachable_engine(socket: &Path, why: &std::io::Error) -> CommandError {
    match why.kind() {
        std::io::ErrorKind::WouldBlock
        | std::io::ErrorKind::TimedOut
        | std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::ConnectionReset => CommandError::NoAnswer {
            path: socket.display().to_string(),
        },
        kind => CommandError::Failed {
            kind,
            path: socket.display().to_string(),
        },
    }
}
