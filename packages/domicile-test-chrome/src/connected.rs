//! A stand-in chrome on a real socket.

use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::conversation::{greet, hear, say, ChromeError};

/// A chrome connected to a compositor, past the handshake.
///
/// Keeps every message it has heard, so failures can show the full transcript.
pub struct Chrome {
    heard: Vec<HostMessage>,
    /// Which messages in `heard` [`Chrome::wait_for`] has already returned.
    ///
    /// Stops a second wait from matching a message an earlier wait returned.
    /// One flag per message, not a high-water mark: the host does not promise
    /// an order, so messages skipped by one wait must stay available.
    returned: Vec<bool>,
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    patience: Duration,
}

impl Chrome {
    /// Connect to a compositor's chrome socket and handshake.
    ///
    /// Retries until `patience` runs out, because the socket can exist briefly
    /// before the compositor listens on it.
    pub fn connect(socket: &Path, patience: Duration) -> Result<Chrome, ChromeError> {
        let until = Instant::now() + patience;
        loop {
            match UnixStream::connect(socket) {
                Ok(stream) => return Chrome::on(stream, patience),
                // Name the socket and wait time; a bare `Io(NotFound)` looks
                // like a bug in the stand-in.
                Err(err) if Instant::now() >= until => {
                    return Err(ChromeError::NeverListened {
                        socket: socket.display().to_string(),
                        patience,
                        kind: err.kind(),
                    })
                }
                Err(_) => std::thread::sleep(Duration::from_millis(20)),
            }
        }
    }

    /// Handshake on an existing socket, such as one end of a pair whose other
    /// end the test drives as the host.
    pub fn on(stream: UnixStream, patience: Duration) -> Result<Chrome, ChromeError> {
        stream
            .set_read_timeout(Some(patience))
            .map_err(|err| ChromeError::Io(err.kind()))?;
        let writer = stream
            .try_clone()
            .map_err(|err| ChromeError::Io(err.kind()))?;
        let mut reader = BufReader::new(stream);
        let mut greeting = writer
            .try_clone()
            .map_err(|err| ChromeError::Io(err.kind()))?;
        let greeting = greet(&mut reader, &mut greeting, patience)?;
        Ok(Chrome {
            returned: vec![false; greeting.early.len()],
            // Keep messages that arrived before the welcome.
            heard: greeting.early,
            patience,
            reader,
            writer,
        })
    }

    /// Say one message to the host.
    pub fn say(&mut self, message: &ChromeMessage) -> Result<(), ChromeError> {
        say(&mut self.writer, message)
    }

    /// The next message the host sent that `wanted` accepts.
    ///
    /// Checks messages already heard before reading the socket, since some
    /// (such as the desktop) arrive with the handshake. Each match is returned
    /// once, so waiting twice for the same shape needs two messages. Unmatched
    /// messages stay available to later waits. On timeout the error carries
    /// the transcript.
    pub fn wait_for(
        &mut self,
        wanted: impl Fn(&HostMessage) -> bool,
    ) -> Result<HostMessage, ChromeError> {
        let until = Instant::now() + self.patience;
        loop {
            if let Some(found) = self
                .heard
                .iter()
                .zip(&self.returned)
                .position(|(message, returned)| !returned && wanted(message))
            {
                self.returned[found] = true;
                return Ok(self.heard[found].clone());
            }
            if Instant::now() >= until {
                return Err(ChromeError::NeverCame {
                    heard: self.transcript(),
                });
            }
            match hear(&mut self.reader) {
                Ok(Some(message)) => {
                    self.heard.push(message);
                    self.returned.push(false);
                }
                Ok(None) => return Err(ChromeError::Closed),
                // A socket pair reports a closed peer as a reset, not EOF.
                Err(ChromeError::Io(
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe,
                )) => return Err(ChromeError::Closed),
                // A read timeout is the deadline, not an I/O failure.
                Err(ChromeError::Io(
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut,
                )) => {
                    return Err(ChromeError::NeverCame {
                        heard: self.transcript(),
                    })
                }
                Err(other) => return Err(other),
            }
        }
    }

    /// The messages heard so far, one wire line each.
    fn transcript(&self) -> String {
        crate::conversation::transcript(&self.heard)
    }
}
