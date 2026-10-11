//! The warning that the screens are about to blank, and the pages listening
//! for it across every chrome connection. The compositor sets it; a page
//! listens with `SystemRequest::IdleWarnings`. See `docs/IDLE.md`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Hears when the screens blank, or `None` when they no longer will, on behalf
/// of one page.
pub(crate) type Hear = Arc<dyn Fn(Option<Instant>) + Send + Sync>;

/// The current warning and every page listening. Clones share both, so every
/// connection's [`crate::system::System`] holds a clone of one.
#[derive(Clone, Default)]
pub struct IdleWarnings(Arc<Mutex<Warned>>);

#[derive(Default)]
struct Warned {
    /// When the screens blank, while a warning runs.
    blanks_at: Option<Instant>,
    next: u64,
    hearing: HashMap<u64, Hear>,
}

/// One page listening. Dropping it stops it.
pub(crate) struct Listener {
    warnings: IdleWarnings,
    key: u64,
}

impl IdleWarnings {
    /// Sets when the screens blank, or `None` for no warning, and tells every
    /// listener if that changed.
    ///
    /// Each is called outside the lock, since hearing takes its connection's
    /// lock, which a page starting to listen holds while it takes this one.
    pub fn warn(&self, blanks_at: Option<Instant>) {
        let hearing: Vec<Hear> = {
            let mut warned = self.0.lock().unwrap();
            if warned.blanks_at == blanks_at {
                return;
            }
            warned.blanks_at = blanks_at;
            warned.hearing.values().cloned().collect()
        };
        for hear in &hearing {
            hear(blanks_at);
        }
    }

    /// When the screens blank, while a warning runs.
    pub(crate) fn blanks_at(&self) -> Option<Instant> {
        self.0.lock().unwrap().blanks_at
    }

    /// Calls `hear` with every change until the [`Listener`] drops.
    pub(crate) fn listen(&self, hear: Hear) -> Listener {
        let mut warned = self.0.lock().unwrap();
        let key = warned.next;
        warned.next += 1;
        warned.hearing.insert(key, hear);
        Listener {
            warnings: self.clone(),
            key,
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.warnings.0.lock().unwrap().hearing.remove(&self.key);
    }
}
