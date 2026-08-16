//! Applying a config file edit to the running daemon.
//!
//! [`domicile_config`] does the parsing and keeps the last known-good config
//! live; what a running process needs on top is to know what an edit actually
//! changed, so it can act on it and report it. That decision is here — pure, so
//! it is testable without a filesystem watcher.

use std::path::{Path, PathBuf};

use domicile_config::{Config, ConfigError, ConfigStore};

/// What a config edit did to the live configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reload {
    /// The edit is live and moved the active chrome package to this path.
    ShellChanged(PathBuf),
    /// The edit is live; the active chrome package is unchanged.
    Applied,
    /// The edit was rejected and the previous configuration is still live.
    Rejected(ConfigError),
}

/// Apply one config reload to the live store, reporting what it changed.
///
/// `result` is what a [`domicile_config::ConfigWatcher`] delivers: a freshly
/// parsed config, or the error from trying.
pub fn apply_reload(
    store: &mut ConfigStore,
    shells_dir: &Path,
    result: Result<Config, ConfigError>,
) -> Reload {
    let before = store.current().shell.package.resolve(shells_dir);
    match store.apply_watch(result) {
        Ok(()) => {
            let after = store.current().shell.package.resolve(shells_dir);
            if after == before {
                Reload::Applied
            } else {
                Reload::ShellChanged(after)
            }
        }
        Err(err) => Reload::Rejected(err),
    }
}
