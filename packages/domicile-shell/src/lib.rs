//! Resolving and starting a Domicile shell.
//!
//! A shell is a chrome package: a directory carrying a [`ShellManifest`] and
//! whatever the manifest's `entry` points at. Domicile starts one, and this
//! crate is everything about that which is not the starting itself —
//! [`resolve`] finds the package a [`ShellRef`] names, and [`launch_command`]
//! says what process would run it.
//!
//! Deliberately no `Command::spawn` here. Every decision in starting a shell is
//! a value this crate computes and a test can read; what is left for the
//! compositor is handing that value to the OS, which is the one part a unit
//! test cannot check and the one part with no decision in it.
//!
//! [`ShellRef`]: domicile_config::ShellRef

mod launch;
mod manifest;
mod request;
mod runtime;
mod search_path;

pub use launch::{
    launch_command, resolve, ChromeSession, ResolvedShell, ShellLaunch, ShellRuntime,
};
pub use manifest::{ShellManifest, MANIFEST_NAME};
pub use request::{shell_request, ShellRequest};
pub use runtime::{runtime_from, shell_for, ConfigOrigin};
pub use search_path::XdgDirs;

use std::path::PathBuf;

/// The one `ErrorKind` that means "there is nothing here", as opposed to
/// "there is something here and it would not open".
pub(crate) const NOT_FOUND: std::io::ErrorKind = std::io::ErrorKind::NotFound;

/// Everything that can go wrong between a config naming a shell and a process
/// running it.
///
/// `Clone + PartialEq` for the reason [`domicile_config::ConfigError`] is: it
/// holds rendered messages rather than opaque source errors, so it can be
/// asserted in tests and reported more than once.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ShellError {
    /// Nothing at the path, or nothing by that name on the search path.
    ///
    /// Carries what was searched, because the commonest cause is a shell
    /// installed somewhere that is not on it — and a bare "not found" leaves
    /// the reader to guess where Domicile looked.
    #[error("no shell {reference:?}; looked in: {}", .searched.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "))]
    NotFound {
        reference: String,
        searched: Vec<PathBuf>,
    },

    /// A file that should have been there could not be read.
    ///
    /// Carries the `ErrorKind` because one caller has to tell two cases apart:
    /// searching a path for a named shell skips a directory with *no* manifest,
    /// and must not skip one whose manifest is there and unreadable. Matching
    /// on the rendered message to do that would be a trap for whoever next
    /// reworded it.
    #[error("could not read {path}: {message}")]
    Unreadable {
        path: String,
        kind: std::io::ErrorKind,
        message: String,
    },

    /// Nothing said which shell to run.
    #[error(
        "no shell to start: name one with `--shell <name-or-path>`, or as \
         `package` under `[shell]` in the config — or pass `--no-shell` to \
         serve the chrome socket without starting anything"
    )]
    NoShellNamed,

    /// Nothing said which shell to run *because* the config could not be read.
    ///
    /// Its own variant rather than [`ShellError::NoShellNamed`] because the two
    /// want opposite advice. A config that parsed and named nothing wants the
    /// key written; a config that never parsed may well have the key already,
    /// two lines under the typo — and telling that user to write what they have
    /// written sends them looking in the one place that is not the problem.
    #[error("the config at {path} could not be read ({message}), so nothing names a shell")]
    ConfigUnreadable { path: String, message: String },

    /// The shell's program would not start.
    #[error(
        "could not start {program} for shell {name:?}: {message}; \
         set DOMICILE_ELECTRON if it is not on PATH"
    )]
    CouldNotStart {
        name: String,
        program: String,
        message: String,
    },

    #[error("{path} is not a valid shell manifest: {message}")]
    Malformed { path: String, message: String },

    #[error("{path} declares an unusable shell: {message}")]
    Invalid { path: String, message: String },

    /// The shell and the compositor do not speak the same protocol.
    ///
    /// Checked before the process starts rather than left to the handshake.
    /// Both refuse, but only this one can say which shell and name a file to
    /// look at; a refused handshake is a page that already loaded reporting a
    /// number.
    #[error(
        "shell {name:?} speaks protocol {shell}, this compositor speaks {host}; \
         install a build of {name:?} for this compositor"
    )]
    ProtocolMismatch { name: String, shell: u32, host: u32 },
}
