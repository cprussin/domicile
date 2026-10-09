//! The control socket a running desktop serves, and the client for it.
//!
//! The path is `$XDG_RUNTIME_DIR/domicile-ipc.<pid>.sock`, exported to child
//! processes as [`VARIABLE`]. As with sway's `SWAYSOCK`, a per-instance name
//! lets several desktops run in one session.
//!
//! The protocol is in [`crate::control`]; this module handles the filesystem
//! and sockets.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::control::{parse_response, to_line, Request, Response};

/// How long either end waits for the other.
///
/// A silent client holds a thread of the desktop's until this elapses. Neither
/// side does real work, so a timeout means a stopped process.
pub const PATIENCE: Duration = Duration::from_secs(5);

/// The environment variable holding the control socket path, like
/// `SWAYSOCK`.
pub const VARIABLE: &str = "DOMICILE_SOCK";

/// The control socket path for the desktop supervised by `pid`.
///
/// Keyed on the pid because the socket is bound before the compositor exists,
/// so there is no Wayland display name yet. Without a runtime directory it
/// uses the temp directory, as the run directory does.
pub fn address(runtime_dir: Option<&str>, pid: u32) -> PathBuf {
    let base = runtime_dir.map_or_else(std::env::temp_dir, PathBuf::from);
    base.join(format!("domicile-ipc.{pid}.sock"))
}

/// [`VARIABLE`] is not set.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{VARIABLE} is not set, so there is no desktop here to ask. A desktop \
     puts it in the environment of everything it starts — run this from a \
     terminal inside the desktop you mean, or set {VARIABLE} to its socket."
)]
pub struct NotInADesktop;

/// The control socket path from [`VARIABLE`].
///
/// There is no search fallback: a session can run several desktops, and
/// guessing could send a command to the wrong one. `swaymsg` requires
/// `SWAYSOCK` for the same reason.
pub fn advertised(said: Option<&str>) -> Result<PathBuf, NotInADesktop> {
    said.map(PathBuf::from).ok_or(NotInADesktop)
}

/// A bound control socket, unlinked on drop so it does not go stale.
#[derive(Debug)]
pub struct Control {
    path: PathBuf,
    listener: UnixListener,
}

impl Control {
    /// A cloned listener for the serving thread.
    ///
    /// The run keeps the [`Control`] so the socket is unlinked when the desktop
    /// ends.
    pub fn listener(&self) -> std::io::Result<UnixListener> {
        self.listener.try_clone()
    }
}

impl Drop for Control {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Why the control socket could not be bound.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TakeError {
    #[error(
        "something is already answering at {path}, and that name belongs to \
         this process. Nothing here will take a socket away from whatever is \
         serving on it; find out what that is."
    )]
    AlreadyRunning { path: String },

    #[error(
        "{path} is not a socket, and it is where a desktop's control socket \
         goes. Nothing here will delete it; move it out of the way."
    )]
    InTheWay { path: String },

    #[error("could not take the control socket at {path}: {kind:?}")]
    Failed {
        path: String,
        kind: std::io::ErrorKind,
    },
}

/// Binds the control socket at `path`. The desktop does not start without it.
///
/// A socket file can outlive its process, so this connects to test it:
/// - Something answers: fail.
/// - A socket that does not answer: stale, so replace it.
/// - Not a socket: fail without deleting it.
pub fn take(path: &Path) -> Result<Control, TakeError> {
    clear(path)?;
    let listener = UnixListener::bind(path).map_err(|why| failed(path, &why))?;
    // The temp-directory fallback in `address` is world-readable, so restrict
    // the socket itself. `bind` creates it under the umask, leaving a brief
    // window before this. Binding to a temp name and renaming (as
    // `session::publish` does) would close it, if the socket ever carries
    // anything sensitive.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|why| failed(path, &why))?;
    Ok(Control {
        listener,
        path: path.to_path_buf(),
    })
}

/// Reads one request from `stream` and writes the answer.
///
/// `answer` is [`crate::control::answer`] in a desktop; a closure in tests.
pub fn answer_one(
    stream: UnixStream,
    patience: Duration,
    answer: &dyn Fn(&str) -> String,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(patience))?;
    stream.set_write_timeout(Some(patience))?;
    let mut asking = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    asking.read_line(&mut line)?;
    let mut answering = stream;
    answering.write_all(answer(&line).as_bytes())
}

