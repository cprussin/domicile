//! Which shell this run wants, and what runs it.
//!
//! Both are read off the environment and the command line, and both are
//! decisions rather than plumbing — so they live here, where `cargo test`
//! reaches them, rather than in the compositor, which is outside the
//! workspace's `default-members` and so outside the required check.

use std::ffi::{OsStr, OsString};
use std::path::PathBuf;

use domicile_config::{Config, ShellRef};

use crate::launch::ShellRuntime;
use crate::request::ShellRequest;
use crate::ShellError;

/// Which shell package this run wants.
///
/// `Ok(None)` only for a run that asked for none. Everything else must name a
/// shell somewhere — the command line or the config — and a run that names one
/// in neither is an error rather than a quiet headless boot: the symptom of
/// that boot is a window with no chrome in it, which says nothing about the
/// missing `[shell] package` that caused it.
pub fn shell_for(
    request: &ShellRequest,
    config: &Config,
    origin: &ConfigOrigin,
) -> Result<Option<ShellRef>, ShellError> {
    match request {
        ShellRequest::None => Ok(None),
        ShellRequest::Named(reference) => Ok(Some(reference.clone())),
        ShellRequest::FromConfig => config
            .shell
            .package
            .clone()
            .map(Some)
            .ok_or_else(|| origin.why_nothing_named_a_shell()),
    }
}

/// Where the config in hand came from.
///
/// The compositor keeps running on defaults when a config will not load, which
/// is right for a nested window size and wrong as an explanation: those defaults
/// name no shell, so a file with a typo in it arrives here looking exactly like
/// a file that named none. Carrying the difference is what lets the refusal
/// point at the typo rather than at the key the user has already written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigOrigin {
    /// Read as written — or legitimately absent, which is not an error.
    AsWritten,
    /// The file is there and would not load, so this config is the defaults.
    Unreadable { path: String, message: String },
}

impl ConfigOrigin {
    /// What to say when nothing named a shell.
    fn why_nothing_named_a_shell(&self) -> ShellError {
        match self {
            ConfigOrigin::AsWritten => ShellError::NoShellNamed,
            ConfigOrigin::Unreadable { path, message } => ShellError::ConfigUnreadable {
                path: path.clone(),
                message: message.clone(),
            },
        }
    }
}

/// What this machine runs a shell with.
///
/// Both values belong to the machine rather than to any shell — a manifest that
/// could name its own interpreter could name `/bin/sh`, and one that could name
/// its own flags could turn its own sandbox off — so both are read from the
/// environment here and neither is anything a shell can ask for.
///
/// The environment is passed in rather than read from the process, so this is
/// testable and so a caller cannot accidentally consult a different one than
/// the command it builds will inherit.
pub fn runtime_from(electron: Option<&OsStr>, extra_args: Option<&OsStr>) -> ShellRuntime {
    ShellRuntime {
        program: electron.map_or_else(|| PathBuf::from(DEFAULT_ELECTRON), PathBuf::from),
        extra_args: extra_args.map(split_arguments).unwrap_or_default(),
    }
}

/// Electron as it is ordinarily found. Overridden by `DOMICILE_ELECTRON`,
/// because under `nix develop` it lives in the store and not on `PATH`.
const DEFAULT_ELECTRON: &str = "electron";

