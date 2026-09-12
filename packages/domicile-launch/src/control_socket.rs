//! Where a running desktop answers, and how a command reaches it.
//!
//! `$XDG_RUNTIME_DIR/domicile.sock`, discovered rather than passed: a client
//! that has to be told where the desktop is has to be told by something that
//! already knew, and the watcher this exists for was not started by the
//! desktop and inherits nothing from it.
//!
//! One path is one desktop, and that is a rule rather than an accident — see
//! [`take`]. What goes over the socket is [`crate::control`]'s and is pure;
//! what is here is the part that needs a filesystem.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::fs::{FileTypeExt as _, PermissionsExt as _};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::control::{parse_response, to_line, Request, Response};

/// How long either end waits on the other before giving up.
///
/// A desktop answers one connection at a time, so a client that connects and
/// says nothing is the whole control socket until this elapses; a client waits
/// the same amount for an answer that is one `serde_json::to_string` away.
/// Both ends are on the same machine and neither is doing any work, so this is
/// about a process that has stopped rather than about a slow one.
pub const PATIENCE: Duration = Duration::from_secs(5);

/// The socket a desktop started with this runtime directory answers on.
///
/// `None` falls back to the temporary directory, which is the same fallback
/// the run's own directory takes — one rule for where this user's runtime
/// files go, rather than a desktop whose sockets and whose control socket are
/// in different places.
pub fn address(runtime_dir: Option<&str>) -> PathBuf {
    let base = runtime_dir.map_or_else(std::env::temp_dir, PathBuf::from);
    base.join(SOCKET)
}

/// A control socket taken for the life of one run.
///
/// Unlinked on drop: a socket file left behind is the next run's stale socket,
/// and a desktop that has to clear one it cannot tell from a live one is the
/// failure this whole module is arranged to avoid.
#[derive(Debug)]
pub struct Control {
    path: PathBuf,
    listener: UnixListener,
}

impl Control {
    /// A listener of this socket's own, for the thread that serves it.
    ///
    /// Cloned rather than handed over, because the run keeps the [`Control`]:
    /// it is what unlinks the socket when the desktop ends, and the serving
    /// thread ends with the process rather than before it.
    pub fn listener(&self) -> std::io::Result<UnixListener> {
        self.listener.try_clone()
    }
}

impl Drop for Control {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// A control socket that could not be taken.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TakeError {
    #[error(
        "a desktop is already running on this session: something is answering \
         at {path}. One socket is one desktop — stop that one first, or start \
         this one with an XDG_RUNTIME_DIR of its own."
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

/// Take the control socket at `path` for this run.
///
/// A DESKTOP THAT CANNOT HAVE THE SOCKET DOES NOT START. The alternative was
/// a second desktop running without one, and every `domicile load-shell` on
/// that machine going to the first desktop with neither of them saying so —
/// the wrong window reloading is exactly the kind of quiet wrong answer this
/// repository refuses elsewhere.
///
/// Told apart by asking rather than by looking: a socket file outlives the
/// process that bound it, so its being there says nothing about whether a
/// desktop is. What says so is whether anything answers. A path that answers
/// is a desktop, a socket that does not is the leavings of one and is
/// replaced, and anything that is not a socket at all is somebody else's file
/// and is left where it is.
pub fn take(path: &Path) -> Result<Control, TakeError> {
    clear(path)?;
    let listener = UnixListener::bind(path).map_err(|why| failed(path, &why))?;
    // The fallback in `address` is world-readable, so the directory is not
    // what protects this one. Set after the bind because there is nowhere to
    // set it before: `bind` is what creates the file, and the umask it does so
    // under is the process's. That leaves a window between the two calls in
    // which the socket is whatever the umask made it — microseconds, on a path
    // in /tmp, and only on a machine with no XDG_RUNTIME_DIR. Closing it means
    // binding under a name nobody is looking for and renaming it into place,
    // the way `session::publish` does, and that is worth doing when this
    // socket carries more than a question.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|why| failed(path, &why))?;
    Ok(Control {
        listener,
        path: path.to_path_buf(),
    })
}

/// Read one request off `stream`, answer it, and be done with the connection.
///
/// `answer` is [`crate::control::answer`] in the desktop and a closure in a
/// test, which is what keeps the decisions out of here: everything this
/// function knows is how to get a line off a socket and one back on.
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

/// A command that did not reach a desktop, or an answer that made no sense.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AskError {
    #[error("no desktop is running here — nothing is answering at {path}.")]
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

/// Send one request to the desktop answering at `path` and read its answer.
pub fn ask(path: &Path, request: &Request, patience: Duration) -> Result<Response, AskError> {
    let mut stream = UnixStream::connect(path).map_err(|why| match why.kind() {
        // Both of these are "there is no desktop here": the socket file is
        // absent, or it is one a dead desktop left behind.
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
        .set_read_timeout(Some(patience))
        .map_err(|why| unreachable_desktop(path, &why))?;
    stream
        .set_write_timeout(Some(patience))
        .map_err(|why| unreachable_desktop(path, &why))?;
    stream
        .write_all(to_line(request).as_bytes())
        .map_err(|why| unreachable_desktop(path, &why))?;
    // Everything this client had to say is said. A half-close is how the
    // desktop knows that without having to trust that the newline above was
    // the last byte.
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|why| unreachable_desktop(path, &why))?;
    let mut said = String::new();
    BufReader::new(stream)
        .read_line(&mut said)
        .map_err(|why| unreachable_desktop(path, &why))?;
    match said.trim() {
        // Nothing at all, which is the third face of a desktop that hung up:
        // see `unreachable_desktop` for the other two. Read as an unreadable
        // response it would be a sentence with nothing after the colon.
        "" => Err(AskError::NoAnswer {
            path: path.display().to_string(),
        }),
        line => parse_response(line).map_err(|_| AskError::Unreadable {
            path: path.display().to_string(),
            said: line.to_string(),
        }),
    }
}

/// The name of the socket inside the runtime directory. One name, because it
/// is what a client looks for and nothing tells it another.
const SOCKET: &str = "domicile.sock";

/// Make `path` a place a socket can be bound, or say why it is not one.
fn clear(path: &Path) -> Result<(), TakeError> {
    match UnixStream::connect(path) {
        Ok(_) => Err(TakeError::AlreadyRunning {
            path: path.display().to_string(),
        }),
        Err(why) if why.kind() == std::io::ErrorKind::NotFound => Ok(()),
        // Nothing answered, which is as true of a plain file at this path as
        // of a dead desktop's socket. Which of the two it is decides whether
        // it may be deleted.
        Err(_) => discard(path),
    }
}

/// Delete what a dead desktop left at `path`, and nothing else.
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

/// What went wrong between a client and the desktop it reached.
///
/// A desktop that took the connection and then did nothing with it is told
/// apart from everything else, because it is a different thing to go and look
/// at: the socket is fine and the desktop is running, and what has stopped is
/// the thread that answers on it.
///
/// FOUR KINDS FOR ONE THING, and the list was found by a test that failed
/// three runs in ten. A timeout arrives as `WouldBlock` or `TimedOut`
/// depending on the platform; a desktop that hung up arrives as
/// `ConnectionReset` or `BrokenPipe` depending on whether its close had been
/// noticed by the time the command was written. The fifth face of the same
/// thing is an empty read, and it is in [`ask`] rather than here because it is
/// not an error at all.
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
