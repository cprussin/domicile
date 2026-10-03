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
//! # What is left out is the desk's to say
//!
//! The walk is handed a question — is this path omitted? — and asks it of
//! every entry by its name relative to the home: an omitted one is neither
//! offered nor descended into. The answer is `files.omit` in the desk's
//! config (`domicile_config::Omit`), whose default is the rule this walk used
//! to keep itself: **nothing hidden**, at every depth. A `.git` walked to the
//! bottom is most of what is in a home full of checkouts, and none of it is a
//! thing anybody opens by name — but a desk that wants its dotfiles offered
//! can say so, and one with a `~/Library` too big to be worth reading can say
//! that.
//!
//! # A link is a name, not a place the walk goes
//!
//! Only what a listing says is a directory is walked into, and a listing says
//! a link is a link. A `result` left by `nix build` points into the store, and
//! a checkout's `node_modules` can be a farm of links into its own store:
//! followed, each is a walk of somebody else's tree, or of one that leads back
//! into itself. The link is still offered, by its name.

use std::collections::VecDeque;
use std::fs::ReadDir;
use std::io;
use std::path::{Path, PathBuf};

/// A source of directory entries, so the walk can be tested without a disk.
pub trait Directory {
    /// What is in `path`.
    ///
    /// An `Err` is "this is not a directory I can read", which the walk treats
    /// as a leaf. Only the home directory's own failure is reported — see
    /// [`walk`].
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>>;
}

/// One entry of a directory, and whether the walk goes into it.
#[derive(Debug, Clone)]
pub struct Entry {
    pub path: PathBuf,
    /// Whether the listing says this is a directory — not a link to one.
    ///
    /// From the listing rather than asked of the path, because asking is a
    /// system call per file, and a home is mostly files.
    pub directory: bool,
}

/// The filesystem this process is running on.
pub struct RealDirectory;

impl Directory for RealDirectory {
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>> {
        listed(std::fs::read_dir(path)?)
    }
}

/// What an opened directory holds.
///
/// Apart from the opening so that [`crate::home_watch`] can watch a directory
/// between the two: once it is open, so a plain file is never watched, and
/// before it is read, so nothing written into it in between is lost.
pub(crate) fn listed(listing: ReadDir) -> io::Result<Vec<Entry>> {
    listing
        .map(|entry| {
            let entry = entry?;
            Ok(Entry {
                // The listing's own type, which does not follow a link.
                directory: entry.file_type()?.is_dir(),
                path: entry.path(),
            })
        })
        .collect()
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
///
/// `omitted` is asked of every path by its name relative to `home`, and one it
/// says yes to is neither offered nor walked.
pub fn walk<'a, D: Directory, O: Fn(&str) -> bool>(
    home: &Path,
    directory: &'a D,
    omitted: &'a O,
) -> io::Result<Walk<'a, D, O>> {
    started_at(home, home, directory, omitted)
}

/// Everything under `path` in `home`, named and omitted as [`walk`] would.
///
/// For a directory that turns up after the walk: its contents are rows the
/// boot walk would have found, so they are named from the home and left out by
/// the same rule rather than by one relative to where they arrived. `Err` is
/// `path` not being a directory that reads. `path` is read whatever it is, so
/// whether it is a directory rather than a link to one is the caller's to know.
pub fn walk_within<'a, D: Directory, O: Fn(&str) -> bool>(
    home: &Path,
    path: &str,
    directory: &'a D,
    omitted: &'a O,
) -> io::Result<Walk<'a, D, O>> {
    started_at(home, &home.join(path), directory, omitted)
}

/// A walk of everything under `root`, named relative to `home`.
fn started_at<'a, D: Directory, O: Fn(&str) -> bool>(
    home: &Path,
    root: &Path,
    directory: &'a D,
    omitted: &'a O,
) -> io::Result<Walk<'a, D, O>> {
    Ok(Walk {
        pending: offerable(directory.read(root)?, home, omitted),
        home: home.to_path_buf(),
        directory,
        omitted,
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
pub struct Walk<'a, D: Directory, O: Fn(&str) -> bool> {
    home: PathBuf,
    pending: VecDeque<Entry>,
    directory: &'a D,
    omitted: &'a O,
}

impl<D: Directory, O: Fn(&str) -> bool> Iterator for Walk<'_, D, O> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            let entry = self.pending.pop_front()?;
            // A directory that will not open is a leaf: the path is still
            // offered, and the walk carries on with the rest of the home
            // rather than stopping on it.
            if entry.directory {
                if let Ok(children) = self.directory.read(&entry.path) {
                    self.pending
                        .extend(offerable(children, &self.home, self.omitted));
                }
            }
            // A name the kernel stored as bytes no `str` can hold is a path a
            // launcher cannot print, so it cannot be offered — but everything
            // *under* it still can be, which is why the descent above happens
            // first and the loop takes the next path rather than ending here.
            if let Some(name) = named_from(&entry.path, &self.home) {
                return Some(name);
            }
        }
    }
}

/// A directory's entries in the order they are walked, omitted ones dropped.
///
/// Sorted, so that two machines with the same home produce the same index in
/// the same order. `read_dir` hands back whatever order the filesystem keeps
/// its entries in, which is neither stable across filesystems nor across
/// writes to one — and a half-built index whose contents depend on that is one
/// a person sees a different half of on each boot.
///
/// A name that is not text cannot be asked about, and is kept: it is not
/// offered either — see [`named_from`] — but what is under it still can be.
fn offerable(entries: Vec<Entry>, home: &Path, omitted: &impl Fn(&str) -> bool) -> VecDeque<Entry> {
    let mut offerable: Vec<Entry> = entries
        .into_iter()
        .filter(|entry| !named_from(&entry.path, home).is_some_and(|name| omitted(&name)))
        .collect();
    offerable.sort_by(|one, other| one.path.cmp(&other.path));
    offerable.into()
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
