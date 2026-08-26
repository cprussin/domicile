//! Finding the shell a config names, and saying what would start it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use domicile_config::ShellRef;

use crate::manifest::ShellManifest;
use crate::ShellError;
use crate::NOT_FOUND;

/// A shell package that was found and read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedShell {
    /// The package directory, which every relative path in the manifest is
    /// against.
    pub directory: PathBuf,
    pub manifest: ShellManifest,
}

/// What the compositor is offering a shell to connect to.
///
/// The compositor knows all of this only once it is up — the sockets are bound
/// and the chrome's display is named by the compositor rather than chosen — so
/// it arrives here rather than being read from the environment a second time.
///
/// `PartialEq` but not `Eq`: `settings` is arbitrary TOML, which may hold a
/// float.
#[derive(Debug, Clone, PartialEq)]
pub struct ChromeSession {
    /// The Unix socket the host protocol is served on.
    pub socket: PathBuf,
    /// The Wayland display the chrome's own surface goes on, which is not the
    /// one apps connect to. Only reaches the shell when `composited`.
    pub wayland_display: String,
    /// Whether Domicile draws the clients itself.
    ///
    /// Two things follow from it, and they are worth naming separately because
    /// only the caller keeps them together. The shell's window must be
    /// *transparent* where an app shows through, since the element is a hole
    /// rather than a picture — that is the shell's own business, and it learns
    /// it from `DOMICILE_COMPOSITED`. And the shell's window belongs on
    /// Domicile's own display rather than the session's, which is what
    /// `wayland_display` and the ozone flag are for.
    ///
    /// They coincide because `main.rs` sets both from `presenting()`: a
    /// compositor drawing clients into its own window is exactly one that has a
    /// window for the chrome to go in. Should those ever come apart, this field
    /// is two fields.
    pub composited: bool,
    /// The protocol version this compositor speaks.
    pub protocol_version: u32,
    /// The shell's own `[shell.settings]` table, as the config carried it.
    ///
    /// Domicile does not interpret it; the schema belongs to the shell. Held as
    /// TOML rather than as a string because turning it into something a page
    /// can read is this crate's decision, not the compositor's — and as a
    /// `Table` rather than a `Value` so "the shell is handed an object" is true
    /// by construction instead of by assertion.
    pub settings: toml::Table,
}

/// A process that would run a shell.
///
/// A value rather than a `Command` so it can be compared in a test; the
/// compositor is what turns it into one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellLaunch {
    pub program: OsString,
    pub args: Vec<OsString>,
    /// Added to the inherited environment, not a replacement for it: a shell is
    /// an ordinary desktop program and still needs the session's own variables.
    pub env: Vec<(String, String)>,
    /// What the process's working directory should be.
    pub directory: PathBuf,
}

/// Find the shell package a reference names.
///
/// A path is taken as given; a name is looked for under each search-path entry
/// in turn, nearest first. Either way the directory that comes back is resolved
/// against `base`, and so is absolute whenever `base` is — which the caller
/// must make true, because the whole reason for resolving here is that a
/// relative result is used twice and applying one use invalidates the other.
/// `base` is the compositor's own working directory; a relative one is a
/// programmer error rather than a configuration, so it is asserted rather than
/// reported.
///
/// Absolute is not tidiness. A relative reference — `package =
/// "./packages/shell-simple"`, the documented way to run a shell out of a
/// checkout — is used twice: once to build the path to the entry point, and
/// once as the child's own working directory. Applying the second invalidates
/// the first, so the shell was launched with an argument that no longer named
/// anything. Resolving once here leaves no order in which a caller can combine
/// them and be wrong.
pub fn resolve(
    reference: &ShellRef,
    search_path: &[PathBuf],
    base: &Path,
) -> Result<ResolvedShell, ShellError> {
    debug_assert!(
        base.is_absolute(),
        "resolve's base must be absolute, got {}",
        base.display()
    );
    match reference {
        ShellRef::Path(reference) => {
            let directory = &absolute(base, reference);
            let manifest = ShellManifest::load(directory).map_err(|err| match err {
                // A path names one place, so "there is nothing there" is the
                // whole diagnosis — and reporting it as an unreadable file
                // invites a hunt for permissions on a path that does not exist.
                ShellError::Unreadable { kind, .. } if kind == NOT_FOUND => ShellError::NotFound {
                    reference: directory.display().to_string(),
                    searched: vec![directory.clone()],
                },
                other => other,
            })?;
            Ok(ResolvedShell {
                directory: directory.clone(),
                manifest,
            })
        }
        ShellRef::Name(name) => find_by_name(name, search_path, base),
    }
}

