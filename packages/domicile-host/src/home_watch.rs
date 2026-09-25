//! A watch on the whole home directory, so the index does not go stale.
//!
//! The index is built once at boot and would be yesterday's by the afternoon
//! without this: a file created in a terminal is not an event any other part
//! of this desktop sees. [`crate::file_changes`] is what reads what comes
//! back, and is where the decisions are; this is the OS glue, which is thin on
//! purpose and is exercised by running rather than by a unit test — the same
//! split `domicile_config::watch` makes, for the same reason.

use std::path::Path;

/// A live watch over a home directory, for as long as it is kept.
///
/// **Dropping it ends the watch**, and nothing says so: `heard` is simply not
/// called again, which reads as a home nobody is writing in.
pub struct HomeWatcher {
    _watcher: notify::RecommendedWatcher,
}

/// Begin watching `home`, and everything under it, for changes.
///
/// Each one is handed to `heard`, on the watcher's own thread. A callback
/// rather than a channel of its own, so the caller can fold what the home
/// reports into whatever else it is waiting on — the index thread also hears
/// the desk's config.
///
/// **Recursive, which is the expensive word.** On Linux that is one inotify
/// watch per directory, and a home of ten thousand directories is ten thousand
/// of them — against `fs.inotify.max_user_watches`, which a distribution sets
/// somewhere between eight thousand and half a million. A watch that cannot be
/// established is an `Err` here and a log line at the caller rather than a
/// desktop that will not start: what is lost is the index staying current, and
/// the boot walk still ran.
///
/// The errors handed to `heard` are the watcher's own — a directory that went away
/// mid-walk, a queue that overflowed — and the second of those matters: an
/// event flagged `Rescan` means the kernel dropped some, which is what
/// [`crate::file_index::FileIndex::rebuilding`] exists for.
pub fn watch_home(
    home: &Path,
    heard: impl Fn(notify::Result<notify::Event>) + Send + 'static,
) -> notify::Result<HomeWatcher> {
    use notify::Watcher;

    let mut watcher = notify::recommended_watcher(heard)?;
    watcher.watch(home, notify::RecursiveMode::Recursive)?;

    Ok(HomeWatcher { _watcher: watcher })
}
