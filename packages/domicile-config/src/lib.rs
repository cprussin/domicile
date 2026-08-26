//! Domicile compositor configuration.
//!
//! Responsibilities:
//! - Define the config schema ([`Config`]).
//! - Parse it, apply defaults, and validate it ([`Config::parse`]).
//! - Provide hot-reload that is *safe*: a bad write keeps the last known-good
//!   config live and surfaces the error rather than crashing ([`ConfigStore`]).
//!
//! This is not a file a person edits. A Domicile desktop is started by its
//! *shell*, the shell owns the configuration its users write, and what it
//! hands the compositor is generated from that — so the schema here is the
//! shell-to-compositor interface rather than a user interface, and it is JSON.
//!
//! The compositor watches the file and feeds new contents into a
//! [`ConfigStore`]; the store is the single source of truth for the live
//! configuration. All of this is pure logic and unit-tested.

mod desktop;

pub use desktop::{Desktop, Display};

use std::path::{Path, PathBuf};

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

/// Host-level compositor settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CompositorConfig {
    /// The desktop's size when nothing describes one (width, height).
    ///
    /// Not the winit window's: `winit::init()` is called with no attributes,
    /// so nothing sizes that from here. This is the single output's logical
    /// size, advertised on every run with no displays — headless included.
    ///
    /// Two jobs, and the second only looks like the first. While
    /// [`OutputConfig::displays`] is empty this *is* the desktop — the single
    /// output's logical size. Once the desktop is described it is the largest
    /// window Domicile will ask a host for: the desktop is shown at its own
    /// size where it fits inside this and scaled to fit where it does not, so
    /// a wall of 4K displays does not ask for a window no screen can hold.
    ///
    /// The desktop itself is what the outputs make up either way. This never
    /// changes what a client is told.
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
/// list rather than a comma-separated string because the format has one; it
/// carries the common keyswaps (`caps:swapescape`, `compose:ralt`, …).
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
        // The `wl_output` mode is physical pixels, which is this times the
        // scale — so a size and a scale that each fit on their own can still
        // multiply past what a coordinate is. Checked here rather than where
        // the mode is built, which is arithmetic in the Smithay backend that
        // nothing can test and that would wrap in release.
        //
        // `u64`, not `i64`: two `u32`s multiply to just under `u64::MAX` and
        // to nearly twice `i64::MAX`, so the check written in `i64` panicked
        // on the largest inputs in debug — which `ConfigStore` cannot have,
        // since a bad config must never take the compositor down.
        //
        // On *this* path that is the whole of it: wrapping needs a width past
        // `i32::MAX`, and no such display survives — the far-corner check just
        // below rejects one whose corner lands off the coordinate space, and
        // `validate_extent` rejects the rest by the span they put between two
        // displays. So an `i64` version here would have wrapped and been
        // convicted by one of those anyway. The nested check has no backstop
        // at all, and there a wrapped product really does land back under the
        // bound and admit what the check exists to reject.
        //
        // This subsumes bounding the logical size on its own: the scale is at
        // least 1 by the check above, so a mode that fits means a size that
        // fits, which is the invariant `Desktop` asserts when it normalises.
        let mode = (
            u64::from(width) * u64::from(self.scale),
            u64::from(height) * u64::from(self.scale),
        );
        let reach = u64::try_from(i32::MAX).expect("`i32::MAX` is positive");
        if mode.0 > reach || mode.1 > reach {
            return Err(ConfigError::Validation(format!(
                "{at} size for {} is {width}x{height} at scale {}, a mode of \
                 {}x{} — more pixels across or down than a coordinate can \
                 describe",
                self.name, self.scale, mode.0, mode.1
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
    /// Governs the single output that follows Domicile's own window, and so
    /// applies only while [`displays`](OutputConfig::displays) is empty: a
    /// described display states its own `scale` and has no ratio to cap.
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
    /// That `None` becomes `compositor.nested_size` and, on the wire, a
    /// display named `domicile-0` — the one output that follows the window.
    /// Not an empty `displays` list: an empty list is a desktop of *no*
    /// screens, and a chrome told one would lay out against nothing.
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
        // a layout. A display whose own far corner does not fit is an error
        // about *that display*, and running this first would answer it with
        // "the displays span N across" — which is a fact about a pair, and so
        // names the wrong display when one of the pair is the one at fault.
        //
        // Only observable with two or more: a lone display's extent is its own
        // size, which `DisplayConfig::validate` bounds first anyway.
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
    pub compositor: CompositorConfig,
    pub input: InputConfig,
    pub output: OutputConfig,
}

impl Config {
    /// Parse a config from JSON text, applying defaults and validating it.
    ///
    /// JSON rather than TOML because nobody writes this by hand: a shell owns
    /// the configuration a *person* edits, and generates this from it. TOML is
    /// a format for human authors; the one thing this file needs is a writer
    /// on the other side that cannot get the escaping wrong.
    pub fn parse(text: &str) -> Result<Config, ConfigError> {
        // `to_string` keeps serde_json's line and column, which is the
        // actionable half of the complaint — and the reader is the shell
        // author, debugging the config their own code emitted.
        let config: Config =
            serde_json::from_str(text).map_err(|e| ConfigError::Parse(e.to_string()))?;
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
        // The nested desktop's mode, for the same reason a described display's
        // is checked: with no displays configured the desktop is
        // `nested_size` and its scale climbs to `max_scale`, so those two
        // multiply into physical pixels that have to be a coordinate. Neither
        // is wrong alone, which is why the check is on the product and the
        // message names both.
        //
        // Unconditional, though a config that describes displays never reaches
        // either setting: a config is checked for what it says, not for which
        // of it this run happens to use, so adding a display does not quietly
        // legalise a nested size that was rejected a moment ago.
        // `u64` for the same reason as a display's: two `u32`s multiply past
        // `i64::MAX`, so an `i64` product panics in debug and wraps in
        // release — and a wrapped one lands back under the bound, which turns
        // this check into the thing that admits what it exists to reject. A
        // panic here would also break `ConfigStore`'s guarantee that a bad
        // config can never take the compositor down.
        let widest = u64::from(w) * u64::from(self.output.max_scale);
        let tallest = u64::from(h) * u64::from(self.output.max_scale);
        let reach = u64::try_from(i32::MAX).expect("`i32::MAX` is positive");
        if widest > reach || tallest > reach {
            return Err(ConfigError::Validation(format!(
                "compositor.nested_size {w}x{h} at output.max_scale {} is a \
                 mode of {widest}x{tallest} — more pixels across or down than \
                 a coordinate can describe",
                self.output.max_scale
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

    /// Attempt to replace the live config from JSON text.
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
/// **Keep the whole `ConfigWatcher` for as long as you read `rx`.** The OS
/// watcher is the field beside it and owns the sending half, so dropping the
/// struct closes the channel: `recv` then returns `Err` rather than blocking,
/// which reads as a file nobody is editing rather than as a watcher nobody
/// kept — no error, no event, nothing to find.
///
/// Easier to do by accident than it looks, and it has been done twice here. A
/// `move` closure in edition 2021 captures the *fields* it names, so both
/// `thread::spawn(move || … watcher.rx.recv() …)` and
/// `thread::spawn(move || for r in watcher.rx …)` take the receiver alone and
/// leave the watcher to be dropped where it stood. Name the whole struct
/// inside the closure — `let watcher = watcher;` — to move it in.
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
