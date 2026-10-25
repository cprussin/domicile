//! `domicile uninstall-app <url>`: removes the desktop entry and icon
//! `domicile install-app` wrote. See `docs/architecture/WEB-APPS.md`.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::desktop_entry::{file_stem, installed_from};
use crate::install_app::{entry_path, icon_path};
use crate::web_app::IconKind;

/// Why an app was not uninstalled.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UninstallAppError {
    #[error(
        "no app is installed from or opens {url}. For an app installed before \
         uninstall-app, give the address after `domicile open --app` in its \
         desktop entry."
    )]
    NotInstalled { url: String },
    #[error("cannot read {}: {why}", path.display())]
    Read { path: PathBuf, why: String },
    #[error("cannot remove {}: {why}", path.display())]
    Remove { path: PathBuf, why: String },
}

/// The start of every entry `install-app` writes; no other entry is touched.
const STEM_PREFIX: &str = "domicile-app-";

/// Removes the app installed from or opening `url` from under `data_home`
/// (`$XDG_DATA_HOME`), and returns the files removed.
///
/// - The entry and icons named by [`file_stem`] of `url`, so `url` can be the
///   start URL.
/// - Otherwise, each `domicile-app-*` entry whose [`installed_from`] is `url`,
///   and its icons.
///
/// Reads nothing from the network.
pub fn uninstall_app(url: &str, data_home: &Path) -> Result<Vec<PathBuf>, UninstallAppError> {
    let by_start = app_removed(data_home, &file_stem(url))?;
    let removed = match by_start.is_empty() {
        true => installed_from_url(url, data_home)?
            .iter()
            .map(|stem| app_removed(data_home, stem))
            .collect::<Result<Vec<_>, _>>()?
            .concat(),
        false => by_start,
    };
    match removed.is_empty() {
        true => Err(UninstallAppError::NotInstalled {
            url: url.to_string(),
        }),
        false => Ok(removed),
    }
}

/// The stems of the `domicile-app-*` entries installed from `url`.
fn installed_from_url(url: &str, data_home: &Path) -> Result<Vec<String>, UninstallAppError> {
    let directory = data_home.join("applications");
    let unreadable = |path: &Path, why: std::io::Error| UninstallAppError::Read {
        path: path.to_path_buf(),
        why: why.to_string(),
    };
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(why) if why.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(why) => return Err(unreadable(&directory, why)),
    };
    let mut stems = Vec::new();
    for entry in entries {
        let path = entry.map_err(|why| unreadable(&directory, why))?.path();
        let stem = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_suffix(".desktop"))
            .filter(|stem| stem.starts_with(STEM_PREFIX));
        let Some(stem) = stem else { continue };
        let text = std::fs::read_to_string(&path).map_err(|why| unreadable(&path, why))?;
        if installed_from(&text).as_deref() == Some(url) {
            stems.push(stem.to_string());
        }
    }
    stems.sort();
    Ok(stems)
}

/// Removes the entry and icons named `stem`, and returns those that were there.
fn app_removed(data_home: &Path, stem: &str) -> Result<Vec<PathBuf>, UninstallAppError> {
    std::iter::once(entry_path(data_home, stem))
        .chain(IconKind::ALL.map(|kind| icon_path(data_home, stem, kind)))
        .filter_map(|path| removed(path).transpose())
        .collect()
}

/// Removes `path`, or `None` when nothing is there.
fn removed(path: PathBuf) -> Result<Option<PathBuf>, UninstallAppError> {
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(Some(path)),
        Err(why) if why.kind() == ErrorKind::NotFound => Ok(None),
        Err(why) => Err(UninstallAppError::Remove {
            path,
            why: why.to_string(),
        }),
    }
}
