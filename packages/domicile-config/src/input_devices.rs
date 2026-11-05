//! Touchpad and relative mouse settings applied by the engine on a tty.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ConfigError;

/// Settings applied to every touchpad on a tty, including newly attached ones.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct TouchpadConfig {
    /// Tap to click.
    pub tap: bool,
    /// Buttons for one-, two- and three-finger taps.
    pub tap_button_map: ButtonMap,
    /// Drag by tapping, then holding a second tap.
    pub tap_drag: bool,
    /// Keep a tap drag held when the fingers lift briefly.
    pub drag_lock: bool,
    /// Move content in the direction the fingers move.
    pub natural_scroll: bool,
    pub accel_profile: AccelProfile,
    /// Pointer acceleration speed, from -1 to 1.
    #[schemars(range(min = -1.0, max = 1.0))]
    pub speed: f64,
    /// Physical click behavior; `default` uses the device's libinput default.
    /// Clickfinger uses left, right and middle for one, two and three fingers.
    pub click_method: ClickMethod,
    /// Emulate a middle click by pressing left and right together.
    pub middle_emulation: bool,
    /// Scrolling gesture; `default` uses the device's libinput default.
    pub scroll_method: ScrollMethod,
    /// Multiplier applied once to both scrolling axes; must be positive.
    #[schemars(schema_with = "scroll_factor_schema")]
    pub scroll_factor: f64,
    /// Increase scroll distance with gesture speed, up to four times.
    pub scroll_acceleration: bool,
    /// Typing suppression policy; `libinput` preserves native keyboard pairing and contacts.
    /// Custom `internal` excludes external pads; `enabled` includes every touchpad.
    pub disable_while_typing: DisableWhileTyping,
    /// Custom pause after one typing key; zero means no pause.
    /// Native `libinput` mode requires the default 200 and uses its own timers.
    #[schemars(range(max = 2147483647))]
    pub typing_pause_ms: u32,
    /// Custom pause during continued typing; zero means no pause.
    /// Native `libinput` mode requires the default 500 and uses its own timers.
    #[schemars(range(max = 2147483647))]
    pub typing_repeat_pause_ms: u32,
}

impl Default for TouchpadConfig {
    fn default() -> Self {
        Self {
            tap: true,
            tap_button_map: ButtonMap::Lrm,
            tap_drag: true,
            drag_lock: false,
            natural_scroll: false,
            accel_profile: AccelProfile::Adaptive,
            speed: 0.0,
            click_method: ClickMethod::Default,
            middle_emulation: false,
            scroll_method: ScrollMethod::Default,
            scroll_factor: 1.0,
            scroll_acceleration: true,
            disable_while_typing: DisableWhileTyping::Enabled,
            typing_pause_ms: 200,
            typing_repeat_pause_ms: 500,
        }
    }
}

impl TouchpadConfig {
    pub(crate) fn validate(&self) -> Result<(), ConfigError> {
        validate_motion("touchpad", self.speed, self.scroll_factor)?;
        for (name, milliseconds, default) in [
            ("typing_pause_ms", self.typing_pause_ms, 200),
            ("typing_repeat_pause_ms", self.typing_repeat_pause_ms, 500),
        ] {
            if milliseconds > i32::MAX as u32 {
                return Err(ConfigError::Validation(format!(
                    "input.touchpad.{name} must be at most {} milliseconds",
                    i32::MAX
                )));
            }
            if self.disable_while_typing == DisableWhileTyping::Libinput && milliseconds != default
            {
                return Err(ConfigError::Validation(format!(
                    "input.touchpad.{name} must remain {default} in libinput mode; native typing timers cannot be configured"
                )));
            }
        }
        Ok(())
    }
}

/// Settings applied to every relative mouse on a tty.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct MouseConfig {
    pub accel_profile: AccelProfile,
    /// Pointer acceleration speed, from -1 to 1.
    #[schemars(range(min = -1.0, max = 1.0))]
    pub speed: f64,
    /// Reverse the mouse wheel's scrolling direction.
    pub natural_scroll: bool,
    /// Emulate a middle click by pressing left and right together.
    pub middle_emulation: bool,
    /// Multiplier applied once to both scrolling axes; must be positive.
    #[schemars(schema_with = "scroll_factor_schema")]
    pub scroll_factor: f64,
}

impl Default for MouseConfig {
    fn default() -> Self {
        Self {
            accel_profile: AccelProfile::Adaptive,
            speed: 0.0,
            natural_scroll: false,
            middle_emulation: false,
            scroll_factor: 1.0,
        }
    }
}

impl MouseConfig {
    pub(crate) fn validate(&self) -> Result<(), ConfigError> {
        validate_motion("mouse", self.speed, self.scroll_factor)
    }
}

/// How movement speed affects pointer acceleration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AccelProfile {
    Adaptive,
    Flat,
}

/// Buttons assigned to one-, two- and three-finger taps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ButtonMap {
    Lrm,
    Lmr,
}

/// How a touchpad's physical button chooses a mouse button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClickMethod {
    Default,
    Clickfinger,
    ButtonAreas,
}

/// How a touchpad generates scrolling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScrollMethod {
    Default,
    TwoFinger,
    Edge,
    OnButtonDown,
}

/// How typing suppression selects touchpads and handles contacts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DisableWhileTyping {
    Enabled,
    Disabled,
    Internal,
    Libinput,
}

fn validate_motion(kind: &str, speed: f64, scroll_factor: f64) -> Result<(), ConfigError> {
    if !speed.is_finite() || !(-1.0..=1.0).contains(&speed) {
        return Err(ConfigError::Validation(format!(
            "input.{kind}.speed must be between -1 and 1"
        )));
    }
    if !scroll_factor.is_finite() || scroll_factor <= 0.0 {
        return Err(ConfigError::Validation(format!(
            "input.{kind}.scroll_factor must be finite and greater than 0"
        )));
    }
    Ok(())
}

fn scroll_factor_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({ "type": "number", "exclusiveMinimum": 0.0 })
}
