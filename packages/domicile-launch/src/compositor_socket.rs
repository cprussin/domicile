//! Asks the compositor for a screenshot, or to send the shell a command, over
//! its chrome socket.
//!
//! Each request is the system call a page makes for it
//! (`SystemRequest::Screenshot`, `SystemRequest::SendShell`), so the
//! compositor has one path for both. The connection never says `hello`, so it
//! is not a chrome: it hears only the reply.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_protocol::{
    ChromeMessage, HostMessage, SystemError, SystemErrorKind, SystemReply, SystemRequest,
};

use crate::control::Shot;

/// The id the one call goes under.
const CALL: u32 = 1;

/// Why the compositor did not do what it was asked.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompositorError {
    #[error(
        "the compositor of this desktop is not answering at {path}. Either it \
         has died and the supervisor is about to replace it, or it has not \
         finished starting."
    )]
    NoCompositor { path: String },

    #[error(
        "the compositor took the request and did not answer at {path}, so \
         whether it carried it out is not something this can say."
    )]
    NoAnswer { path: String },

    #[error("the compositor at {path} answered something that is not a reply: {said}.")]
    Unreadable { path: String, said: String },

    #[error("the compositor did not do it: {why}")]
    Refused { why: String },

    #[error("could not reach the compositor at {path}: {kind:?}")]
    Failed {
        path: String,
        kind: std::io::ErrorKind,
    },
}

/// Tells the compositor at `socket` to write a PNG of the whole desk to the
/// absolute path `file`, or, with no `file`, to take the shell's interactive
/// screenshot.
///
/// With no `patience`, waits until the compositor answers or hangs up, as the
/// interactive one needs while the user picks.
pub fn screenshot(
    socket: &Path,
    file: Option<&Path>,
    patience: Option<Duration>,
) -> Result<Shot, CompositorError> {
    let request = SystemRequest::Screenshot {
        file: file.map(|file| file.display().to_string()),
    };
    let answer = called(socket, request, patience)?;
    match answer.reply {
        SystemReply::Saved { path } => Ok(Shot::Saved(PathBuf::from(path))),
        SystemReply::Failed {
            error:
                SystemError {
                    kind: SystemErrorKind::Canceled,
                    ..
                },
        } => Ok(Shot::Canceled),
        reply => Err(not_done(socket, reply, answer.said)),
    }
}

/// Tells the compositor at `socket` to send `command` to every page listening
/// for shell commands.
pub fn send_shell(
    socket: &Path,
    command: &[String],
    patience: Option<Duration>,
) -> Result<(), CompositorError> {
    let request = SystemRequest::SendShell {
        command: command.to_vec(),
    };
    let answer = called(socket, request, patience)?;
    match answer.reply {
        SystemReply::Sent => Ok(()),
        reply => Err(not_done(socket, reply, answer.said)),
    }
}

/// The compositor's reply to a call, and the line it came in.
struct Answer {
    reply: SystemReply,
    said: String,
}

/// Makes the one call `request` and reads its answer.
fn called(
    socket: &Path,
    request: SystemRequest,
    patience: Option<Duration>,
) -> Result<Answer, CompositorError> {
    let path = || socket.display().to_string();
    let unreachable = |why: std::io::Error| match why.kind() {
        // A timeout is `WouldBlock` or `TimedOut` depending on the platform,
        // and a hang-up `ConnectionReset` or `BrokenPipe` depending on timing.
        std::io::ErrorKind::WouldBlock
        | std::io::ErrorKind::TimedOut
        | std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::ConnectionReset => CompositorError::NoAnswer { path: path() },
        kind => CompositorError::Failed { path: path(), kind },
    };
    let mut stream = UnixStream::connect(socket).map_err(|why| match why.kind() {
        // A missing socket, or a stale one left by a dead compositor.
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {
            CompositorError::NoCompositor { path: path() }
        }
        kind => CompositorError::Failed { path: path(), kind },
    })?;
    stream.set_read_timeout(patience).map_err(unreachable)?;
    stream.set_write_timeout(patience).map_err(unreachable)?;
    let mut line = serde_json::to_string(&ChromeMessage::SystemRequest { id: CALL, request })
        .expect("a system request always serializes");
    line.push('\n');
    stream.write_all(line.as_bytes()).map_err(unreachable)?;
    let mut said = String::new();
    BufReader::new(stream)
        .read_line(&mut said)
        .map_err(unreachable)?;
    let said = said.trim();
    if said.is_empty() {
        // The compositor closed without replying.
        Err(CompositorError::NoAnswer { path: path() })
    } else {
        match serde_json::from_str::<HostMessage>(said) {
            Ok(HostMessage::SystemReply { id: CALL, reply }) => Ok(Answer {
                reply,
                said: said.to_string(),
            }),
            _ => Err(CompositorError::Unreadable {
                path: path(),
                said: said.to_string(),
            }),
        }
    }
}

/// The error for a `reply` that is not the success the call wanted.
fn not_done(socket: &Path, reply: SystemReply, said: String) -> CompositorError {
    match reply {
        SystemReply::Failed { error } => CompositorError::Refused { why: error.message },
        _ => CompositorError::Unreadable {
            path: socket.display().to_string(),
            said,
        },
    }
}
