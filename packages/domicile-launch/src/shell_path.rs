//! Which page to serve, out of what the caller said.
//!
//! A shell is a path to a built page, or a name a packaged desktop passes
//! along for the log while handing the page over itself. Telling the two apart
//! is three rules and every one of them has been got wrong once, so they are
//! here — with the filesystem injected — rather than in the supervisor where
//! testing them would need a desktop.

use std::path::{Path, PathBuf};

/// The name a shell's module has to have. Fixed rather than searched for:
/// `shellBuild` pins it, because a content hash in the name would change every
/// time the shell did and then nothing could name the file.
///
/// Public because the engine is told it too: it goes into the document the
/// fork generates as `<script src>`, and the name the launcher looks for on
/// disk and the name the document asks for have to be the one name.
pub const MODULE: &str = "shell.js";

/// Two instructions that disagree, or none that names a shell.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ShellPathError {
    #[error(
        "given both a page and a path to one, and they are not the same \
         instruction: DOMICILE_PAGE={page}, the argument {argument}. Pass one."
    )]
    TwoPages { page: String, argument: String },
    #[error("no shell at '{0}' — it is neither a file nor a directory")]
    NotThere(String),
    #[error(
        "no {MODULE} in {0}. A shell is one built JavaScript module by that \
         name, and Domicile writes the document that loads it."
    )]
    NoModule(PathBuf),
}

/// The directory to serve.
///
/// `exists` answers `Some(true)` for a directory, `Some(false)` for a file and
/// `None` for neither — the one thing this cannot decide on its own, and a
/// parameter so that every rule below is testable without a disk.
pub fn shell_page(
    argument: &str,
    handed_in: Option<&str>,
    exists: &dyn Fn(&Path) -> Option<bool>,
) -> Result<PathBuf, ShellPathError> {
    let page = if is_path(argument, handed_in, exists) {
        // TWO INSTRUCTIONS THAT DISAGREE. A handed-in page and a path argument
        // are both somebody saying which page to serve. An earlier version
        // validated the argument and then discarded it, so a run could fail
        // over a path it was never going to use, and succeed while serving a
        // different page than the one typed. Neither reading is safe to pick.
        if let Some(page) = handed_in {
            return Err(ShellPathError::TwoPages {
                argument: argument.to_string(),
                page: page.to_string(),
            });
        }
        directory_of(argument, exists)?
    } else {
        // A name, which means the page came with it. Without one there is
        // nothing to serve: this program builds nothing, so a bare word names
        // no page it could produce.
        PathBuf::from(handed_in.ok_or_else(|| ShellPathError::NotThere(argument.to_string()))?)
    };

    match exists(&page.join(MODULE)) {
        Some(false) => Ok(page),
        _ => Err(ShellPathError::NoModule(page)),
    }
}

/// Whether the argument is a path rather than a name.
///
/// A separator, `.` or `..` is always a path. A bare word is one only when no
/// page was handed in: a packaged desktop passes its own name alongside the
/// page it built, and run from a directory that happens to hold a `simple/`
/// that word became a path and the refusal above fired about two instructions
/// the user never gave. The user's own `cd` is not an argument.
fn is_path(
    argument: &str,
    handed_in: Option<&str>,
    exists: &dyn Fn(&Path) -> Option<bool>,
) -> bool {
    if argument.contains('/') || argument == "." || argument == ".." {
        return true;
    }
    handed_in.is_none() && exists(Path::new(argument)) == Some(true)
}

/// A file is taken as one in the directory that holds it, so naming the module
/// and naming what contains it are the same instruction.
fn directory_of(
    argument: &str,
    exists: &dyn Fn(&Path) -> Option<bool>,
) -> Result<PathBuf, ShellPathError> {
    let path = Path::new(argument);
    match exists(path) {
        Some(true) => Ok(path.to_path_buf()),
        Some(false) => Ok(path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()),
        None => Err(ShellPathError::NotThere(argument.to_string())),
    }
}
