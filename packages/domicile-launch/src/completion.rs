//! Tab completion for `domicile`: what can follow the words typed so far,
//! which `domicile completions --complete=<word> <word>...` prints for the
//! scripts `domicile completions <shell>` prints. See docs/CLI.md.
//!
//! The scripts only pass words and show the answer, so every shell completes
//! the same things. Values that live in the running desktop (windows,
//! displays, agents, profiles, the shell's own commands) come from
//! [`Sources`], read only when the word being completed needs them.

use crate::commands::{self, COMMANDS};
use crate::shell_usage::{next_words, Word};
use domicile_protocol::{
    KnownAgents, ListedDisplay, ListedWindow, LogLevel, ShellCommandHelp, Subsystem,
};

/// A shell `domicile completions` prints a script for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionShell {
    Bash,
    Zsh,
    Fish,
    Nushell,
    Elvish,
    PowerShell,
}

impl CompletionShell {
    pub const ALL: [CompletionShell; 6] = [
        CompletionShell::Bash,
        CompletionShell::Zsh,
        CompletionShell::Fish,
        CompletionShell::Nushell,
        CompletionShell::Elvish,
        CompletionShell::PowerShell,
    ];

    /// Its name on the command line.
    pub fn name(self) -> &'static str {
        match self {
            CompletionShell::Bash => "bash",
            CompletionShell::Zsh => "zsh",
            CompletionShell::Fish => "fish",
            CompletionShell::Nushell => "nushell",
            CompletionShell::Elvish => "elvish",
            CompletionShell::PowerShell => "powershell",
        }
    }

    /// The shell named `word`, if any.
    pub fn named(word: &str) -> Option<CompletionShell> {
        Self::ALL.into_iter().find(|shell| shell.name() == word)
    }

    /// Its completion script.
    pub fn script(self) -> &'static str {
        match self {
            CompletionShell::Bash => include_str!("../completions/domicile.bash"),
            CompletionShell::Zsh => include_str!("../completions/_domicile"),
            CompletionShell::Fish => include_str!("../completions/domicile.fish"),
            CompletionShell::Nushell => include_str!("../completions/domicile.nu"),
            CompletionShell::Elvish => include_str!("../completions/domicile.elv"),
            CompletionShell::PowerShell => include_str!("../completions/domicile.ps1"),
        }
    }
}

/// What can go where the cursor is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Completion {
    /// These words, each with what it is (empty when nothing says).
    Values(Vec<(String, String)>),
    /// A path, which the shell completes itself.
    Files,
    /// A directory, which the shell completes itself.
    Directories,
}

impl Completion {
    /// As `--complete` prints it: `values`, `files` or `directories`, then a
    /// `<value>\t<about>` line per value.
    pub fn printed(&self) -> String {
        match self {
            Completion::Files => "files\n".to_string(),
            Completion::Directories => "directories\n".to_string(),
            Completion::Values(values) => values
                .iter()
                .fold("values\n".to_string(), |printed, (value, about)| {
                    format!("{printed}{value}\t{about}\n")
                }),
        }
    }
}

/// Where completion reads what the running desktop has. Each is empty
/// outside a desktop.
pub struct Sources<'a> {
    pub windows: &'a dyn Fn() -> Vec<ListedWindow>,
    pub displays: &'a dyn Fn() -> Vec<ListedDisplay>,
    pub agents: &'a dyn Fn() -> KnownAgents,
    /// Browser profiles, as `(id, name)`.
    pub profiles: &'a dyn Fn() -> Vec<(String, String)>,
    pub shell_commands: &'a dyn Fn() -> Vec<ShellCommandHelp>,
    /// Programs on `PATH` whose names start with the word.
    pub programs: &'a dyn Fn(&str) -> Vec<String>,
}

