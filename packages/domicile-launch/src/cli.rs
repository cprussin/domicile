//! What `domicile` was asked to do.
//!
//! Two things, told apart by the first argument: `domicile <shell>` runs a
//! desktop, and `domicile <verb>` sends a command to one that is already
//! running. One binary either way, the way `sway` and `swaymsg` are two names
//! for one — and one name is enough here because the desktop is the only thing
//! either form talks about.

use crate::control::Request;

/// A command line `domicile` will not run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    #[error(
        "which shell? Give the JavaScript module your shell built:\n\n    \
         domicile ./my-desktop/dist/shell.js\n\n\
         Or a command for the desktop already running: which-shell.\n"
    )]
    NoShell,
    #[error(
        "too many arguments: {extra}. A desktop is one shell, and which one is \
         the whole command line."
    )]
    TooMany { extra: String },
    #[error("{verb} takes no arguments, and it was given {extra}.")]
    Extra { verb: String, extra: String },
}

/// What to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// Run a desktop on this shell.
    Run { shell: String },
    /// Ask the desktop that is already running.
    Ask { request: Request },
}

/// Read the command line, or refuse it and say what to type instead.
///
/// Refused rather than defaulted, both ways. There is no shell a bare
/// `domicile` could mean, and a second argument is somebody saying two things:
/// quietly dropping the word they typed is how a run serves one page while
/// they read another on their own command line.
///
/// A VERB WINS OVER A SHELL OF THE SAME NAME, and the set of them is closed so
/// that it can. `shell_path` reads a bare word as a path when there is
/// something on disk by that name, which is what makes `domicile shell.js`
/// work from inside a build — so leaving the two readings to compete would
/// mean `domicile which-shell` starting a desktop for anyone who happened to
/// have a file called that beside them. A shell named after a verb is run the
/// way every path is: `domicile ./which-shell`.
pub fn invocation(args: impl IntoIterator<Item = String>) -> Result<Invocation, CliError> {
    let mut args = args.into_iter();
    let first = args.next().ok_or(CliError::NoShell)?;
    match verb(&first) {
        Some(request) => match args.next() {
            None => Ok(Invocation::Ask { request }),
            Some(extra) => Err(CliError::Extra { extra, verb: first }),
        },
        None => match args.next() {
            None => Ok(Invocation::Run { shell: first }),
            Some(extra) => Err(CliError::TooMany { extra }),
        },
    }
}

/// The request a word names, if it names one.
///
/// The other spelling of [`Request`]: every verb here is a variant there, and
/// a variant with no verb is a question a desktop can answer that nobody can
/// ask.
fn verb(word: &str) -> Option<Request> {
    match word {
        "which-shell" => Some(Request::WhichShell),
        _ => None,
    }
}
