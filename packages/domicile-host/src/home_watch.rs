//! A watch on the whole home directory, so the index does not go stale.
//!
//! The index is built once at boot and would be yesterday's by the afternoon
//! without this: a file created in a terminal is not an event any other part
//! of this desktop sees. [`crate::file_changes`] is what reads what comes
//! back, and is where the decisions are; this is the OS glue, which is thin on
//! purpose and is exercised by running rather than by a unit test — the same
//! split `domicile_config::watch` makes, for the same reason.

use std::path::Path;
use std::sync::mpsc::Receiver;

/// A live watch over a home directory.
///
/// **Keep the whole `HomeWatcher` for as long as you read `rx`.** The OS
/// watcher is the field beside it and owns the sending half, so dropping the
/// struct closes the channel: `recv` then returns `Err` rather than blocking,
/// which reads as a home nobody is writing in rather than as a watcher nobody
/// kept. A `move` closure in edition 2021 captures the *fields* it names, so
/// `thread::spawn(move || … watcher.rx.recv() …)` takes the receiver alone and
/// leaves the watcher to be dropped where it stood — name the whole struct
/// inside the closure to move it in. `domicile_config::ConfigWatcher` says the
/// same thing and has been got wrong twice.
pub struct HomeWatcher {
    _watcher: notify::RecommendedWatcher,
    pub rx: Receiver<notify::Result<notify::Event>>,
}

/// Begin watching `home`, and everything under it, for changes.
///
/// **Recursive, which is the expensive word.** On Linux that is one inotify
/// watch per directory, and a home of ten thousand directories is ten thousand
/// of them — against `fs.inotify.max_user_watches`, which a distribution sets
/// somewhere between eight thousand and half a million. A watch that cannot be
/// established is an `Err` here and a log line at the caller rather than a
/// desktop that will not start: what is lost is the index staying current, and
/// the boot walk still ran.
///
/// The errors on `rx` are the watcher's own — a directory that went away
/// mid-walk, a queue that overflowed — and the second of those matters: an
/// event flagged `Rescan` means the kernel dropped some, which is what
/// [`crate::file_index::FileIndex::rebuilding`] exists for.
pub fn watch_home(home: &Path) -> notify::Result<HomeWatcher> {
    use notify::Watcher;

    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        // The receiver is gone when the desktop is shutting down, which is not
        // a thing to report from a watcher thread.
        let _ = tx.send(event);
    })?;
    watcher.watch(home, notify::RecursiveMode::Recursive)?;

    Ok(HomeWatcher {
        _watcher: watcher,
        rx,
    })
}
