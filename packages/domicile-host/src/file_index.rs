//! In-memory set of home paths the launcher offers.
//!
//! - [`crate::home_walk`] fills it at boot and [`crate::file_changes`] keeps
//!   it current.
//! - It is read while the walk runs. [`FileIndex::indexing`] tells the
//!   launcher the list is incomplete.
//! - It starts from the last run's list ([`crate::index_file`]).
//!   [`FileIndex::built`] drops seeded paths the walk did not find.

use std::collections::BTreeSet;

/// The paths a launcher may offer, and whether indexing is complete.
///
/// A `BTreeSet` keeps paths unique and in byte order, and lets a removed
/// directory's contents be dropped with a prefix range.
#[derive(Debug, Default)]
pub struct FileIndex {
    offered: BTreeSet<String>,
    /// Seeded paths the walk has not yet found. [`FileIndex::built`] removes
    /// them. Files created during the walk are never in here, so they stay.
    unconfirmed: BTreeSet<String>,
    indexing: bool,
    /// Whether anything changed since [`FileIndex::changed`] was last called.
    /// Tracked as a flag to avoid keeping a copy of the list to compare.
    news: bool,
}

impl FileIndex {
    /// An index seeded with the last run's list, awaiting a walk.
    pub fn building(seed: impl IntoIterator<Item = String>) -> Self {
        let offered: BTreeSet<String> = seed.into_iter().collect();
        FileIndex {
            unconfirmed: offered.clone(),
            offered,
            indexing: true,
            // Chromes need the seed, or the fact that indexing has started.
            news: true,
        }
    }

    /// Starts a new walk, treating the current paths as the seed.
    ///
    /// For when the watch lost events, such as an inotify queue overflow that
    /// `notify` reports as a rescan. Current paths stay offered until the walk
    /// finishes, so the launcher does not go blank.
    pub fn rebuilding(&mut self) {
        self.unconfirmed = self.offered.clone();
        self.indexing = true;
        self.news = true;
    }

    /// Adds paths the walk has found.
    pub fn found(&mut self, paths: impl IntoIterator<Item = String>) {
        for path in paths {
            self.unconfirmed.remove(&path);
            self.news |= self.offered.insert(path);
        }
    }

    /// Ends the walk and drops seeded paths it did not find.
    ///
    /// Always marks a change, since `indexing` flips even if no path did.
    pub fn built(&mut self) {
        for path in std::mem::take(&mut self.unconfirmed) {
            self.offered.remove(&path);
        }
        self.indexing = false;
        self.news = true;
    }

    /// Adds a path that appeared on disk.
    pub fn appeared(&mut self, path: String) {
        self.unconfirmed.remove(&path);
        self.news |= self.offered.insert(path);
    }

    /// Removes `path` and everything under it.
    ///
    /// A `rm -r` reports only the directory, so its contents go too. The range
    /// is over `path/`, so a sibling such as `Notes-old` beside `Notes` stays.
    pub fn vanished(&mut self, path: &str) {
        let under = format!("{path}/");
        let gone: Vec<String> = self
            .offered
            .range(under.clone()..)
            .take_while(|offered| offered.starts_with(&under))
            .cloned()
            .collect();
        self.news |= self.offered.remove(path);
        for path in gone {
            self.offered.remove(&path);
            self.news = true;
        }
    }

    /// Every path, in byte order so the list does not depend on `LC_COLLATE`.
    pub fn files(&self) -> Vec<String> {
        self.offered.iter().cloned().collect()
    }

    /// Whether a walk is still running, so the list may be incomplete.
    pub fn indexing(&self) -> bool {
        self.indexing
    }

    /// Returns and clears whether the index changed and needs a broadcast.
    ///
    /// Most filesystem events change nothing here, and each broadcast can be
    /// megabytes.
    pub fn changed(&mut self) -> bool {
        std::mem::replace(&mut self.news, false)
    }
}