/// What a word of a command can be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Value {
    /// Anything; nothing to offer.
    Free,
    File,
    Directory,
    /// A `list-windows` id.
    Window,
    /// A `list-windows` id, or `shell`.
    WindowOrShell,
    /// A view's id in a `list-windows --json` window.
    View,
    /// Any name `list-displays` prints.
    Display,
    /// A display's mode, as `<W>x<H>@<Hz>`.
    Mode,
    /// An agent session's number.
    AgentSession,
    /// An agent's name, of those let in without asking.
    AgentName,
    /// A browser profile's id.
    Profile,
    /// A shell to run: a path, or a package.
    Shell,
    /// A program on `PATH`.
    Program,
    /// A command's name.
    Command,
    /// A shell `completions` prints for.
    CompletionShell,
    LogLevel,
    Subsystem,
    /// One of these words.
    OneOf(&'static [(&'static str, &'static str)]),
    /// `send-shell`'s words, which the running shell describes.
    ShellWords,
    /// `configure-display`'s changes, each a word and its values.
    DisplayChanges,
}

/// A flag a command takes, and the value after it, if any.
struct Flag {
    name: &'static str,
    value: Option<Value>,
}

/// What a command takes after its name.
struct Takes {
    flags: &'static [Flag],
    /// Its words in order.
    args: &'static [Value],
    /// What any further words are.
    rest: Option<Value>,
}

const NOTHING: Takes = Takes {
    flags: &[],
    args: &[],
    rest: None,
};

const JSON: &[Flag] = &[Flag {
    name: "--json",
    value: None,
}];

const AGENT: &[Flag] = &[Flag {
    name: "--agent",
    value: Some(Value::AgentSession),
}];

/// `--agent`, then `--window`, which the commands that act on a window take.
const AGENT_WINDOW: &[Flag] = &[
    Flag {
        name: "--agent",
        value: Some(Value::AgentSession),
    },
    Flag {
        name: "--window",
        value: Some(Value::Window),
    },
];

const SWITCH: &[(&str, &str)] = &[
    ("on", "Turn it on"),
    ("off", "Turn it off"),
    ("toggle", "Turn it the other way"),
];

/// What `domicile` takes before any command.
const RUN: Takes = Takes {
    flags: &[
        Flag {
            name: "--config",
            value: Some(Value::File),
        },
        Flag {
            name: "--help",
            value: None,
        },
        Flag {
            name: "--version",
            value: None,
        },
    ],
    args: &[Value::Shell],
    rest: None,
};

