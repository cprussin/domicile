//! Domicile's own apps: unpacked Chrome extensions installed beside
//! `domicile`, such as History. The compositor adds each to the config's
//! `extensions.unpacked`. See `docs/HISTORY.md`.

use std::path::{Path, PathBuf};

/// Each app in `apps`, one directory per app, sorted.
pub fn apps_in(apps: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut found = std::fs::read_dir(apps)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    found.sort();
    Ok(found)
}

/// The History app's page. The id is fixed by the `key` in
/// `packages/app-history`'s manifest.
pub const HISTORY: &str = "chrome-extension://dimbckmbklbplcobppahmnepgiponamj/history.html";
