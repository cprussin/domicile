//! Maps filesystem events from [`crate::home_watch`] to file index changes.
//! Kept separate from the watch so it can be tested without a disk.
//!
//! The index is a set of paths, so only events that add or remove a path
//! matter. Content writes and events under omitted directories are dropped.

use std::path::Path;

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::Event;

/// One change to the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// A path that now exists, relative to the home directory.
    Appeared(String),
    /// A path that no longer exists, along with everything under it.
    Vanished(String),
}

/// The index changes `event` causes under `home`, usually none.
///
/// Paths that `omitted` matches, or that sit under one it matches, are
/// skipped (see [`crate::home_walk`]).
///
/// A paired rename yields `Vanished` then `Appeared`. Callers must apply them
/// in order, or a file renamed onto itself would end up removed.
pub fn changes(event: &Event, home: &Path, omitted: &impl Fn(&str) -> bool) -> Vec<Change> {
    match event.kind {
        EventKind::Create(_) => offerable(&event.paths, home, omitted)
            .map(Change::Appeared)
            .collect(),
        EventKind::Remove(_) => offerable(&event.paths, home, omitted)
            .map(Change::Vanished)
            .collect(),
        // A paired rename: old path, then new path.
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            let mut named = offerable(&event.paths, home, omitted);
            named
                .next()
                .map(Change::Vanished)
                .into_iter()
                .chain(named.next().map(Change::Appeared))
                .collect()
        }
        // Unpaired halves, such as a `mv` out of the watched home.
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
        // `RenameMode::Any` does not say which side the path is, so it is
        // ignored. Writes, reads and attribute changes do not change paths.
        _ => Vec::new(),
    }
}

/// An event's paths relative to `home`, minus the home itself, paths outside
/// it, and omitted paths.
///
/// Checks every ancestor against `omitted`, not just the path. The walk never
/// descends into an omitted directory, but the watch reports deep paths such
/// as `src/target/debug/build.log` directly.
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

/// `path` and its ancestors, shallowest first: `a`, `a/b`, `a/b/c`.
fn ancestry(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/')
        .map(|(at, _)| &path[..at])
        .chain(std::iter::once(path))
}