/// What the command named `verb` takes, or `None` for an unknown one.
fn takes(verb: &str) -> Option<Takes> {
    let one = |args: &'static [Value]| Takes {
        flags: &[],
        args,
        rest: None,
    };
    let agent_then = |args: &'static [Value]| Takes {
        flags: AGENT,
        args,
        rest: None,
    };
    Some(match verb {
        "which-shell" | "lock" | "power-off" | "reboot" | "log-out" | "screen-record" => NOTHING,
        "load-shell" => one(&[Value::Shell]),
        "dev" | "check-config" => one(&[Value::File]),
        "load-extension" => one(&[Value::Directory]),
        "send-shell" => Takes {
            flags: AGENT_WINDOW,
            args: &[],
            rest: Some(Value::ShellWords),
        },
        "list-shell-commands"
        | "list-bindings"
        | "list-windows"
        | "list-displays"
        | "list-inputs"
        | "status"
        | "idle-time"
        | "list-agents" => Takes {
            flags: JSON,
            args: &[],
            rest: None,
        },
        "open" => Takes {
            flags: &[
                Flag {
                    name: "--profile",
                    value: Some(Value::Profile),
                },
                Flag {
                    name: "--app",
                    value: None,
                },
                Flag {
                    name: "--id",
                    value: Some(Value::Free),
                },
                Flag {
                    name: "--reuse",
                    value: Some(Value::OneOf(&[
                        ("new", "Open another window"),
                        ("focus", "Bring the open window to the front"),
                        ("navigate", "Bring it to the front and load the address"),
                    ])),
                },
                Flag {
                    name: "--which",
                    value: None,
                },
                Flag {
                    name: "--agent",
                    value: Some(Value::AgentSession),
                },
                Flag {
                    name: "--electron",
                    value: None,
                },
            ],
            args: &[Value::File],
            rest: None,
        },
        "exec" => Takes {
            flags: AGENT,
            args: &[Value::Program],
            rest: Some(Value::File),
        },
        "inhibit-idle" => Takes {
            flags: &[Flag {
                name: "--",
                value: None,
            }],
            args: &[Value::Program],
            rest: Some(Value::File),
        },
        "focus-window" => agent_then(&[Value::Window]),
        "close-window" | "kill-window" | "accessibility" => Takes {
            flags: AGENT_WINDOW,
            args: &[],
            rest: None,
        },
        "install-app" | "uninstall-app" => one(&[Value::Free]),
        "configure-display" => Takes {
            flags: &[],
            args: &[Value::Display],
            rest: Some(Value::DisplayChanges),
        },
        "sleep-displays" | "wake-displays" => one(&[Value::Display]),
        "monitor" => Takes {
            flags: &[],
            args: &[Value::Free, Value::Free, Value::Free],
            rest: None,
        },
        "pointer" => agent_then(&[
            Value::Free,
            Value::OneOf(&[
                ("click", "Click the left button"),
                ("double-click", "Click the left button twice"),
                ("right-click", "Click the right button"),
                ("middle-click", "Click the middle button"),
            ]),
        ]),
        "drag" => agent_then(&[Value::Free, Value::Free]),
        "scroll" => agent_then(&[Value::Free]),
        "key" | "type" => Takes {
            flags: AGENT_WINDOW,
            args: &[Value::Free],
            rest: None,
        },
        "disable-while-typing" => Takes {
            flags: &[],
            args: &[Value::OneOf(SWITCH)],
            rest: None,
        },
        "theme" => Takes {
            flags: &[],
            args: &[Value::OneOf(&[
                ("light", "Light theme"),
                ("dark", "Dark theme"),
                ("toggle", "The other theme"),
            ])],
            rest: None,
        },
        "subscribe" => Takes {
            flags: &[],
            args: &[],
            rest: Some(Value::OneOf(&[
                ("windows", "Windows opening, changing and closing"),
                ("displays", "Monitors and their modes"),
                ("inputs", "Input devices plugged in and out"),
                ("status", "Theme, lock, keymap and screens"),
            ])),
        },
        "screenshot" => Takes {
            flags: &[
                Flag {
                    name: "--fit",
                    value: Some(Value::Free),
                },
                Flag {
                    name: "--area",
                    value: Some(Value::Free),
                },
            ],
            args: &[Value::File],
            rest: None,
        },
        "trace" => Takes {
            flags: &[Flag {
                name: "--seconds",
                value: Some(Value::Free),
            }],
            args: &[Value::File],
            rest: None,
        },
        "set-log-level" => Takes {
            flags: &[Flag {
                name: "--reset",
                value: None,
            }],
            args: &[Value::LogLevel],
            rest: Some(Value::Subsystem),
        },
        "logs" => Takes {
            flags: &[Flag {
                name: "--follow",
                value: None,
            }],
            args: &[],
            rest: None,
        },
        "export-logs" => Takes {
            flags: &[Flag {
                name: "--show-everything",
                value: None,
            }],
            args: &[Value::File],
            rest: None,
        },
        "mcp" => Takes {
            flags: &[
                Flag {
                    name: "--http",
                    value: Some(Value::Free),
                },
                Flag {
                    name: "--url",
                    value: Some(Value::Free),
                },
                Flag {
                    name: "--relay",
                    value: None,
                },
            ],
            args: &[],
            rest: None,
        },
        "agent" | "forget-agent" => one(&[Value::AgentName]),
        "stop-agent" => one(&[Value::AgentSession]),
        "accessibility-act" => Takes {
            flags: AGENT_WINDOW,
            args: &[
                Value::Free,
                Value::OneOf(&[
                    ("click", "Click it"),
                    ("focus", "Focus it"),
                    ("set-text", "Replace its text"),
                ]),
            ],
            rest: None,
        },
        "devtools" => Takes {
            flags: &[
                Flag {
                    name: "--agent",
                    value: Some(Value::AgentSession),
                },
                Flag {
                    name: "--window",
                    value: Some(Value::WindowOrShell),
                },
                Flag {
                    name: "--view",
                    value: Some(Value::View),
                },
            ],
            args: &[Value::Free, Value::Free],
            rest: None,
        },
        "help" => Takes {
            flags: &[Flag {
                name: "--man",
                value: Some(Value::Directory),
            }],
            args: &[Value::Command],
            rest: None,
        },
        "completions" => Takes {
            flags: &[],
            args: &[Value::CompletionShell],
            rest: None,
        },
        _ => return None,
    })
}

