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
//! shell-to-compositor interface rather than a user interface, and it is TOML.
//!
//! The compositor watches the file and feeds new contents into a
//! [`ConfigStore`]; the store is the single source of truth for the live
//! configuration. All of this is pure logic and unit-tested.

mod desktop;
mod files;
mod profile;

pub use desktop::{Desktop, Display};
pub use files::{FilesConfig, Omit};
pub use profile::{Connected, DisplayPlacement, Layout, Placed, Profile, Scanout, Transform};

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

/// Everything that can go wrong loading a config.
///
/// Deliberately `Clone + PartialEq` (it holds rendered messages, not opaque
/// source errors) so it can be stored on [`ConfigStore`] and asserted in tests.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("could not read config file {path}: {message}")]
    Io { path: String, message: String },

    /// A config that was read from a file, and the file it came from.
    ///
    /// [`Config::parse`] is given text and has no file to name; [`Config::load`]
    /// has one, so the path goes on here rather than into every message
    /// underneath. Without it only [`ConfigError::Io`] said which config it was
    /// about, and a machine has more than one: the shell's generated file, the
    /// one a `--config` flag names, whatever is under `$XDG_CONFIG_HOME`. A
    /// complaint about a key that names none of them is a hunt.
    #[error("the config at {path} could not be loaded:\n{why}")]
    At { path: String, why: Box<ConfigError> },

    #[error("invalid config syntax: {0}")]
    Parse(String),

    #[error("invalid config: {0}")]
    Validation(String),
}

/// Keyboard settings, named after the `xkb_*` options SwayWM accepts.
///
/// `xkb_rules`, `xkb_model`, `xkb_layout` and `xkb_variant` are handed to xkb
/// verbatim, so sway's comma-separated multi-layout form (`xkb_layout =
/// "us,de"` with `xkb_variant = "dvp,"`) works here too. Empty `xkb_rules` /
/// `xkb_model` mean "whatever libxkbcommon defaults to". `xkb_options` is a
/// list rather than a comma-separated string because the format has one; it
/// carries the common keyswaps (`caps:swapescape`, `compose:ralt`, …).
///
/// **THE DEFAULTS ARE NOBODY'S KEYBOARD, WHICH IS THE POINT.** They were
/// Programmer's Dvorak with Caps Lock and Escape swapped, which is one
/// author's desk and a surprise on anybody else's: a user who configured
/// nothing got a layout they never asked for, and the only symptom is that
/// every key is wrong. A shell that wants a layout states one -- that is what
/// the config is for -- and a desk that states nothing gets the plain `us`
/// that saying nothing ought to mean.
///
/// Compared, which is what `PartialEq` is for: a reload asks what moved
/// between two configs, and the keyboard is one of the answers — see the
/// compositor's `Restatement`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
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
            // `us` rather than empty because `validate` refuses an empty
            // layout, and it refuses one because xkb's own fallback for it is
            // a build-time default this cannot see -- so a desktop would come
            // up on a layout nothing here could name. The variant and the
            // options have no such problem: empty is exactly "the layout as it
            // comes", which is what a desk that said nothing means.
            xkb_layout: "us".into(),
            xkb_variant: String::new(),
            xkb_options: Vec::new(),
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
    /// monitor. Not the desktop's space, which [`Desktop`] normalizes this
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
        // fits, which is the invariant `Desktop` asserts when it normalizes.
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
    /// N renders N² times the pixels — its own work, and the engine's to
    /// composite — so sharpness is bought in the square. `1` turns scaling off
    /// entirely.
    ///
    /// Governs the single output that follows Domicile's own window, and so
    /// applies only while [`displays`](OutputConfig::displays) is empty: a
    /// described display states its own `scale` and has no ratio to cap.
    pub max_scale: u32,
    /// The arrangements of *real* monitors, and what to do with each.
    ///
    /// The third way a desktop gets described, and the only one that is a
    /// function of the hardware: [`displays`](OutputConfig::displays) states a
    /// desktop outright and the nested size follows a window, while a profile
    /// states a placement and the monitor states its mode. So this is the one
    /// that is re-read on every hotplug — see [`OutputConfig::layout`].
    ///
    /// Empty is a config that says nothing about placement, which leaves the
    /// monitors wherever the engine's own reading put them.
    pub profiles: Vec<Profile>,
}

