//! Detects a page that never connects to the compositor's control socket.
//!
//! If the engine never loads the shell, the user sees a blank browser window
//! and the engine logs nothing. The compositor owns the control socket, so it
//! reports the silence. [`Handshake`] counts what the socket hears and
//! [`silence`] builds the message. The message states what was observed, not
//! a guessed cause.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

/// How long the compositor waits for a page before reporting it.
///
/// Matches the engine's `ControlChannel::kReachFor` retry window, so both ends
/// give up at the same time.
pub const WAIT_FOR_A_PAGE: Duration = Duration::from_secs(30);

/// Whether a page is expected to connect, set by `--expect-a-page` (see
/// [`crate::arguments`]).
///
/// Test harnesses such as `guard-client-window.sh` run the engine without a
/// shell page. They pass `no` so passing runs do not print a false error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expected {
    /// A shell page will connect; report if it does not.
    APage,
    /// No page will connect.
    NoPage,
}

/// What the control socket heard before the timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Heard {
    /// A page connected and agreed on the protocol.
    APage,
    /// Something connected, but no page agreed on the protocol.
    AConnection,
    /// Nothing connected.
    Nothing,
}

/// Counts connections and protocol agreements on the control socket.
///
/// Independent relaxed counters suffice: updates come from several threads,
/// and the result is read once, long after.
#[derive(Debug, Default)]
pub struct Handshake {
    connections: AtomicUsize,
    agreements: AtomicUsize,
}

impl Handshake {
    pub fn new() -> Self {
        Handshake::default()
    }

    /// Records a connection.
    pub fn connected(&self) {
        self.connections.fetch_add(1, Ordering::Relaxed);
    }

    /// Records a page agreeing on a supported protocol.
    pub fn agreed(&self) {
        self.agreements.fetch_add(1, Ordering::Relaxed);
    }

    /// The furthest stage reached. One agreement wins over any number of
    /// connections.
    pub fn heard(&self) -> Heard {
        match (
            self.agreements.load(Ordering::Relaxed),
            self.connections.load(Ordering::Relaxed),
        ) {
            (0, 0) => Heard::Nothing,
            (0, _) => Heard::AConnection,
            (_, _) => Heard::APage,
        }
    }
}

/// The message for a control socket that heard only `heard`, or `None` if
/// nothing is wrong.
pub fn silence(
    expected: Expected,
    heard: Heard,
    socket: &Path,
    patience: Duration,
) -> Option<String> {
    let socket = socket.display();
    let seconds = patience.as_secs();
    match (expected, heard) {
        (Expected::NoPage, _) | (Expected::APage, Heard::APage) => None,
        (Expected::APage, Heard::Nothing) => Some(format!(
            "nothing has connected to the control socket at {socket} after \
             {seconds}s. The desktop is drawn by a page in the engine, and no \
             page has reached this compositor: either the engine never loaded \
             the shell, or it was not told where this socket is. The engine's \
             own output says which; check that it was started with \
             --domicile-control-socket={socket}."
        )),
        (Expected::APage, Heard::AConnection) => Some(format!(
            "something connected to the control socket at {socket} but no page \
             has agreed the protocol after {seconds}s. A page says `hello` \
             naming a protocol version as soon as it starts; a version this \
             compositor refuses is logged above."
        )),
    }
}
