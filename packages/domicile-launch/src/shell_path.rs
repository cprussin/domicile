//! Which module to load, out of what the caller said.
//!
//! A shell is a path to a built JavaScript module, or a name a packaged
//! desktop passes along for the log while handing the module over itself.
//! Telling the two apart is three rules and every one of them has been got
//! wrong once, so they are here — with the filesystem injected — rather than
//! in the supervisor where testing them would need a desktop.
//!
//! THE ARGUMENT NAMES THE FILE, and it did not always. It used to name a
//! *directory*: a file was quietly taken as the directory holding it, and a
//! `shell.js` in that directory was what got loaded. `domicile foo/other.js`
//! therefore started a desktop on `foo/shell.js` — a file the user had not
//! named, with nothing in the run's own output to disagree, because the line
//! it printed was the directory both readings share. Which module a shell
//! built is the shell's own business now, and nothing here knows a name for
//! it.
//!
//! AND IT NAMES IT FROM ANYWHERE. Whatever was typed is resolved to one
//! absolute path before anything is asked about it — see [`resolved`] — so
//! that the directory the engine is told to serve, the file `domicile
//! which-shell` answers with, and the line this run prints are the same path
//! read from processes with working directories of their own.

use std::path::{Path, PathBuf};

/// A built shell, in the two halves the engine is told it in.
///
/// Split here rather than where the flags are built because the split has a
/// rule in it — see `root_and_module` — and `spawn` is a description of three
/// command lines rather than a place decisions are made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shell {
    /// The directory served over `domicile://shell/`: the one the module is
    /// in, and the whole of what the page can reach. Absolute.
    pub root: PathBuf,
    /// The module inside it. Relative, because the generated document puts it
    /// in a `<script src>` resolved against that root.
    pub module: PathBuf,
}

/// Two instructions that disagree, none that names a shell, or one this
/// program cannot work out where it starts.
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
        "'{0}' is a directory, and a shell is one built JavaScript module. \
         Name the module itself — `domicile {0}/shell.js`, if that is what \
         your build emitted."
    )]
    Directory(String),
    #[error(
        "'{0}' starts at a home directory and HOME is not set, so there is \
         nowhere for it to start. Write the path out in full."
    )]
    NoHome(String),
}

/// The module to load, and the directory it is served out of.
///
/// `here` is the directory this was typed in and `home` the one `~` stands
/// for; both are given rather than read so that every rule below is testable
/// without a disk or an environment. `exists` answers `Some(true)` for a
/// directory, `Some(false)` for a file and `None` for neither — the one thing
/// this cannot decide on its own.
///
/// ONE RULE FOR BOTH WAYS IN. `DOMICILE_PAGE` and the argument are two ways of
/// saying one thing — a packaged desktop hands the module over rather than
/// making its user type it — so whichever is in play is resolved here, by the
/// same lines. Two rules would leave a directory legal on the way in that a
/// user never types, which is the way that is hardest to find broken.
pub fn shell_module(
    argument: &str,
    handed_in: Option<&str>,
    here: &Path,
    home: Option<&Path>,
    exists: &dyn Fn(&Path) -> Option<bool>,
) -> Result<Shell, ShellPathError> {
    let named = if is_path(argument, handed_in, here, exists) {
        // TWO INSTRUCTIONS THAT DISAGREE. A handed-in module and a path
        // argument are both somebody saying which shell to serve. An earlier
        // version validated the argument and then discarded it, so a run could
        // fail over a path it was never going to use, and succeed while
        // serving a different module than the one typed. Neither reading is
        // safe to pick.
        if let Some(page) = handed_in {
            return Err(ShellPathError::TwoPages {
                argument: argument.to_string(),
                page: page.to_string(),
            });
        }
        argument
    } else {
        // A name, which means the module came with it. Without one there is
        // nothing to serve: this program builds nothing, so a bare word names
        // no module it could produce.
        handed_in.ok_or_else(|| ShellPathError::NotThere(argument.to_string()))?
    };

    let path = resolved(named, here, home)?;
    // The refusals name the resolved path rather than what was typed: where
    // this looked is the half the person does not have, and a `~` or a
    // relative path that went somewhere unexpected is invisible in the other.
    match exists(&path) {
        Some(false) => Ok(root_and_module(&path).expect(
            "`exists` said this names a file, and a path that names a file has \
             both a last component and something in front of it",
        )),
        // A DIRECTORY IS NOT A SHELL, and it is refused rather than searched.
        // Searching one for a fixed name is what made the argument mean
        // something other than what it said, and it left a shell that had
        // built its module under any other name with no way to be run at all.
        // The message is written for the fingers that still type the old form.
        Some(true) => Err(ShellPathError::Directory(said(&path))),
        None => Err(ShellPathError::NotThere(said(&path))),
    }
}

