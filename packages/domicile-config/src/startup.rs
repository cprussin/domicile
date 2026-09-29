//! What a desk runs as it comes up.
//!
//! A session's own programs — a notification daemon, an editor's server — are
//! the session's to start, on its display, and not anything a shell page can
//! reach. Each is an argv, run as a launcher's application is: pointed at this
//! desk's `WAYLAND_DISPLAY`.

use serde::Deserialize;

use crate::ConfigError;

/// The commands a desk starts with.
///
/// **Run once, when the compositor starts**, and not on a reload: a reload
/// that started them again would be a second notification daemon, and one that
/// stopped the old ones would be killing what the person has since used.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StartupConfig {
    /// Each an argv: the program, then its arguments, with no shell between.
    /// `["sh", "-c", "…"]` is how to have one.
    pub commands: Vec<Vec<String>>,
}

impl StartupConfig {
    pub(crate) fn validate(&self) -> Result<(), ConfigError> {
        if self.commands.iter().any(Vec::is_empty) {
            Err(ConfigError::Validation(
                "startup.commands holds an empty command, which names no program to run"
                    .to_string(),
            ))
        } else {
            Ok(())
        }
    }
}
