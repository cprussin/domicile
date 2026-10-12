//! Something every listening page hears, across every chrome connection: the
//! shell commands ([`crate::shell_commands`]), the lock's refusals
//! ([`crate::unlock_refusals`]) and clients' window requests
//! ([`crate::window_requests`]).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Hears one item, on behalf of one page.
pub(crate) type Hear<T> = Arc<dyn Fn(&T) + Send + Sync>;

/// Every page listening. Clones share the listeners, so every connection's
/// [`crate::system::System`] holds a clone of one.
pub struct Fanout<T: ?Sized>(Arc<Mutex<Listeners<T>>>);

struct Listeners<T: ?Sized> {
    next: u64,
    hearing: HashMap<u64, Hear<T>>,
}

/// One page listening. Dropping it stops it.
pub(crate) struct Listener {
    stop: Option<Box<dyn FnOnce() + Send>>,
}

impl<T: ?Sized + 'static> Fanout<T> {
    /// Calls `hear` with every item sent until the [`Listener`] drops.
    pub(crate) fn listen(&self, hear: Hear<T>) -> Listener {
        let mut listeners = self.0.lock().unwrap();
        let key = listeners.next;
        listeners.next += 1;
        listeners.hearing.insert(key, hear);
        let fanout = self.clone();
        Listener {
            stop: Some(Box::new(move || {
                fanout.0.lock().unwrap().hearing.remove(&key);
            })),
        }
    }

    /// Sends `item` to every listener, and returns how many there were.
    ///
    /// Each is called outside the lock, since hearing takes its connection's
    /// lock, which a page starting to listen holds while it takes this one.
    pub fn send(&self, item: &T) -> usize {
        let hearing: Vec<Hear<T>> = self.0.lock().unwrap().hearing.values().cloned().collect();
        for hear in &hearing {
            hear(item);
        }
        hearing.len()
    }
}

impl<T: ?Sized> Clone for Fanout<T> {
    fn clone(&self) -> Self {
        Fanout(Arc::clone(&self.0))
    }
}

impl<T: ?Sized> Default for Fanout<T> {
    fn default() -> Self {
        Fanout(Arc::new(Mutex::new(Listeners {
            next: 0,
            hearing: HashMap::new(),
        })))
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            stop();
        }
    }
}
