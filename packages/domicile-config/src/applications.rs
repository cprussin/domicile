//! Which of the machine's applications a launcher is offered.
//!
//! Every desktop entry the XDG data directories hold is an application, which
//! on a real machine is every package's idea of what belongs in a menu. So
//! what is offered is the desk's to say, here, as globs over desktop file IDs
//! — the entry's path under `applications/`, a `/` read as `-`.

use serde::Deserialize;

use crate::files::Omit;

/// What a launcher's applications are chosen from.
///
/// Compared, like [`crate::FilesConfig`]: a reload asks what moved.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ApplicationsConfig {
    /// The desktop file IDs left out, by `files.omit`'s rules: a pattern that
    /// starts with `!` takes an ID back, and the last pattern to match one
    /// decides it. So `["*", "!launcher-*"]` is a desk that offers only its
    /// own.
    ///
    /// **SAYING NOTHING OMITS NOTHING**, unlike `files.omit`: an entry is
    /// already something its package meant to be launched.
    pub omit: Omit,
}

impl Default for ApplicationsConfig {
    fn default() -> Self {
        ApplicationsConfig {
            omit: Omit::try_from(Vec::new()).expect("no patterns is no globs to get wrong"),
        }
    }
}