/// What runs a shell, as the machine rather than the shell has it.
///
/// Neither field is the shell's to choose, which is why neither is in the
/// manifest: a shell that could name its own interpreter or its own flags could
/// name `/bin/sh`, or turn its own sandbox off.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellRuntime {
    /// The Electron binary. Not always on `PATH`: under `nix develop` it lives
    /// in the store, and the caller is what knows where.
    pub program: PathBuf,
    /// Arguments this machine needs Electron started with, after the entry
    /// point. `--no-sandbox` is the one every script in this repo passes, for
    /// want of the setuid helper a store build does not carry.
    pub extra_args: Vec<OsString>,
}

/// What would start this shell against this compositor.
pub fn launch_command(
    shell: &ResolvedShell,
    session: &ChromeSession,
    runtime: &ShellRuntime,
) -> Result<ShellLaunch, ShellError> {
    if shell.manifest.protocol != session.protocol_version {
        Err(ShellError::ProtocolMismatch {
            name: shell.manifest.name.clone(),
            shell: shell.manifest.protocol,
            host: session.protocol_version,
        })
    } else {
        Ok(ShellLaunch {
            program: runtime.program.clone().into_os_string(),
            args: display_flags(session)
                .into_iter()
                .chain([
                    // Through `absolute` rather than a bare `join`, so the two
                    // halves of this path agree about what a `.` is worth. The
                    // directory has already had its `.` components dropped;
                    // `entry` may legitimately carry one — `./main.js` is a
                    // documented, tested shape — and joining without the same
                    // filter puts it straight back, in the argument Electron is
                    // given and in every message that names it.
                    absolute(&shell.directory, &shell.manifest.entry).into_os_string(),
                ])
                // After the entry point, so nothing the machine adds can
                // displace it: Electron runs the first non-flag argument it is
                // given.
                .chain(runtime.extra_args.iter().cloned())
                .collect(),
            env: session_environment(session),
            directory: shell.directory.clone(),
        })
    }
}

/// Look for a package of this name under each search-path entry in turn.
///
/// A directory that is not a shell is skipped rather than fatal: an unrelated
/// directory sharing the name on an earlier entry must not hide the real shell
/// behind it. Anything that *is* a manifest and is wrong stops the search, so a
/// broken install is reported rather than silently passed over.
fn find_by_name(
    name: &str,
    search_path: &[PathBuf],
    base: &Path,
) -> Result<ResolvedShell, ShellError> {
    for entry in search_path {
        let directory = absolute(base, &entry.join(name));
        match ShellManifest::load(&directory) {
            // Only a manifest that is *absent*. A manifest that is there and
            // cannot be read — the usual cause being permissions — is a broken
            // install of the shell that was asked for, and skipping it falls
            // through to a different build under a later entry, or reports
            // "not found" naming the very directory the shell is sitting in.
            Err(ShellError::Unreadable { kind, .. }) if kind == NOT_FOUND => continue,
            Err(other) => return Err(other),
            Ok(manifest) if manifest.name != name => {
                return Err(ShellError::Invalid {
                    path: directory.join(crate::MANIFEST_NAME).display().to_string(),
                    message: format!(
                        "installed as {name:?} but calls itself {:?}; a named lookup finds it \
                         by its directory, so the two have to agree",
                        manifest.name
                    ),
                })
            }
            Ok(manifest) => {
                return Ok(ResolvedShell {
                    directory,
                    manifest,
                })
            }
        }
    }
    Err(ShellError::NotFound {
        reference: name.to_string(),
        searched: search_path
            .iter()
            .map(|entry| absolute(base, entry))
            .collect(),
    })
}

/// Which display the shell's own window goes on, if Domicile is placing it.
///
/// Only when Domicile is compositing. Then the chrome is a Wayland client of
/// Domicile like any other, drawn over the apps on the display Domicile made
/// for it — and Electron would default to X11 where both are available, putting
/// the chrome on the host session's desktop instead of inside the compositor it
/// is the chrome of.
///
/// Headless, the chrome's own pixels never leave the page: frames arrive over
/// the socket and the canvas draws them. Its window is then an ordinary one on
/// whatever display the session already has, and naming Domicile's own would
/// put it on a display nothing is compositing.
fn display_flags(session: &ChromeSession) -> Vec<OsString> {
    if session.composited {
        vec![OsString::from("--ozone-platform=wayland")]
    } else {
        Vec::new()
    }
}

