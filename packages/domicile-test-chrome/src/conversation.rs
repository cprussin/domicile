//! What a chrome says and hears, over anything that can be read and written.

use std::io::{BufRead, Write};
use std::time::{Duration, Instant};

use domicile_host::ipc::to_line;
use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};

/// What can go wrong being a chrome.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChromeError {
    #[error("the host went away before it said anything")]
    Closed,

    #[error("the host speaks protocol {host}; this chrome speaks {chrome}")]
    ProtocolMismatch { host: u32, chrome: u32 },

    #[error("the host said something this chrome cannot read: {line} ({message})")]
    Unreadable { line: String, message: String },

    #[error("could not speak to the host: {0:?}")]
    Io(std::io::ErrorKind),

    #[error("the host never said it; it said: {heard}")]
    NeverCame { heard: String },

    #[error("nothing was listening on {socket} after {patience:?} ({kind:?})")]
    NeverListened {
        socket: String,
        patience: Duration,
        kind: std::io::ErrorKind,
    },
}

/// Say hello and wait for the welcome, returning the version agreed on and
/// anything the host said before it.
///
/// The welcome is waited for by *type* rather than by position, because the
/// host is not obliged to send it first and observably does not. A chrome now
/// joins the compositor's broadcast list at the handshake rather than at the
/// socket — so the window is narrower than it was — but it is not closed: the
/// join happens inside the `hello` arm and the `welcome` is written after that
/// arm returns, so a broadcast the handshake itself set off can still reach
/// the socket ahead of the reply. `@domicile/chrome-sdk` dispatches on type
/// and holds what arrives early for the page; this does the same, and a
/// stand-in that insisted on position would fail a test about the desktop with
/// a complaint about a greeting.
///
/// The refusal is a value rather than a panic: a version mismatch is the
/// failure a protocol bump produces, and a test that hits it should report
/// which two numbers disagreed rather than time out looking like a compositor
/// that never came up.
pub fn greet(
    heard: &mut impl BufRead,
    said: &mut impl Write,
    patience: Duration,
) -> Result<Greeting, ChromeError> {
    say(
        said,
        &ChromeMessage::Hello {
            protocol_version: PROTOCOL_VERSION,
        },
    )?;
    let mut early = Vec::new();
    let until = Instant::now() + patience;
    loop {
        // Deadlined, because a *successful* read advances nothing: a host that
        // talks and never welcomes — one broadcasting frames while its `hello`
        // handler is broken — would otherwise be waited on forever, and a hang
        // has no message at all. A read timeout bounds each read, not the loop.
        if Instant::now() >= until {
            return Err(ChromeError::NeverCame {
                heard: transcript(&early),
            });
        }
        let message = match hear(heard) {
            // A read that ran out of time is this deadline arriving through
            // the socket rather than through the clock, and it says the same
            // thing: what did come, instead of blaming a socket that behaved
            // exactly as it was asked to.
            Err(ChromeError::Io(std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut)) => {
                return Err(ChromeError::NeverCame {
                    heard: transcript(&early),
                })
            }
            other => other?,
        };
        match message {
            None => return Err(ChromeError::Closed),
            Some(HostMessage::Welcome { protocol_version })
                if protocol_version == PROTOCOL_VERSION =>
            {
                return Ok(Greeting {
                    agreed: protocol_version,
                    early,
                })
            }
            Some(HostMessage::Welcome { protocol_version }) => {
                return Err(ChromeError::ProtocolMismatch {
                    host: protocol_version,
                    chrome: PROTOCOL_VERSION,
                })
            }
            Some(other) => early.push(other),
        }
    }
}

/// What a host said, as the lines it said them on.
pub(crate) fn transcript(said: &[HostMessage]) -> String {
    if said.is_empty() {
        return "nothing at all".to_string();
    }
    said.iter()
        .map(|message| to_line(message).trim_end().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// A completed handshake: the version, and whatever arrived ahead of it.
///
/// The early messages are kept rather than dropped — they are things the host
/// said to this chrome, and a test asking what a compositor said should not
/// have a hole in the answer where the greeting was.
#[derive(Debug, Clone, PartialEq)]
pub struct Greeting {
    pub agreed: u32,
    pub early: Vec<HostMessage>,
}

/// Say one message to the host.
pub fn say(said: &mut impl Write, message: &ChromeMessage) -> Result<(), ChromeError> {
    said.write_all(to_line(message).as_bytes())
        .and_then(|()| said.flush())
        .map_err(|err| ChromeError::Io(err.kind()))
}

/// Read the next message the host sent, or `None` once it has closed.
///
/// A closed connection is the end rather than a failure: a compositor that
/// stopped is something a test asserts on, and the caller has the context to
/// say whether it was expected.
pub fn hear(heard: &mut impl BufRead) -> Result<Option<HostMessage>, ChromeError> {
    let mut line = String::new();
    let read = heard
        .read_line(&mut line)
        .map_err(|err| ChromeError::Io(err.kind()))?;
    if read == 0 {
        return Ok(None);
    }
    serde_json::from_str(line.trim_end())
        .map(Some)
        .map_err(|err| ChromeError::Unreadable {
            line: line.trim_end().to_string(),
            message: err.to_string(),
        })
}
