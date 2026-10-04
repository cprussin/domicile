//! The chrome side of the protocol, over any reader and writer.

use std::io::{BufRead, Write};
use std::time::{Duration, Instant};

use domicile_host::ipc::to_line;
use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};

/// Errors from talking to a host.
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

    #[error("the host announced {expected} bytes of frame and sent {got}")]
    TruncatedFrame { expected: u64, got: u64 },

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
/// Matches the welcome by type, not position: a broadcast triggered by the
/// handshake can reach the socket before the welcome. `@domicile-desktop/sdk`
/// does the same.
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
        // The read timeout bounds each read, not the loop. A host that keeps
        // talking without a welcome would otherwise hang the test.
        if Instant::now() >= until {
            return Err(ChromeError::NeverCame {
                heard: transcript(&early),
            });
        }
        let message = match hear(heard) {
            // A read timeout is the same deadline; report it the same way.
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

/// Format messages for an error, one wire line each.
pub(crate) fn transcript(said: &[HostMessage]) -> String {
    if said.is_empty() {
        return "nothing at all".to_string();
    }
    said.iter()
        .map(|message| to_line(message).trim_end().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// A completed handshake: the agreed version and any messages that arrived
/// before the welcome.
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
/// A closed connection is not an error; the caller decides whether it was
/// expected.
pub fn hear(heard: &mut impl BufRead) -> Result<Option<HostMessage>, ChromeError> {
    let mut line = String::new();
    let read = heard
        .read_line(&mut line)
        .map_err(|err| ChromeError::Io(err.kind()))?;
    if read == 0 {
        return Ok(None);
    }
    let message: HostMessage =
        serde_json::from_str(line.trim_end()).map_err(|err| ChromeError::Unreadable {
            line: line.trim_end().to_string(),
            message: err.to_string(),
        })?;
    Ok(Some(message))
}
