//! The queue from the Wayland thread to the chrome writer.
//!
//! The Wayland thread must never wait on a chrome. It also injects input,
//! answers frame callbacks and flushes clients, so a stall on a socket freezes
//! input for every client, long enough for a held key to start repeating.
//!
//! The queue is unbounded. It carries only lifecycle messages, which are the
//! chrome's model of the world and cannot be dropped. They are small and
//! arrive at the rate windows open and close.

use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use domicile_protocol::HostMessage;

/// Something on its way to the chrome.
///
/// An enum with one variant, so adding an item that is not a `HostMessage`
/// does not change the channel's type at every use.
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
    /// Block until the next item, returning `Some(None)` after `timeout`.
    ///
    /// The caller also reports on a schedule, which must keep running when
    /// nothing is sent. `None` means the sender is gone.
    pub fn recv_until(&self, timeout: Duration) -> Option<Option<Outbound>> {
        match self.receiver.recv_timeout(timeout) {
            Ok(item) => Some(Some(item)),
            Err(RecvTimeoutError::Timeout) => Some(None),
            Err(RecvTimeoutError::Disconnected) => None,
        }
    }
}
