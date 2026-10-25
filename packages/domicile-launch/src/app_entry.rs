//! The module `domicile open --app` is given, as the engine serves it: the
//! directory it is in and its name there. See
//! `docs/architecture/APP-MODULES.md`.

use std::path::{Path, PathBuf};

/// An app module, resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppEntry {
    /// The directory served at the app's address. Canonical, because the
    /// engine names the app's origin after it: one directory is one app.
    pub root: PathBuf,
    /// The module's file name under `root`.
    pub module: PathBuf,
}

/// Resolves `entry` against `cwd`, following links. The desktop does not share
/// this working directory.
pub fn app_entry(entry: &Path, cwd: &Path) -> Result<AppEntry, String> {
    let file = cwd
        .join(entry)
        .canonicalize()
        .map_err(|why| format!("cannot find the app module {}: {why}", entry.display()))?;
    if !file.is_file() {
        return Err(format!(
            "{} is not a file. An app is the JavaScript module whose main export \
             Domicile calls.",
            entry.display()
        ));
    }
    match (file.parent(), file.file_name()) {
        (Some(root), Some(module)) => Ok(AppEntry {
            root: root.to_path_buf(),
            module: PathBuf::from(module),
        }),
        _ => unreachable!("a canonical file has a directory and a name"),
    }
}
