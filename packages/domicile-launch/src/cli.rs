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
//! them. Optional twice over — a desktop with no monitors written down is the
//! defaults and that is a desktop, and a desktop whose monitors are written
//! down in the usual place does not need telling. `config_path.rs` is where
//! the usual place is and why the guess is made there and not in the
//! compositor, which still has no default location for anything.

use std::path::PathBuf;

use crate::control::Request;

/// A command line `domicile` will not run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    #[error(
        "which shell? Give the JavaScript module your shell built:\n\n    \
         domicile ./my-desktop/dist/shell.js\n\n\
         Your monitors come from ~/.config/domicile/domicile.toml, or from \
         --config <path>.\n\
         Or a command for the desktop already running: which-shell, or \
         load-shell <path>.\n"
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
        "load-shell takes the path to the JavaScript module the shell you want \
         is, and was given nothing:\n\n    \
         domicile load-shell ./my-desktop/dist/shell.js\n"
    )]
    NoShellToLoad,
    #[error(
        "load-shell takes one shell, and it was given {extra} as well. A \
         desktop serves one shell at a time, and it read its config when it \
         started — so there is no --config here either."
    )]
    ExtraToLoad { extra: String },
    #[error(
        "--config takes the path to the compositor's config file and was given \
         nothing. Leaving the flag off reads ~/.config/domicile/domicile.toml \
         and runs the defaults when there is none, which is what an empty one \
         looks like it means."
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
    /// `None` is nobody having named one, which `config_path` turns into the
    /// file where a config lives or into the compositor's defaults. Not itself
    /// "the defaults" any more: this is what the command line said, and where
    /// else to look is a question about the machine rather than about the
    /// words somebody typed.
    Run {
        shell: String,
        config: Option<PathBuf>,
    },
    /// Ask the desktop that is already running.
    Ask { request: Request },
    /// Tell the desktop that is already running to serve this shell instead.
    ///
    /// The word as it was typed, and the one verb that carries one. What file
    /// it names is a question about the directory it was typed in and the home
    /// directory of whoever typed it — `shell_path` has those rules and an
    /// injected filesystem to ask them against, and this module has neither.
    Load { shell: String },
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
/// **A VERB TAKES WHAT THAT VERB TAKES, AND NEVER A FLAG.** `which-shell`
/// takes nothing: it is a question a desktop answers out of what it already
/// knows. `load-shell` takes one word, the shell to serve from now on, and is
/// the reason this is a rule per verb rather than the blanket "a verb takes
/// nothing" it used to be. What neither takes is `--config`: the desktop being
/// spoken to read its config when it started, so a flag here would be a config
/// handed to a process that is not going to read one, which is worse than
/// refused because it looks like it worked. `load-shell --config x.toml
/// ./shell.js` is refused by [`CliError::ExtraToLoad`] for that reason and not
/// by accident — a verb's argument list is closed the same way the set of
/// verbs is.
///
/// The flag may come on either side of the shell. A run is two values and
/// neither is positional against the other, so the order somebody types them
/// in is not a thing to be right about.
pub fn invocation(args: impl IntoIterator<Item = String>) -> Result<Invocation, CliError> {
    let mut args = args.into_iter();
    let first = args.next().ok_or(CliError::NoShell)?;
    if let Some(verb) = verb(&first) {
        return match verb {
            Verb::Asking(request) => match args.next() {
                None => Ok(Invocation::Ask { request }),
                Some(extra) => Err(CliError::Extra { extra, verb: first }),
            },
            Verb::Loading => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NoShellToLoad),
                (Some(shell), None) => Ok(Invocation::Load { shell }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToLoad { extra }),
            },
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

/// A verb, and what it goes on to take.
///
/// The distinction is the whole of why this type exists: a request that is
/// complete as soon as its word is read can be built here, and one that is not
/// cannot. There is no `Verb::Loading(Request)` to build, because the
/// [`Request::LoadShell`] that word leads to carries the resolved shell and
/// resolving it is a question about a filesystem this module does not have.
enum Verb {
    /// A question a desktop answers out of what it already knows.
    Asking(Request),
    /// `load-shell`: the word, with the shell still to come.
    Loading,
}

/// The verb a word names, if it names one.
///
/// The other spelling of [`Request`]: every verb here leads to a variant
/// there, and a variant no verb leads to is a question a desktop can answer
/// that nobody can ask.
fn verb(word: &str) -> Option<Verb> {
    match word {
        "which-shell" => Some(Verb::Asking(Request::WhichShell)),
        "load-shell" => Some(Verb::Loading),
        _ => None,
    }
}
