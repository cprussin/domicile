//! What a launcher is offered, and where the walk that finds it lives.
//!
//! A shell is a page, and a page has no filesystem. `ChromeMessage::ListFiles`
//! is how it asks what there is to open and [`HostMessage::Files`] is the
//! answer, and the walk between the two is here — in the brain rather than in
//! the Smithay backend — so that it is a function over a table of directories
//! and not something you need a compositor to test. [`Directory`] is the seam:
//! the compositor passes [`RealDirectory`], the tests pass a map.
//!
//! # The rule
//!
//! Two passes, taken from the launcher this desktop is modeled on
//! (`pkgs/launcher/scripts/launch.nix` in `cprussin/dotfiles`):
//!
//! ```sh
//! find ~/* -maxdepth 1
//! find ~/{Notes,Scratch} -mindepth 2 -not -path '*/\.*'
//! ```
//!
//! The first is everything at the top of home plus one level into each of it;
//! the second takes the few trees a person keeps documents in the rest of the
//! way down. Between them they answer the two things a launcher is typed at —
//! "the thing I was just in" and "that note from March" — without listing a
//! source checkout's hundred thousand files.
//!
//! The two halves disagree about hidden files, and the disagreement is kept:
//! the first pass filters with a glob, which skips a dotfile *at the top of
//! home* and nothing else, so `Notes/.git` is offered while `Notes/.git/HEAD`
//! is not. Tidying either half to match the other changes what the launcher
//! offers, which is why `tests/files.rs` pins it.
//!
//! [`HostMessage::Files`]: domicile_protocol::HostMessage::Files

use std::io;
use std::path::{Path, PathBuf};

/// The directories walked past the one level the first pass stops at.
///
/// A desktop's policy rather than a user's, for now: it is the shell that
/// decides what its launcher offers, and there is no route from a page to a
/// path here on purpose — `ListFiles` carries nothing, so nothing a document
/// can say picks a directory to read. Moving this to the compositor's config
/// file is the next step, and is a question about `domicile-config`'s schema
/// rather than about the protocol.
pub const DEEP_ROOTS: &[&str] = &["Notes", "Scratch"];

/// A source of directory entries, so the walk can be tested without a disk.
pub trait Directory {
    /// What is in `path`.
    ///
    /// An `Err` is "this is not a directory I can read", which is the ordinary
    /// answer for a plain file and the one thing the walk is allowed to treat
    /// as a leaf. Only the home directory's own failure is reported — see
    /// [`listing`].
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

/// Everything under `home` a launcher should offer, relative to it and sorted.
///
/// Byte order rather than the user's collation: the same home has to produce
/// the same list on every machine, and `LC_COLLATE` is not a thing a desktop
/// should be able to reorder a launcher with.
///
/// `Err` means the home directory itself could not be read, which is a broken
/// desktop rather than a person with no files — the caller reports it instead
/// of answering "you have nothing", which is what that failure would otherwise
/// look like from the page.
pub fn listing(home: &Path, roots: &[&str], directory: &impl Directory) -> io::Result<Vec<String>> {
    let shallow = directory
        .read(home)?
        .into_iter()
        .filter(|entry| !is_hidden(entry))
        .flat_map(|entry| {
            let children = children(&entry, directory);
            std::iter::once(entry).chain(children)
        });

    let deep = roots
        .iter()
        .flat_map(|root| descendants(&home.join(root), directory));

    let mut offered: Vec<String> = shallow
        .chain(deep)
        .filter_map(|path| named_from(&path, home))
        .collect();
    offered.sort();
    Ok(offered)
}

/// What is directly in `path`, and nothing when it is not a directory.
///
/// The second half of `find ~/* -maxdepth 1`: the first half is the entry
/// itself, and a plain file is one that contributes only that.
fn children(path: &Path, directory: &impl Directory) -> Vec<PathBuf> {
    directory.read(path).unwrap_or_default()
}

/// Everything under `root` at a depth of two or more, hidden subtrees left out.
///
/// The depths above two belong to the first pass — `Notes` and `Notes/2026`
/// are already offered by it — so starting here is what keeps the two passes
/// from counting the same path twice.
fn descendants(root: &Path, directory: &impl Directory) -> Vec<PathBuf> {
    children(root, directory)
        .into_iter()
        .filter(|child| !is_hidden(child))
        .flat_map(|child| below(&child, directory))
        .collect()
}

/// Everything strictly under `path`, skipping hidden subtrees.
///
/// Strictly, so that [`descendants`] handing it each depth-one child yields
/// depth two and below — which is what `-mindepth 2` asks for.
fn below(path: &Path, directory: &impl Directory) -> Vec<PathBuf> {
    children(path, directory)
        .into_iter()
        .filter(|child| !is_hidden(child))
        .flat_map(|child| {
            let deeper = below(&child, directory);
            std::iter::once(child).chain(deeper)
        })
        .collect()
}

/// Whether the last component starts with a dot — what the glob and the
/// `-not -path '*/\.*'` between them mean by hidden.
fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.as_encoded_bytes().starts_with(b"."))
}

/// `path` as the launcher shows it: relative to `home`, and dropped when it is
/// not under `home` or cannot be spelled as text.
///
/// Neither case comes off a real walk of a real home — every path here was
/// built by joining onto `home`, and `read_dir` hands back what the kernel
/// stored. A name that is not UTF-8 is the one that can genuinely occur, and a
/// path a launcher cannot print is a path it cannot offer.
fn named_from(path: &Path, home: &Path) -> Option<String> {
    path.strip_prefix(home)
        .ok()?
        .to_str()
        .map(ToString::to_string)
}
