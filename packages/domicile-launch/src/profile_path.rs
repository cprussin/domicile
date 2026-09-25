//! Where the engine keeps its profile between desktops.
//!
//! `$XDG_STATE_HOME/domicile/profile`, and `~/.local/state/domicile/profile`
//! when nothing names a state home. **State, by the spec's own definition**:
//! what a program would be sorry to lose but is not configuration — cookies,
//! logins, site storage. Not the run's own directory, which is thrown away
//! with the run and took every sign-in with it.
//!
//! **The environment is read through an argument rather than from `std::env`**
//! for the reason [`crate::config_path`] states: a path that is guessed should
//! be guessed somewhere that can be asked why.

use std::path::PathBuf;

/// The directory under the state home that is ours.
const DIRECTORY: &str = "domicile";

/// The profile itself, which Chromium is handed as `--user-data-dir`.
const PROFILE: &str = "profile";

/// Where this user's engine profile is, or `None` when the environment names
/// nowhere.
///
/// `None` is a desktop with no `HOME` and no `XDG_STATE_HOME`, and inventing a
/// path for it would be keeping a person's logins somewhere nobody named.
pub fn profile_directory(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    state_home(env).map(|home| home.join(DIRECTORY).join(PROFILE))
}

/// Where this user's state is kept.
///
/// `XDG_STATE_HOME` when it is set to an absolute path, and `~/.local/state`
/// otherwise — the spec's rule, for the reason `config_path` gives about the
/// config home: a relative value resolves against wherever the desktop's
/// launcher was standing.
fn state_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let absolute = |value: String| {
        let path = PathBuf::from(value);
        path.is_absolute().then_some(path)
    };
    env("XDG_STATE_HOME").and_then(absolute).or_else(|| {
        env("HOME")
            .and_then(absolute)
            .map(|home| home.join(".local").join("state"))
    })
}
