//! The XDG data directories, where tray icons are installed.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The spec's default for an unset or empty `XDG_DATA_DIRS`.
const DEFAULT_DATA_DIRS: &str = "/usr/local/share:/usr/share";

/// The XDG data directories, highest priority first.
///
/// `data_home` and `data_dirs` are `XDG_DATA_HOME` and `XDG_DATA_DIRS`. Per
/// the spec, empty means unset. Without either `data_home` or `home`, the data
/// home is omitted.
pub fn data_dirs(
    data_home: Option<OsString>,
    data_dirs: Option<OsString>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let data_home = data_home
        .filter(|set| !set.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".local/share")));
    let data_dirs = data_dirs
        .filter(|set| !set.is_empty())
        .unwrap_or_else(|| OsString::from(DEFAULT_DATA_DIRS));
    data_home
        .into_iter()
        .chain(std::env::split_paths(&data_dirs))
        .collect()
}
