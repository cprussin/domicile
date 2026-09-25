//! What a filesystem event does to the index.
//!
//! An index built once at boot is yesterday's by the afternoon, so the home is
//! watched and this is the reading of what comes back. The watch itself is
//! four lines of OS glue in [`crate::home_watch`]; the decision is here, where
//! it can be tested against an event rather than against a disk.
//!
//! # Most of what a home reports is not a change to what there is to open
//!
//! That is the whole shape of this module. An editor saving a file is a burst
//! of `Modify(Data)` events about a path that was already offered; a build is
//! thousands of them under a `.git` nobody opens by name. The index is a set
//! of *paths*, so only the events that add or remove one mean anything, and
//! everything else has to be dropped here rather than turned into a broadcast
//! of the whole home at somebody who is typing.

use std::path::Path;

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::Event;

/// What one event asks of the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// A path that is there now, named relative to the home directory.
    Appeared(String),
    /// A path that is not, and with it everything that was under it.
    Vanished(String),
}

/// What `event` does to an index of `home`, which is usually nothing.
///
/// `omitted` is the walk's question — see [`crate::home_walk`] — and a path
/// it says yes to, or that is under one it says yes to, is not offered.
///
/// A list rather than one, because a rename the kernel paired up is both a
/// departure and an arrival — and in that order, which is the contract: a file
/// renamed over itself would otherwise have the arrival removed by the
/// departure that followed it.
pub fn changes(event: &Event, home: &Path, omitted: &impl Fn(&str) -> bool) -> Vec<Change> {
    match event.kind {
        EventKind::Create(_) => offerable(&event.paths, home, omitted)
            .map(Change::Appeared)
            .collect(),
        EventKind::Remove(_) => offerable(&event.paths, home, omitted)
            .map(Change::Vanished)
            .collect(),
        // A rename the kernel paired up, which `notify` reports as the two
        // paths of one event: what was there, then what is there now.
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            let mut named = offerable(&event.paths, home, omitted);
            named
                .next()
                .map(Change::Vanished)
                .into_iter()
                .chain(named.next().map(Change::Appeared))
                .collect()
        }
        // And the halves of one it could not: a `mv` out of the home has no
        // arrival to pair with, because the other end is not watched.
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            offerable(&event.paths, home, omitted)
                .map(Change::Vanished)
                .collect()
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            offerable(&event.paths, home, omitted)
                .map(Change::Appeared)
                .collect()
        }
        // `Any` is a name that changed without saying which way, which neither
        // half can be worked out from: reading it as an arrival would offer a
        // path that may have just gone, and as a departure would drop one that
        // may have just arrived. Everything else — a write into a file, a read
        // of one, an attribute — is about a path the index already has an
        // answer for.
        _ => Vec::new(),
    }
}

/// The paths of an event, as rows a launcher could draw.
///
/// Three things are dropped, and the first is the only one that should ever
/// arrive: the home directory itself, which names every row and so names
/// itself as the empty string. A path outside the home has no name relative to
/// it, and an omitted one is held out for the reason the walk holds it out — a
/// `git commit` is hundreds of events under a `.git`, and an index that took
/// them would grow a copy of every checkout's object store that the next boot
/// walk would then throw away.
///
/// **EVERY ANCESTOR IS ASKED, NOT ONLY THE PATH.** The walk never reaches what
/// is under an omitted directory, so it only ever asks of the directory; the
/// watch is on the whole tree and reports `src/target/debug/build.log` with
/// nothing to say it is under `src/target`.
fn offerable<'a, O: Fn(&str) -> bool>(
    paths: &'a [std::path::PathBuf],
    home: &'a Path,
    omitted: &'a O,
) -> impl Iterator<Item = String> + 'a {
    paths.iter().filter_map(move |path| {
        let named = path.strip_prefix(home).ok()?.to_str()?;
        let offerable = !named.is_empty() && !ancestry(named).any(omitted);
        offerable.then(|| named.to_string())
    })
}

/// `path` and every directory above it, shallowest first: `a`, `a/b`, `a/b/c`.
fn ancestry(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/')
        .map(|(at, _)| &path[..at])
        .chain(std::iter::once(path))
}
