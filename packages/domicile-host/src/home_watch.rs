//! A watch on a home directory, so the index does not go stale.
//!
//! The index is built once at boot and would be yesterday's by the afternoon
//! without this: a file created in a terminal is not an event any other part
//! of this desktop sees. [`crate::file_changes`] is what reads what comes
//! back, and is where the decisions are; this is the OS glue, which is thin on
//! purpose.
//!
//! # What is watched is what the walk reads, and nothing else
//!
//! [`HomeWatcher`] is a [`Directory`]: the walk reads the home through it, and
//! each directory is watched as it is read. So what the desk's `files.omit`
//! leaves out is never watched — the walk never reads it.
//!
//! It used to be one recursive watch over the whole home, which is one inotify
//! watch per directory *under it*, omitted or not: a `~/.cache` a browser
//! writes into all day, every checkout's `.git`, a `target/` per crate. Setting
//! it up visited every one, and a walk again set it up again. What they
//! reported was all thrown away, but not before it had filled the kernel's
//! queue — and a queue that overflows is a walk again.

use std::cell::RefCell;
use std::io;
use std::path::Path;

use notify::{EventKindMask, RecursiveMode, Watcher};

use crate::home_walk::{listed, Directory, Entry};

/// A watch over the directories read through it, for as long as it is kept.
///
/// **Dropping it ends the watch**, and nothing says so: `heard` is simply not
/// called again, which reads as a home nobody is writing in.
pub struct HomeWatcher {
    watcher: RefCell<notify::RecommendedWatcher>,
    unwatched: RefCell<Option<Unwatched>>,
}

/// The directories that were read but could not be watched, since last asked.
#[derive(Debug)]
pub struct Unwatched {
    pub count: usize,
    /// The first one's error, which is almost always all of them: the usual
    /// cause is `fs.inotify.max_user_watches`, and past it, every one fails.
    pub first: notify::Error,
}

impl HomeWatcher {
    /// A watcher that has watched nothing yet.
    ///
    /// What each watched directory reports is handed to `heard`, on the
    /// watcher's own thread. A callback rather than a channel of its own, so
    /// the caller can fold it into whatever else it is waiting on — the index
    /// thread also hears the desk's config.
    ///
    /// The errors handed to `heard` are the watcher's own, and one matters: an
    /// event flagged `Rescan` means the kernel dropped some, which is what
    /// [`crate::file_index::FileIndex::rebuilding`] exists for.
    pub fn new(
        heard: impl Fn(notify::Result<notify::Event>) + Send + 'static,
    ) -> notify::Result<Self> {
        // WHAT THE INDEX READS, AND NOTHING ELSE. The kernel queues a bounded
        // number of events and says it dropped some when that fills, which the
        // index can only answer with a walk. Asked for everything, the queue
        // was mostly opens — one per directory the walk reads — so a home of
        // more directories than `max_queued_events` overflowed it every time,
        // and was walked again, forever. A write into a file is no row either.
        let only = EventKindMask::CREATE | EventKindMask::REMOVE | EventKindMask::MODIFY_NAME;
        let watcher = notify::RecommendedWatcher::new(
            heard,
            notify::Config::default().with_event_kinds(only),
        )?;
        Ok(HomeWatcher {
            watcher: RefCell::new(watcher),
            unwatched: RefCell::new(None),
        })
    }

    /// The directories read since this was last asked that are not watched.
    ///
    /// Held rather than reported as they fail, because past
    /// `fs.inotify.max_user_watches` every directory fails, and a log line
    /// each is a log of the whole home.
    pub fn unwatched(&self) -> Option<Unwatched> {
        self.unwatched.take()
    }
}

impl Directory for HomeWatcher {
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>> {
        // Opened first, so that a plain file fails here rather than being
        // watched; watched before it is read, so that nothing written into it
        // in between is lost.
        let listing = std::fs::read_dir(path)?;
        match self
            .watcher
            .borrow_mut()
            .watch(path, RecursiveMode::NonRecursive)
        {
            Ok(()) => {}
            // Gone since it was opened, which its parent's watch reports.
            Err(err) if matches!(err.kind, notify::ErrorKind::PathNotFound) => {}
            Err(err) => {
                let mut unwatched = self.unwatched.borrow_mut();
                match unwatched.as_mut() {
                    Some(unwatched) => unwatched.count += 1,
                    None => {
                        *unwatched = Some(Unwatched {
                            count: 1,
                            first: err,
                        })
                    }
                }
            }
        }
        listed(listing)
    }
}