/// What can go in place of `current`, after `words` (the words typed after
/// `domicile`, without it).
pub fn complete(words: &[String], current: &str, sources: &Sources) -> Completion {
    let (verb, after) = match words.split_first() {
        Some((verb, after)) => (Some(verb.as_str()), after),
        None => (None, words),
    };
    match verb.map(|verb| (verb, takes(verb))) {
        // Help is the same after any command.
        Some((_, Some(_))) if after.iter().any(|word| word == "--help") => {
            Completion::Values(Vec::new())
        }
        Some((verb, Some(takes))) => completed(verb, &takes, after, current, sources),
        // A shell, or `--config <file>`, before any command.
        Some((_, None)) => completed("", &RUN, words, current, sources),
        None if current.starts_with('-') => completed("", &RUN, words, current, sources),
        None if looks_like_a_path(current) => Completion::Files,
        None => Completion::Values(matching(
            current,
            COMMANDS
                .iter()
                .map(|command| (command.name.to_string(), command.summary.to_string())),
        )),
    }
}

/// `word` is the start of a path rather than of a command.
fn looks_like_a_path(word: &str) -> bool {
    word.starts_with(['.', '/', '~']) || word.contains('/')
}

/// What can go in place of `current` after `after`, the words after `verb`.
fn completed(
    verb: &str,
    takes: &Takes,
    after: &[String],
    current: &str,
    sources: &Sources,
) -> Completion {
    let mut wanted: Option<Value> = None;
    let mut used: Vec<&str> = Vec::new();
    let mut positionals: Vec<String> = Vec::new();
    for word in after {
        if wanted.take().is_some() {
            continue;
        }
        match takes.flags.iter().find(|flag| flag.name == word) {
            // Flags come before the command's own words.
            Some(flag) if positionals.is_empty() => {
                used.push(flag.name);
                wanted = flag.value;
            }
            _ => positionals.push(word.clone()),
        }
    }
    if let Some(value) = wanted {
        return values(value, &[], current, sources);
    }
    let unused_flags = || {
        Completion::Values(matching(
            current,
            takes
                .flags
                .iter()
                .filter(|flag| !used.contains(&flag.name))
                .map(|flag| (flag.name.to_string(), flag_about(verb, flag.name))),
        ))
    };
    if current.starts_with('-') && positionals.is_empty() {
        return unused_flags();
    }
    match (takes.args.get(positionals.len()), takes.rest) {
        (Some(value), _) => values(*value, &[], current, sources),
        (None, Some(rest)) => values(rest, &positionals[takes.args.len()..], current, sources),
        (None, None) if positionals.is_empty() => unused_flags(),
        (None, None) => Completion::Values(Vec::new()),
    }
}

/// What `flag` of `verb` does, from its help.
fn flag_about(verb: &str, flag: &str) -> String {
    let command = match verb {
        "" => &commands::RUN,
        verb => match commands::command(verb) {
            Some(command) => command,
            None => return String::new(),
        },
    };
    command
        .sections
        .iter()
        .flat_map(|section| section.entries)
        .find(|(entry, _)| entry.split([' ', ',']).any(|part| part.trim() == flag))
        .map(|(_, about)| plain(about))
        .unwrap_or_default()
}

