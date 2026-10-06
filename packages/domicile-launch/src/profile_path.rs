//! Locates the engine's persistent profile, and Domicile's state directory it
//! lives in.
//!
//! `$XDG_STATE_HOME/domicile/profile`, falling back to
//! `~/.local/state/domicile/profile`. Cookies and logins are state in the XDG
//! sense: worth keeping, but not configuration.
//!
//! The environment is passed in, as in [`crate::config_path`], so tests can
//! supply it.

use std::path::PathBuf;

/// Our directory under the state home.
const DIRECTORY: &str = "domicile";

/// The profile, passed to Chromium as `--user-data-dir`.
const PROFILE: &str = "profile";

/// Returns the user's engine profile directory.
///
/// `None` when neither `HOME` nor `XDG_STATE_HOME` is set. We don't invent a
/// place to store logins.
pub fn profile_directory(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    state_directory(env).map(|directory| directory.join(PROFILE))
}

/// Returns Domicile's directory under the state home, which may not exist yet.
///
/// `None` when neither `HOME` nor `XDG_STATE_HOME` is set.
pub fn state_directory(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    state_home(env).map(|home| home.join(DIRECTORY))
}

/// Returns the user's state home.
///
/// Per the XDG spec, a relative `XDG_STATE_HOME` is ignored, since it would
/// resolve against the launcher's working directory.
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