/// Whether the argument is a path rather than a name.
///
/// A separator, `.`, `..` or a leading `~` is always a path. A bare word is
/// one only when no module was handed in: a packaged desktop passes its own
/// name alongside the module it built, and run from a directory that happens
/// to hold a `simple/` that word became a path and the refusal above fired
/// about two instructions the user never gave. The user's own `cd` is not an
/// argument.
///
/// Anything on disk beside `here` counts, a file as much as a directory,
/// because `domicile shell.js` from inside the build is the shortest true
/// command there is — and beside `here` rather than beside this process
/// because that is what the word means on the command line it was typed on.
/// Only a directory counted while only a directory could be served.
fn is_path(
    argument: &str,
    handed_in: Option<&str>,
    here: &Path,
    exists: &dyn Fn(&Path) -> Option<bool>,
) -> bool {
    if argument.contains('/') || argument == "." || argument == ".." || argument.starts_with('~') {
        return true;
    }
    handed_in.is_none() && exists(&here.join(argument)).is_some()
}

/// One absolute path, out of whatever was typed.
///
/// A leading `~` is the home directory, expanded here because the argument
/// does not always come from a shell that would have done it: `DOMICILE_PAGE`
/// is written by a packaged desktop, and a tilde that was quoted arrives with
/// the tilde still on it. Only `~` itself and `~/` — `~alice` is another
/// user's home, which is a lookup this program does not have, so it stays part
/// of the name and is named as such by whichever refusal it reaches.
///
/// Everything else is joined onto `here`, which leaves a path that was already
/// absolute alone: `Path::join` replaces rather than appends. Collecting the
/// components takes the `.` out on the way, because a run that prints
/// `/home/me/./dist/shell.js` has made its own output harder to read for
/// nothing.
///
/// THE `..` STAYS. Popping the component in front of one is the same
/// directory only while that component is not a symlink, and a `dist` that is
/// one is ordinary — so resolving it here would serve a directory nobody
/// named, which is the bug this module's header is about. The filesystem
/// resolves those, and it is the thing that can.
fn resolved(named: &str, here: &Path, home: Option<&Path>) -> Result<PathBuf, ShellPathError> {
    let path = match named.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => home
            .ok_or_else(|| ShellPathError::NoHome(named.to_string()))?
            .join(rest.trim_start_matches('/')),
        Some(_) | None => PathBuf::from(named),
    };
    Ok(here.join(path).components().collect())
}

/// A path as a refusal says it.
fn said(path: &Path) -> String {
    path.display().to_string()
}

/// One absolute path to a file, as the directory to serve and the name in it
/// to load.
///
/// `None` for a path that names no file at all — `/`, or one ending in `..`.
/// Every such path is a directory, so a caller that gets here with one has
/// been told by the filesystem that a directory is a file, and the panic at
/// the call site is the right end for that.
///
/// A module typed with nothing in front of it used to arrive here as one
/// component, whose `Path::parent` is `Some("")` rather than `None` — and
/// `--domicile-shell-root=` names no directory at all. [`resolved`] is what
/// answers that now: the path is absolute, so there is always a directory in
/// front of the file, and it is the one the person who typed it was standing
/// in.
fn root_and_module(path: &Path) -> Option<Shell> {
    Some(Shell {
        root: path.parent()?.to_path_buf(),
        module: PathBuf::from(path.file_name()?),
    })
}
