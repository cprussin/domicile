//! Domicile compositor configuration.
//!
//! - [`Config`] is the schema. [`Config::parse`] applies defaults, expands `~`
//!   against `HOME` and validates.
//! - [`ConfigStore`] holds the live config. A failed reload keeps the last
//!   good config and records the error.
//! - Each type derives `schemars::JsonSchema`. `examples/schema.rs` prints the
//!   schema the SDK ships as `config.schema.json`. Doc comments on config
//!   types become its descriptions, which config authors read, so notes about
//!   this crate's code are `//` comments.
//!
//! The shell generates this JSON file; people do not edit it. See
//! `docs/SHELL-CONFIG.md`.

mod desktop;
mod files;
mod profile;
mod startup;

pub use desktop::{Desktop, Display};
pub use files::{FilesConfig, Omit};
pub use profile::{Connected, Desk, DisplayPlacement, Layout, Placed, Profile, Scanout, Transform};
pub use startup::StartupConfig;

use std::path::{Path, PathBuf};
use std::time::Duration;

use schemars::JsonSchema;
use serde::Deserialize;

/// An error loading a config.
///
/// Holds rendered messages, so it is `Clone + PartialEq` and can be stored on
/// [`ConfigStore`] and compared in tests.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("could not read config file {path}: {message}")]
    Io { path: String, message: String },

    /// An error in a config file, with the file's path.
    ///
    /// A machine can have several configs, so the path says which one failed.
    #[error("the config at {path} could not be loaded:\n{why}")]
    At { path: String, why: Box<ConfigError> },

    #[error("invalid config syntax: {0}")]
    Parse(String),

    #[error("invalid config: {0}")]
    Validation(String),
}

/// Keyboard settings, named after SwayWM's `xkb_*` options.
///
/// The string fields go to xkb verbatim, so sway's multi-layout form
/// (`xkb_layout = "us,de"`) works. Empty `xkb_rules` and `xkb_model` use the
/// libxkbcommon defaults. The default layout is `us`.
// `PartialEq` lets a reload detect a change; see the compositor's
// `Restatement`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
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
            // `validate` refuses an empty layout: xkb would fall back to a
            // build-time default this crate cannot name.
            xkb_layout: "us".into(),
            xkb_variant: String::new(),
            xkb_options: Vec::new(),
        }
    }
}

impl KeyboardConfig {
    /// The options joined with commas, as xkb expects.
    ///
    /// An empty list yields `""`, which xkb reads as "no options".
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
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct InputConfig {
    pub keyboard: KeyboardConfig,
}

/// One display, described in the config rather than discovered.
///
/// A nested compositor has no monitors to enumerate. Each display becomes a
/// `wl_output` and a region of the chrome page, which the shell addresses by
/// `name`. `position` and `size` are logical units.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DisplayConfig {
    /// The name the chrome and the compositor use for this display.
    ///
    /// Matched exactly, so a name padded with whitespace is rejected.
    pub name: String,
    /// The top-left corner in the config's coordinate space.
    ///
    /// May be negative.
    // [`Desktop`] normalizes it; these values do not leave this crate.
    #[serde(default)]
    pub position: (i32, i32),
    /// The `wl_output` scale for clients on this display.
    ///
    /// `output.max_scale` does not apply to described displays.
    #[serde(default = "one")]
    pub scale: u32,
    /// Width and height in logical units. The `wl_output` mode is this times
    /// `scale`.
    pub size: (u32, u32),
}

fn one() -> u32 {
    1
}

impl DisplayConfig {
    /// Whether this display and `other` overlap.
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
        // Width times scale can exceed `i32` even when each fits. Check it
        // here: the Smithay backend builds the mode unchecked and would wrap
        // in release.
        //
        // Multiply in `u64`: two `u32`s can overflow `i64`, and a panic here
        // would let a bad config crash the compositor.
        //
        // Scale is at least 1, so this also bounds the logical size, which
        // `Desktop` asserts when it normalizes.
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

/// One display's half-open extent along one axis, in the config's space.
///
/// Widened to `i64` so a far end past `i32` does not wrap;
/// [`DisplayConfig::validate`] rejects it.
fn span(start: i32, length: u32) -> (i64, i64) {
    (i64::from(start), i64::from(start) + i64::from(length))
}

/// Whether two half-open spans intersect.
///
/// Spans that share an endpoint are adjacent, not overlapping.
fn overlap((start, end): (i64, i64), (other_start, other_end): (i64, i64)) -> bool {
    start < other_end && other_start < end
}

/// Output settings.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct OutputConfig {
    /// The displays that make up the desktop.
    ///
    /// Empty means one output sized to Domicile's own window.
    pub displays: Vec<DisplayConfig>,
    /// The highest `wl_output` scale to advertise.
    ///
    /// Limits cost: a client at scale N renders N² times the pixels. `1` turns
    /// scaling off. Applies only while `displays` is empty.
    pub max_scale: u32,
    /// Placements for real monitors, matched against what is connected.
    ///
    /// Re-read on every hotplug. Empty leaves the monitors where the engine
    /// placed them. See `docs/DISPLAYS.md#profiles`.
    // Matched by [`OutputConfig::layout`].
    pub profiles: Vec<Profile>,
}

