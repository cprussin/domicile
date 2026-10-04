//! Watches a config module's directory for edits.
//!
//! The config may import any file near it, so the whole directory is watched,
//! except `node_modules` and dot directories.

use std::path::{Component, Path};
use std::sync::mpsc;
use std::time::Duration;

use notify::Watcher;

/// An active watch. Dropping it stops watching.
pub struct Watching {
    _watcher: notify::RecommendedWatcher,
}

/// Calls `on_change` after each burst of edits under `directory`, once no
/// edit has happened for `quiet`.
///
/// Debounced because one editor save produces several events.
pub fn watch(
    directory: &Path,
    quiet: Duration,
    on_change: impl Fn() + Send + 'static,
) -> Result<Watching, String> {
    let (told, heard) = mpsc::channel();
    let watched = directory.to_path_buf();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            // Ignore access events, which the watcher itself causes.
            let edited = event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove();
            if edited && event.paths.iter().any(|path| matters(&watched, path)) {
                // The receiving thread runs as long as the watcher, so a
                // failed send can be ignored.
                let _ = told.send(());
            }
        }
    })
    .map_err(|why| format!("cannot watch {}: {why}", directory.display()))?;
    watcher
        .watch(directory, notify::RecursiveMode::Recursive)
        .map_err(|why| format!("cannot watch {}: {why}", directory.display()))?;
    std::thread::spawn(move || {
        while heard.recv().is_ok() {
            while heard.recv_timeout(quiet).is_ok() {}
            on_change();
        }
    });
    Ok(Watching { _watcher: watcher })
}

/// Whether a change at `path` is a user edit: not under `node_modules` or a
/// dot directory.
///
/// Only the part below `directory` is checked, so the config may itself live
/// in a dot directory.
pub fn matters(directory: &Path, path: &Path) -> bool {
    let under = path.strip_prefix(directory).unwrap_or(path);
    !under.components().any(|component| match component {
        Component::Normal(name) => {
            name == "node_modules" || name.to_string_lossy().starts_with('.')
        }
        _ => false,
    })
}
