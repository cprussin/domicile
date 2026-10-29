//! Parses the `domicile` command line.
//!
//! `domicile <shell>` runs a desktop. `domicile <verb>` sends a command to a
//! running one. `--config` is optional; [`crate::config_path`] finds the
//! default.

use std::path::PathBuf;

use domicile_protocol::Scale;

use crate::control::{AppReuse, Request, Switch, ThemeChange};
use crate::power::Power;

/// What `domicile --help` prints.
///
/// Every verb in [`verb`] needs a line here; `tests/cli.rs` checks both ways.
pub const USAGE: &str = "\
Run a desktop:

  domicile [shell] [--config <file>]
      Run a desktop on <shell>, or on the shell the config names. The config
      is ~/.config/domicile/domicile.{ts,tsx,js,mjs,json} unless --config
      names one.

Ask the running desktop:

  domicile which-shell                  Print the shell it serves
  domicile load-shell <shell>           Serve another shell, or a new build
  domicile open <file|folder|url>       Open with its default app, a link in
                                        a browser window
  domicile open --app <url|module>      Open a site or app module as an app
  domicile open --app --id <id> [--reuse new|focus|navigate] <url>
                                        Open a site as app <id>; with focus or
                                        navigate, reuse its open window
  domicile open --which <file|url>      Print the app open would use
  domicile screenshot [file]            Take the shell's screenshot, or write a PNG
  domicile screen-record                Record the screen until the toolbar stops it
  domicile send-shell <word>...         Run a shell command, as a keybinding does
  domicile theme [light|dark|toggle]    Set the theme, or print it
  domicile disable-while-typing [on|off|toggle]
                                        Set the touchpad setting, or print it
  domicile monitor <name> <W>x<H>[@Hz] [scale]
                                        Add a monitor with no screen until stdin
                                        ends; each line read resizes it
  domicile power-off                    Ask, then turn the computer off
  domicile reboot                       Ask, then restart the computer
  domicile log-out                      Ask, then end the login session

Without a desktop:

  domicile check-config <file>          Fail with the reason a config is refused
  domicile install-app <url>            Add a site to your applications
  domicile uninstall-app <url>          Remove a site install-app added
  domicile help                         Print this, as do --help and -h
";

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
         For a command for the running desktop, see domicile --help.\n"
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
        "open takes the file, folder or address to open, and was given \
         nothing:\n\n    \
         domicile open ~/notes.org\n    \
         domicile open https://example.com\n\n\
         With --app it takes a site or app module to open as an app:\n\n    \
         domicile open --app https://example.com\n    \
         domicile open --app ./notes/notes.js\n"
    )]
    NothingToOpen,
    #[error(
        "--reuse finds the open window by its app's id, and was given no \
         --id:\n\n    \
         domicile open --app --id mail --reuse focus https://mail.example\n"
    )]
    ReuseWithoutId,
    #[error("--reuse is new, focus or navigate, and was given {given}.")]
    UnknownReuse { given: String },
    #[error("{flag} takes a value, and was given none.")]
    FlagWithoutValue { flag: String },
    #[error(
        "open takes one thing to open, and it was given {extra} as well. One \
         thing is one window."
    )]
    ExtraToOpen { extra: String },
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
        "disable-while-typing takes on, off or toggle, or nothing to print \
         the setting, and was given {said}."
    )]
    NotASwitch { said: String },
    #[error(
        "theme takes light, dark or toggle, or nothing to print the theme, \
         and was given {said}."
    )]
    NotATheme { said: String },
    #[error(
        "monitor takes a name and a size, and was given less:\n\n    \
         domicile monitor \"Left pane\" 1280x720\n"
    )]
    NoMonitor,
    #[error("{said} is not a size like 1280x720 or 1280x720@30.")]
    NotASize { said: String },
    #[error("{said} is not a scale like 2 or 1.5.")]
    NotAScale { said: String },
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
    /// Open this file, folder or address with what opens its type; see
    /// [`crate::open`]. A web address opens in a new browser window.
    ///
    /// Kept as typed; it is relative to the working directory.
    Open { target: String },
    /// Tell the running desktop to open this as an app: an existing file as
    /// an app module ([`crate::app_entry`]), anything else as a site in a
    /// browser window without an address bar ([`crate::address`]).
    ///
    /// Kept as typed, like [`Invocation::Open`]'s. A site may be app `id`'s,
    /// whose open window `reuse` reuses.
    OpenAsApp {
        target: String,
        id: Option<String>,
        reuse: AppReuse,
    },
    /// Print the desktop file id of the application [`Invocation::Open`]
    /// would run for this, or nothing for a web address. The launcher lists
    /// it first under "Open with".
    Opener { target: String },
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
    /// Power off or reboot the computer, or log out, after a yes in the
    /// desktop's Access dialog.
    Power { power: Power },
    /// Add a virtual monitor until stdin ends, resizing it to each size read.
    Monitor { name: String, mode: MonitorMode },
    /// Print [`USAGE`].
    Help,
}

