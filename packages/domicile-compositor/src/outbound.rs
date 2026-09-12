//! The queue between the Wayland thread and the chrome writer.
//!
//! The rule this exists to enforce: **nothing the Wayland thread does may wait
//! on a chrome.** That thread also injects input, answers frame callbacks and
//! flushes clients, so a few hundred milliseconds spent waiting on a socket is
//! a few hundred milliseconds of frozen input for every client — long enough
//! for a held key to start repeating.
//!
//! Frames and lifecycle messages wanted opposite things when the chrome fell
//! behind, and once got opposite policies: a frame is superseded by the next
//! one, so past a shallow cap they were dropped. THAT CAP IS GONE WITH THE
//! FRAMES — a client's buffer goes to the display compositor now and no pixels
//! come down here, as `Outbound` says below. What is left is lifecycle
//! messages, which *are* the chrome's model of the world and cannot be
//! dropped, so the queue simply accepts them: they are small and arrive at the
//! rate a person opens and closes windows.

use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use domicile_protocol::HostMessage;

/// Something on its way to the chrome.
///
/// One variant, and it used to be two: a frame carried raw pixels so that the
/// encoding — tens of milliseconds for a large window — happened on the writer
/// thread rather than the one driving Wayland. A client's buffer goes to the
/// display compositor now and no pixels come down here, so what is left is
/// messages. The enum stays because the channel's item type is what the two
/// halves agree on, and a bare `HostMessage` would make the next thing that
/// is not one a wider change than it should be.
pub enum Outbound {
    Message(HostMessage),
}

/// The sending half, held by the Wayland thread.
pub struct OutboundSender {
    sender: Sender<Outbound>,
}

/// The receiving half, held by the writer thread.
pub struct OutboundReceiver {
    receiver: Receiver<Outbound>,
}

/// Create the queue.
pub fn outbound() -> (OutboundSender, OutboundReceiver) {
    let (sender, receiver) = channel();
    (OutboundSender { sender }, OutboundReceiver { receiver })
}

impl OutboundSender {
    /// Queue a lifecycle message. Never waits and never drops.
    pub fn message(&self, message: HostMessage) {
        let _ = self.sender.send(Outbound::Message(message));
    }
}

impl OutboundReceiver {
    /// Block until the next item, giving up after `timeout` with `Some(None)`.
    ///
    /// The caller reports on a schedule as well as forwarding, and a path that
    /// sends nothing must not silence it: waiting for traffic that will never
    /// come is how the compositing path came to report nothing at all while it
    /// was drawing sixty frames a second.
    ///
    /// `None` still means the sender is gone.
    pub fn recv_until(&self, timeout: Duration) -> Option<Option<Outbound>> {
        match self.receiver.recv_timeout(timeout) {
            Ok(item) => Some(Some(item)),
            Err(RecvTimeoutError::Timeout) => Some(None),
            Err(RecvTimeoutError::Disconnected) => None,
        }
    }
}