impl Default for OutputConfig {
    fn default() -> Self {
        // 2 covers a typical HiDPI laptop. Higher scales cost more than they
        // improve.
        OutputConfig {
            displays: Vec::new(),
            max_scale: 2,
            profiles: Vec::new(),
        }
    }
}

impl OutputConfig {
    /// The desktop these displays make up, shifted so its top-left corner is
    /// the origin.
    ///
    /// `None` when no displays are configured. The compositor then uses one
    /// output, `domicile-0`, that follows its window. An empty desktop would
    /// give the chrome nothing to lay out against.
    ///
    /// Rebuilt on each call; keep it off frame paths.
    pub fn desktop(&self) -> Option<Desktop> {
        Desktop::of(&self.displays)
    }

    /// The first profile matching `connected`, applied to those monitors.
    ///
    /// `Ok(None)` means no profile matches, and the monitors stay where the
    /// engine placed them. `Err` means the matched profile cannot apply: a
    /// mode mismatch, a scale that leaves no logical pixels, or a placement
    /// too large for a desktop. These depend on the monitor's mode, so parsing
    /// cannot catch them.
    ///
    /// Called on each hotplug.
    pub fn layout(&self, connected: &[Connected]) -> Result<Option<Layout>, ConfigError> {
        profile::layout(&self.profiles, connected)
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
        // Run last: a per-display error names the faulty display, while this
        // check can only name a pair.
        self.validate_extent()?;
        profile::validate(&self.profiles)
    }

    /// Whether the displays together fit in `i32` coordinates.
    ///
    /// Each display fitting is not enough: two can be four billion apart.
    /// `Desktop::of` subtracts corners to normalize positions and would
    /// overflow. A single display is already bounded by
    /// `DisplayConfig::validate`, so the error always names two displays.
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

/// One axis of the desktop, for the extent check.
#[derive(Debug, Clone, Copy)]
enum Axis {
    Horizontal,
    Vertical,
}

impl Axis {
    /// The display's near edge along the axis, in the config's space.
    fn near(self, display: &DisplayConfig) -> i32 {
        match self {
            Axis::Horizontal => display.position.0,
            Axis::Vertical => display.position.1,
        }
    }

    /// The display's far edge along the axis, widened because it can exceed
    /// `i32`.
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

/// When an idle desktop turns its screens off.
///
/// Absent means never, and that is the default: a blank screen looks like a
/// crash, so a shell must opt in. When `lock` sets a verifier,
/// blanking also locks the desk. See `docs/IDLE.md`.
///
/// The unit is in the key name because a generator writes this file.
// `PartialEq` lets a reload detect a change; see the compositor's
// `Restatement`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct IdleConfig {
    /// Seconds without input before the screens go dark.
    ///
    /// Absent means never. Zero is refused.
    pub blank_after_seconds: Option<u64>,
}

impl IdleConfig {
    /// How long the desktop goes without input before it blanks, or `None`
    /// for never.
    pub fn blank_after(&self) -> Option<Duration> {
        self.blank_after_seconds.map(Duration::from_secs)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.blank_after_seconds == Some(0) {
            return Err(ConfigError::Validation(
                "idle.blank_after_seconds must be at least 1 second; leave the key out \
                 for a desktop whose screens never blank"
                    .into(),
            ));
        }
        Ok(())
    }
}

/// What unlocks this desk.
///
/// Absent means the desk never locks, and that is the default: a locked desk
/// with no verifier cannot be unlocked. Such a desk never sends
/// `HostMessage::Locked`.
///
/// Set one verifier:
/// - `pam_service` authenticates the desk's user against a PAM service.
/// - `passphrase` is for machines without a PAM service. The file is
///   generated, often into the world-readable Nix store, so any user can read
///   it.
///
/// A config with both is refused, so a passphrase is never mistaken for a PAM
/// fallback. A PAM service that does not exist stops the compositor from
/// starting. See `docs/LOCK.md#verifiers`.
// `PartialEq` lets a reload detect a change; see the compositor's
// `Restatement`.
#[derive(Clone, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct LockConfig {
    /// A passphrase that unlocks this desk. An empty string is refused.
    // The `Debug` impl below redacts it. It is `pub` so
    // `scripts/test-the-home-manager-module-agrees.sh` can check that this
    // struct accepts every key the home-manager module writes.
    pub passphrase: Option<String>,
    /// The PAM service the desk's user authenticates against.
    ///
    /// The system must declare it in `/etc/pam.d/`; on NixOS,
    /// `security.pam.services.<name> = {};`. The docs use `"domicile"`.
    pub pam_service: Option<String>,
}

