//! The user's folders, as `user-dirs.dirs` names them.

use std::path::{Path, PathBuf};

/// The folder `key` (such as `XDG_PICTURES_DIR`) names in `user_dirs`, the
/// contents of `user-dirs.dirs`, else `~/<fallback>`.
pub fn user_dir(user_dirs: Option<&str>, key: &str, home: &Path, fallback: &str) -> PathBuf {
    let named = user_dirs.and_then(|dirs| {
        dirs.lines().find_map(|line| {
            let value = line.trim().strip_prefix(key)?.strip_prefix('=')?;
            let value = value.trim_matches('"');
            Some(match value.strip_prefix("$HOME") {
                Some(rest) => home.join(rest.trim_start_matches('/')),
                None => PathBuf::from(value),
            })
        })
    });
    named.unwrap_or_else(|| home.join(fallback))
}
