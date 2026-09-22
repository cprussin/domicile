//! Where the file index is kept between runs.
//!
//! **A cache, by the spec's own definition**: non-essential data this desktop
//! can regenerate, which is exactly what an index of a home directory is —
//! deleting it costs one boot walk. So `$XDG_CACHE_HOME/domicile/file-index`,
//! and `~/.cache/domicile/file-index` when nothing names a cache home. Not
//! `$XDG_STATE_HOME`, which is for what a program would be sorry to lose.
//!
//! **The environment is read through an argument rather than from `std::env`**
//! for the reason `domicile_launch::config_path` states about the config file:
//! a path that is guessed should be guessed somewhere that can be asked why.
//! Here it also keeps the answer testable without a home directory to set up.

use std::path::PathBuf;

/// The directory under the cache home that is ours.
const DIRECTORY: &str = "domicile";

/// The file itself.
const FILE: &str = "file-index";

/// Where this user's index is, or `None` when the environment names nowhere.
///
/// `None` is a desktop with no `HOME` and no `XDG_CACHE_HOME`, which is a
/// desktop with no home to index either — so there is nothing to invent a path
/// for, and a cache written to a path nobody named is a file nobody can find
/// to delete.
pub fn index_file(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    cache_home(env).map(|home| home.join(DIRECTORY).join(FILE))
}

/// Where this user's caches are kept.
///
/// `XDG_CACHE_HOME` when it is set to an absolute path, and `~/.cache`
/// otherwise — which is the spec's own rule rather than a kindness. A relative
/// value resolves against whatever directory the desktop happened to be
/// started from, so honoring one would make where a desk keeps its index
/// depend on where its launcher was standing.
fn cache_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let absolute = |value: String| {
        let path = PathBuf::from(value);
        path.is_absolute().then_some(path)
    };
    env("XDG_CACHE_HOME").and_then(absolute).or_else(|| {
        env("HOME")
            .and_then(absolute)
            .map(|home| home.join(".cache"))
    })
}
