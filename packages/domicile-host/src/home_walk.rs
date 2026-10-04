//! Walks the home directory to fill [`crate::file_index`].
//!
//! - Omitted paths, per `files.omit` (`domicile_config::Omit`), are neither
//!   offered nor descended into. See `docs/LAUNCHER.md`.
//! - Symlinks are offered but not followed, since they may lead into the Nix
//!   store or back into the home.
//! - Tests implement [`Directory`] with a map.

use std::collections::VecDeque;
use std::fs::ReadDir;
use std::io;
use std::path::{Path, PathBuf};

/// A source of directory entries, so the walk can be tested without a disk.
pub trait Directory {
    /// The entries in `path`.
    ///
    /// The walk treats an `Err` as a leaf. Only a failure on the home itself is
    /// reported; see [`walk`].
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>>;
}

/// One directory entry.
#[derive(Debug, Clone)]
pub struct Entry {
    pub path: PathBuf,
    /// Whether the listing reports a directory. False for a link to one.
    ///
    /// Taken from the listing to avoid a `stat` per file.
    pub directory: bool,
}

/// The real filesystem.
pub struct RealDirectory;

impl Directory for RealDirectory {
    fn read(&self, path: &Path) -> io::Result<Vec<Entry>> {
        listed(std::fs::read_dir(path)?)
    }
}

/// The entries of an opened directory.
///
/// Separate from opening so [`crate::home_watch`] can add a watch in between:
/// after opening, so a plain file is never watched, and before reading, so no
/// write is missed.
pub(crate) fn listed(listing: ReadDir) -> io::Result<Vec<Entry>> {
    listing
        .map(|entry| {
            let entry = entry?;
            Ok(Entry {
                // Does not follow links.
                directory: entry.file_type()?.is_dir(),
                path: entry.path(),
            })
        })
        .collect()
}

/// Lazily yields every path under `home`, relative to it, shallowest first.
///
/// Lazy so the launcher can show partial results during the walk. `Err` means
/// the home itself is unreadable; the caller reports it rather than showing an
/// empty index. Paths that `omitted` matches are neither yielded nor walked.
pub fn walk<'a, D: Directory, O: Fn(&str) -> bool>(
    home: &Path,
    directory: &'a D,
    omitted: &'a O,
) -> io::Result<Walk<'a, D, O>> {
    started_at(home, home, directory, omitted)
}

/// Like [`walk`], but only under `path`, for a directory that appears later.
///
/// Paths are still relative to `home` and filtered by the same rule. `Err`
/// means `path` is not a readable directory. `path` is read even if it is a
/// link, so the caller must check that it is a real directory.
pub fn walk_within<'a, D: Directory, O: Fn(&str) -> bool>(
    home: &Path,
    path: &str,
    directory: &'a D,
    omitted: &'a O,
) -> io::Result<Walk<'a, D, O>> {
    started_at(home, &home.join(path), directory, omitted)
}

/// Walks `root`, naming paths relative to `home`.
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

/// An in-progress breadth-first walk.
///
/// Breadth first so a launcher opened mid-walk shows the top of the home
/// first. Uses a queue so the caller can stop after any batch.
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
            // An unreadable directory is still offered, as a leaf.
            if entry.directory {
                if let Ok(children) = self.directory.read(&entry.path) {
                    self.pending
                        .extend(offerable(children, &self.home, self.omitted));
                }
            }
            // A non-UTF-8 name is not offered, but its children are, so the
            // descent above runs first.
            if let Some(name) = named_from(&entry.path, &self.home) {
                return Some(name);
            }
        }
    }
}

/// A directory's entries in walk order, minus omitted ones.
///
/// Sorted because `read_dir` order is unstable, and a partial index should be
/// the same on every boot. Non-UTF-8 names cannot be checked and are kept so
/// their children are walked; [`named_from`] skips the names themselves.
fn offerable(entries: Vec<Entry>, home: &Path, omitted: &impl Fn(&str) -> bool) -> VecDeque<Entry> {
    let mut offerable: Vec<Entry> = entries
        .into_iter()
        .filter(|entry| !named_from(&entry.path, home).is_some_and(|name| omitted(&name)))
        .collect();
    offerable.sort_by(|one, other| one.path.cmp(&other.path));
    offerable.into()
}

/// `path` relative to `home`, or `None` if it is outside `home` or not
/// UTF-8.
fn named_from(path: &Path, home: &Path) -> Option<String> {
    path.strip_prefix(home)
        .ok()?
        .to_str()
        .map(ToString::to_string)
}