impl Default for OutputConfig {
    fn default() -> Self {
        // 2 covers the ordinary retina laptop, which is the display that makes
        // unscaled text look wrong; past that the frame gets expensive faster
        // than it gets better.
        OutputConfig {
            displays: Vec::new(),
            max_scale: 2,
            profiles: Vec::new(),
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
    /// That `None` becomes the compositor's own startup placeholder and, on
    /// the wire, a display named `domicile-0` — the one output that follows
    /// the window. Not an empty `displays` list: an empty list is a desktop of
    /// *no* screens, and a chrome told one would lay out against nothing.
    ///
    /// Rebuilt on each call, names and all. Fine for a list the config states
    /// once; not something to put on a frame path.
    pub fn desktop(&self) -> Option<Desktop> {
        Desktop::of(&self.displays)
    }

    /// The first profile `connected` is the set for, applied to them.
    ///
    /// `Ok(None)` is no profile matching, which is not an empty desktop but a
    /// config that says nothing about this arrangement of monitors — the
    /// displays then stay wherever the engine's own reading put them, which is
    /// the behavior that existed before profiles did.
    ///
    /// The `Err` arm is a matched profile that cannot be applied to the
    /// monitors it matched: a monitor that is not at the mode the profile
    /// states it is, a scale that leaves one with no logical pixels, or a
    /// placement that spans further than a desktop can. None is reachable at
    /// parse time, because each needs a mode that arrives with the monitor.
    ///
    /// Rebuilt on each call. That is the point rather than a cost: this is
    /// what a hotplug calls, and the answer is supposed to change.
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
        // Last, because it is the least specific thing that can be wrong with
        // a layout. A display whose own far corner does not fit is an error
        // about *that display*, and running this first would answer it with
        // "the displays span N across" — which is a fact about a pair, and so
        // names the wrong display when one of the pair is the one at fault.
        //
        // Only observable with two or more: a lone display's extent is its own
        // size, which `DisplayConfig::validate` bounds first anyway.
        self.validate_extent()?;
        profile::validate(&self.profiles)
    }

    /// Whether the displays together span a desktop that is a coordinate space.
    ///
    /// Only ever two *different* displays: a lone one spans its own size,
    /// which `DisplayConfig::validate` has already bounded, so the message
    /// below can name a pair without ever naming one display twice.
    ///
    /// Each entry's own far corner fitting an `i32` is not enough: two that
    /// each fit can still be four billion apart. The desktop is placed about
    /// its own top-left corner, so a display's normalized position is the
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

/// When a desktop nobody is at turns its screens off.
///
/// **ABSENT IS NEVER, AND THAT IS THE DEFAULT.** A blank screen is
/// indistinguishable from a desktop that has died, and nothing warns a moment
/// before this one, so a desk whose shell never mentioned idle would go dark for
/// the first time on an upgrade it did not ask for, with no way to tell that
/// from a crash. A shell that wants the screens off says how long.
///
/// **It is also what locks a desk**, on a desktop that states a
/// [`LockConfig::passphrase`]: the dark edge is the only thing that locks one, so
/// a desk with no timeout here never locks whatever else it says.
///
/// Seconds, spelled in the name, because this file is generated: a unit that
/// has to be read out of a doc comment is one a generator gets wrong, and the
/// only alternative -- `"10m"` -- is a parser and a second way to be wrong
/// about what a config says.
///
/// Compared, which is what `PartialEq` is for: a reload asks what moved
/// between two configs, and when the screens go dark is one of the answers --
/// see the compositor's `Restatement`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct IdleConfig {
    /// How long the desktop goes untouched before its screens go dark.
    ///
    /// Absent is a desktop that never blanks. Zero is refused rather than
    /// read as either one -- see [`IdleConfig::validate`].
    pub blank_after_seconds: Option<u64>,
}

impl IdleConfig {
    /// How long a desktop goes untouched before it blanks, or `None` for one
    /// that never does.
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

/// What opens this desk once it has locked itself.
///
/// **ABSENT IS NEVER, AND THAT IS THE DEFAULT** — for the reason
/// [`IdleConfig`] above says nothing means never, and one that is not merely
/// conservative: a desk that locked with nothing to open it is a desk nobody
/// can get back into, and the way out would be another tty. So the lock is
/// opt-in, and a desk that states no verifier never locks and never sends
/// `HostMessage::Locked` at all.
///
/// **TWO VERIFIERS, AND A DESK STATES ONE OF THEM.** `pam_service` is the real
/// one: the desk's own user, authenticated against the PAM service it names —
/// the arrangement every other lock screen on Linux has, and the one whose
/// secret is not in this file. `passphrase` is the one that came first, and it
/// is a mechanism rather than a secret: this file is generated — on NixOS by
/// home-manager, into a world-readable store — so a passphrase written here is
/// readable by every process of every user on the machine. It stays because it
/// is what a desk on a machine with no PAM service for it can use, and because
/// removing it would change what an existing config means without a word.
///
/// **NEITHER IS A FALLBACK FOR THE OTHER.** A desk that states both is refused
/// by name rather than given one of them, because whichever was picked the
/// other would be a line that did nothing — and the dangerous reading is a
/// passphrase somebody believes stands in for PAM when PAM cannot run. A desk
/// that names a service PAM does not have does not come up at all; the
/// compositor says which service and what to declare.
///
/// Compared, which is what `PartialEq` is for: a reload asks what moved between
/// two configs, and whether this desk can lock is one of the answers -- see the
/// compositor's `Restatement`.
#[derive(Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LockConfig {
    /// A passphrase that opens this desk. The empty string is refused rather
    /// than read as "never locks" -- see [`LockConfig::validate`].
    ///
    /// **What keeps this out of a log is the `Debug` below and not its
    /// visibility.** Private would buy nothing here: `{:?}` on the struct
    /// holding it goes through that impl either way, and a caller that wanted
    /// the string would reach it through the accessor. It is `pub` like every
    /// other key in this file, which is also what lets
    /// `scripts/test-the-home-manager-module-agrees.sh` read it -- a key the
    /// module writes and this struct does not accept refuses the whole config
    /// file, so being readable by that comparison is worth more than a
    /// visibility that protects nothing.
    pub passphrase: Option<String>,
    /// The PAM service this desk's own user is authenticated against, which
    /// the system has to declare -- `/etc/pam.d/<this>`. On NixOS that is
    /// `security.pam.services.<this> = {};`, and `"domicile"` is the name the
    /// docs use.
    pub pam_service: Option<String>,
}

/// What a desk said opens it, once [`LockConfig::validate`] has made sure it
/// said at most one thing.
///
/// Borrowed from the config rather than copied out of it, so that asking which
/// verifier a desk has does not make another copy of a passphrase.
#[derive(PartialEq, Eq)]
pub enum LockVerifier<'a> {
    /// `lock.passphrase`: this string, compared.
    Passphrase(&'a str),
    /// `lock.pam_service`: the desk's own user, authenticated by PAM against
    /// this service.
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

/// Says whether there is a passphrase here and never what it is.
///
/// Derived `Debug` is what this struct exists to not have. It is reached by
/// `Config`'s own derive and by the compositor's `Restatement`, so the
/// redaction has to live on the type rather than at whichever call site
/// eventually prints one. `domicile_protocol::Passphrase` is the same decision
/// on the wire half.
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

/// The same redaction, for the same reason, on the value the compositor
/// chooses its verifier from.
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

/// Which way round the desktop is drawn: dark, or light.
///
/// **THERE IS NO THIRD ANSWER, AND THE MISSING ONE IS THE POINT.** Every other
/// desktop offers "follow the system" because it is a program running on one.
/// Domicile *is* the system: the chrome is the only thing on the screen that
/// is not a client, and there is nothing above it whose preference it could
/// follow. A `system` here would be the desktop deferring to itself, so the
/// word is refused rather than quietly read as one of the two — see
/// `rejects_a_theme_that_is_neither` in `tests/config.rs`.
///
/// It goes the other way instead: this is what the desktop's *clients* follow,
/// through the settings portal the compositor answers — see
/// `domicile_compositor::appearance`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeMode {
    /// Light text on a dark ground, which is what the chrome was drawn
    /// against and so what a desk that says nothing gets.
    #[default]
    Dark,
    Light,
}

/// How the desktop is themed.
///
/// One key today. A section of its own rather than a bare top-level `theme =`
/// because the theme is a subject rather than a setting — an accent color, a
/// wallpaper and a font all belong under this heading, and a scalar here would
/// have to become a table to admit the second of them.
///
/// Compared, which is what `PartialEq` is for: a reload asks what moved
/// between two configs, and the theme is one of the answers — see the
/// compositor's `Restatement`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ThemeConfig {
    pub mode: ThemeMode,
}

