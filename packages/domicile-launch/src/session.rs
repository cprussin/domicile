//! The session file the compositor writes once it is ready.
//!
//! The shell picks the path (`--session PATH`) and waits for the file. The
//! compositor writes it after binding its sockets and before serving. It holds
//! what the shell cannot know in advance, such as the Wayland display names.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A running compositor's endpoints, as read by the shell.
///
/// The field names are the wire format, read by TypeScript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    /// The host protocol version. A shell built for another version must
    /// refuse to connect.
    pub protocol: u32,
    /// The Unix socket the host protocol is served on.
    pub chrome_socket: PathBuf,
    /// The display applications connect to.
    pub wayland_display: String,
    /// The display for the chrome's own window. A separate socket lets the
    /// compositor tell the chrome from apps.
    pub chrome_wayland_display: String,
}

/// Could not write the session file.
///
/// Names the requested path, not the staging file, which the reader never sees.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("could not publish the session to {path}: {kind:?}")]
pub struct PublishError {
    pub path: String,
    pub kind: std::io::ErrorKind,
}

/// Writes `session` to `path` atomically.
///
/// Uses a rename because the shell polls for the file and would otherwise read
/// partial JSON.
pub fn publish(session: &Session, path: &Path) -> Result<(), PublishError> {
    let document = serde_json::to_string_pretty(session)
        .expect("a session is plain data and always serializes");
    let staging = staging_path(path)?;
    // A failed write (such as a full disk) leaves a staging file just like a
    // failed rename, so both steps share the cleanup.
    through(&staging, path, || {
        std::fs::write(&staging, document)?;
        std::fs::rename(&staging, path)
    })
}

/// Runs `steps`, removing the staging file if they fail.
///
/// The error is captured before the removal so a failed removal cannot hide it.
fn through(
    staging: &Path,
    path: &Path,
    steps: impl FnOnce() -> std::io::Result<()>,
) -> Result<(), PublishError> {
    match steps() {
        Ok(()) => Ok(()),
        Err(err) => {
            let failure = at(path, &err);
            let _ = std::fs::remove_file(staging);
            Err(failure)
        }
    }
}

/// Returns the staging path: a `.new` sibling of `path`.
///
/// It is a sibling because `rename` is only atomic within one filesystem. A
/// path with no file name, such as `/`, is refused.
fn staging_path(path: &Path) -> Result<PathBuf, PublishError> {
    let Some(name) = path.file_name() else {
        return Err(PublishError {
            path: path.display().to_string(),
            kind: std::io::ErrorKind::InvalidInput,
        });
    };
    let mut name = name.to_os_string();
    name.push(".new");
    Ok(path.with_file_name(name))
}

fn at(path: &Path, err: &std::io::Error) -> PublishError {
    PublishError {
        path: path.display().to_string(),
        kind: err.kind(),
    }
}
