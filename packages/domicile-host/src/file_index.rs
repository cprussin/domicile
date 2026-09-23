//! What there is to open, held between a walk that finds it and a page that
//! draws it.
//!
//! The launcher used to be answered by walking the home as the panel opened,
//! which is why it was answered with so little of one — see
//! [`crate::home_walk`] for the budget that bought. This is the other design:
//! the home is walked once at boot into here, a watcher keeps it, and the
//! panel is answered out of memory.
//!
//! # It is read while it is being written
//!
//! Everything awkward about this type comes from that. A boot walk of a real
//! home takes seconds; a launcher opened in the middle of one is offered
//! whatever has been found so far, and is told so — [`FileIndex::indexing`] is
//! what the page draws its "still building" line from, so that an incomplete
//! answer is never mistaken for the whole of a home.
//!
//! # Where the list it starts with comes from
//!
//! The compositor seeds it with what the last run wrote down (see
//! [`crate::index_file`]), so the first launcher of a session has a list
//! before the walk has found anything. That list is a week stale in the small
//! ways a week changes a home, which is what [`FileIndex::built`] is for: the
//! walk is the truth as of its run, so anything the seed held that the walk
//! did not find is gone by the time the walk ends.

use std::collections::BTreeSet;

/// Everything a launcher may be offered, and whether that is all of it yet.
///
/// A `BTreeSet` because three things want it: a launcher wants one row per
/// path, it wants them in byte order however they arrived, and a directory
/// that went away wants everything under it gone with it — which is a range
/// over a prefix rather than a scan.
#[derive(Debug, Default)]
pub struct FileIndex {
    offered: BTreeSet<String>,
    /// What the seed held and the walk has not confirmed, emptied as it is.
    ///
    /// The sweep half of a mark and sweep, and it is over the *seed* rather
    /// than over the index: a file created while the walk is still running was
    /// never in last run's list, so it is not in here and the walk ending does
    /// not take it.
    unconfirmed: BTreeSet<String>,
    indexing: bool,
    /// Whether anything a chrome would draw has moved since it was last asked.
    ///
    /// Held rather than worked out, because the alternative is keeping a copy
    /// of the whole list to compare against — and the whole list is the size
    /// of a home directory.
    news: bool,
}

impl FileIndex {
    /// An index of what the last run wrote down, with a walk still to come.
    pub fn building(seed: impl IntoIterator<Item = String>) -> Self {
        let offered: BTreeSet<String> = seed.into_iter().collect();
        FileIndex {
            unconfirmed: offered.clone(),
            offered,
            indexing: true,
            // A seeded index has its whole list to say and an empty one has
            // the fact that it is building, so either way the chromes are owed
            // something before anything else happens.
            news: true,
        }
    }

    /// Start the walk again over what is in the index now.
    ///
    /// **For a watch that lost events, which is a thing a kernel does.** An
    /// inotify queue has a bound and a `git clone` into a watched home
    /// out-runs it; `notify` says so by flagging a rescan, and what was lost is
    /// unknowable. So the home is walked again and the launcher is told the
    /// list it has is not complete — which is exactly the state a boot is in,
    /// and is why this is the same pair of calls rather than a second path
    /// through the index.
    ///
    /// Nothing is dropped. What is here is still the best answer there is
    /// until the second walk contradicts it, and a launcher blanked for the
    /// length of one would be a desktop punishing somebody for a burst of file
    /// writes.
    pub fn rebuilding(&mut self) {
        self.unconfirmed = self.offered.clone();
        self.indexing = true;
        self.news = true;
    }

    /// Take in what the walk has found so far.
    pub fn found(&mut self, paths: impl IntoIterator<Item = String>) {
        for path in paths {
            self.unconfirmed.remove(&path);
            self.news |= self.offered.insert(path);
        }
    }

    /// The walk is over: what it did not find is not there any more.
    ///
    /// Always news, even when the sweep drops nothing and the walk found
    /// nothing new, because `indexing` is half of what the chromes are told
    /// and it is the half that just changed. A launcher left saying "still
    /// building" over a complete list would go on saying it until somebody
    /// saved a file.
    pub fn built(&mut self) {
        for path in std::mem::take(&mut self.unconfirmed) {
            self.offered.remove(&path);
        }
        self.indexing = false;
        self.news = true;
    }

    /// A path that has turned up on disk.
    pub fn appeared(&mut self, path: String) {
        self.unconfirmed.remove(&path);
        self.news |= self.offered.insert(path);
    }

    /// A path that has gone, and everything that was under it.
    ///
    /// One event is all the kernel gives for a `rm -r`: a watch on a tree
    /// reports the directory going, not each of the thousand paths that went
    /// with it. The range is over `path/` rather than over `path`, so a
    /// sibling whose name merely starts the same way — `Notes-elsewhere.txt`
    /// beside `Notes` — stays where it is.
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

    /// What a launcher is offered, in the order it goes on screen.
    ///
    /// Byte order rather than the user's collation: the same home has to
    /// produce the same list on every machine, and `LC_COLLATE` is not a thing
    /// a desktop should be able to reorder a launcher with.
    pub fn files(&self) -> Vec<String> {
        self.offered.iter().cloned().collect()
    }

    /// Whether the first full walk is still running, which is what a page
    /// draws its "still building" line from.
    pub fn indexing(&self) -> bool {
        self.indexing
    }

    /// Whether there is a broadcast to make, asked once per answer.
    ///
    /// The index is told about every filesystem event under a home and most of
    /// them change nothing a launcher draws — a write into a file that already
    /// exists, a path that was already known, a removal of one that was not.
    /// Sending the whole list to every chrome for one of those is a megabyte
    /// of JSON saying what the page already had.
    pub fn changed(&mut self) -> bool {
        std::mem::replace(&mut self.news, false)
    }
}
