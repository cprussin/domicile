//! Temporary changes to the config, for Settings and the shell's theme
//! toggle: laid over the file until the desktop stops
//! ([`domicile_config::ConfigStore::set_override`]). The desktop takes them up
//! as it takes up an edit of the file.

use std::sync::mpsc;

use domicile_config::ConfigKey;
use domicile_protocol as wire;
use tracing::info;

use crate::DomicileCompositor;

/// What a chrome asked of the temporary changes.
#[derive(Debug, Clone, PartialEq)]
pub enum ConfigChange {
    Set {
        path: Vec<ConfigKey>,
        value: serde_json::Value,
    },
    Reset {
        paths: Vec<Vec<ConfigKey>>,
    },
    Which,
}

/// `theme.mode`, which the shell's theme toggle changes.
fn the_theme_mode() -> Vec<ConfigKey> {
    vec![
        ConfigKey::Name("theme".into()),
        ConfigKey::Name("mode".into()),
    ]
}

impl ConfigChange {
    /// Whether it is one the shell's theme toggle makes, or only asks: what
    /// a locked desk takes ([`crate::lock::refused`]).
    pub fn is_the_theme_toggles(&self) -> bool {
        match self {
            ConfigChange::Which => true,
            ConfigChange::Set { path, .. } => *path == the_theme_mode(),
            ConfigChange::Reset { paths } => paths.iter().all(|path| *path == the_theme_mode()),
        }
    }

    /// Why it is refused whatever the config says: the `lock` section (the
    /// PAM service) changes only in the file.
    /// Other settings that bear on locking, such as `idle.lock_after_seconds`,
    /// can change for now like any setting.
    fn refused(&self) -> Option<String> {
        match self {
            ConfigChange::Set { path, .. }
                if path
                    .first()
                    .is_none_or(|key| *key == ConfigKey::Name("lock".into())) =>
            {
                Some("the lock's settings change only in the config file".into())
            }
            _ => None,
        }
    }
}

/// Where the Wayland thread tells a chrome connection thread the temporary
/// changes after a
/// [`ClientRequest::ChangeConfig`](crate::client_requests::ClientRequest::ChangeConfig),
/// or why it was refused.
pub struct Answer(mpsc::SyncSender<Result<Vec<wire::ConfigOverride>, String>>);

/// What a chrome connection thread waits on.
pub type Answered = mpsc::Receiver<Result<Vec<wire::ConfigOverride>, String>>;

impl Answer {
    /// An answer, and where to wait for it.
    pub fn new() -> (Answer, Answered) {
        let (answer, answered) = mpsc::sync_channel(1);
        (Answer(answer), answered)
    }

    /// Tell the waiting thread. It may have stopped waiting.
    pub fn give(self, answer: Result<Vec<wire::ConfigOverride>, String>) {
        let _ = self.0.send(answer);
    }
}

impl std::fmt::Debug for Answer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Answer")
    }
}

/// Requests are compared by what they ask, so any two answers are equal.
impl PartialEq for Answer {
    fn eq(&self, _: &Answer) -> bool {
        true
    }
}

/// `path` as the config crate takes it.
pub fn path_of(path: Vec<wire::ConfigKey>) -> Vec<ConfigKey> {
    path.into_iter()
        .map(|key| match key {
            wire::ConfigKey::Index(index) => ConfigKey::Index(index),
            wire::ConfigKey::Name(name) => ConfigKey::Name(name),
        })
        .collect()
}

/// A chrome's `set_config_override`, or why its value is not JSON.
pub fn set_of(path: Vec<wire::ConfigKey>, value: &str) -> Result<ConfigChange, String> {
    serde_json::from_str(value)
        .map(|value| ConfigChange::Set {
            path: path_of(path),
            value,
        })
        .map_err(|why| format!("the value is not JSON: {why}"))
}

impl DomicileCompositor {
    /// Does `change`, takes up the config it makes, and returns the temporary
    /// changes.
    pub fn change_the_config(
        &mut self,
        change: ConfigChange,
    ) -> Result<Vec<wire::ConfigOverride>, String> {
        if let Some(why) = change.refused() {
            return Err(why);
        }
        let was = self.config.current().clone();
        let changed = match &change {
            ConfigChange::Set { path, value } => {
                self.config.set_override(path.clone(), value.clone())
            }
            ConfigChange::Reset { paths } => self.config.reset_overrides(paths),
            ConfigChange::Which => return Ok(self.overrides_on_the_wire()),
        };
        changed.map_err(|why| why.to_string())?;
        info!(?change, "changed the config until the desktop stops");
        let dh = self.display_handle.clone();
        self.take_up_the_changed_config(&dh, &was);
        Ok(self.overrides_on_the_wire())
    }

    /// The temporary changes as the wire carries them, each value and what
    /// the file has under it as JSON text.
    pub(crate) fn overrides_on_the_wire(&self) -> Vec<wire::ConfigOverride> {
        self.config
            .overrides()
            .into_iter()
            .map(|change| wire::ConfigOverride {
                written: self.config.written_at(&change.path).to_string(),
                path: change
                    .path
                    .into_iter()
                    .map(|key| match key {
                        ConfigKey::Index(index) => wire::ConfigKey::Index(index),
                        ConfigKey::Name(name) => wire::ConfigKey::Name(name),
                    })
                    .collect(),
                value: change.value.to_string(),
            })
            .collect()
    }
}
