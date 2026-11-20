//! Turns the engine's stderr into journal entries.
//!
//! Chromium starts each line with `[pid:tid:time:LEVEL:file:line]`. The level
//! becomes the entry's priority and the file and line its `CODE_FILE` and
//! `CODE_LINE`. The shell's `console` lines go under `domicile-shell`, so a
//! shell author reads them apart from the engine's.
//!
//! Every process the engine forks writes to the same stderr, so the pid is
//! kept as `DOMICILE_PID`: journald's own `_PID` is the launcher's.

use crate::journal::{Entry, Priority};

/// The name the engine's entries carry.
pub const ENGINE: &str = "domicile-engine";

/// The name the shell's `console` lines carry.
pub const SHELL: &str = "domicile-shell";

/// Where the shell is served from. See `docs/architecture/DOMICILE-SCHEME.md`.
const SHELL_SOURCE: &str = ", source: domicile://shell/";

/// Reads the engine's stderr one line at a time.
///
/// Holds the last prefixed line's name and priority: a line without a prefix
/// continues it, as a stack under a `console.error` does.
pub struct EngineLog {
    last: Option<(&'static str, Priority)>,
}

impl EngineLog {
    pub fn new() -> Self {
        EngineLog { last: None }
    }

    /// The entry for one line of the engine's stderr.
    pub fn entry(&mut self, line: &str) -> Entry {
        match prefixed(line) {
            Some(said) => {
                let identifier = match said.file == "CONSOLE" && said.message.contains(SHELL_SOURCE)
                {
                    true => SHELL,
                    false => ENGINE,
                };
                self.last = Some((identifier, said.priority));
                Entry {
                    identifier,
                    priority: said.priority,
                    message: said.message.to_string(),
                    fields: said.fields(),
                }
            }
            // A library that writes to stderr itself, such as Mesa, has no
            // level. It is rare, so it is shown.
            None => {
                let (identifier, priority) = self.last.unwrap_or((ENGINE, Priority::Warning));
                Entry {
                    identifier,
                    priority,
                    message: line.to_string(),
                    fields: Vec::new(),
                }
            }
        }
    }
}

impl Default for EngineLog {
    fn default() -> Self {
        EngineLog::new()
    }
}

/// A line with Chromium's prefix, split up.
struct Prefixed<'a> {
    pid: &'a str,
    priority: Priority,
    file: &'a str,
    line: Option<&'a str>,
    message: &'a str,
}

impl Prefixed<'_> {
    fn fields(&self) -> Vec<(&'static str, String)> {
        [
            ("CODE_FILE", Some(self.file)),
            ("CODE_LINE", self.line),
            ("DOMICILE_PID", Some(self.pid)),
        ]
        .into_iter()
        .filter_map(|(name, value)| value.map(|value| (name, value.to_string())))
        .collect()
    }
}

/// Splits `[pid:tid:time:LEVEL:where] message`, or `None` for a line without
/// the prefix. `where` is `file:line`, or `file(line)` from older code paths.
fn prefixed(line: &str) -> Option<Prefixed<'_>> {
    let (prefix, message) = line.strip_prefix('[')?.split_once("] ")?;
    let mut parts = prefix.splitn(5, ':');
    let pid = parts.next()?;
    let _tid = parts.next()?;
    let _time = parts.next()?;
    let priority = priority(parts.next()?)?;
    let place = parts.next()?;
    let (file, line) = match place
        .strip_suffix(')')
        .and_then(|place| place.split_once('('))
    {
        Some((file, line)) => (file, Some(line)),
        None => match place.rsplit_once(':') {
            Some((file, line)) => (file, Some(line)),
            None => (place, None),
        },
    };
    Some(Prefixed {
        pid,
        priority,
        file,
        line,
        message,
    })
}

/// The priority for a Chromium severity, or `None` for a word that is not one.
fn priority(level: &str) -> Option<Priority> {
    match level {
        "FATAL" => Some(Priority::Critical),
        "ERROR" => Some(Priority::Error),
        "WARNING" => Some(Priority::Warning),
        "INFO" => Some(Priority::Info),
        verbose if verbose.starts_with("VERBOSE") => Some(Priority::Debug),
        _ => None,
    }
}
