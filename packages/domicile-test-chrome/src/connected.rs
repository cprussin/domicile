//! A stand-in chrome on a real socket.

use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::conversation::{greet, hear, say, ChromeError};

/// A chrome connected to a compositor, past the handshake.
///
/// Keeps every message it has heard. A test's question is usually about what a
/// compositor said and in what order, and a reader that matched one line and
/// dropped the rest could only answer half of it.
pub struct Chrome {
    heard: Vec<HostMessage>,
    /// Which of `heard` [`Chrome::wait_for`] has already handed back, by
    /// position.
    ///
    /// Without it a wait is satisfied by a message an earlier wait already
    /// returned, so a test that waits twice for the same shape asserts nothing
    /// the second time. Not hypothetical: a reload test passed in 40ms against
    /// a compositor that was never reconfigured, because the desktop it was
    /// waiting for had already arrived with the handshake.
    ///
    /// One mark per message rather than a high-water mark, because the host
    /// does not promise an order. A chrome joins the compositor's broadcast
    /// list at connect rather than at handshake, so an `app_appeared` can land
    /// ahead of the desktop; a cursor that skipped everything in front of a
    /// match would throw that away, and the next wait for it would sit out its
    /// whole patience and then report the compositor for something it did.
    returned: Vec<bool>,
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    patience: Duration,
}

impl Chrome {
    /// Connect to a compositor's chrome socket and handshake.
    ///
    /// Retries until `patience` runs out: the socket exists before anything is
    /// listening on it for a moment, and a test that raced that would fail
    /// about a connection rather than about its subject.
    pub fn connect(socket: &Path, patience: Duration) -> Result<Chrome, ChromeError> {
        let until = Instant::now() + patience;
        loop {
            match UnixStream::connect(socket) {
                Ok(stream) => return Chrome::on(stream, patience),
                // Named rather than left as a bare `Io(NotFound)`: what a test
                // needs to know here is which socket and how long it was
                // waited on, and a kind on its own reads like a bug in the
                // stand-in rather than a compositor that never listened.
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

    /// The same on a socket the caller already has, which is how a test plays
    /// the host itself.
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
            // Kept, not dropped: what the host said before its welcome is
            // still what the host said, and a test asking what a compositor
            // said should not have a hole where the greeting was.
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
    /// The transcript first and only then the socket, because a message can
    /// arrive before the caller thinks to ask for it — `greet` hands over
    /// whatever beat the welcome, and the desktop rides with the handshake.
    /// So this is not "read until": a wait can be answered without reading.
    ///
    /// *Next*, though, rather than *any*: a match is consumed, so a second
    /// wait for the same shape is a wait for a second message. Waiting on
    /// history would let a test assert that a compositor re-described the
    /// desktop and be answered by the description it started with.
    ///
    /// Only the match, though — everything it was found behind stays waitable,
    /// because nothing promises the order two kinds of message arrive in.
    ///
    /// Everything read on the way is kept, and the failure carries it: "the
    /// compositor never sent a `render_band`" is half an answer, and the other
    /// half is what it sent instead.
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
                // A reset is the peer going away too. A socket pair reports
                // one where a closed pipe reports end-of-file, and to a test
                // asserting "the compositor died" they are the same event.
                Err(ChromeError::Io(
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe,
                )) => return Err(ChromeError::Closed),
                // A read that ran out of time is the deadline, reported with
                // the transcript rather than as an I/O failure about a socket
                // that is working exactly as asked.
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

    /// What the host has said, as the lines it said them on.
    fn transcript(&self) -> String {
        crate::conversation::transcript(&self.heard)
    }
}
