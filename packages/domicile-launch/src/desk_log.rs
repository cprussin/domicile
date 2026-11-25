//! Messages from a process the desktop starts but `domicile set-log-level`
//! does not reach, such as `domicile mcp --relay`. It asks the desktop's
//! levels for each line below an error, so a level set while it runs
//! applies at once. Errors show always, as everywhere. See
//! `docs/guidelines/LOGGING.md`.

use std::io::Write;

use domicile_protocol::{LogLevel, LogLevels, Subsystem};

use crate::control::{Request, Response};
use crate::control_socket::{advertised, ask, VARIABLE};
use crate::launcher_log::{line, shown, threshold_of};

/// How long the desktop has to say its levels.
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(2);

/// Writes `said` to stderr at `level` for `subsystem`, if the desktop's
/// levels show it.
pub fn say(subsystem: Subsystem, level: LogLevel, said: &str) {
    match shows(subsystem, level, asked_levels) {
        Ok(false) => {}
        Ok(true) => written(level, said),
        Err(why) => written(
            LogLevel::Error,
            &format!("could not ask the desktop's log levels, so this went unsaid: {why}"),
        ),
    }
}

/// Whether a line at `level` for `subsystem` shows under the levels
/// `levels` gives, asked only for a line below an error.
fn shows(
    subsystem: Subsystem,
    level: LogLevel,
    levels: impl FnOnce() -> Result<LogLevels, String>,
) -> Result<bool, String> {
    match level {
        LogLevel::Error => Ok(true),
        _ => Ok(shown(level, threshold_of(subsystem, &levels()?))),
    }
}

/// The desktop's log levels, asked over its control socket.
fn asked_levels() -> Result<LogLevels, String> {
    let socket =
        advertised(std::env::var(VARIABLE).ok().as_deref()).map_err(|why| why.to_string())?;
    match ask(&socket, &Request::LogLevels, Some(PATIENCE)).map_err(|why| why.to_string())? {
        Response::LogLevels { levels } => Ok(levels),
        other => Err(format!("the desktop answered {other:?}")),
    }
}

fn written(level: LogLevel, said: &str) {
    let journal = crate::journal::stderr_is_the_journal();
    // Nowhere is left to say a failed write.
    let _ = writeln!(std::io::stderr(), "{}", line(level, said, journal));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_error_shows_without_asking() {
        assert_eq!(
            shows(Subsystem::Agents, LogLevel::Error, || unreachable!()),
            Ok(true)
        );
    }

    #[test]
    fn a_lower_line_shows_at_its_subsystems_level() {
        let agents = || {
            Ok(LogLevels {
                all: None,
                subsystems: [(Subsystem::Agents, LogLevel::Info)].into(),
            })
        };
        assert_eq!(shows(Subsystem::Agents, LogLevel::Info, agents), Ok(true));
        assert_eq!(shows(Subsystem::Agents, LogLevel::Debug, agents), Ok(false));
        assert_eq!(shows(Subsystem::Session, LogLevel::Info, agents), Ok(false));
    }

    #[test]
    fn a_level_that_cannot_be_asked_is_said() {
        assert_eq!(
            shows(Subsystem::Agents, LogLevel::Info, || Err("gone".into())),
            Err("gone".to_string())
        );
    }
}
