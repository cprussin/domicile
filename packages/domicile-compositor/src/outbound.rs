//! The queue between the Wayland thread and the chrome writer.
//!
//! The rule this exists to enforce: **nothing the Wayland thread does may wait
//! on a chrome.** That thread also injects input, answers frame callbacks and
//! flushes clients, so a few hundred milliseconds spent waiting on a socket is
//! a few hundred milliseconds of frozen input for every client — long enough
//! for a held key to start repeating.
//!
//! Frames and lifecycle messages want opposite things when the chrome falls
//! behind, so they get opposite policies. A frame is superseded by the next one,
//! so queueing them adds latency and nothing else: past a shallow cap they are
//! dropped. A lifecycle message *is* the chrome's model of the world and cannot
//! be dropped, so the queue simply accepts it — they are small and arrive at the
//! rate a person opens and closes windows.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use domicile_protocol::HostMessage;

/// How many frames may wait in the queue before the next one is dropped. One is
/// enough to keep the writer busy; more only buys staleness.
const FRAME_DEPTH: usize = 1;

/// Something on its way to the chrome.
///
/// A frame carries raw pixels rather than a finished [`HostMessage`] so that
/// base64 and JSON encoding — tens of milliseconds for a large window — happen
/// on the writer thread rather than the one driving Wayland.
pub enum Outbound {
    Message(HostMessage),
    Frame {
        app_id: String,
        width: u32,
        height: u32,
        /// Device pixels per logical unit the client drew at.
        scale: u32,
        rgba: Vec<u8>,
    },
}

/// The sending half, held by the Wayland thread.
pub struct OutboundSender {
    sender: Sender<Outbound>,
    waiting_frames: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}

/// The receiving half, held by the writer thread.
pub struct OutboundReceiver {
    receiver: Receiver<Outbound>,
    waiting_frames: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}

/// Create the queue.
pub fn outbound() -> (OutboundSender, OutboundReceiver) {
    let (sender, receiver) = channel();
    let waiting_frames = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    (
        OutboundSender {
            sender,
            waiting_frames: waiting_frames.clone(),
            dropped: dropped.clone(),
        },
        OutboundReceiver {
            receiver,
            waiting_frames,
            dropped,
        },
    )
}

impl OutboundSender {
    /// Queue a lifecycle message. Never waits and never drops.
    pub fn message(&self, message: HostMessage) {
        let _ = self.sender.send(Outbound::Message(message));
    }

    /// Queue an app's pixels, returning whether they were taken. Never waits.
    pub fn frame(&self, app_id: &str, width: u32, height: u32, scale: u32, rgba: Vec<u8>) -> bool {
        if self.waiting_frames.load(Ordering::SeqCst) >= FRAME_DEPTH {
            self.dropped.fetch_add(1, Ordering::SeqCst);
            false
        } else {
            self.waiting_frames.fetch_add(1, Ordering::SeqCst);
            self.sender
                .send(Outbound::Frame {
                    app_id: app_id.to_string(),
                    width,
                    height,
                    scale,
                    rgba,
                })
                .is_ok()
        }
    }
}

impl OutboundReceiver {
    /// Frames refused since this was last asked, and reset.
    ///
    /// This is the number that says whether the chrome is keeping up: a drop
    /// means pixels were produced that nobody could take.
    pub fn take_dropped(&self) -> usize {
        self.dropped.swap(0, Ordering::SeqCst)
    }

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
            Ok(item) => Some(self.took(Some(item))),
            Err(RecvTimeoutError::Timeout) => Some(None),
            Err(RecvTimeoutError::Disconnected) => None,
        }
    }

    fn took(&self, item: Option<Outbound>) -> Option<Outbound> {
        if matches!(item, Some(Outbound::Frame { .. })) {
            self.waiting_frames.fetch_sub(1, Ordering::SeqCst);
        }
        item
    }
}