/// Parses the command line.
///
/// - A bare `domicile` runs the shell the config names. Extra arguments are
///   rejected rather than dropped.
/// - Verbs take precedence over a shell of the same name, because
///   `shell_path` treats a bare word as a path when such a file exists. Use
///   `./which-shell` to run a shell with a verb's name.
/// - Each verb has a closed argument list and takes no flags but `open`'s
///   `--app`, `--id` and `--reuse`, and `--which`. The running desktop already read its config, so a `--config`
///   would be silently ignored.
/// - `--config` may come before or after the shell.
pub fn invocation(args: impl IntoIterator<Item = String>) -> Result<Invocation, CliError> {
    let mut args = args.into_iter();
    let Some(first) = args.next() else {
        return Ok(Invocation::Run {
            shell: None,
            config: None,
        });
    };
    let mut args = args.peekable();
    if HELP.contains(&first.as_str())
        || (verb(&first).is_some()
            && args
                .peek()
                .is_some_and(|next| HELP.contains(&next.as_str())))
    {
        return match (first.as_str(), args.next()) {
            ("help", Some(extra)) => Err(CliError::Extra { verb: first, extra }),
            _ => Ok(Invocation::Help),
        };
    }
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
            Verb::Opening => {
                let first = args.next();
                let flag = first.clone().filter(|word| word == APP || word == WHICH);
                let (id, reuse) = match flag.as_deref() {
                    Some(APP) => app_flags(&mut args)?,
                    _ => (None, AppReuse::New),
                };
                let target = if flag.is_some() { args.next() } else { first };
                match (target, args.next()) {
                    (None, _) => Err(CliError::NothingToOpen),
                    (Some(_), Some(extra)) => Err(CliError::ExtraToOpen { extra }),
                    (Some(target), None) => Ok(match flag.as_deref() {
                        Some(APP) => Invocation::OpenAsApp { target, id, reuse },
                        Some(_) => Invocation::Opener { target },
                        None => Invocation::Open { target },
                    }),
                }
            }
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
            Verb::Switching => match (args.next(), args.next()) {
                (None, _) => Ok(Invocation::Ask {
                    request: Request::DisableWhileTyping { to: None },
                }),
                (Some(said), extra) => match (switch(&said), extra) {
                    (None, _) => Err(CliError::NotASwitch { said }),
                    (Some(_), Some(extra)) => Err(CliError::Extra {
                        verb: format!("{first} {said}"),
                        extra,
                    }),
                    (Some(to), None) => Ok(Invocation::Ask {
                        request: Request::DisableWhileTyping { to: Some(to) },
                    }),
                },
            },
            Verb::Theming => match (args.next(), args.next()) {
                (None, _) => Ok(Invocation::Ask {
                    request: Request::Theme { to: None },
                }),
                (Some(said), extra) => match (theme_change(&said), extra) {
                    (None, _) => Err(CliError::NotATheme { said }),
                    (Some(_), Some(extra)) => Err(CliError::Extra {
                        verb: format!("{first} {said}"),
                        extra,
                    }),
                    (Some(to), None) => Ok(Invocation::Ask {
                        request: Request::Theme { to: Some(to) },
                    }),
                },
            },
            Verb::Capturing => match (args.next(), args.next()) {
                (Some(_), Some(extra)) => Err(CliError::ExtraToSave { extra }),
                (file, _) => Ok(Invocation::Screenshot { file }),
            },
            Verb::Monitoring => match (args.next(), args.next(), args.next(), args.next()) {
                (Some(name), Some(size), scale, None) => {
                    let (size, refresh_mhz) =
                        monitor_size(&size).ok_or(CliError::NotASize { said: size })?;
                    let scale = match scale {
                        None => Scale::ONE,
                        Some(said) => scale_of(&said).ok_or(CliError::NotAScale { said })?,
                    };
                    Ok(Invocation::Monitor {
                        name,
                        mode: MonitorMode {
                            size,
                            refresh_mhz,
                            scale,
                        },
                    })
                }
                (Some(name), Some(size), Some(scale), Some(extra)) => Err(CliError::Extra {
                    verb: format!("{first} {name} {size} {scale}"),
                    extra,
                }),
                _ => Err(CliError::NoMonitor),
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

/// The words that ask for [`USAGE`], first or right after a verb.
const HELP: [&str; 3] = ["help", "--help", "-h"];

/// `open`'s flag for opening as an app.
const APP: &str = "--app";

/// `open --app`'s flag naming the app a site's window belongs to.
const ID: &str = "--id";

/// `open --app`'s flag saying what to do when the app's window is open.
const REUSE: &str = "--reuse";

/// `open --app`'s `--id` and `--reuse`, in either order, before the target.
fn app_flags(
    args: &mut std::iter::Peekable<impl Iterator<Item = String>>,
) -> Result<(Option<String>, AppReuse), CliError> {
    let mut id = None;
    let mut reuse = AppReuse::New;
    while let Some(flag) = args.next_if(|word| word == ID || word == REUSE) {
        let value = args
            .next()
            .ok_or_else(|| CliError::FlagWithoutValue { flag: flag.clone() })?;
        if flag == ID {
            id = Some(value);
        } else {
            reuse = match value.as_str() {
                "new" => AppReuse::New,
                "focus" => AppReuse::Focus,
                "navigate" => AppReuse::Navigate,
                _ => return Err(CliError::UnknownReuse { given: value }),
            };
        }
    }
    if reuse != AppReuse::New && id.is_none() {
        return Err(CliError::ReuseWithoutId);
    }
    Ok((id, reuse))
}

/// `open`'s flag for printing what would open it, without opening it.
const WHICH: &str = "--which";

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
    /// `open`, which takes `--app` or nothing, then a target.
    Opening,
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
    /// `disable-while-typing`, which takes a [`Switch`] or nothing.
    Switching,
    /// `theme`, which takes a [`ThemeChange`] or nothing.
    Theming,
    /// `power-off`, `reboot` or `log-out`, which take no arguments.
    Powering(Power),
    /// `monitor`, which takes a name, a size and maybe a scale.
    Monitoring,
}

/// The verb `word` names, if any.
///
/// Every [`Request`] variant needs a verb here, or nobody can send it.
fn verb(word: &str) -> Option<Verb> {
    match word {
        "which-shell" => Some(Verb::Asking(Request::WhichShell)),
        "load-shell" => Some(Verb::Loading),
        "open" => Some(Verb::Opening),
        "install-app" => Some(Verb::Installing),
        "uninstall-app" => Some(Verb::Uninstalling),
        "screenshot" => Some(Verb::Capturing),
        "screen-record" => Some(Verb::Asking(Request::ScreenRecord)),
        "send-shell" => Some(Verb::Sending),
        "check-config" => Some(Verb::Checking),
        "disable-while-typing" => Some(Verb::Switching),
        "theme" => Some(Verb::Theming),
        "power-off" => Some(Verb::Powering(Power::Off)),
        "reboot" => Some(Verb::Powering(Power::Reboot)),
        "log-out" => Some(Verb::Powering(Power::LogOut)),
        "monitor" => Some(Verb::Monitoring),
        _ => None,
    }
}

/// The [`Switch`] `word` names, if any.
fn switch(word: &str) -> Option<Switch> {
    match word {
        "on" => Some(Switch::On),
        "off" => Some(Switch::Off),
        "toggle" => Some(Switch::Toggle),
        _ => None,
    }
}

/// The [`ThemeChange`] `word` names, if any.
fn theme_change(word: &str) -> Option<ThemeChange> {
    match word {
        "light" => Some(ThemeChange::Light),
        "dark" => Some(ThemeChange::Dark),
        "toggle" => Some(ThemeChange::Toggle),
        _ => None,
    }
}

/// What a virtual monitor is asked to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorMode {
    pub size: (u32, u32),
    /// In millihertz.
    pub refresh_mhz: u32,
    pub scale: Scale,
}

