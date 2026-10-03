//! A config module, and the files beside it, watched.
//!
//! A module config is evaluated and built once at startup; an edit to it, or
//! to a file it imports, is the same work again. Those files are the user's,
//! wherever they put them, so the whole directory the config is in is
//! watched — less what an install or a build writes there.

use std::path::{Component, Path};
use std::sync::mpsc;
use std::time::Duration;

use notify::Watcher;

/// The watch, for as long as it is held.
pub struct Watching {
    _watcher: notify::RecommendedWatcher,
}

/// Call `on_change` once for each burst of edits under `directory`, once the
/// files have been still for `quiet`.
///
/// A burst rather than every event, because an editor's save is several — a
/// temporary file, a rename over, a touch — and a build for each would be
/// the same build several times.
pub fn watch(
    directory: &Path,
    quiet: Duration,
    on_change: impl Fn() + Send + 'static,
) -> Result<Watching, String> {
    let (told, heard) = mpsc::channel();
    let watched = directory.to_path_buf();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            // A file written, made, renamed or removed; not one read, which
            // the watch itself does as it walks the directory.
            let edited = event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove();
            if edited && event.paths.iter().any(|path| matters(&watched, path)) {
                // The receiver goes only with the thread below, which runs
                // for as long as this watcher does.
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

/// Whether a change at `path`, under the watched `directory`, is an edit of
/// the user's: not under `node_modules`, which an install writes, nor a dot
/// directory, which a version control or an editor keeps. Only the part
/// under `directory` is read: where the config itself lives is the user's
/// business, a dot directory included.
pub fn matters(directory: &Path, path: &Path) -> bool {
    let under = path.strip_prefix(directory).unwrap_or(path);
    !under.components().any(|component| match component {
        Component::Normal(name) => {
            name == "node_modules" || name.to_string_lossy().starts_with('.')
        }
        _ => false,
    })
}