#[cfg(test)]
mod tests {
    /// Long enough that a timeout in these tests means a genuine failure to
    /// deliver rather than a slow machine.
    const PATIENTLY: Duration = Duration::from_secs(5);

    use std::sync::mpsc::sync_channel;
    use std::thread;
    use std::time::Duration;

    use domicile_protocol::HostMessage;

    use super::{outbound, Outbound};

    fn frame_bytes(sender: &super::OutboundSender) -> bool {
        sender.frame("app-1", 2, 2, 1, vec![0; 16])
    }

    fn closed(app_id: &str) -> HostMessage {
        HostMessage::AppClosed {
            app_id: app_id.to_string(),
        }
    }

    #[test]
    fn a_frame_is_dropped_while_one_is_already_waiting() {
        let (sender, _receiver) = outbound();
        assert!(frame_bytes(&sender), "the first frame is taken");
        assert!(!frame_bytes(&sender), "the second supersedes nothing yet");
    }

    #[test]
    fn taking_a_frame_makes_room_for_the_next() {
        let (sender, receiver) = outbound();
        assert!(frame_bytes(&sender));
        assert!(matches!(
            receiver.recv_until(PATIENTLY).flatten(),
            Some(Outbound::Frame { .. })
        ));
        assert!(frame_bytes(&sender), "the writer caught up, so this fits");
    }

    #[test]
    fn lifecycle_messages_are_never_dropped_behind_a_backlog() {
        // The chrome's model of the world is not something a busy frame path
        // may discard: an app it never hears closed stays on screen forever.
        let (sender, receiver) = outbound();
        assert!(frame_bytes(&sender));
        for index in 0..100 {
            sender.message(closed(&format!("app-{index}")));
        }
        let mut delivered = 0;
        while let Some(item) = receiver.recv_until(PATIENTLY).flatten() {
            if matches!(item, Outbound::Message(_)) {
                delivered += 1;
            }
            if delivered == 100 {
                break;
            }
        }
        assert_eq!(delivered, 100);
    }

    #[test]
    fn queueing_never_blocks_the_caller() {
        // The regression this file exists for: a bounded queue made the Wayland
        // thread wait on the chrome, and everything it also does — input, frame
        // callbacks — waited with it.
        let (done_tx, done_rx) = sync_channel(1);
        thread::spawn(move || {
            let (sender, _receiver) = outbound();
            for index in 0..1000 {
                sender.message(closed(&format!("app-{index}")));
                frame_bytes(&sender);
            }
            let _ = done_tx.send(());
        });
        assert!(
            done_rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "queueing blocked with nothing draining the queue"
        );
    }

    #[test]
    fn drops_are_counted_and_reset_when_reported() {
        // How many frames the chrome could not keep up with is the number that
        // says whether the copy path is the limit, so it has to survive until
        // something reports it — and start clean for the next window.
        let (sender, receiver) = outbound();
        assert!(frame_bytes(&sender));
        assert!(!frame_bytes(&sender));
        assert!(!frame_bytes(&sender));
        assert_eq!(receiver.take_dropped(), 2);
        assert_eq!(
            receiver.take_dropped(),
            0,
            "a window reports each drop once"
        );
    }

    #[test]
    fn order_is_kept_across_both_kinds() {
        let (sender, receiver) = outbound();
        sender.message(closed("first"));
        assert!(frame_bytes(&sender));
        sender.message(closed("last"));

        assert!(matches!(
            receiver.recv_until(PATIENTLY).flatten(),
            Some(Outbound::Message(HostMessage::AppClosed { app_id })) if app_id == "first"
        ));
        assert!(matches!(
            receiver.recv_until(PATIENTLY).flatten(),
            Some(Outbound::Frame { .. })
        ));
        assert!(matches!(
            receiver.recv_until(PATIENTLY).flatten(),
            Some(Outbound::Message(HostMessage::AppClosed { app_id })) if app_id == "last"
        ));
    }
}
