//! Reads screen brightness from `/sys/class/backlight`.
//!
//! Writing needs root, so the compositor asks logind to set the raw value
//! from [`Backlight::raw_for`]. Tests implement [`Backlights`] with a map.

use std::path::Path;

/// Sysfs directory listing every backlight.
const BACKLIGHT: &str = "/sys/class/backlight";

/// Backlight types, preferred first, in systemd's order. A firmware interface
/// knows the panel's curve; a raw one drives the same panel without it.
const KINDS: &[&str] = &["firmware", "platform", "raw"];

/// The uevent field for the backlight subsystem, matched whole.
const BACKLIGHT_SUBSYSTEM: &[u8] = b"SUBSYSTEM=backlight";

/// Whether a uevent datagram concerns a backlight, meaning `/sys` should be
/// read again.
///
/// The contents are not trusted. Any write through `/sys`, including logind's
/// and a brightness key's, sends one, so the slider tracks every change.
pub fn announces_a_backlight(datagram: &[u8]) -> bool {
    datagram
        .split(|byte| *byte == 0)
        .any(|field| field == BACKLIGHT_SUBSYSTEM)
}

/// One backlight device's current and maximum raw brightness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backlight {
    /// The device name under `/sys/class/backlight`, passed to logind.
    pub device: String,
    pub raw: u32,
    pub max: u32,
}

impl Backlight {
    /// Brightness from 0.0 to 1.0.
    pub fn level(&self) -> f64 {
        f64::from(self.raw) / f64::from(self.max)
    }

    /// The raw value for `level`, clamped to 0.0..=1.0, or `None` if `level`
    /// is not finite.
    ///
    /// Never returns zero: most panels turn off at zero, leaving no visible
    /// slider to raise it again.
    pub fn raw_for(&self, level: f64) -> Option<u32> {
        level.is_finite().then(|| {
            let raw = (level.clamp(0.0, 1.0) * f64::from(self.max)).round() as u32;
            raw.max(1)
        })
    }
}

/// Access to backlight devices, so reading can be tested without `/sys`.
pub trait Backlights {
    /// Every device name.
    fn devices(&self) -> Vec<String>;

    /// One file of `device`, trimmed, or `None` if it cannot be read.
    fn read(&self, device: &str, name: &str) -> Option<String>;
}

/// Backlights from the real `/sys`.
pub struct RealBacklights;

impl Backlights for RealBacklights {
    /// Empty when the class directory is missing, as on a machine with no
    /// backlight.
    fn devices(&self) -> Vec<String> {
        std::fs::read_dir(BACKLIGHT)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn read(&self, device: &str, name: &str) -> Option<String> {
        std::fs::read_to_string(Path::new(BACKLIGHT).join(device).join(name))
            .ok()
            .map(|value| value.trim().to_string())
    }
}

/// The backlight to show and set, or `None` if there is none.
///
/// Picks the preferred type, breaking ties by name so the choice is stable.
/// Skips devices with a missing or zero `max_brightness`.
pub fn reading(backlights: &impl Backlights) -> Option<Backlight> {
    let mut devices = backlights.devices();
    devices.sort();
    KINDS.iter().find_map(|kind| {
        devices
            .iter()
            .filter(|device| backlights.read(device, "type").as_deref() == Some(*kind))
            .find_map(|device| read_one(device, backlights))
    })
}

fn read_one(device: &str, backlights: &impl Backlights) -> Option<Backlight> {
    let max: u32 = backlights.read(device, "max_brightness")?.parse().ok()?;
    let raw: u32 = backlights.read(device, "brightness")?.parse().ok()?;
    (max > 0).then(|| Backlight {
        device: device.to_string(),
        raw: raw.min(max),
        max,
    })
}

/// The brightness last sent to the chromes.
///
/// Only a change of a whole percent is sent, since the slider shows no finer.
/// The value sent is still the unrounded fraction.
#[derive(Debug, Default)]
pub struct Brightness(Option<f64>);

impl Brightness {
    /// The level to broadcast, or `None` if the chromes already have it.
    ///
    /// A `None` reading is never sent but is recorded, so a backlight that
    /// reappears is broadcast.
    pub fn moved_to(&mut self, now: Option<f64>) -> Option<f64> {
        if shown(self.0) == shown(now) {
            None
        } else {
            self.0 = now;
            now
        }
    }

    /// The level to send a newly connected chrome.
    pub fn again(&self) -> Option<f64> {
        self.0
    }
}

fn shown(level: Option<f64>) -> Option<i64> {
    level.map(|level| (level * 100.0).round() as i64)
}
