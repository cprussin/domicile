//! Where the engine takes commands, and carrying one to it.
//!
//! The supervisor names this socket — `--domicile-command-socket`, under the
//! run's own directory, see [`crate::spawn`] — and the engine binds it. So the
//! dialing is one direction only, and one line each way:
//! [`crate::command`] is what those lines are.
//!
//! NOT [`crate::control_socket`], though it is the same shape twice. That one
//! is the socket this desktop *answers*, with sentences about a desktop that
//! is not running; this one is the one it *dials*, with sentences about an
//! engine that is not answering — and a desktop whose engine has died is a
//! different thing to be told about than a desktop that was never there. The
//! two ends of that socket are one binary and the two ends of this one are not,
//! which is also why only this one carries a version.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::command::{load_shell_line, open_url_line, reply, Reply};

/// A command the engine did not carry out, and why it did not.
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

    #[error("could not reach the engine at {path}: {kind:?}")]
    Failed {
        path: String,
        kind: std::io::ErrorKind,
    },
}

/// Tell the engine answering at `socket` to serve `module` out of `root`.
///
/// One connection, one request, one reply, in the order the engine's own
/// `CommandSocket` reads them.
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

/// Tell the engine answering at `socket` to hand `url` to the shell to open.
pub fn open_url(socket: &Path, url: &str, patience: Duration) -> Result<(), CommandError> {
    carry_out(socket, &open_url_line(url), Reply::Opened, patience)
}

/// Put one command to the engine, and read `done` as its having carried it
/// out.
///
/// A reply to some other command is unreadable here rather than a success:
/// `loaded` in answer to `open_url` is an engine that heard something else.
fn carry_out(
    socket: &Path,
    line: &str,
    done: Reply,
    patience: Duration,
) -> Result<(), CommandError> {
    let said = exchange(socket, line, patience)?;
    match reply(said.trim()) {
        Ok(Reply::Refused { why }) => Err(CommandError::Refused { why }),
        Ok(answered) if answered == done => Ok(()),
        _ => Err(CommandError::Unreadable {
            path: socket.display().to_string(),
            said: said.trim().to_string(),
        }),
    }
}

/// Write one line to the engine and read the one it writes back.
fn exchange(socket: &Path, line: &str, patience: Duration) -> Result<String, CommandError> {
    let mut stream = UnixStream::connect(socket).map_err(|why| match why.kind() {
        // The socket file is absent, or it is one an engine that died left
        // behind: either way there is no engine here.
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
        // Nothing at all: the engine closed the connection without answering,
        // which `CommandSocket::Close` also does for a peer it gave up on.
        // Read as an unreadable reply it would be a sentence with nothing
        // after the colon.
        true => Err(CommandError::NoAnswer {
            path: socket.display().to_string(),
        }),
        false => Ok(said),
    }
}

/// What went wrong between the supervisor and the engine it dialed.
///
/// THE SAME FOUR KINDS FOR ONE THING [`crate::control_socket`] FOUND, and they
/// are the same four for the same reason: a timeout arrives as `WouldBlock` or
/// `TimedOut` depending on the platform, and a peer that hung up as
/// `ConnectionReset` or `BrokenPipe` depending on whether its close had been
/// noticed yet. The fifth face is an empty read, and it is in [`exchange`]
/// because it is not an error at all.
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