/// What the shell is told about the compositor it is the chrome of.
///
/// Added to the inherited environment rather than replacing it: a shell is an
/// ordinary desktop program and still needs the session's own variables —
/// `XDG_RUNTIME_DIR`, `PATH`, the locale.
fn session_environment(session: &ChromeSession) -> Vec<(String, String)> {
    let composited = session
        .composited
        // Absent rather than "0" when it is off. Every shell reads this as
        // `=== "1"`, so the two already mean the same thing to a shell that is
        // told — and only an absent variable cannot silently keep a previous
        // run's export true for a shell started by hand.
        .then(|| ("DOMICILE_COMPOSITED".to_string(), "1".to_string()));
    [
        Some((
            "DOMICILE_CHROME_SOCKET".to_string(),
            session.socket.display().to_string(),
        )),
        composited,
        // Only when Domicile is compositing, for the reason `display_flags`
        // gives: headless, this would move the shell's window off the display
        // the session actually has and onto one nothing draws.
        session.composited.then(|| {
            (
                "WAYLAND_DISPLAY".to_string(),
                session.wayland_display.clone(),
            )
        }),
        Some((
            "DOMICILE_SHELL_SETTINGS".to_string(),
            settings_json(&session.settings),
        )),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// The shell's settings table as JSON, for a page to parse.
///
/// JSON rather than the TOML it was written in: the reader is a web page, which
/// has a parser for one of those built in and none for the other.
///
/// Always set, and always an object because the settings are a `toml::Table` —
/// a config that puts a scalar there is refused when the config is parsed
/// rather than carried this far. So an absent variable and an empty table are
/// one case for a shell to read rather than two, and there is no third.
///
/// Converted a value at a time rather than through `toml::Value`'s own
/// `Serialize`, which is not a conversion to JSON but to whatever the format
/// asks for — and for a date it asks for a tagged object:
///
/// ```text
/// {"when":{"$__toml_private_datetime":"1979-05-27T07:32:00Z"}}
/// ```
///
/// That key is `toml`'s internal business. Putting it in front of a shell
/// author makes it part of this contract forever: they would reach through a
/// `$__`-prefixed key named after a crate they never chose to read a date they
/// wrote themselves. A date crosses as its own text instead, which is what
/// every JSON producer does with one.
///
/// Total, so there is no failure to swallow: every TOML value has a JSON
/// counterpart once dates are text.
fn settings_json(settings: &toml::Table) -> String {
    as_object(settings).to_string()
}

/// A TOML table as a JSON object.
fn as_object(table: &toml::Table) -> serde_json::Value {
    table
        .iter()
        .map(|(key, value)| (key.clone(), as_json(value)))
        .collect()
}

/// One TOML value as its JSON counterpart.
fn as_json(value: &toml::Value) -> serde_json::Value {
    match value {
        toml::Value::String(text) => serde_json::Value::String(text.clone()),
        toml::Value::Integer(number) => serde_json::Value::from(*number),
        // JSON has no infinity or NaN, and `serde_json::Number` refuses both.
        // TOML has them, so a config *can* carry one; `null` is what JSON says
        // about a number it cannot hold, and it is what `serde_json` itself
        // produces for one.
        toml::Value::Float(number) => serde_json::Number::from_f64(*number)
            .map_or(serde_json::Value::Null, serde_json::Value::Number),
        toml::Value::Boolean(yes) => serde_json::Value::Bool(*yes),
        toml::Value::Datetime(when) => serde_json::Value::String(when.to_string()),
        toml::Value::Array(values) => values.iter().map(as_json).collect(),
        toml::Value::Table(table) => as_object(table),
    }
}

/// `path` against `base`, with the no-op `.` components dropped.
///
/// Lexical: nothing here touches the filesystem, so a reference naming a
/// directory that does not exist still produces the path to report as missing.
/// The two kinds of no-op component are treated differently on purpose. A `.`
/// is dropped, because it says nothing and otherwise reaches a log line and an
/// error message — `base.join("./my-shell")` is `/home/me/./my-shell`, which
/// works and reads like a bug. A `..` is kept, because it does say something
/// and only the filesystem knows what: across a symlink, resolving it here
/// would name a different directory than the OS will. So a reference that
/// climbs is reported with its `..` intact, which is the path that was actually
/// used.
fn absolute(base: &Path, path: &Path) -> PathBuf {
    base.join(path)
        .components()
        .filter(|component| !matches!(component, std::path::Component::CurDir))
        .collect()
}