/// The full compositor configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub files: FilesConfig,
    pub idle: IdleConfig,
    pub input: InputConfig,
    pub lock: LockConfig,
    pub output: OutputConfig,
    pub theme: ThemeConfig,
}

impl Config {
    /// Parse a config from TOML text, applying defaults and validating it.
    ///
    /// **TOML BECAUSE IT IS READ, WHICH IS NOT WHAT THIS FILE WAS BUILT FOR.**
    /// It was JSON on the argument that nobody writes it by hand — a shell
    /// generates it, and a generated file wants a writer that cannot get the
    /// escaping wrong rather than a syntax that is pleasant to type. That
    /// reasoning was about the writer and there are two ends: a desk comes up
    /// in the wrong arrangement and somebody opens this file to find out why,
    /// and a desk of six monitors and five profiles is a wall of braces to
    /// read one `transform` out of. `[[output.profiles]]` says which profile a
    /// display belongs to on the line the display is on.
    ///
    /// The writer keeps what it had: every language that generates one of
    /// these has a TOML writer too — nixpkgs has `pkgs.formats.toml` beside
    /// the `json` this desk's own config used — so nothing gained a chance to
    /// get the escaping wrong.
    pub fn parse(text: &str) -> Result<Config, ConfigError> {
        // `to_string` keeps toml's line, column and the span it underlines,
        // which is the actionable half of the complaint — and more of it than
        // JSON gave, because a TOML error names the key it was reading.
        let config: Config = toml::from_str(text).map_err(|e| ConfigError::Parse(e.to_string()))?;
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
        // Not the read failure above, which names the path already.
        Config::parse(&text).map_err(|why| ConfigError::At {
            path: path.display().to_string(),
            why: Box::new(why),
        })
    }

    /// Semantic validation beyond what the type system / deserializer enforce.
    fn validate(&self) -> Result<(), ConfigError> {
        self.idle.validate()?;
        self.input.keyboard.validate()?;
        self.lock.validate()?;
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
