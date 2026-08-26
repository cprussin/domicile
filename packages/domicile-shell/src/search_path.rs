//! Where a named shell is looked up.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

/// The XDG base directories a shell search path is built from.
///
/// Held as the raw variables rather than as resolved paths so the defaults the
/// spec gives each one are applied in one place, and so a test can drive this
/// without touching the process environment.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct XdgDirs {
    pub data_home: Option<OsString>,
    pub data_dirs: Option<OsString>,
    pub home: Option<OsString>,
}

impl XdgDirs {
    /// The variables as this process has them.
    /// `var_os` rather than `var`: a path is bytes on Linux, and `var` folds
    /// "not valid UTF-8" into the same `None` as "not set" — so a data home
    /// with an odd byte in it silently became the default, and the shell
    /// installed under the real one was then reported missing from a directory
    /// the user had never used.
    pub fn from_env() -> XdgDirs {
        XdgDirs {
            data_home: std::env::var_os("XDG_DATA_HOME"),
            data_dirs: std::env::var_os("XDG_DATA_DIRS"),
            home: std::env::var_os("HOME"),
        }
    }

    /// Where a named shell is looked up, nearest first.
    ///
    /// The user's own data directory, then the system ones, each with
    /// [`SHELLS_SUBDIRECTORY`] under it. Nearest first is what lets someone try
    /// a modified build of an installed shell without replacing it.
    pub fn shell_search_path(&self) -> Vec<PathBuf> {
        let user = self
            .user_data_home()
            .map(|home| home.join(SHELLS_SUBDIRECTORY));
        // Split on the bytes, because the separator is one ASCII byte and the
        // entries either side of it need not be UTF-8. `OsStrExt` rather than
        // `as_encoded_bytes` + an `unsafe` rebuild: on Unix an `OsStr` *is*
        // bytes, so the safe API says exactly this, and the crate is Unix-only
        // already — `runtime.rs` splits an `OsStr` the same way.
        let dirs = self
            .data_dirs
            .as_deref()
            .unwrap_or_else(|| OsStr::new(DEFAULT_DATA_DIRS));
        let system = dirs
            .as_bytes()
            .split(|byte| *byte == b':')
            .map(|entry| Path::new(OsStr::from_bytes(entry)))
            // Absolute only. An empty entry is ordinary in a `:`-joined
            // variable, and a relative one is merely unusual — but both would
            // be resolved against whatever directory the compositor happens to
            // have been started from rather than against anything a user
            // installed into, and the XDG specification says to ignore them for
            // that reason. `is_absolute` covers the empty case too, so this is
            // one rule rather than two.
            .filter(|entry| entry.is_absolute())
            .map(|entry| entry.join(SHELLS_SUBDIRECTORY))
            .collect::<Vec<_>>();
        user.into_iter().chain(system).collect()
    }

    /// The user's own data directory, if this process has one.
    ///
    /// `None` rather than a relative fallback when neither variable is set: a
    /// daemon with no `HOME` is a real configuration, and a search path with a
    /// relative entry is worse than one with a missing entry.
    fn user_data_home(&self) -> Option<PathBuf> {
        let named = match (&self.data_home, &self.home) {
            (Some(data_home), _) => Some(PathBuf::from(data_home)),
            (None, Some(home)) => Some(Path::new(home).join(DEFAULT_DATA_HOME_SUFFIX)),
            (None, None) => None,
        };
        // Same rule as the system entries, and it matters more here: this one
        // is searched *first*, so a relative `XDG_DATA_HOME` would shadow every
        // system install with a directory under the compositor's cwd.
        named.filter(|path| path.is_absolute())
    }
}

/// What every entry on the search path ends in.
const SHELLS_SUBDIRECTORY: &str = "domicile/shells";

/// `XDG_DATA_DIRS`' default, from the XDG base directory specification.
const DEFAULT_DATA_DIRS: &str = "/usr/local/share:/usr/share";

