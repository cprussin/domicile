//! Watches the home directory so the file index stays current.
//! [`crate::file_changes`] interprets the events.
//!
//! [`HomeWatcher`] is a [`Directory`] that watches each directory as the walk
//! reads it. Directories omitted by `files.omit` are never read, so never
//! watched, which keeps busy trees like `.git` from overflowing the inotify
//! queue.

use std::cell::RefCell;
use std::io;
use std::path::Path;

use notify::{EventKindMask, RecursiveMode, Watcher};

use crate::home_walk::{listed, Directory, Entry};

/// Watches every directory read through it.
///
/// Dropping it silently ends the watch: `heard` is no longer called.
pub struct HomeWatcher {
    watcher: RefCell<notify::RecommendedWatcher>,
    unwatched: RefCell<Option<Unwatched>>,
}

/// Directories read but not watched since the last call to `unwatched`.
#[derive(Debug)]
pub struct Unwatched {
    pub count: usize,
    /// The first error. Usually `fs.inotify.max_user_watches` was reached, so
    /// the rest failed the same way.
    pub first: notify::Error,
}

impl HomeWatcher {
    /// A watcher with no directories yet.
    ///
    /// Calls `heard` on the watcher's thread for each event or error. A
    /// callback lets the caller merge it with other inputs, such as config
    /// changes. An event flagged `Rescan` means events were dropped; handle it
    /// with [`crate::file_index::FileIndex::rebuilding`].
    pub fn new(
        heard: impl Fn(notify::Result<notify::Event>) + Send + 'static,
    ) -> notify::Result<Self> {
        // Only events that add or remove paths. The kernel queue is bounded
        // and an overflow forces a rewalk. With all events, the walk's own
        // directory opens overflowed it on large homes, looping forever.
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

    /// Returns and clears the directories that failed to be watched.
    ///
    /// Aggregated so hitting `fs.inotify.max_user_watches` logs once rather
    /// than once per directory.
    pub fn unwatched(&self) -> Option<Unwatched> {
        self.unwatched.take()
    }
}

impl Directory for HomeWatcher {
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>> {
        // Open first so a plain file fails before it is watched. Watch before
        // reading so no write in between is missed.
        let listing = std::fs::read_dir(path)?;
        match self
            .watcher
            .borrow_mut()
            .watch(path, RecursiveMode::NonRecursive)
        {
            Ok(()) => {}
            // Removed since opening; the parent's watch reports it.
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