/// Help text without its backticks.
fn plain(text: &str) -> String {
    text.replace('`', "")
}

/// The values `value` can take in place of `current`. `before` are the
/// words of a [`Value::ShellWords`] or [`Value::DisplayChanges`] already
/// typed.
fn values(value: Value, before: &[String], current: &str, sources: &Sources) -> Completion {
    let listed = |listed: Vec<(String, String)>| Completion::Values(matching(current, listed));
    match value {
        Value::Free => Completion::Values(Vec::new()),
        Value::File => Completion::Files,
        Value::Directory => Completion::Directories,
        // A package, or else a path.
        Value::Shell if current.starts_with('@') => listed(vec![(
            "@domicile-desktop/manganese".to_string(),
            "Domicile's own shell".to_string(),
        )]),
        Value::Shell => Completion::Files,
        Value::Program => listed(
            (sources.programs)(current)
                .into_iter()
                .map(|program| (program, String::new()))
                .collect(),
        ),
        Value::Window => listed(windows(sources)),
        Value::WindowOrShell => listed(
            std::iter::once(("shell".to_string(), "The shell's page".to_string()))
                .chain(windows(sources))
                .collect(),
        ),
        Value::View => listed(
            (sources.windows)()
                .into_iter()
                .flat_map(|window| {
                    let title = window.title.clone();
                    window
                        .views
                        .into_iter()
                        .map(move |view| (view.id, format!("A view of {title}")))
                })
                .collect(),
        ),
        Value::Display => listed(displays(sources)),
        Value::Mode => listed(
            (sources.displays)()
                .into_iter()
                .map(|listed| {
                    let display = listed.display;
                    (
                        format!(
                            "{}x{}@{}",
                            display.mode[0],
                            display.mode[1],
                            hertz(display.refresh_mhz)
                        ),
                        format!("{}'s mode now", display.name),
                    )
                })
                .collect(),
        ),
        Value::AgentSession => listed(
            (sources.agents)()
                .connected
                .into_iter()
                .map(|agent| (agent.session.to_string(), agent.agent))
                .collect(),
        ),
        Value::AgentName => listed(
            (sources.agents)()
                .remembered
                .into_iter()
                .map(|agent| (agent.agent, "Let in without asking".to_string()))
                .collect(),
        ),
        Value::Profile => listed((sources.profiles)()),
        Value::Command => listed(
            COMMANDS
                .iter()
                .map(|command| (command.name.to_string(), command.summary.to_string()))
                .collect(),
        ),
        Value::CompletionShell => listed(
            CompletionShell::ALL
                .iter()
                .map(|shell| (shell.name().to_string(), String::new()))
                .collect(),
        ),
        Value::LogLevel => listed(
            [
                LogLevel::Error,
                LogLevel::Warn,
                LogLevel::Info,
                LogLevel::Debug,
                LogLevel::Trace,
            ]
            .iter()
            .map(|level| (level.name().to_string(), String::new()))
            .collect(),
        ),
        Value::Subsystem => listed(
            Subsystem::ALL
                .into_iter()
                .map(|subsystem| (subsystem.name().to_string(), String::new()))
                .collect(),
        ),
        Value::OneOf(words) => listed(
            words
                .iter()
                .map(|(word, about)| (word.to_string(), about.to_string()))
                .collect(),
        ),
        Value::ShellWords => listed(shell_words(before, sources)),
        Value::DisplayChanges => display_change(before, current, sources),
    }
}

/// Every window, by id, with its title.
fn windows(sources: &Sources) -> Vec<(String, String)> {
    (sources.windows)()
        .into_iter()
        .map(|window| {
            let about = match (window.title.is_empty(), window.app) {
                (false, _) => window.title,
                (true, Some(app)) => app,
                (true, None) => String::new(),
            };
            (window.id, about)
        })
        .collect()
}

