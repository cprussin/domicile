//! Finds the compositor and engine next to the `domicile` binary.
//!
//! ```text
//! <prefix>/bin/domicile
//! <prefix>/bin/domicile-compositor
//! <prefix>/libexec/domicile/engine     the Chromium tree, `chrome` inside it
//! ```
//!
//! `current_exe` resolves symlinks, so a binary run from `~/.nix-profile`
//! finds its siblings in the store.

use std::path::{Path, PathBuf};

/// A component missing next to the binary and not set in the environment.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "no {what} at {}, and {variable} is not set. The components ship beside \
     `domicile`; set {variable} to point at one built somewhere else.",
    .looked.display()
)]
pub struct Missing {
    pub what: &'static str,
    pub looked: PathBuf,
    pub variable: &'static str,
}

/// Paths to the engine and compositor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Components {
    /// The directory holding `chrome`.
    pub engine: PathBuf,
    pub compositor: PathBuf,
}

/// Resolves both components from the running binary's path.
///
/// Paths from the environment are not checked: a build may not have produced
/// them yet, and a failure to run them reports a better error.
pub fn components(
    binary: &Path,
    env: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<Components, Missing> {
    let bin = binary.parent().unwrap_or_else(|| Path::new("."));
    let libexec = bin
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("libexec")
        .join("domicile");
    Ok(Components {
        compositor: one(
            "compositor",
            "DOMICILE_COMPOSITOR",
            bin.join("domicile-compositor"),
            env,
            exists,
        )?,
        engine: one(
            "engine",
            "DOMICILE_ENGINE",
            libexec.join("engine"),
            env,
            exists,
        )?,
    })
}

/// The shell builder: `DOMICILE_BUILDER`, or `libexec/domicile/builder`.
///
/// Separate from [`components`] so a prebuilt shell can run without one.
pub fn builder(
    binary: &Path,
    env: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, Missing> {
    one(
        "shell builder",
        "DOMICILE_BUILDER",
        libexec(binary).join("builder"),
        env,
        exists,
    )
}

/// The directory of Domicile's prebuilt shell `name`, under
/// `DOMICILE_SHELLS` or `libexec/domicile/shells`.
pub fn our_shell(
    binary: &Path,
    name: &str,
    env: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, Missing> {
    let shells = env("DOMICILE_SHELLS")
        .map(PathBuf::from)
        .unwrap_or_else(|| libexec(binary).join("shells"));
    let root = shells.join(name);
    if exists(&root.join("shell.js")) {
        Ok(root)
    } else {
        Err(Missing {
            looked: root,
            variable: "DOMICILE_SHELLS",
            what: "shell of Domicile's by that name",
        })
    }
}

/// The `libexec/domicile` directory next to `binary`'s `bin`.
fn libexec(binary: &Path) -> PathBuf {
    binary
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."))
        .join("libexec")
        .join("domicile")
}

/// The path from `variable`, or `beside` if it exists.
fn one(
    what: &'static str,
    variable: &'static str,
    beside: PathBuf,
    env: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, Missing> {
    match env(variable) {
        Some(named) => Ok(PathBuf::from(named)),
        None if exists(&beside) => Ok(beside),
        None => Err(Missing {
            looked: beside,
            variable,
            what,
        }),
    }
}
