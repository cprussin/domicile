//! Domicile compositor configuration.
//!
//! Responsibilities:
//! - Define the on-disk config schema ([`Config`]).
//! - Parse it, apply defaults, and validate it ([`Config::parse`]).
//! - Resolve which chrome package implements the shell ([`ShellRef`]).
//! - Provide hot-reload that is *safe*: a bad edit keeps the last known-good
//!   config live and surfaces the error rather than crashing ([`ConfigStore`]).
//!
//! The compositor watches the config file and feeds new file contents into a
//! [`ConfigStore`]; the store is the single source of truth for the live
//! configuration. All of this is pure logic and unit-tested.

use std::path::{Path, PathBuf};
use std::str::FromStr;

use serde::Deserialize;

/// Everything that can go wrong loading a config.
///
/// Deliberately `Clone + PartialEq` (it holds rendered messages, not opaque
/// source errors) so it can be stored on [`ConfigStore`] and asserted in tests.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("could not read config file {path}: {message}")]
    Io { path: String, message: String },

    #[error("invalid config syntax: {0}")]
    Parse(String),

    #[error("invalid config: {0}")]
    Validation(String),
}

/// A reference to the chrome package that implements the shell.
///
/// The shell is "all the user chrome" — panels, launchers, decorations — and is
/// swappable via config. A reference is either a bare name (resolved under a
/// well-known shells directory) or an explicit filesystem path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellRef {
    /// A named package, e.g. `"simple"`, resolved under the shells directory.
    Name(String),
    /// A filesystem path to a chrome package, e.g. `"./apps/shell"`.
    Path(PathBuf),
}

impl ShellRef {
    /// Resolve this reference to a concrete path.
    ///
    /// Named packages resolve under `shells_dir`; explicit paths are returned
    /// as-is (the caller interprets any relative path against its own base).
    pub fn resolve(&self, shells_dir: &Path) -> PathBuf {
        match self {
            ShellRef::Name(name) => shells_dir.join(name),
            ShellRef::Path(path) => path.clone(),
        }
    }
}

impl FromStr for ShellRef {
    type Err = ConfigError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim();
        if s.is_empty() {
            return Err(ConfigError::Validation(
                "shell package reference must not be empty".into(),
            ));
        }
        // Anything that looks like a path is a path; a bare identifier is a name.
        let looks_like_path =
            s.starts_with('/') || s.starts_with('~') || s.starts_with('.') || s.contains('/');
        if looks_like_path {
            Ok(ShellRef::Path(PathBuf::from(s)))
        } else {
            Ok(ShellRef::Name(s.to_string()))
        }
    }
}

impl<'de> Deserialize<'de> for ShellRef {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

/// Configuration for the shell (the chrome package and its opaque settings).
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ShellConfig {
    /// Which chrome package to run.
    pub package: ShellRef,
    /// Opaque settings handed to the chrome package verbatim. Domicile does not
    /// interpret these; each shell defines its own schema.
    pub settings: toml::Value,
}

impl Default for ShellConfig {
    fn default() -> Self {
        ShellConfig {
            package: ShellRef::Name("simple".into()),
            settings: toml::Value::Table(toml::map::Map::new()),
        }
    }
}

/// Host-level compositor settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CompositorConfig {
    /// Size of the nested output used by the `winit` dev backend (width, height).
    pub nested_size: (u32, u32),
}

impl Default for CompositorConfig {
    fn default() -> Self {
        CompositorConfig {
            nested_size: (1280, 800),
        }
    }
}

/// Keyboard settings, named after the `xkb_*` options SwayWM accepts.
///
/// `xkb_rules`, `xkb_model`, `xkb_layout` and `xkb_variant` are handed to xkb
/// verbatim, so sway's comma-separated multi-layout form (`xkb_layout =
/// "us,de"` with `xkb_variant = "dvp,"`) works here too. Empty `xkb_rules` /
/// `xkb_model` mean "whatever libxkbcommon defaults to". `xkb_options` is a
/// list rather than a comma-separated string because TOML has one; it carries
/// the common keyswaps (`caps:swapescape`, `compose:ralt`, …).
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct KeyboardConfig {
    pub xkb_rules: String,
    pub xkb_model: String,
    pub xkb_layout: String,
    pub xkb_variant: String,
    pub xkb_options: Vec<String>,
}

impl Default for KeyboardConfig {
    fn default() -> Self {
        KeyboardConfig {
            xkb_rules: String::new(),
            xkb_model: String::new(),
            xkb_layout: "us".into(),
            // Programmer's Dvorak, with Caps Lock and Escape swapped.
            xkb_variant: "dvp".into(),
            xkb_options: vec!["caps:swapescape".into()],
        }
    }
}

