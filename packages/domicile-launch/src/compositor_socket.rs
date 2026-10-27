//! Asks the compositor for a screenshot, to send the shell a command, for its
//! theme, or for a virtual monitor, over its chrome socket.
//!
//! Each request is the message a page sends for it (`SystemRequest::Screenshot`,
//! `SystemRequest::SendShell`, `ChromeMessage::SetTheme`), so the compositor
//! has one path for each. The connection never says `hello`, so it is not a
//! chrome: it hears only the reply.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_protocol::{
    ChromeMessage, HostMessage, SystemError, SystemErrorKind, SystemReply, SystemRequest, Theme,
};

use crate::cli::MonitorMode;
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
        SystemReply::Copied => Ok(Shot::Copied),
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

/// Tells the compositor at `socket` to record the screen, and waits until the
/// user stops the recording, however long that takes. `None` when the user
/// dismissed the picker or discarded the recording.
pub fn screen_record(socket: &Path) -> Result<Option<PathBuf>, CompositorError> {
    let answer = called(socket, SystemRequest::ScreenRecord, None)?;
    match answer.reply {
        SystemReply::Saved { path } => Ok(Some(PathBuf::from(path))),
        SystemReply::Failed {
            error:
                SystemError {
                    kind: SystemErrorKind::Canceled,
                    ..
                },
        } => Ok(None),
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

/// Tells the compositor at `socket` to set the theme `to`, if given, and
/// returns the desk's theme.
///
/// The compositor answers a connection's messages in order, so the
/// `which_theme` sent after `set_theme` reports the new theme.
pub fn theme(
    socket: &Path,
    to: Option<Theme>,
    patience: Option<Duration>,
) -> Result<Theme, CompositorError> {
    let messages: Vec<ChromeMessage> = to
        .map(|theme| ChromeMessage::SetTheme { theme })
        .into_iter()
        .chain([ChromeMessage::WhichTheme])
        .collect();
    let said = exchanged(socket, &messages, patience)?;
    match serde_json::from_str::<HostMessage>(&said) {
        Ok(HostMessage::Theme { theme }) => Ok(theme),
        _ => Err(CompositorError::Unreadable {
            path: socket.display().to_string(),
            said,
        }),
    }
}

/// A virtual monitor the compositor keeps while this connection is open.
pub struct HeldMonitor {
    output: String,
    stream: UnixStream,
    path: PathBuf,
}

impl HeldMonitor {
    /// Its `wl_output`, as `domicile.displays` names it.
    pub fn output(&self) -> &str {
        &self.output
    }

    /// Resizes it in place.
    pub fn resize(&self, mode: MonitorMode) -> Result<(), CompositorError> {
        let message = ChromeMessage::SystemRequest {
            id: CALL,
            request: SystemRequest::ResizeVirtualMonitor {
                width: mode.size.0,
                height: mode.size.1,
                refresh_mhz: mode.refresh_mhz,
                scale: mode.scale,
            },
        };
        let mut line = serde_json::to_string(&message).expect("a chrome message always serializes");
        line.push('\n');
        (&self.stream)
            .write_all(line.as_bytes())
            .map_err(|why| CompositorError::Failed {
                path: self.path.display().to_string(),
                kind: why.kind(),
            })
    }

    /// Blocks until the compositor ends it: it exited, or ended the call.
    pub fn until_it_ends(&self) {
        // Whatever comes, an end or a hang-up, ends it.
        let _ = BufReader::new(&self.stream).read_line(&mut String::new());
    }

    /// Hangs up, which removes it, and wakes [`HeldMonitor::until_it_ends`].
    pub fn give_back(&self) {
        // Already gone if the compositor hung up first.
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }
}

/// Asks the compositor at `socket` for a virtual monitor named `name`, and
/// holds it until [`HeldMonitor::give_back`] or the drop.
pub fn virtual_monitor(
    socket: &Path,
    name: &str,
    mode: MonitorMode,
    patience: Option<Duration>,
) -> Result<HeldMonitor, CompositorError> {
    let request = SystemRequest::VirtualMonitor {
        name: name.to_owned(),
        width: mode.size.0,
        height: mode.size.1,
        refresh_mhz: mode.refresh_mhz,
        scale: mode.scale,
    };
    let stream = connected(socket, patience)?;
    let said = said_over(
        socket,
        &stream,
        &[ChromeMessage::SystemRequest { id: CALL, request }],
    )?;
    let reply = match serde_json::from_str::<HostMessage>(&said) {
        Ok(HostMessage::SystemReply { id: CALL, reply }) => reply,
        _ => {
            return Err(CompositorError::Unreadable {
                path: socket.display().to_string(),
                said,
            })
        }
    };
    match reply {
        SystemReply::VirtualMonitor { output } => {
            // It lasts until the compositor goes, however long that is.
            stream
                .set_read_timeout(None)
                .map_err(|why| CompositorError::Failed {
                    path: socket.display().to_string(),
                    kind: why.kind(),
                })?;
            Ok(HeldMonitor {
                output,
                stream,
                path: socket.to_path_buf(),
            })
        }
        reply => Err(not_done(socket, reply, said)),
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
    let said = exchanged(
        socket,
        &[ChromeMessage::SystemRequest { id: CALL, request }],
        patience,
    )?;
    match serde_json::from_str::<HostMessage>(&said) {
        Ok(HostMessage::SystemReply { id: CALL, reply }) => Ok(Answer { reply, said }),
        _ => Err(CompositorError::Unreadable {
            path: socket.display().to_string(),
            said,
        }),
    }
}

/// Sends `messages` and reads the one line the compositor answers with.
fn exchanged(
    socket: &Path,
    messages: &[ChromeMessage],
    patience: Option<Duration>,
) -> Result<String, CompositorError> {
    said_over(socket, &connected(socket, patience)?, messages)
}

/// A connection to the compositor at `socket`, waiting at most `patience`.
fn connected(socket: &Path, patience: Option<Duration>) -> Result<UnixStream, CompositorError> {
    let path = || socket.display().to_string();
    let stream = UnixStream::connect(socket).map_err(|why| match why.kind() {
        // A missing socket, or a stale one left by a dead compositor.
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {
            CompositorError::NoCompositor { path: path() }
        }
        kind => CompositorError::Failed { path: path(), kind },
    })?;
    stream
        .set_read_timeout(patience)
        .map_err(|why| unreachable(socket, &why))?;
    stream
        .set_write_timeout(patience)
        .map_err(|why| unreachable(socket, &why))?;
    Ok(stream)
}

/// Sends `messages` over `stream` and reads the one line the compositor
/// answers with. Nothing follows that line but a hang-up or, for a held
/// call, its end, so the reader buffers nothing the caller misses.
fn said_over(
    socket: &Path,
    mut stream: &UnixStream,
    messages: &[ChromeMessage],
) -> Result<String, CompositorError> {
    let lines: String = messages
        .iter()
        .map(|message| {
            let mut line =
                serde_json::to_string(message).expect("a chrome message always serializes");
            line.push('\n');
            line
        })
        .collect();
    stream
        .write_all(lines.as_bytes())
        .map_err(|why| unreachable(socket, &why))?;
    let mut said = String::new();
    BufReader::new(stream)
        .read_line(&mut said)
        .map_err(|why| unreachable(socket, &why))?;
    let said = said.trim();
    if said.is_empty() {
        // The compositor closed without replying.
        Err(CompositorError::NoAnswer {
            path: socket.display().to_string(),
        })
    } else {
        Ok(said.to_string())
    }
}

/// The error for a connection that failed after it was made.
fn unreachable(socket: &Path, why: &std::io::Error) -> CompositorError {
    let path = socket.display().to_string();
    match why.kind() {
        // A timeout is `WouldBlock` or `TimedOut` depending on the platform,
        // and a hang-up `ConnectionReset` or `BrokenPipe` depending on timing.
        std::io::ErrorKind::WouldBlock
        | std::io::ErrorKind::TimedOut
        | std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::ConnectionReset => CompositorError::NoAnswer { path },
        kind => CompositorError::Failed { path, kind },
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
