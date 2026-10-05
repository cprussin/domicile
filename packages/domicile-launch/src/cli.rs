//! Parses the `domicile` command line.
//!
//! `domicile <shell>` runs a desktop. `domicile <verb>` sends a command to a
//! running one. `--config` is optional; [`crate::config_path`] finds the
//! default.

use std::path::PathBuf;

use crate::control::Request;

/// An invalid `domicile` command line.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    #[error(
        "which shell? Give one, or name it in your config:\n\n    \
         domicile ./my-desktop/dist/shell.js\n    \
         domicile @domicile-desktop/manganese\n\n\
         A config is ~/.config/domicile/domicile.{{ts,tsx,js,mjs,json}}, or \
         --config <path>: a module's `Shell` export, or a JSON config's \
         \"shell\", is the shell when none is given.\n\
         Or a command for the desktop already running: which-shell, \
         load-shell <shell>, open-url <url>, or screenshot <file>.\n"
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
        "open-url takes the address to open, and was given nothing:\n\n    \
         domicile open-url https://example.com\n"
    )]
    NothingToOpen,
    #[error(
        "open-url takes one address, and it was given {extra} as well. One \
         address is one browser window."
    )]
    ExtraToOpen { extra: String },
    #[error(
        "screenshot takes the file to write the PNG to, and was given \
         nothing:\n\n    \
         domicile screenshot ~/shot.png\n"
    )]
    NowhereToSave,
    #[error("screenshot takes one file, and it was given {extra} as well.")]
    ExtraToSave { extra: String },
    #[error(
        "--config takes the path to the compositor's config file and was given \
         nothing. Leaving the flag off reads ~/.config/domicile/domicile.{{ts,tsx,js,mjs,json}} \
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

/// A parsed `domicile` command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// Run a desktop on this shell, with the compositor reading `config`.
    ///
    /// A `None` config means none was given; `config_path` resolves it.
    Run {
        /// The shell, or `None` for the one the config names.
        shell: Option<String>,
        config: Option<PathBuf>,
    },
    /// Query the running desktop.
    Ask { request: Request },
    /// Tell the running desktop to serve this shell instead.
    ///
    /// Kept as typed; `shell_path` resolves it against the filesystem.
    Load { shell: String },
    /// Tell the running desktop to open this in a new browser window.
    ///
    /// Kept as typed; [`crate::address`] makes it a URL.
    Open { target: String },
    /// Tell the running desktop to write a PNG of the desk to this file.
    ///
    /// Kept as typed; the client makes it absolute.
    Screenshot { file: String },
}

/// Parses the command line.
///
/// - A bare `domicile` runs the shell the config names. Extra arguments are
///   rejected rather than dropped.
/// - Verbs take precedence over a shell of the same name, because
///   `shell_path` treats a bare word as a path when such a file exists. Use
///   `./which-shell` to run a shell with a verb's name.
/// - Each verb has a closed argument list and takes no flags. The running
///   desktop already read its config, so a `--config` would be silently
///   ignored.
/// - `--config` may come before or after the shell.
pub fn invocation(args: impl IntoIterator<Item = String>) -> Result<Invocation, CliError> {
    let mut args = args.into_iter();
    let Some(first) = args.next() else {
        return Ok(Invocation::Run {
            shell: None,
            config: None,
        });
    };
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
            Verb::Opening => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NothingToOpen),
                (Some(target), None) => Ok(Invocation::Open { target }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToOpen { extra }),
            },
            Verb::Capturing => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NowhereToSave),
                (Some(file), None) => Ok(Invocation::Screenshot { file }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToSave { extra }),
            },
        };
    }
    let mut shell: Option<String> = None;
    let mut config: Option<PathBuf> = None;
    let mut word = Some(first);
    while let Some(said) = word {
        if said == CONFIG {
            // Read the path before checking for a duplicate, because the
            // error names it. `--config a --config` reports a missing path.
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
    Ok(Invocation::Run { shell, config })
}

/// The config file flag. Matches the compositor's flag in `arguments.rs`,
/// which receives it.
const CONFIG: &str = "--config";

/// A verb, and what it takes.
///
/// Only argument-free verbs carry a [`Request`]. [`Request::LoadShell`] needs
/// a resolved shell, which needs the filesystem.
enum Verb {
    /// A query that takes no arguments.
    Asking(Request),
    /// `load-shell`, which takes a shell.
    Loading,
    /// `open-url`, which takes an address.
    Opening,
    /// `screenshot`, which takes a file.
    Capturing,
}

/// The verb `word` names, if any.
///
/// Every [`Request`] variant needs a verb here, or nobody can send it.
fn verb(word: &str) -> Option<Verb> {
    match word {
        "which-shell" => Some(Verb::Asking(Request::WhichShell)),
        "load-shell" => Some(Verb::Loading),
        "open-url" => Some(Verb::Opening),
        "screenshot" => Some(Verb::Capturing),
        _ => None,
    }
}