/// The verifier a desk configured.
///
/// Borrows from the config so the passphrase is not copied.
#[derive(PartialEq, Eq)]
pub enum LockVerifier<'a> {
    /// `lock.passphrase`: compared with what the user types.
    Passphrase(&'a str),
    /// `lock.pam_service`: the desk's user, authenticated by PAM against this
    /// service.
    Pam { service: &'a str },
}

impl LockConfig {
    /// What opens this desk, or `None` for one that never locks.
    pub fn verifier(&self) -> Option<LockVerifier<'_>> {
        match (self.passphrase.as_deref(), self.pam_service.as_deref()) {
            (None, None) => None,
            (Some(passphrase), None) => Some(LockVerifier::Passphrase(passphrase)),
            (None, Some(service)) => Some(LockVerifier::Pam { service }),
            (Some(_), Some(_)) => {
                unreachable!("validate refuses a [lock] that states both verifiers")
            }
        }
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.passphrase.as_deref() == Some("") {
            return Err(ConfigError::Validation(
                "lock.passphrase must not be empty; leave the key out for a desktop that \
                 never locks"
                    .into(),
            ));
        }
        if self.pam_service.as_deref() == Some("") {
            return Err(ConfigError::Validation(
                "lock.pam_service must not be empty; name the PAM service this desk \
                 authenticates against, or leave the key out"
                    .into(),
            ));
        }
        if self.passphrase.is_some() && self.pam_service.is_some() {
            return Err(ConfigError::Validation(
                "lock.passphrase and lock.pam_service are two ways to open this desk and \
                 it takes one; neither is a fallback for the other"
                    .into(),
            ));
        }
        Ok(())
    }
}

/// Redacts the passphrase.
///
/// The redaction lives on the type because `Config`'s derived `Debug` and the
/// compositor's `Restatement` both print it. `domicile_protocol::Passphrase`
/// does the same on the wire.
impl std::fmt::Debug for LockConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LockConfig")
            .field(
                "passphrase",
                &self.passphrase.as_ref().map(|_| "<redacted>"),
            )
            .field("pam_service", &self.pam_service)
            .finish()
    }
}

/// Redacts the passphrase, as [`LockConfig`]'s `Debug` does.
impl std::fmt::Debug for LockVerifier<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LockVerifier::Passphrase(_) => f.write_str("Passphrase(<redacted>)"),
            LockVerifier::Pam { service } => {
                f.debug_struct("Pam").field("service", service).finish()
            }
        }
    }
}

/// Whether the desktop is drawn dark or light.
///
/// There is no "follow the system" option: the chrome is the system, so there
/// is nothing to follow. Clients follow this value through the settings
/// portal; see the compositor's `portals::settings`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeMode {
    /// Light text on a dark background, which the chrome is designed for.
    #[default]
    Dark,
    /// Dark text on a light background.
    Light,
}

/// How the desktop is themed.
///
/// Clients read every field but `mode` through the settings portal; see the
/// compositor's `portals::settings`.
// `PartialEq` lets a reload detect a change; see the compositor's
// `Restatement`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct ThemeConfig {
    pub mode: ThemeMode,
    /// The color clients highlight with, or their own when unset.
    pub accent_color: Option<AccentColor>,
    pub contrast: Contrast,
    /// Asks clients to keep animation to a minimum.
    pub reduced_motion: bool,
    /// The freedesktop icon theme's directory name, such as `Papirus-Dark`.
    /// Unset leaves shells with `hicolor`.
    pub icon_theme: Option<String>,
}

impl ThemeConfig {
    fn validate(&self) -> Result<(), ConfigError> {
        // A theme is a directory under each `icons` directory.
        match self
            .icon_theme
            .as_deref()
            .filter(|name| matches!(*name, "" | "." | "..") || name.contains('/'))
        {
            Some(name) => Err(ConfigError::Validation(format!(
                "theme.icon_theme {name:?} is not an icon theme's directory name"
            ))),
            None => Ok(()),
        }
    }
}