/// What `XDG_DATA_HOME` defaults to under `HOME`, from the same spec.
const DEFAULT_DATA_HOME_SUFFIX: &str = ".local/share";

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(data_home: Option<&str>, data_dirs: Option<&str>, home: Option<&str>) -> XdgDirs {
        XdgDirs {
            data_home: data_home.map(OsString::from),
            data_dirs: data_dirs.map(OsString::from),
            home: home.map(OsString::from),
        }
    }

    fn paths(dirs: &XdgDirs) -> Vec<String> {
        dirs.shell_search_path()
            .iter()
            .map(|p| p.display().to_string())
            .collect()
    }

    #[test]
    fn the_users_own_shells_come_first() {
        // Nearest first, so a shell a user installed for themselves shadows a
        // system one of the same name. That is the direction every other XDG
        // lookup goes, and the one that lets someone try a modified build
        // without touching what is installed for everyone.
        assert_eq!(
            paths(&dirs(
                Some("/home/me/.local/share"),
                Some("/usr/share"),
                None
            )),
            [
                "/home/me/.local/share/domicile/shells",
                "/usr/share/domicile/shells"
            ]
        );
    }

    #[test]
    fn data_home_defaults_under_home() {
        assert_eq!(
            paths(&dirs(None, Some("/usr/share"), Some("/home/me")))[0],
            "/home/me/.local/share/domicile/shells"
        );
    }

    #[test]
    fn data_dirs_defaults_to_the_spec() {
        // The spec's own default, not an invention: without it a system-wide
        // install is unreachable on any machine that does not set the variable,
        // which is most of them.
        assert_eq!(
            paths(&dirs(Some("/x"), None, None)),
            [
                "/x/domicile/shells",
                "/usr/local/share/domicile/shells",
                "/usr/share/domicile/shells"
            ]
        );
    }

    #[test]
    fn every_data_dir_is_searched() {
        assert_eq!(
            paths(&dirs(Some("/x"), Some("/a:/b:/c"), None)),
            [
                "/x/domicile/shells",
                "/a/domicile/shells",
                "/b/domicile/shells",
                "/c/domicile/shells"
            ]
        );
    }

    #[test]
    fn empty_entries_are_dropped() {
        // `XDG_DATA_DIRS=/a::/b` and a trailing colon are both ordinary, and an
        // empty entry would otherwise become a relative `domicile/shells` —
        // resolved against the compositor's working directory, which is not a
        // place shells are installed and is attacker-controllable if it is ever
        // started from one.
        assert_eq!(
            paths(&dirs(Some("/x"), Some("/a::/b:"), None)),
            [
                "/x/domicile/shells",
                "/a/domicile/shells",
                "/b/domicile/shells"
            ]
        );
    }

    #[test]
    fn relative_entries_are_ignored() {
        // The same rule the empty entry gets, and for the same reason: a
        // relative entry is resolved against whatever directory the compositor
        // was started from, which is not a place shells are installed. The XDG
        // specification says to ignore them.
        assert_eq!(
            paths(&dirs(Some("/x"), Some("relative:/b:./also"), None)),
            ["/x/domicile/shells", "/b/domicile/shells"]
        );
    }

    #[test]
    fn a_relative_data_home_is_ignored_rather_than_shadowing_the_system() {
        // This one is searched first, so a relative value would put a directory
        // under the compositor's working directory ahead of every real install.
        assert_eq!(
            paths(&dirs(Some("relative"), Some("/usr/share"), None)),
            ["/usr/share/domicile/shells"]
        );
    }

    #[test]
    fn with_no_home_and_no_data_home_only_the_system_dirs_are_searched() {
        // Rather than inventing a relative path for the user's half. A daemon
        // with no HOME is a real configuration, and a search path with a
        // relative entry in it is worse than one with a missing entry.
        assert_eq!(
            paths(&dirs(None, Some("/usr/share"), None)),
            ["/usr/share/domicile/shells"]
        );
    }
}
