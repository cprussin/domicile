//! The terminal the config names for `Terminal=true` applications, such as
//! htop and vim, and how it reaches every process on the desk.
//!
//! The config's `terminal` is an argv the application's own argv follows:
//! `["kitty", "--"]` runs vim as `kitty -- vim`. Unset, such entries are not
//! offered at all, since there is nothing to run them in: Domicile has no
//! default terminal.
//!
//! The compositor puts it in [`VARIABLE`] for every process it starts, the
//! shell's and applications' alike, so `domicile open` and the shell's
//! launcher read the same value. It holds the argv as JSON, since an argv's
//! words may hold spaces.

use std::ffi::OsString;
use std::sync::RwLock;

/// The environment variable that carries the desk's terminal.
pub const VARIABLE: &str = "DOMICILE_TERMINAL";

/// The terminal the live config names, as the compositor last set it.
static CURRENT: RwLock<Option<Vec<String>>> = RwLock::new(None);

/// The compositor's config now names `terminal`. Processes started from here
/// on are told; running ones keep what they started with.
pub fn set(terminal: Option<Vec<String>>) {
    *CURRENT
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = terminal;
}

/// The terminal the live config names, in the compositor.
pub fn current() -> Option<Vec<String>> {
    CURRENT
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// [`VARIABLE`]'s value for `terminal`, or `None` to remove it, so a desk with
/// none does not pass on its host's.
pub fn variable(terminal: Option<&[String]>) -> Option<OsString> {
    terminal.map(|argv| {
        serde_json::to_string(argv)
            .expect("a list of strings is JSON")
            .into()
    })
}

/// The terminal [`VARIABLE`] names, from its `value`. An empty, unreadable or
/// empty-argv value is none.
pub fn from_variable(value: Option<&str>) -> Option<Vec<String>> {
    value
        .and_then(|text| serde_json::from_str::<Vec<String>>(text).ok())
        .filter(|argv| !argv.is_empty())
}

/// `argv` run in `terminal`.
pub fn wrapped(terminal: &[String], argv: Vec<String>) -> Vec<String> {
    terminal.iter().cloned().chain(argv).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(all: &[&str]) -> Vec<String> {
        all.iter().map(|word| word.to_string()).collect()
    }

    #[test]
    fn a_terminal_round_trips_through_the_variable() {
        let terminal = words(&["foot", "--title", "a b"]);
        let value = variable(Some(&terminal)).unwrap();
        assert_eq!(from_variable(value.to_str()), Some(terminal));
    }

    #[test]
    fn no_terminal_removes_the_variable() {
        assert_eq!(variable(None), None);
    }

    #[test]
    fn an_unreadable_or_empty_variable_is_no_terminal() {
        assert_eq!(from_variable(None), None);
        assert_eq!(from_variable(Some("")), None);
        assert_eq!(from_variable(Some("kitty")), None);
        assert_eq!(from_variable(Some("[]")), None);
    }

    #[test]
    fn the_application_follows_the_terminal() {
        assert_eq!(
            wrapped(&words(&["kitty", "--"]), words(&["vim", "a.txt"])),
            words(&["kitty", "--", "vim", "a.txt"])
        );
    }
}
