//! The pages watching for the desktop to go idle, each after a time it chose,
//! across every chrome connection. A page watches with
//! `SystemRequest::IdleAfter` or `SystemRequest::IdleBeforeBlanking`; the
//! compositor's clock settles them. See `docs/IDLE.md`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::fanout::Listener;

/// Hears whether the desk is idle, on behalf of one page.
pub(crate) type Hear = Arc<dyn Fn(bool) + Send + Sync>;

/// Asks the compositor's clock to settle the watches again.
type Wake = Arc<dyn Fn() + Send + Sync>;

/// When a watch goes idle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    /// This long after the last input.
    After(Duration),
    /// This long before the screens blank.
    BeforeBlanking(Duration),
}

/// Every page watching. Clones share them, so every connection's
/// [`crate::system::System`] holds a clone of one.
#[derive(Clone)]
pub struct IdleWatches(Arc<Mutex<Watching>>, Wake);

#[derive(Default)]
struct Watching {
    next: u64,
    watches: HashMap<u64, Watch>,
}

struct Watch {
    mark: Mark,
    /// What the page was last told.
    idle: bool,
    hear: Hear,
}

impl IdleWatches {
    /// Watches that call `wake` when a page starts watching, so the clock can
    /// tell it at once if the desk has already been still long enough.
    pub fn new(wake: impl Fn() + Send + Sync + 'static) -> IdleWatches {
        IdleWatches(Arc::default(), Arc::new(wake))
    }

    /// Tells each watch whether the desk has been `still` long enough, and
    /// returns how long until the next is due, or `None` for none.
    ///
    /// `still` is how long since the last input, or `None` while an idle
    /// inhibitor holds the desk awake. `blank_after` is the blank timeout, or
    /// `None` for screens that never blank.
    ///
    /// Heard outside the lock, since hearing takes its connection's lock,
    /// which a page starting to watch holds while it takes this one.
    pub fn settle(
        &self,
        still: Option<Duration>,
        blank_after: Option<Duration>,
    ) -> Option<Duration> {
        let (heard, due) = {
            let mut watching = self.0.lock().unwrap();
            let mut heard: Vec<(Hear, bool)> = Vec::new();
            let mut due: Option<Duration> = None;
            for watch in watching.watches.values_mut() {
                let after = after(watch.mark, blank_after);
                let idle = matches!((still, after), (Some(still), Some(after)) if still >= after);
                if idle != watch.idle {
                    watch.idle = idle;
                    heard.push((watch.hear.clone(), idle));
                }
                if let (Some(still), Some(after), false) = (still, after, idle) {
                    let left = after - still;
                    due = Some(due.map_or(left, |due| due.min(left)));
                }
            }
            (heard, due)
        };
        for (hear, idle) in heard {
            hear(idle);
        }
        due
    }

    /// Ends every idle spell, for input. Returns whether one ended: the
    /// clock must then come round again for it.
    pub fn stirred(&self) -> bool {
        let heard: Vec<Hear> = {
            let mut watching = self.0.lock().unwrap();
            watching
                .watches
                .values_mut()
                .filter(|watch| watch.idle)
                .map(|watch| {
                    watch.idle = false;
                    watch.hear.clone()
                })
                .collect()
        };
        for hear in &heard {
            hear(false);
        }
        !heard.is_empty()
    }

    /// Calls `hear` on each change at `mark` until the [`Listener`] drops.
    pub(crate) fn watch(&self, mark: Mark, hear: Hear) -> Listener {
        let mut watching = self.0.lock().unwrap();
        let key = watching.next;
        watching.next += 1;
        watching.watches.insert(
            key,
            Watch {
                mark,
                idle: false,
                hear,
            },
        );
        let watches = self.0.clone();
        Listener::stopping(move || {
            watches.lock().unwrap().watches.remove(&key);
        })
    }

    /// Asks the clock to settle the watches.
    pub(crate) fn wake(&self) {
        (self.1)();
    }
}

/// How long after the last input `mark` falls, or `None` for never: before
/// screens that never blank, or that blank sooner.
fn after(mark: Mark, blank_after: Option<Duration>) -> Option<Duration> {
    match mark {
        Mark::After(after) => Some(after),
        Mark::BeforeBlanking(before) => blank_after
            .and_then(|blank_after| blank_after.checked_sub(before))
            .filter(|after| !after.is_zero()),
    }
}