/// Every name of every display, with its output's name.
fn displays(sources: &Sources) -> Vec<(String, String)> {
    (sources.displays)()
        .into_iter()
        .flat_map(|listed| {
            let output = listed.display.name;
            listed
                .names
                .into_iter()
                .map(move |name| (name, output.clone()))
        })
        .collect()
}

/// `mhz` in hertz, without a fraction when it is whole.
fn hertz(mhz: u32) -> String {
    match mhz % 1000 {
        0 => (mhz / 1000).to_string(),
        _ => format!("{:.3}", f64::from(mhz) / 1000.0)
            .trim_end_matches('0')
            .to_string(),
    }
}

/// The words that can follow `before` in a command the running shell runs.
fn shell_words(before: &[String], sources: &Sources) -> Vec<(String, String)> {
    let commands = (sources.shell_commands)();
    let mut words: Vec<(String, String)> = Vec::new();
    let mut add = |word: String, about: &str| {
        if !words.iter().any(|(listed, _)| *listed == word) {
            words.push((word, about.to_string()));
        }
    };
    for command in &commands {
        for next in next_words(&command.usage, before) {
            match next {
                Word::Literal(word) => add(word, &command.description),
                Word::Placeholder(name) => {
                    for (value, about) in placeholder(&name, sources) {
                        add(value, &about);
                    }
                }
            }
        }
    }
    words
}

/// The values Domicile knows for a placeholder a shell's usage names, such
/// as `<window>`.
fn placeholder(name: &str, sources: &Sources) -> Vec<(String, String)> {
    match name {
        "window" => windows(sources),
        "display" | "output" => displays(sources),
        _ => Vec::new(),
    }
}

/// The changes `configure-display` takes, each with what it takes.
const DISPLAY_CHANGES: &[(&str, &str, Value)] = &[
    ("mode", "A mode the monitor offers", Value::Mode),
    ("scale", "Scale, such as 1.25", Value::Free),
    (
        "position",
        "Top-left corner, in logical pixels",
        Value::Free,
    ),
    (
        "transform",
        "Turn it counterclockwise",
        Value::OneOf(&[
            ("normal", "Upright"),
            ("90", "A quarter turn"),
            ("180", "Upside down"),
            ("270", "Three quarter turns"),
        ]),
    ),
    (
        "adaptive-sync",
        "Variable refresh rate",
        Value::OneOf(SWITCH_ON_OFF),
    ),
    ("hdr", "High dynamic range", Value::OneOf(SWITCH_ON_OFF)),
    ("sdr-white", "SDR white level while HDR is on", Value::Free),
    ("enable", "Light the monitor", Value::Free),
    (
        "disable",
        "Turn it off and leave it out of the desktop",
        Value::Free,
    ),
    (
        "reset",
        "Drop its earlier changes, back to the config",
        Value::Free,
    ),
];

const SWITCH_ON_OFF: &[(&str, &str)] = &[("on", "Turn it on"), ("off", "Turn it off")];

/// The changes that take no value.
const VALUELESS: [&str; 3] = ["enable", "disable", "reset"];

/// What can go in place of `current` after the display changes `before`.
fn display_change(before: &[String], current: &str, sources: &Sources) -> Completion {
    let mut waiting: Option<Value> = None;
    for word in before {
        waiting = match waiting {
            Some(_) => None,
            None => DISPLAY_CHANGES
                .iter()
                .find(|(change, _, _)| change == word && !VALUELESS.contains(change))
                .map(|(_, _, value)| *value),
        };
    }
    match waiting {
        Some(value) => values(value, &[], current, sources),
        None => Completion::Values(matching(
            current,
            DISPLAY_CHANGES
                .iter()
                .filter(|(change, _, _)| !before.iter().any(|word| word == change))
                .map(|(change, about, _)| (change.to_string(), about.to_string())),
        )),
    }
}

/// The values that start with `current`.
fn matching(
    current: &str,
    values: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    values
        .into_iter()
        .filter(|(value, _)| value.starts_with(current))
        .collect()
}