/// An sRGB color, written `"#rrggbb"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(try_from = "String")]
#[schemars(schema_with = "accent_color_schema")]
pub struct AccentColor(pub [u8; 3]);

impl TryFrom<String> for AccentColor {
    type Error = String;

    fn try_from(written: String) -> Result<Self, String> {
        let not_a_color = || format!("{written:?} is not a color written \"#rrggbb\"");
        let digits = written
            .strip_prefix('#')
            .filter(|digits| digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(not_a_color)?;
        let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).expect("hex digits");
        Ok(AccentColor([channel(0), channel(2), channel(4)]))
    }
}

/// The written form `AccentColor::try_from` accepts.
fn accent_color_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({
        "type": "string",
        "pattern": "^#[0-9a-fA-F]{6}$",
    })
}

/// How strongly clients set text and edges apart from their background.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Contrast {
    #[default]
    Normal,
    High,
}

/// Chrome extensions the engine installs into the browser windows' profile.
/// See `docs/architecture/EXTENSIONS.md`.
///
/// Listing an extension is consent: there is no install prompt. Removing one
/// from the list uninstalls it.
// `PartialEq` lets a reload detect a change; see the compositor's
// `Restatement`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct ExtensionsConfig {
    /// Chrome Web Store ids, installed from the Store and updated from it.
    pub web_store: Vec<String>,
    /// Directories holding an unpacked extension, loaded as they are.
    pub unpacked: Vec<PathBuf>,
}

impl ExtensionsConfig {
    fn validate(&self) -> Result<(), ConfigError> {
        // Store ids are 32 letters from `a` to `p`. Checking here names the
        // config file; the Store would fail later, in a log.
        if let Some(id) = self
            .web_store
            .iter()
            .find(|id| id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
        {
            return Err(ConfigError::Validation(format!(
                "extensions.web_store {id:?} is not a Chrome Web Store id, which is \
                 32 letters from `a` to `p`"
            )));
        }
        // A relative path would depend on the compositor's working directory.
        match self.unpacked.iter().find(|path| !path.is_absolute()) {
            Some(path) => Err(ConfigError::Validation(format!(
                "extensions.unpacked {:?} is not an absolute path, or one under `~`",
                path.display().to_string()
            ))),
            None => Ok(()),
        }
    }

    /// These extensions, with a leading `~` in `unpacked` expanded to `home`.
    ///
    /// The browser does not expand `~`. Only `~` and `~/` expand, as in
    /// `domicile`'s own argument; `~alice` is refused.
    fn at_home(self, home: Option<&Path>) -> Result<ExtensionsConfig, ConfigError> {
        self.unpacked
            .into_iter()
            .map(|path| under_home(path, home))
            .collect::<Result<_, _>>()
            .map(|unpacked| ExtensionsConfig { unpacked, ..self })
    }
}

/// `path` with a leading `~` component replaced by `home`.
fn under_home(path: PathBuf, home: Option<&Path>) -> Result<PathBuf, ConfigError> {
    match (path.strip_prefix("~"), home) {
        // Collecting the components drops the trailing `/` from a bare `~`.
        (Ok(rest), Some(home)) => Ok(home.join(rest).components().collect()),
        (Ok(_), None) => Err(ConfigError::Validation(format!(
            "extensions.unpacked {:?} starts at a home directory and HOME is not \
             set, so there is nowhere for it to start",
            path.display().to_string()
        ))),
        (Err(_), _) if path.to_string_lossy().starts_with('~') => {
            Err(ConfigError::Validation(format!(
                "extensions.unpacked {:?} is under another user's home, which is not \
                 expanded; only `~` and `~/` are, so write that home out",
                path.display().to_string()
            )))
        }
        (Err(_), _) => Ok(path),
    }
}

/// What applications are told not to do, through the
/// `org.freedesktop.impl.portal.Lockdown` portal. Every switch defaults to
/// off.
///
/// Applications enforce these themselves; the compositor only reports them.
/// See `docs/SHELL-CONFIG.md#lockdown`.
// `PartialEq` lets a reload detect a change; see the compositor's
// `Restatement`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct LockdownConfig {
    pub disable_printing: bool,
    pub disable_save_to_disk: bool,
    pub disable_application_handlers: bool,
    pub disable_location: bool,
    pub disable_camera: bool,
    pub disable_microphone: bool,
    pub disable_sound_output: bool,
}

