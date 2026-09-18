//! What `domicile` was asked to do.
//!
//! Two things, told apart by the first argument: `domicile <shell>` runs a
//! desktop, and `domicile <verb>` sends a command to one that is already
//! running. One binary either way, the way `sway` and `swaymsg` are two names
//! for one — and one name is enough here because the desktop is the only thing
//! either form talks about.
//!
//! A run may also carry `--config`, which is the compositor's own file: the
//! monitors, their scales, their turns and the profiles that choose between
//! them. Optional, because a desktop with no monitors written down is the
//! defaults and that is a desktop; named on the command line rather than found
//! at a path of our own, for the reason `arguments.rs` gives for every value
//! it reads — a program starts this, and a program that meant to say something
//! can say it.

use std::path::PathBuf;

use crate::control::Request;

/// A command line `domicile` will not run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    #[error(
        "which shell? Give the JavaScript module your shell built:\n\n    \
         domicile ./my-desktop/dist/shell.js\n\n\
         Add --config <path> to give the compositor your monitors.\n\
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
    #[error(
        "--config takes the path to the compositor's config file and was given \
         nothing. A desktop with no monitors written down is that flag left \
         off, not that flag left empty."
    )]
    ConfigWithoutPath,
    #[error(
        "--config twice, the second naming {second}. A desktop is one config, \
         and quietly keeping one of the two is how a desk comes up wearing \
         settings nobody chose."
    )]
    TwoConfigs { second: String },
}

/// What to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// Run a desktop on this shell, with the compositor reading `config`.
    ///
    /// `None` is the compositor's defaults, which is what a desktop with no
    /// monitors written down runs.
    Run {
        shell: String,
        config: Option<PathBuf>,
    },
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
///
/// **A VERB STILL TAKES NOTHING, `--config` INCLUDED.** It is a question put to
/// a desktop that is already running, and that desktop read its config when it
/// started — so a flag here would be a config handed to a process that is not
/// going to read one, which is worse than refused because it looks like it
/// worked.
///
/// The flag may come on either side of the shell. A run is two values and
/// neither is positional against the other, so the order somebody types them
/// in is not a thing to be right about.
pub fn invocation(args: impl IntoIterator<Item = String>) -> Result<Invocation, CliError> {
    let mut args = args.into_iter();
    let first = args.next().ok_or(CliError::NoShell)?;
    if let Some(request) = verb(&first) {
        return match args.next() {
            None => Ok(Invocation::Ask { request }),
            Some(extra) => Err(CliError::Extra { extra, verb: first }),
        };
    }
    let mut shell: Option<String> = None;
    let mut config: Option<PathBuf> = None;
    let mut word = Some(first);
    while let Some(said) = word {
        if said == CONFIG {
            // The path is read before the duplicate is refused, because the
            // message names it and there is nothing to name until it has
            // been. So `--config a --config` is the empty flag rather than
            // the doubled one — which is also true of it, and is the half a
            // person can act on without first deleting something.
            if let Some(second) = args.next() {
                if config.is_some() {
                    return Err(CliError::TwoConfigs { second });
                }
                config = Some(PathBuf::from(second));
            } else {
                return Err(CliError::ConfigWithoutPath);
            }
        } else if shell.is_none() {
            shell = Some(said);
        } else {
            return Err(CliError::TooMany { extra: said });
        }
        word = args.next();
    }
    Ok(Invocation::Run {
        shell: shell.ok_or(CliError::NoShell)?,
        config,
    })
}

/// The flag that names the compositor's config file. The same spelling the
/// compositor's own `arguments.rs` reads, because this is the flag that is
/// handed on rather than a second name for it.
const CONFIG: &str = "--config";

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
