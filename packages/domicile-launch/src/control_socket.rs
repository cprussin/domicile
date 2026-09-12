//! Where a running desktop answers, and how a command reaches it.
//!
//! `$XDG_RUNTIME_DIR/domicile-ipc.<pid>.sock`, and the desktop puts that path
//! in [`VARIABLE`] for everything it starts. That is the shape every other
//! Wayland compositor's control channel has: sway keys
//! `sway-ipc.<uid>.<pid>.sock` and exports `SWAYSOCK`, Hyprland puts its
//! socket under a per-instance signature directory and exports
//! `HYPRLAND_INSTANCE_SIGNATURE`, river rides a Wayland protocol and is
//! per-display by construction. All three say the same thing: name the socket
//! after the instance, let the client read the name out of its environment,
//! and never refuse a second instance.
//!
//! ONE NAME PER SESSION WAS THE FIRST ANSWER HERE and it was wrong: it made a
//! second `domicile` on one login refuse to start, which is not something
//! `wayland-1` existing lets a compositor do.
//!
//! What goes over the socket is [`crate::control`]'s and is pure; what is here
//! is the part that needs a filesystem.

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

/// The variable a desktop publishes its control socket in, and the only way a
/// client finds one.
///
/// `SWAYSOCK`'s job, under this program's name.
pub const VARIABLE: &str = "DOMICILE_SOCK";

/// The socket the desktop supervised by `pid` answers on.
///
/// KEYED ON THE PID, like sway's, and not on the Wayland display name — which
/// is the obvious alternative and cannot work: the supervisor takes this
/// socket before it starts the engine, so at the moment the name is needed
/// there is no compositor yet and no display for it to be named after.
///
/// The uid sway also puts in the name buys nothing here. It is there so two
/// users' sockets do not collide in a shared `/tmp`, and a pid is already
/// unique across the machine that allocated it.
///
/// `None` falls back to the temporary directory, which is the same fallback
/// the run's own directory takes — one rule for where this user's runtime
/// files go, rather than a desktop whose sockets and whose control socket are
/// in different places.
pub fn address(runtime_dir: Option<&str>, pid: u32) -> PathBuf {
    let base = runtime_dir.map_or_else(std::env::temp_dir, PathBuf::from);
    base.join(format!("domicile-ipc.{pid}.sock"))
}

/// A command typed somewhere no desktop put [`VARIABLE`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{VARIABLE} is not set, so there is no desktop here to ask. A desktop \
     puts it in the environment of everything it starts — run this from a \
     terminal inside the desktop you mean, or set {VARIABLE} to its socket."
)]
pub struct NotInADesktop;

/// The socket the desktop around this client answers on, as it said so.
///
/// REFUSED RATHER THAN SEARCHED FOR when nothing said. A session can hold
/// several desktops now, so there is no longer a path that "the" desktop is
/// at; the runtime directory could be scanned, but a scan that finds two
/// sockets has to guess which desktop the person meant, and a command that
/// goes to the wrong desktop is worse than one that does not go. `swaymsg`
/// draws the same line and requires `SWAYSOCK`.
pub fn advertised(said: Option<&str>) -> Result<PathBuf, NotInADesktop> {
    said.map(PathBuf::from).ok_or(NotInADesktop)
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

/// Take the control socket at `path` for this run.
///
/// A DESKTOP THAT CANNOT HAVE THE SOCKET DOES NOT START, and with a pid in
/// the name the only way that happens is that something which is not this
/// desktop is serving on this desktop's name. A second Domicile is not that
/// case and never reaches here — it has a pid of its own and therefore a
/// socket of its own.
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
