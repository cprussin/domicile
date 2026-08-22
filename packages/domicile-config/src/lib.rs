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

mod desktop;

pub use desktop::{Desktop, Display};

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
    ///
    /// Will be used only while [`OutputConfig::displays`] is empty: once the
    /// desktop is described, its bounding box is what the nested window is
    /// sized to. Nothing reads `displays` yet, so today it is used either way.
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

/// One display, described in the config rather than discovered.
///
/// A nested compositor has no monitors to enumerate and no DRM to ask, so the
/// desktop's shape is whatever the config says it is. Each display becomes a
/// `wl_output`, and a region of the one chrome page that spans the desktop;
/// `name` is what the shell addresses that region by.
///
/// `position` and `size` are logical units. `position` is where this display's
/// top-left corner sits in the config's own space, which is what puts two
/// displays side by side rather than on top of each other — see [`Desktop`]
/// for the space that reaches the rest of Domicile.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplayConfig {
    /// How the chrome and the compositor name this display to each other.
    ///
    /// Matched exactly, in both directions, which is why a padded one is
    /// rejected rather than trimmed.
    pub name: String,
    /// The top-left corner, in the *config's* coordinate space.
    ///
    /// Wherever the user finds it natural to put it — negative included, since
    /// "to the left of that one" is the obvious way to describe a second
    /// monitor. Not the desktop's space, which [`Desktop`] normalises this
    /// into and which is what the compositor advertises and the chrome is
    /// told; these numbers do not leave this crate.
    #[serde(default)]
    pub position: (i32, i32),
    /// The `wl_output` scale to advertise for clients on this display.
    ///
    /// Stated outright rather than capped: [`OutputConfig::max_scale`] governs
    /// the display Domicile's own window landed on, which a described display
    /// is not.
    #[serde(default = "one")]
    pub scale: u32,
    /// Width and height in logical units.
    ///
    /// Logical, so a `wl_output` mode — which is physical pixels — is this
    /// multiplied by `scale`.
    pub size: (u32, u32),
}

fn one() -> u32 {
    1
}

impl DisplayConfig {
    /// Whether this display and `other` cover any of the same ground.
    ///
    /// Both axes, because a rectangle that overlaps along only one of them is
    /// the display next to it rather than the display on top of it.
    fn overlaps(&self, other: &DisplayConfig) -> bool {
        overlap(
            span(self.position.0, self.size.0),
            span(other.position.0, other.size.0),
        ) && overlap(
            span(self.position.1, self.size.1),
            span(other.position.1, other.size.1),
        )
    }

    fn validate(&self, index: usize) -> Result<(), ConfigError> {
        let at = format!("output.displays[{index}]");
        if self.name.trim().is_empty() {
            return Err(ConfigError::Validation(format!("{at} must have a name")));
        }
        if self.name.trim() != self.name {
            return Err(ConfigError::Validation(format!(
                "{at} name {:?} is padded with whitespace; \
                 the name is matched exactly, so the padding would have to be typed everywhere",
                self.name
            )));
        }
        let (width, height) = self.size;
        if width == 0 || height == 0 {
            return Err(ConfigError::Validation(format!(
                "{at} size for {} must be non-zero, got {width}x{height}",
                self.name
            )));
        }
        if self.scale == 0 {
            return Err(ConfigError::Validation(format!(
                "{at} scale for {} must be at least 1",
                self.name
            )));
        }
        if i64::from(width) > i64::from(i32::MAX) || i64::from(height) > i64::from(i32::MAX) {
            return Err(ConfigError::Validation(format!(
                "{at} size for {} is {width}x{height}, wider or taller than a \
                 position on one desktop can reach: normalising puts this \
                 display's near edge at zero, so its far edge has to be a \
                 position",
                self.name
            )));
        }
        let (_, right) = span(self.position.0, width);
        let (_, bottom) = span(self.position.1, height);
        if right > i64::from(i32::MAX) || bottom > i64::from(i32::MAX) {
            return Err(ConfigError::Validation(format!(
                "{at} puts {}'s far corner at ({right}, {bottom}), off the edge of the \
                 coordinate space the desktop is measured in",
                self.name
            )));
        }
        Ok(())
    }
}

/// One display's half-open extent along one axis, in the config's own space.
///
/// Widened, because a display placed far out along an axis has an end that is
/// not an `i32` — and rejecting that layout is [`DisplayConfig::validate`]'s
/// job rather than something wrapping arithmetic decides silently here.
fn span(start: i32, length: u32) -> (i64, i64) {
    (i64::from(start), i64::from(start) + i64::from(length))
}

/// Whether two half-open spans of one axis intersect.
///
/// Half-open, so spans that share an endpoint — the ordinary side-by-side or
/// stacked desktop — are adjacent rather than overlapping.
fn overlap((start, end): (i64, i64), (other_start, other_end): (i64, i64)) -> bool {
    start < other_end && other_start < end
}