impl KeyboardConfig {
    /// The options in the comma-separated form xkb wants.
    ///
    /// An empty list yields `""`, which xkb reads as "no options at all" —
    /// distinct from leaving the option string unset.
    pub fn xkb_options_string(&self) -> String {
        self.xkb_options.join(",")
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.xkb_layout.trim().is_empty() {
            return Err(ConfigError::Validation(
                "input.keyboard.xkb_layout must not be empty".into(),
            ));
        }
        if self.xkb_options.iter().any(|o| o.trim().is_empty()) {
            return Err(ConfigError::Validation(
                "input.keyboard.xkb_options must not contain an empty option".into(),
            ));
        }
        Ok(())
    }
}

/// Input-device settings.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct InputConfig {
    pub keyboard: KeyboardConfig,
}

/// The full compositor configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub shell: ShellConfig,
    pub compositor: CompositorConfig,
    pub input: InputConfig,
}

impl Config {
    /// Parse a config from TOML text, applying defaults and validating it.
    pub fn parse(text: &str) -> Result<Config, ConfigError> {
        let config: Config =
            toml::from_str(text).map_err(|e| ConfigError::Parse(e.message().to_string()))?;
        config.validate()?;
        Ok(config)
    }

    /// Read and parse a config from a file.
    pub fn load(path: impl AsRef<Path>) -> Result<Config, ConfigError> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path).map_err(|e| ConfigError::Io {
            path: path.display().to_string(),
            message: e.to_string(),
        })?;
        Config::parse(&text)
    }

    /// Semantic validation beyond what the type system / deserializer enforce.
    fn validate(&self) -> Result<(), ConfigError> {
        let (w, h) = self.compositor.nested_size;
        if w == 0 || h == 0 {
            return Err(ConfigError::Validation(format!(
                "compositor.nested_size must be non-zero, got {w}x{h}"
            )));
        }
        self.input.keyboard.validate()
    }
}

/// Holds the live configuration and applies hot-reloads safely.
///
/// The guarantee: [`reload_from_str`](ConfigStore::reload_from_str) /
/// [`reload_from_path`](ConfigStore::reload_from_path) only replace the live
/// config when the new one is valid. On failure the previous config stays
/// active and the error is retained via [`last_error`](ConfigStore::last_error),
/// so a typo in the config file can never take the compositor down.
#[derive(Debug, Clone)]
pub struct ConfigStore {
    current: Config,
    last_error: Option<ConfigError>,
}

impl ConfigStore {
    pub fn new(initial: Config) -> Self {
        ConfigStore {
            current: initial,
            last_error: None,
        }
    }

    /// The live configuration.
    pub fn current(&self) -> &Config {
        &self.current
    }

    /// The error from the most recent failed reload, if the last reload failed.
    pub fn last_error(&self) -> Option<&ConfigError> {
        self.last_error.as_ref()
    }

    /// Attempt to replace the live config from TOML text.
    pub fn reload_from_str(&mut self, text: &str) -> Result<(), ConfigError> {
        self.apply(Config::parse(text))
    }

    /// Attempt to replace the live config from a file on disk.
    pub fn reload_from_path(&mut self, path: impl AsRef<Path>) -> Result<(), ConfigError> {
        self.apply(Config::load(path))
    }

    fn apply(&mut self, result: Result<Config, ConfigError>) -> Result<(), ConfigError> {
        match result {
            Ok(config) => {
                self.current = config;
                self.last_error = None;
                Ok(())
            }
            Err(err) => {
                self.last_error = Some(err.clone());
                Err(err)
            }
        }
    }
}

/// A live watcher over a config file.
///
/// Keeps the underlying OS watcher alive and delivers a freshly parsed
/// [`Config`] (or a [`ConfigError`]) on `rx` each time the file changes. Wire
/// `rx` into a [`ConfigStore`] via [`ConfigStore::apply`] to get safe
/// hot-reload. (The parse/store logic is unit-tested; this thin OS glue is
/// exercised via integration/manual runs.)
pub struct ConfigWatcher {
    _watcher: notify::RecommendedWatcher,
    pub rx: std::sync::mpsc::Receiver<Result<Config, ConfigError>>,
}

/// Begin watching `path` for changes.
pub fn watch(path: impl AsRef<Path>) -> Result<ConfigWatcher, ConfigError> {
    use notify::Watcher;

    let path = path.as_ref().to_path_buf();
    // Watch the parent directory: editors often save via atomic rename, which
    // a direct file watch can miss.
    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let (tx, rx) = std::sync::mpsc::channel();
    let reload_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(Config::load(&reload_path));
        }
    })
    .map_err(|e| ConfigError::Io {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;

    watcher
        .watch(&dir, notify::RecursiveMode::NonRecursive)
        .map_err(|e| ConfigError::Io {
            path: dir.display().to_string(),
            message: e.to_string(),
        })?;

    Ok(ConfigWatcher {
        _watcher: watcher,
        rx,
    })
}

impl ConfigStore {
    /// Apply a reload result delivered by a [`ConfigWatcher`].
    pub fn apply_watch(&mut self, result: Result<Config, ConfigError>) -> Result<(), ConfigError> {
        self.apply(result)
    }
}
