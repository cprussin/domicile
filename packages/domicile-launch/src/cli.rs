//! Parses the `domicile` command line.
//!
//! `domicile <shell>` runs a desktop. `domicile <verb>` sends a command to a
//! running one. `--config` is optional; [`crate::config_path`] finds the
//! default.

use std::path::PathBuf;

use crate::control::Request;
use crate::power::Power;

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
         load-shell <shell>, open-url <url>, open-app <url>, run-app \
         <module>, screenshot \
         [file], or \
         send-shell <command>…. Or \
         check-config <file> to check a config without running it, or \
         power-off or reboot to turn the computer off or restart it, or \
         install-app <url> to add a site to your applications, or \
         uninstall-app <url> to remove one.\n"
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
        "open-app takes the address of the app to open, and was given \
         nothing:\n\n    \
         domicile open-app https://example.com\n"
    )]
    NothingToOpenAsApp,
    #[error(
        "open-app takes one address, and it was given {extra} as well. One \
         address is one app window."
    )]
    ExtraToOpenAsApp { extra: String },
    #[error(
        "run-app takes the app module to run, and was given nothing:\n\n    \
         domicile run-app ./notes/notes.js\n"
    )]
    NothingToRun,
    #[error(
        "run-app takes one module, and it was given {extra} as well. One \
         module is one app window."
    )]
    ExtraToRun { extra: String },
    #[error(
        "install-app takes the address of the site to install, and was given \
         nothing:\n\n    \
         domicile install-app https://example.com\n"
    )]
    NothingToInstall,
    #[error(
        "install-app takes one address, and it was given {extra} as well. One \
         address is one app."
    )]
    ExtraToInstall { extra: String },
    #[error(
        "uninstall-app takes the address the app opens, and was given \
         nothing:\n\n    \
         domicile uninstall-app https://example.com/\n"
    )]
    NothingToUninstall,
    #[error(
        "uninstall-app takes one address, and it was given {extra} as well. One \
         address is one app."
    )]
    ExtraToUninstall { extra: String },
    #[error("screenshot takes one file, and it was given {extra} as well.")]
    ExtraToSave { extra: String },
    #[error(
        "send-shell takes the command to send the shell, and was given \
         nothing:\n\n    \
         domicile send-shell focus right\n"
    )]
    NothingToSend,
    #[error(
        "check-config takes the config file to check, and was given \
         nothing:\n\n    \
         domicile check-config ~/.config/domicile/domicile.json\n"
    )]
    NothingToCheck,
    #[error("check-config takes one config, and it was given {extra} as well.")]
    ExtraToCheck { extra: String },
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
#[derive(Debug, Clone, PartialEq)]
pub enum Invocation {
    /// Run a desktop on this shell, with the compositor reading `config`.
    ///
    /// A `None` config means none was given; `config_path` resolves it.
    Run {
        /// The shell, or `None` for the one the config names.
        shell: Option<String>,
        config: Option<PathBuf>,
    },
    /// Send this request to the running desktop as it is.
    Ask { request: Request },
    /// Tell the running desktop to serve this shell instead.
    ///
    /// Kept as typed; `shell_path` resolves it against the filesystem.
    Load { shell: String },
    /// Tell the running desktop to open this in a new browser window.
    ///
    /// Kept as typed; [`crate::address`] makes it a URL.
    Open { target: String },
    /// Tell the running desktop to open this in a new app window: a browser
    /// window without an address bar.
    ///
    /// Kept as typed, like [`Invocation::Open`]'s.
    OpenApp { target: String },
    /// Tell the running desktop to run this app module in a new app window.
    ///
    /// Kept as typed; [`crate::app_entry`] resolves it.
    RunApp { entry: String },
    /// Write a desktop entry that opens the site at `url` as an app. Needs no
    /// running desktop.
    InstallApp { url: String },
    /// Remove the desktop entry and icon `install-app` wrote for `url`, the
    /// address it was given or the start URL. Needs no running desktop.
    UninstallApp { url: String },
    /// Tell the running desktop to write a PNG of the desk to this file, or,
    /// with none, to take the shell's interactive screenshot.
    ///
    /// Kept as typed; the client makes it absolute.
    Screenshot { file: Option<String> },
    /// Check that the compositor takes this config, without running a desktop.
    Check { config: PathBuf },
    /// Power off or reboot the computer, after a yes in the desktop's Access
    /// dialog.
    Power { power: Power },
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
            Verb::Powering(power) => match args.next() {
                None => Ok(Invocation::Power { power }),
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
            Verb::OpeningApp => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NothingToOpenAsApp),
                (Some(target), None) => Ok(Invocation::OpenApp { target }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToOpenAsApp { extra }),
            },
            Verb::RunningApp => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NothingToRun),
                (Some(entry), None) => Ok(Invocation::RunApp { entry }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToRun { extra }),
            },
            Verb::Installing => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NothingToInstall),
                (Some(url), None) => Ok(Invocation::InstallApp { url }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToInstall { extra }),
            },
            Verb::Uninstalling => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NothingToUninstall),
                (Some(url), None) => Ok(Invocation::UninstallApp { url }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToUninstall { extra }),
            },
            Verb::Sending => {
                let command: Vec<String> = args.collect();
                match command.is_empty() {
                    true => Err(CliError::NothingToSend),
                    false => Ok(Invocation::Ask {
                        request: Request::SendShell { command },
                    }),
                }
            }
            Verb::Capturing => match (args.next(), args.next()) {
                (Some(_), Some(extra)) => Err(CliError::ExtraToSave { extra }),
                (file, _) => Ok(Invocation::Screenshot { file }),
            },
            Verb::Checking => match (args.next(), args.next()) {
                (None, _) => Err(CliError::NothingToCheck),
                (Some(config), None) => Ok(Invocation::Check {
                    config: PathBuf::from(config),
                }),
                (Some(_), Some(extra)) => Err(CliError::ExtraToCheck { extra }),
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
    /// `open-app`, which takes an address.
    OpeningApp,
    /// `run-app`, which takes a module.
    RunningApp,
    /// `install-app`, which takes an address.
    Installing,
    /// `uninstall-app`, which takes an address.
    Uninstalling,
    /// `screenshot`, which takes a file or nothing.
    Capturing,
    /// `send-shell`, which takes one or more words.
    Sending,
    /// `check-config`, which takes a config file.
    Checking,
    /// `power-off` or `reboot`, which take no arguments.
    Powering(Power),
}

/// The verb `word` names, if any.
///
/// Every [`Request`] variant needs a verb here, or nobody can send it.
fn verb(word: &str) -> Option<Verb> {
    match word {
        "which-shell" => Some(Verb::Asking(Request::WhichShell)),
        "load-shell" => Some(Verb::Loading),
        "open-url" => Some(Verb::Opening),
        "open-app" => Some(Verb::OpeningApp),
        "run-app" => Some(Verb::RunningApp),
        "install-app" => Some(Verb::Installing),
        "uninstall-app" => Some(Verb::Uninstalling),
        "screenshot" => Some(Verb::Capturing),
        "send-shell" => Some(Verb::Sending),
        "check-config" => Some(Verb::Checking),
        "power-off" => Some(Verb::Powering(Power::Off)),
        "reboot" => Some(Verb::Powering(Power::Reboot)),
        _ => None,
    }
}
