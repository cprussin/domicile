//! A one-shot answer a D-Bus method awaits.
//!
//! The backend methods run on zbus's executor and must not block it while the
//! shell decides, so each awaits a [`Reply`]. Std-only, to add no async
//! runtime.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

/// The two ends of one answer.
pub fn reply<T>() -> (Replier<T>, Reply<T>) {
    let slot = Arc::new(Mutex::new(Slot {
        value: None,
        dropped: false,
        waker: None,
    }));
    (
        Replier {
            slot: Arc::clone(&slot),
        },
        Reply { slot },
    )
}

/// What sends the answer.
#[derive(Debug)]
pub struct Replier<T> {
    slot: Arc<Mutex<Slot<T>>>,
}

/// What awaits it: `None` when the [`Replier`] was dropped unsent.
#[derive(Debug)]
pub struct Reply<T> {
    slot: Arc<Mutex<Slot<T>>>,
}

#[derive(Debug)]
struct Slot<T> {
    value: Option<T>,
    dropped: bool,
    waker: Option<Waker>,
}

impl<T> Replier<T> {
    pub fn send(self, value: T) {
        self.slot.lock().unwrap().value = Some(value);
    }
}

/// Wakes the [`Reply`], sent or not.
impl<T> Drop for Replier<T> {
    fn drop(&mut self) {
        let mut slot = self.slot.lock().unwrap();
        slot.dropped = true;
        if let Some(waker) = slot.waker.take() {
            waker.wake();
        }
    }
}

impl<T> Future for Reply<T> {
    type Output = Option<T>;

    fn poll(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<T>> {
        let mut slot = self.slot.lock().unwrap();
        if slot.dropped {
            Poll::Ready(slot.value.take())
        } else {
            slot.waker = Some(context.waker().clone());
            Poll::Pending
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn an_answer_sent_from_another_thread_arrives() {
        let (replier, reply) = reply();
        let sender = thread::spawn(move || replier.send("allowed"));

        assert_eq!(zbus::block_on(reply), Some("allowed"));
        sender.join().expect("the sender finished");
    }

    #[test]
    fn a_replier_dropped_unsent_ends_the_wait() {
        let (replier, reply) = reply::<&str>();
        drop(replier);

        assert_eq!(zbus::block_on(reply), None);
    }
}