/// Output settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct OutputConfig {
    /// The displays that make up the desktop.
    ///
    /// Empty means the one output a nested compositor can manage without being
    /// told: sized by whatever window Domicile itself was given.
    pub displays: Vec<DisplayConfig>,
    /// The highest `wl_output` scale to advertise, whatever the chrome's
    /// display actually is.
    ///
    /// This is a cost dial, not a preference. A client asked to draw at scale
    /// N produces N² times the pixels, and every one of them is read back off
    /// the GPU, written down a socket and copied across the Electron process
    /// boundary — so sharpness is bought with latency, in the square. `1`
    /// turns scaling off entirely and restores the old behaviour.
    ///
    /// Governs the single output that follows Domicile's own window, so it
    /// will apply only while [`displays`](OutputConfig::displays) is empty: a
    /// described display states its own `scale` and has no ratio to cap.
    /// Nothing reads `displays` yet, so today it applies either way.
    pub max_scale: u32,
}

impl Default for OutputConfig {
    fn default() -> Self {
        // 2 covers the ordinary retina laptop, which is the display that makes
        // unscaled text look wrong; past that the frame gets expensive faster
        // than it gets better.
        OutputConfig {
            displays: Vec::new(),
            max_scale: 2,
        }
    }
}

impl OutputConfig {
    /// The desktop these displays make up, placed about its own top-left.
    ///
    /// `None` when none are configured, which is not an empty desktop but the
    /// absence of a described one — the case where the single output follows
    /// whatever window Domicile itself was given.
    ///
    /// That `None` is what has to become both `compositor.nested_size` and the
    /// wire's *empty* `displays` list, which `HostMessage::Displays` is
    /// equally clear is an answer rather than an absence. Both are right for
    /// their layer, and whoever writes the host side owes them one decision
    /// rather than two.
    ///
    /// Rebuilt on each call, names and all. Fine for a list the config states
    /// once; not something to put on a frame path.
    pub fn desktop(&self) -> Option<Desktop> {
        Desktop::of(&self.displays)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.max_scale == 0 {
            return Err(ConfigError::Validation(
                "output.max_scale must be at least 1".into(),
            ));
        }
        for (index, display) in self.displays.iter().enumerate() {
            display.validate(index)?;
            for earlier in &self.displays[..index] {
                if earlier.name == display.name {
                    return Err(ConfigError::Validation(format!(
                        "two output.displays are both named {}",
                        display.name
                    )));
                }
                if earlier.overlaps(display) {
                    return Err(ConfigError::Validation(format!(
                        "output.displays {} and {} cover the same ground",
                        earlier.name, display.name
                    )));
                }
            }
        }
        // Last, because it is the least specific thing that can be wrong with
        // a layout: a single display whose own far corner does not fit is an
        // error about *that display*, and running this first would answer it
        // with "the displays span N across", which names nobody and is not
        // even true of one.
        self.validate_extent()
    }

    /// Whether the displays together span a desktop that is a coordinate space.
    ///
    /// Only ever two *different* displays: a lone one spans its own size,
    /// which `DisplayConfig::validate` has already bounded, so the message
    /// below can name a pair without ever naming one display twice.
    ///
    /// Each entry's own far corner fitting an `i32` is not enough: two that
    /// each fit can still be four billion apart. The desktop is placed about
    /// its own top-left corner, so a display's normalised position is the
    /// distance between two of those corners — and `i32` is what a position
    /// is. Checked here rather than left to `Desktop::of`, which does that
    /// subtraction and would overflow doing it.
    fn validate_extent(&self) -> Result<(), ConfigError> {
        for axis in [Axis::Horizontal, Axis::Vertical] {
            let furthest = self.displays.iter().max_by_key(|d| axis.reach(d));
            let nearest = self.displays.iter().min_by_key(|d| axis.near(d));
            let (Some(furthest), Some(nearest)) = (furthest, nearest) else {
                continue;
            };
            let extent = axis.reach(furthest) - i64::from(axis.near(nearest));
            if extent > i64::from(i32::MAX) {
                return Err(ConfigError::Validation(format!(
                    "output.displays span {extent} {axis}, from {} to {} — \
                     further than a position on one desktop can describe",
                    nearest.name, furthest.name
                )));
            }
        }
        Ok(())
    }
}

/// One axis of the desktop, so the extent check reads once rather than twice.
#[derive(Debug, Clone, Copy)]
enum Axis {
    Horizontal,
    Vertical,
}

impl Axis {
    /// This display's near edge along the axis, in the config's own space.
    fn near(self, display: &DisplayConfig) -> i32 {
        match self {
            Axis::Horizontal => display.position.0,
            Axis::Vertical => display.position.1,
        }
    }

    /// Its far edge, widened — the near edge fits an `i32` and the sum need
    /// not, which is what makes this worth checking at all.
    fn reach(self, display: &DisplayConfig) -> i64 {
        let length = match self {
            Axis::Horizontal => display.size.0,
            Axis::Vertical => display.size.1,
        };
        i64::from(self.near(display)) + i64::from(length)
    }
}

impl std::fmt::Display for Axis {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Axis::Horizontal => "across",
            Axis::Vertical => "down",
        })
    }
}

/// The full compositor configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub shell: ShellConfig,
    pub compositor: CompositorConfig,
    pub input: InputConfig,
    pub output: OutputConfig,
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
        self.input.keyboard.validate()?;
        self.output.validate()
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