/// `DOMICILE_SHELL_ARGS`, split on whitespace.
///
/// Deliberately not a shell parse: there is no quoting, so an argument
/// containing a space cannot be expressed. The one thing this exists to carry
/// is `--no-sandbox`, and inventing half a shell grammar for a variable that
/// holds flags would be a worse trade than the limitation — which is documented
/// rather than left to be discovered.
///
/// Splitting on the encoded bytes rather than going through `to_string_lossy`,
/// so a value that is not UTF-8 reaches the child as it was written instead of
/// being silently mangled into replacement characters.
fn split_arguments(value: &OsStr) -> Vec<OsString> {
    use std::os::unix::ffi::OsStrExt;
    value
        .as_bytes()
        .split(|byte| byte.is_ascii_whitespace())
        .filter(|word| !word.is_empty())
        .map(|word| OsStr::from_bytes(word).to_os_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_naming(package: &str) -> Config {
        Config::parse(&format!("[shell]\npackage = \"{package}\"\n")).unwrap()
    }

    #[test]
    fn asking_for_none_starts_nothing_even_when_the_config_names_one() {
        // The headless case every end-to-end check drives, and the only way to
        // reach it: it has to be asked for.
        assert_eq!(
            shell_for(
                &ShellRequest::None,
                &config_naming("manganese"),
                &ConfigOrigin::AsWritten
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn the_config_decides_when_the_command_line_does_not() {
        assert_eq!(
            shell_for(
                &ShellRequest::FromConfig,
                &config_naming("manganese"),
                &ConfigOrigin::AsWritten
            )
            .unwrap(),
            Some(ShellRef::Name("manganese".into()))
        );
    }

    #[test]
    fn a_named_request_beats_the_config() {
        assert_eq!(
            shell_for(
                &ShellRequest::Named(ShellRef::Name("simple".into())),
                &config_naming("manganese"),
                &ConfigOrigin::AsWritten
            )
            .unwrap(),
            Some(ShellRef::Name("simple".into()))
        );
    }

    #[test]
    fn naming_a_shell_nowhere_is_an_error_rather_than_a_silent_headless_boot() {
        // The case this whole shape exists for. A compositor that came up with
        // no chrome because the config said nothing is a black window, and
        // nothing about it names the key that was missing.
        let err = shell_for(
            &ShellRequest::FromConfig,
            &Config::default(),
            &ConfigOrigin::AsWritten,
        )
        .unwrap_err();
        assert!(matches!(err, ShellError::NoShellNamed), "{err:?}");
    }

    #[test]
    fn a_config_that_would_not_load_is_blamed_instead_of_the_user() {
        // The compositor falls back to defaults when a config will not parse,
        // and those defaults name no shell — so without this, a file with a
        // stray line tells its author to write `package` under `[shell]`, which
        // is very likely already there two lines under the typo.
        let err = shell_for(
            &ShellRequest::FromConfig,
            &Config::default(),
            &ConfigOrigin::Unreadable {
                path: "/home/me/domicile.toml".into(),
                message: "TOML parse error at line 2".into(),
            },
        )
        .unwrap_err();

        let ShellError::ConfigUnreadable { path, message } = err else {
            panic!("expected the config to be blamed, got {err:?}");
        };
        assert_eq!(path, "/home/me/domicile.toml");
        assert!(message.contains("line 2"), "{message}");
    }

    #[test]
    fn electron_defaults_to_the_one_on_the_path() {
        assert_eq!(
            runtime_from(None, None),
            ShellRuntime {
                program: PathBuf::from("electron"),
                extra_args: Vec::new(),
            }
        );
    }

    #[test]
    fn a_named_electron_is_used_instead() {
        assert_eq!(
            runtime_from(Some(OsStr::new("/nix/store/x/electron")), None).program,
            PathBuf::from("/nix/store/x/electron")
        );
    }

    #[test]
    fn arguments_are_split_on_whitespace_and_empties_dropped() {
        // A variable set from a shell script ordinarily arrives with the
        // spacing it was written with, and an empty one must not become an
        // empty argument — Electron would take `""` as the app path.
        assert_eq!(
            runtime_from(None, Some(OsStr::new("  --no-sandbox   --disable-gpu  "))).extra_args,
            [
                OsString::from("--no-sandbox"),
                OsString::from("--disable-gpu")
            ]
        );
        assert_eq!(
            runtime_from(None, Some(OsStr::new("   "))).extra_args,
            Vec::<OsString>::new()
        );
    }

    #[test]
    fn a_value_that_is_not_utf8_reaches_the_child_as_written() {
        // Rather than through `to_string_lossy`, which would replace the byte
        // and hand Electron an argument nobody typed.
        use std::os::unix::ffi::OsStrExt;
        let raw = OsStr::from_bytes(b"--path=\xff");
        assert_eq!(
            runtime_from(None, Some(raw)).extra_args,
            [raw.to_os_string()]
        );
    }
}
