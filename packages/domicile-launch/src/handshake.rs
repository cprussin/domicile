//! Whether a page ever reached the compositor, and what to say when none did.
//!
//! THIS IS THE ONE THAT COST A DAY. `nix run …#manganese` came up on a blank
//! Chrome window; four separate causes were found behind it, and the last was
//! that `MaybeLaunchAppShortcutWindow` declines `--app=domicile://shell/`
//! because the scheme is deliberately not web-safe — so startup carried on as
//! though the flag had never been passed and the user got a browser on the New
//! Tab page. The engine logged nothing, because from its side nothing had
//! failed. The compositor logged nothing, because it has no opinion about how
//! long a socket stays quiet. The page could not log anything, because there
//! was no page.
//!
//! So the compositor is the one that knows: it binds the control socket, and
//! it is the only end that can tell "nobody has dialled this" from "nobody is
//! coming". [`Handshake`] is what it counts on that socket and [`silence`] is
//! what it says about a count that is too low. Both live here, in a crate with
//! no Smithay in it, so the sentence a user reads is a unit test rather than
//! something only a machine with a display can run.
//!
//! What it will not do is name the cause. `--app` is one way to get a browser
//! that never loads a shell and a mistyped `--domicile-control-socket` is
//! another; the observation is the same and it is the observation that goes in
//! the message.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

/// How long a compositor waits for a page before saying it has not had one.
///
/// The engine's `ControlChannel::kReachFor`, deliberately: that is how long the
/// browser's end spends retrying a socket that is not there, so a shorter wait
/// here would complain about a page that was still on its way, and a longer one
/// would leave the two ends failing at different times for the same reason.
pub const WAIT_FOR_A_PAGE: Duration = Duration::from_secs(30);

/// What the control socket had heard when its patience ran out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Heard {
    /// A page connected and agreed the protocol. This is a desktop.
    APage,
    /// Something dialled the socket, and no page has agreed the protocol on
    /// it.
    AConnection,
    /// Nothing at all.
    Nothing,
}

/// What the socket has heard, counted as it happens.
///
/// Two counters rather than a state machine because both ends of it are
/// racing: connections arrive on their own threads, and a `hello` is read on
/// the connection's. Nothing here has to be consistent with anything else at
/// an instant — the question is only ever asked once, long after.
#[derive(Debug, Default)]
pub struct Handshake {
    connections: AtomicUsize,
    agreements: AtomicUsize,
}

impl Handshake {
    pub fn new() -> Self {
        Handshake::default()
    }

    /// Something dialled the socket.
    pub fn connected(&self) {
        self.connections.fetch_add(1, Ordering::Relaxed);
    }

    /// A page on it agreed a protocol this compositor speaks.
    pub fn agreed(&self) {
        self.agreements.fetch_add(1, Ordering::Relaxed);
    }

    /// The most that has happened, which is what the answer is about. One
    /// page that agreed makes this a desktop however many other connections
    /// came and went.
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

/// What to tell the user about a control socket that has heard only this much.
///
/// `None` when there is nothing to say, which is the case a running desktop is
/// in.
pub fn silence(heard: Heard, socket: &Path, patience: Duration) -> Option<String> {
    let socket = socket.display();
    let seconds = patience.as_secs();
    match heard {
        Heard::APage => None,
        Heard::Nothing => Some(format!(
            "nothing has connected to the control socket at {socket} after \
             {seconds}s. The desktop is drawn by a page in the engine, and no \
             page has reached this compositor: either the engine never loaded \
             the shell, or it was not told where this socket is. The engine's \
             own output says which; check that it was started with \
             --domicile-control-socket={socket}."
        )),
        Heard::AConnection => Some(format!(
            "something connected to the control socket at {socket} but no page \
             has agreed the protocol after {seconds}s. A page says `hello` \
             naming a protocol version as soon as it starts; a version this \
             compositor refuses is logged above."
        )),
    }
}
