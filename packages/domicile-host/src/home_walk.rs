//! Every path in a home directory, found once so a launcher never has to look.
//!
//! This is the producer half of the file index: it reads a home all the way
//! down and hands back what is in it, and [`crate::file_index`] is what holds
//! the answer. The seam is [`Directory`] — the compositor passes
//! [`RealDirectory`], the tests pass a map — so the rule about what a launcher
//! is offered is a function over a table of directories rather than something
//! you need a disk to state.
//!
//! # What changed, and why the old rule is gone
//!
//! A launcher used to be answered by walking the home *while the panel was
//! opening*, which is what the two-pass `find` it inherited was shaped by:
//!
//! ```sh
//! find ~/* -maxdepth 1
//! find ~/{Notes,Scratch} -mindepth 2 -not -path '*/\.*'
//! ```
//!
//! One level everywhere plus two hand-picked trees all the way down — a budget
//! rather than a preference, and one that had to be spent before the panel
//! could draw. An index is the other side of that trade: the walk happens once
//! at boot and a watcher keeps it, so there is no keystroke waiting on it and
//! no reason to stop at a depth or to make a person name their document
//! directories in the desktop's source.
//!
//! # The one rule that is kept
//!
//! **Nothing hidden**, at every depth: an entry whose name starts with a dot
//! is neither offered nor descended into. The original did this in two halves
//! that disagreed — a glob that hid `~/.config` and a `-not -path` that hid
//! `~/Notes/.git/HEAD` while offering `~/Notes/.git` — and the disagreement
//! was worth keeping only while both halves were cheap. At full depth it is
//! not: a `.git` walked to the bottom is most of what is in a home full of
//! checkouts, and none of it is a thing anybody opens by name.

use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};

/// A source of directory entries, so the walk can be tested without a disk.
pub trait Directory {
    /// What is in `path`.
    ///
    /// An `Err` is "this is not a directory I can read", which is the ordinary
    /// answer for a plain file and the one thing the walk treats as a leaf.
    /// Only the home directory's own failure is reported — see [`walk`].
    fn read(&self, path: &Path) -> io::Result<Vec<PathBuf>>;
}

/// The filesystem this process is running on.
pub struct RealDirectory;

impl Directory for RealDirectory {
    fn read(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
        std::fs::read_dir(path)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect()
    }
}

/// Everything under `home`, named relative to it, shallowest first.
///
/// `Err` means the home directory itself could not be read, which is a broken
/// desktop rather than a person with no files — the caller reports it instead
/// of building an index that says "you have nothing", which is what that
/// failure would otherwise look like from the page.
///
/// Lazy, because the caller reads the answer while it is still being produced:
/// the launcher is offered whatever has been found so far, so a walk that only
/// existed as its finished `Vec` would be a launcher with no list for as long
/// as a home takes to read.
pub fn walk<'a, D: Directory>(home: &Path, directory: &'a D) -> io::Result<Walk<'a, D>> {
    Ok(Walk {
        home: home.to_path_buf(),
        pending: offerable(directory.read(home)?),
        directory,
    })
}

/// A walk in progress: what is still to be visited, and what reads it.
///
/// **Breadth first, and the launcher is what asks for it.** The panel can be
/// opened while the walk is running and shows what has been found by then, so
/// the order paths are found in is the order a person gets them. Depth first
/// would produce the whole of `~/Archive` before `~/Notes` existed at all;
/// this way the top of the home is there from the first moment and the deep
/// paths fill in underneath.
///
/// A queue rather than recursion for the same reason it is lazy: the caller
/// takes a batch, hands it to the index and comes back, which a recursive walk
/// has no way to be stopped in the middle of.
pub struct Walk<'a, D: Directory> {
    home: PathBuf,
    pending: VecDeque<PathBuf>,
    directory: &'a D,
}

impl<D: Directory> Iterator for Walk<'_, D> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            let path = self.pending.pop_front()?;
            // Asked of everything, because a directory listing does not say
            // which of its entries is itself a directory. A plain file and a
            // directory that will not open answer the same way and are both
            // leaves: the path is still offered, and the walk carries on with
            // the rest of the home rather than stopping on it.
            if let Ok(children) = self.directory.read(&path) {
                self.pending.extend(offerable(children));
            }
            // A name the kernel stored as bytes no `str` can hold is a path a
            // launcher cannot print, so it cannot be offered — but everything
            // *under* it still can be, which is why the descent above happens
            // first and the loop takes the next path rather than ending here.
            if let Some(name) = named_from(&path, &self.home) {
                return Some(name);
            }
        }
    }
}

/// A directory's entries in the order they are walked, hidden ones dropped.
///
/// Sorted, so that two machines with the same home produce the same index in
/// the same order. `read_dir` hands back whatever order the filesystem keeps
/// its entries in, which is neither stable across filesystems nor across
/// writes to one — and a half-built index whose contents depend on that is one
/// a person sees a different half of on each boot.
fn offerable(entries: Vec<PathBuf>) -> VecDeque<PathBuf> {
    let mut offerable: Vec<PathBuf> = entries
        .into_iter()
        .filter(|entry| !is_hidden(entry))
        .collect();
    offerable.sort();
    offerable.into()
}

/// Whether the last component starts with a dot.
fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.as_encoded_bytes().starts_with(b"."))
}

/// `path` as the launcher shows it: relative to `home`, and dropped when it is
/// not under `home` or cannot be spelled as text.
///
/// The first case cannot come off a walk of a real home — every path here was
/// built by joining onto `home` — and the second is the one that genuinely
/// occurs: `read_dir` hands back what the kernel stored, and what the kernel
/// stored is bytes.
fn named_from(path: &Path, home: &Path) -> Option<String> {
    path.strip_prefix(home)
        .ok()?
        .to_str()
        .map(ToString::to_string)
}
