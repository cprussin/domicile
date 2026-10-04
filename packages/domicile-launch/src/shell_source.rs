//! Classifies a shell argument: a module, an entry to build, one of
//! Domicile's shells, or a package to install.
//!
//! ```text
//! domicile load-shell /path/to/bundle.js      a module, served as it is
//! domicile load-shell ./entry.ts              an entry, built
//! domicile load-shell @domicile-desktop/manganese     Domicile's own, prebuilt
//! domicile load-shell github:me/my-shell      a package, installed and built
//! ```
//!
//! Only an entry or a package needs the builder. Prebuilt shells start
//! without bun or network access.

use std::path::{Path, PathBuf};

use crate::shell_path::{shell_module, Shell, ShellPathError};

/// Where a shell comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellSource {
    /// A built module, served as it is.
    Module(Shell),
    /// A TypeScript or JavaScript entry the builder bundles. Absolute.
    Entry(PathBuf),
    /// One of Domicile's own shells, by name: `manganese` for
    /// `@domicile-desktop/manganese`. Prebuilt in Domicile's install.
    Ours(String),
    /// An npm package or a `github:` repository the builder installs.
    Package(String),
}

/// The scope Domicile's own shells are named under.
const OURS: &str = "@domicile-desktop/";

/// Classifies `argument`.
///
/// Paths follow [`shell_module`]'s rules. `read` returns a file's text, used
/// to tell a bundle from a JavaScript entry.
pub fn shell_source(
    argument: &str,
    handed_in: Option<&str>,
    here: &Path,
    home: Option<&Path>,
    exists: &dyn Fn(&Path) -> Option<bool>,
    read: &dyn Fn(&Path) -> Option<String>,
) -> Result<ShellSource, ShellPathError> {
    if handed_in.is_none() {
        if let Some(name) = argument.strip_prefix(OURS) {
            // `@domicile-desktop/shell-simple` is the workspace name of the
            // `simple` shell.
            return Ok(ShellSource::Ours(
                name.strip_prefix("shell-").unwrap_or(name).to_string(),
            ));
        }
        if is_package(argument, here, exists) {
            return Ok(ShellSource::Package(argument.to_string()));
        }
    }
    let shell = shell_module(argument, handed_in, here, home, exists)?;
    let file = shell.root.join(&shell.module);
    Ok(if needs_building(&file, read) {
        ShellSource::Entry(file)
    } else {
        ShellSource::Module(shell)
    })
}

/// Whether `argument` names a package: a `github:` or `npm:` prefix, a scope,
/// or a bare word that does not exist under `here`.
fn is_package(argument: &str, here: &Path, exists: &dyn Fn(&Path) -> Option<bool>) -> bool {
    argument.starts_with("github:")
        || argument.starts_with("npm:")
        || argument.starts_with('@')
        || (!argument.contains('/')
            && !argument.starts_with('.')
            && !argument.starts_with('~')
            && exists(&here.join(argument)).is_none())
}

/// Whether the file at `file` has to be built before it is served.
///
/// TypeScript and JSX always do. JavaScript does when it imports a package
/// by name, which a browser cannot resolve.
fn needs_building(file: &Path, read: &dyn Fn(&Path) -> Option<String>) -> bool {
    match file.extension().and_then(|extension| extension.to_str()) {
        Some("ts" | "tsx" | "mts" | "jsx") => true,
        Some("js" | "mjs") => read(file).is_some_and(|text| imports_a_package(&text)),
        _ => false,
    }
}

/// Whether `text` imports a package by name.
///
/// A loose scan that also matches comments. A false positive only rebuilds a
/// bundle; a false negative would serve a module the browser cannot load.
pub fn imports_a_package(text: &str) -> bool {
    ["from", "import", "import("].iter().any(|keyword| {
        text.match_indices(keyword).any(|(at, _)| {
            let after = text[at + keyword.len()..].trim_start();
            let Some(quote) = after.chars().next().filter(|c| matches!(c, '"' | '\'')) else {
                return false;
            };
            let specifier = &after[1..];
            let Some(end) = specifier.find(quote) else {
                return false;
            };
            is_bare(&specifier[..end])
        })
    })
}

/// Whether a browser cannot resolve `specifier`: it is not relative,
/// absolute or a URL.
fn is_bare(specifier: &str) -> bool {
    !specifier.is_empty()
        && !specifier.starts_with('.')
        && !specifier.starts_with('/')
        && !specifier.contains("://")
        && !specifier.starts_with("data:")
}