/// The full compositor configuration.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub extensions: ExtensionsConfig,
    pub files: FilesConfig,
    pub idle: IdleConfig,
    pub input: InputConfig,
    pub lock: LockConfig,
    pub lockdown: LockdownConfig,
    pub output: OutputConfig,
    pub startup: StartupConfig,
    pub theme: ThemeConfig,
    /// The shell `domicile` runs when given none: a path or a package, as
    /// `domicile load-shell` takes. The compositor ignores it.
    pub shell: Option<String>,
    /// Where editors find this file's JSON Schema. Domicile ignores it.
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
}

impl Config {
    /// Parse a config from JSON text, applying defaults and validating it.
    pub fn parse(text: &str) -> Result<Config, ConfigError> {
        Config::parse_at_home(text, home_directory().as_deref())
    }

    /// [`Config::parse`], with the home directory given rather than read.
    fn parse_at_home(text: &str, home: Option<&Path>) -> Result<Config, ConfigError> {
        // `to_string` keeps serde_json's line, column and key name.
        let parsed: Config =
            serde_json::from_str(text).map_err(|e| ConfigError::Parse(e.to_string()))?;
        Config::settled(parsed, home)
    }

    /// A config as it was written, with its paths taken from `home` and
    /// validated.
    fn settled(parsed: Config, home: Option<&Path>) -> Result<Config, ConfigError> {
        parsed.extensions.at_home(home).and_then(|extensions| {
            let config = Config {
                extensions,
                ..parsed
            };
            config.validate().map(|()| config)
        })
    }

    /// Read and parse a config from a file.
    pub fn load(path: impl AsRef<Path>) -> Result<Config, ConfigError> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path).map_err(|e| ConfigError::Io {
            path: path.display().to_string(),
            message: e.to_string(),
        })?;
        // Add the path to parse errors; the read error above already has it.
        Config::parse(&text).map_err(|why| ConfigError::At {
            path: path.display().to_string(),
            why: Box::new(why),
        })
    }

    /// Validation the deserializer cannot express.
    fn validate(&self) -> Result<(), ConfigError> {
        self.extensions.validate()?;
        self.idle.validate()?;
        self.input.keyboard.validate()?;
        self.lock.validate()?;
        self.startup.validate()?;
        self.theme.validate()?;
        self.output.validate()
    }
}

/// The home directory `~` expands to: `HOME`, which the compositor also
/// indexes for the launcher.
fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Holds the live configuration and applies hot-reloads.
///
/// A reload replaces the live config only when the new one is valid.
/// Otherwise the previous config stays and the error is kept in
/// [`last_error`](ConfigStore::last_error), so a bad write cannot crash the
/// compositor.
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

/// Watches a config file and sends a parsed [`Config`] or [`ConfigError`] on
/// `rx` after each change. Pass the results to [`ConfigStore::apply_watch`].
///
/// Keep the whole struct alive while reading `rx`. The OS watcher owns the
/// sender, so dropping it closes the channel and `recv` returns `Err` with no
/// other sign. In edition 2021 a `move` closure that names `watcher.rx`
/// captures only that field; write `let watcher = watcher;` inside the closure
/// to move the whole struct.
pub struct ConfigWatcher {
    _watcher: notify::RecommendedWatcher,
    pub rx: std::sync::mpsc::Receiver<Result<Config, ConfigError>>,
}

/// Begin watching `path` for changes.
pub fn watch(path: impl AsRef<Path>) -> Result<ConfigWatcher, ConfigError> {
    use notify::Watcher;

    let path = path.as_ref().to_path_buf();
    // Watch the parent directory: editors often save by atomic rename, which
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

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{Config, ConfigError};

    const HOME: &str = "/home/you";

    fn unpacked(path: &str, home: Option<&Path>) -> Result<Vec<PathBuf>, ConfigError> {
        Config::parse_at_home(
            &format!(r#"{{ "extensions": {{ "unpacked": [{path:?}] }} }}"#),
            home,
        )
        .map(|config| config.extensions.unpacked)
    }

    #[test]
    fn a_tilde_in_an_unpacked_extension_is_the_home_directory() {
        for (written, meant) in [
            ("~/src/my-extension", "/home/you/src/my-extension"),
            ("~", "/home/you"),
        ] {
            assert_eq!(
                unpacked(written, Some(Path::new(HOME))),
                Ok(vec![PathBuf::from(meant)]),
                "{written}"
            );
        }
    }

    #[test]
    fn refuses_a_tilde_with_no_home_to_stand_for() {
        let err = unpacked("~/src/my-extension", None).unwrap_err();
        let ConfigError::Validation(message) = &err else {
            panic!("got {err:?}");
        };
        assert!(message.contains("~/src/my-extension"), "{message}");
        assert!(message.contains("HOME"), "{message}");
    }
}