/// Why a request to a desktop failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AskError {
    #[error(
        "no desktop is running here — nothing is answering at {path}. A \
         desktop that was killed outright leaves its socket behind and leaves \
         {VARIABLE} pointing at it, so this is also what the terminals that \
         outlived one see."
    )]
    NoDesktop { path: String },

    #[error(
        "the desktop answering at {path} took the command and did not answer. \
         It is running and it is not serving its control socket."
    )]
    NoAnswer { path: String },

    #[error("the desktop at {path} answered something that is not a response: {said}")]
    Unreadable { path: String, said: String },

    #[error("could not reach the desktop at {path}: {kind:?}")]
    Failed {
        path: String,
        kind: std::io::ErrorKind,
    },
}

/// Sends one request to the desktop at `path` and reads its response.
///
/// With no `patience`, waits until the desktop answers or hangs up.
pub fn ask(
    path: &Path,
    request: &Request,
    patience: Option<Duration>,
) -> Result<Response, AskError> {
    let mut stream = UnixStream::connect(path).map_err(|why| match why.kind() {
        // A missing socket, or a stale one left by a dead desktop.
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {
            AskError::NoDesktop {
                path: path.display().to_string(),
            }
        }
        kind => AskError::Failed {
            kind,
            path: path.display().to_string(),
        },
    })?;
    stream
        .set_read_timeout(patience)
        .map_err(|why| unreachable_desktop(path, &why))?;
    stream
        .set_write_timeout(patience)
        .map_err(|why| unreachable_desktop(path, &why))?;
    stream
        .write_all(to_line(request).as_bytes())
        .map_err(|why| unreachable_desktop(path, &why))?;
    // Half-close so the desktop sees the end of the request.
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|why| unreachable_desktop(path, &why))?;
    let mut said = String::new();
    BufReader::new(stream)
        .read_line(&mut said)
        .map_err(|why| unreachable_desktop(path, &why))?;
    match said.trim() {
        // The desktop closed without replying.
        "" => Err(AskError::NoAnswer {
            path: path.display().to_string(),
        }),
        line => parse_response(line).map_err(|_| AskError::Unreadable {
            path: path.display().to_string(),
            said: line.to_string(),
        }),
    }
}

/// Clears `path` for binding, or says why it cannot be.
fn clear(path: &Path) -> Result<(), TakeError> {
    match UnixStream::connect(path) {
        Ok(_) => Err(TakeError::AlreadyRunning {
            path: path.display().to_string(),
        }),
        Err(why) if why.kind() == std::io::ErrorKind::NotFound => Ok(()),
        // Either a stale socket or a regular file; only a socket is deleted.
        Err(_) => discard(path),
    }
}

/// Deletes a stale socket at `path`, and nothing else.
fn discard(path: &Path) -> Result<(), TakeError> {
    let kind = std::fs::symlink_metadata(path)
        .map_err(|why| failed(path, &why))?
        .file_type();
    if kind.is_socket() {
        std::fs::remove_file(path).map_err(|why| failed(path, &why))
    } else {
        Err(TakeError::InTheWay {
            path: path.display().to_string(),
        })
    }
}

fn failed(path: &Path, why: &std::io::Error) -> TakeError {
    TakeError::Failed {
        kind: why.kind(),
        path: path.display().to_string(),
    }
}

/// Classifies an I/O error talking to a connected desktop.
///
/// A desktop that accepted but does not answer is reported separately: its
/// serving thread has stopped. That shows up as `WouldBlock` or `TimedOut`
/// (by platform) or `ConnectionReset` or `BrokenPipe` (by timing). [`ask`]
/// handles an empty read.
fn unreachable_desktop(path: &Path, why: &std::io::Error) -> AskError {
    match why.kind() {
        std::io::ErrorKind::WouldBlock
        | std::io::ErrorKind::TimedOut
        | std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::ConnectionReset => AskError::NoAnswer {
            path: path.display().to_string(),
        },
        kind => AskError::Failed {
            kind,
            path: path.display().to_string(),
        },
    }
}