/// The mode `said` names: a size as [`monitor_size`] reads it, then
/// optionally a scale, like `3840x2160@30 2`. None for anything else.
pub fn monitor_mode(said: &str) -> Option<MonitorMode> {
    let mut words = said.split_whitespace();
    let (size, refresh_mhz) = monitor_size(words.next()?)?;
    let scale = match words.next() {
        None => Scale::ONE,
        Some(word) => scale_of(word)?,
    };
    words.next().is_none().then_some(MonitorMode {
        size,
        refresh_mhz,
        scale,
    })
}

/// The scale `said` names, a number above zero like `2` or `1.5`.
fn scale_of(said: &str) -> Option<Scale> {
    Scale::try_from(said.parse::<f64>().ok()?).ok()
}

/// The refresh rate of a size that names none, in millihertz.
const REFRESH_MHZ: u32 = 60_000;

/// The size `said` names, `<width>x<height>` with an optional `@<hertz>`, and
/// its refresh rate in millihertz. None for anything else, or a zero.
pub fn monitor_size(said: &str) -> Option<((u32, u32), u32)> {
    let (size, hertz) = match said.split_once('@') {
        Some((size, hertz)) => (size, Some(hertz)),
        None => (said, None),
    };
    let (width, height) = size.split_once('x')?;
    let (width, height) = (width.parse::<u32>().ok()?, height.parse::<u32>().ok()?);
    let refresh_mhz = match hertz {
        None => REFRESH_MHZ,
        Some(hertz) => {
            let hertz = hertz
                .parse::<f64>()
                .ok()
                .filter(|hertz| hertz.is_finite())?;
            // Rounded, so 59.94 is 59940 rather than 59939.
            let millihertz = (hertz * 1000.0).round();
            (millihertz >= 1.0 && millihertz <= f64::from(u32::MAX)).then_some(millihertz as u32)?
        }
    };
    (width > 0 && height > 0).then_some(((width, height), refresh_mhz))
}
