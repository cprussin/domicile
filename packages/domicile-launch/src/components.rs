//! The two programs a desktop is, found beside the one the user ran.
//!
//! `domicile` is one of three things that ship together, the way a
//! multi-binary program like postfix does, and it finds the other two from its
//! own path rather than being handed them:
//!
//! ```text
//! <prefix>/bin/domicile
//! <prefix>/bin/domicile-compositor
//! <prefix>/libexec/domicile/engine     the Chromium tree, `chrome` inside it
//! ```
//!
//! On Linux `current_exe` reads `/proc/self/exe`, which resolves symlinks — so
//! a `~/.nix-profile/bin/domicile` arrives here already pointing into the
//! store, where its siblings are, in the same output. A package installed into
//! `/usr` answers the same way for the same reason.

use std::path::{Path, PathBuf};

/// A component that is neither beside the binary nor named in the environment.
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

/// Where each of the two is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Components {
    /// The directory holding `chrome`.
    pub engine: PathBuf,
    pub compositor: PathBuf,
}

/// Resolve both from the running binary's own path.
///
/// `exists` is asked only about the siblings. A path somebody named in the
/// environment is taken as given: they meant it, and checking would refuse a
/// component a build is about to produce — while the failure to run one says
/// so with the reason attached, which a check here could not.
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

/// The environment's answer, or the sibling, or what to do about neither.
/// The program that builds a shell out of an entry or a package —
/// `libexec/domicile/builder` beside `domicile`, or `DOMICILE_BUILDER`.
///
/// Apart from [`components`] because a desktop on a prebuilt shell never runs
/// it, and a run that refused to start for want of a builder it was never
/// going to use would be refusing over nothing.
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

/// Domicile's own prebuilt shell `name`: `libexec/domicile/shells/<name>`
/// beside `domicile`, or under `DOMICILE_SHELLS`, holding its `shell.js`.
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

/// `libexec/domicile`, beside the `bin` `binary` is in.
fn libexec(binary: &Path) -> PathBuf {
    binary
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."))
        .join("libexec")
        .join("domicile")
}

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
