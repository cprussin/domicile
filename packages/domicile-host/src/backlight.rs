//! The screen's brightness, read where the kernel keeps it.
//!
//! Read off `/sys/class/backlight` like [`crate::battery`] reads the charge:
//! no daemon, no bus. Writing is another matter — those files are root's — so
//! the compositor asks logind, which lets a session's owner set its own
//! backlight, for the raw value [`Backlight::raw_for`] works out here.
//!
//! [`Backlights`] is the seam: the compositor passes [`RealBacklights`], the
//! tests pass a map.

use std::path::Path;

/// Where the kernel publishes every backlight.
const BACKLIGHT: &str = "/sys/class/backlight";

/// The kinds of backlight, best first — systemd's order. A firmware interface
/// knows the panel's curve; a raw one beside it is the same panel driven
/// around it.
const KINDS: &[&str] = &["firmware", "platform", "raw"];

/// The field the kernel names a backlight's subsystem with, matched whole like
/// [`crate::battery`]'s.
const BACKLIGHT_SUBSYSTEM: &[u8] = b"SUBSYSTEM=backlight";

/// Whether a uevent datagram is the kernel reporting a backlight.
///
/// A doorbell, for the battery's reason: nothing in it is believed, and what
/// it means is "read `/sys` again". A write through `/sys` — logind's, or a
/// brightness key's — sends one with `SOURCE=sysfs`, so the slider follows a
/// change made anywhere.
pub fn announces_a_backlight(datagram: &[u8]) -> bool {
    datagram
        .split(|byte| *byte == 0)
        .any(|field| field == BACKLIGHT_SUBSYSTEM)
}

/// One backlight, as the kernel reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backlight {
    /// The device's name under `/sys/class/backlight`, which is what logind
    /// is asked to write.
    pub device: String,
    pub raw: u32,
    pub max: u32,
}

impl Backlight {
    /// How bright, 0.0 through 1.0.
    pub fn level(&self) -> f64 {
        f64::from(self.raw) / f64::from(self.max)
    }

    /// The raw value for `level`, or `None` for one that is not a number.
    ///
    /// **Never zero.** On most panels that is a screen that is off, and a
    /// slider dragged to its end must not leave a desk nobody can see to drag
    /// it back. A level past either end is the end.
    pub fn raw_for(&self, level: f64) -> Option<u32> {
        level.is_finite().then(|| {
            let raw = (level.clamp(0.0, 1.0) * f64::from(self.max)).round() as u32;
            raw.max(1)
        })
    }
}

/// The machine's backlights, so the reading can be tested without a `/sys`.
pub trait Backlights {
    /// Every device's name.
    fn devices(&self) -> Vec<String>;

    /// One file of one device, whitespace trimmed, or `None` when it is not
    /// there to read.
    fn read(&self, device: &str, name: &str) -> Option<String>;
}

/// The machine this compositor is running on.
pub struct RealBacklights;

impl Backlights for RealBacklights {
    /// Nothing at all when the class is not there: a machine with no
    /// backlight has nothing to report, which [`reading`] turns into no
    /// message.
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

/// The backlight to show and set, or `None` for a machine with none.
///
/// One device, the best kind there is, ties broken by name so the choice is
/// the same on every read. A device that reports no `max_brightness`, or zero,
/// cannot say how bright it is and is passed over.
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

/// What the chromes have been told about the brightness.
///
/// **News is a whole percent**, the resolution the slider's figures are drawn
/// at — [`crate::battery::Charge`]'s rule. What goes out is still the
/// fraction, rounded where it is drawn.
#[derive(Debug, Default)]
pub struct Brightness(Option<f64>);

impl Brightness {
    /// The level to broadcast now, or `None` when the chromes already have
    /// it. `now` is `None` for a machine with no backlight, which is never a
    /// message but is recorded, so a backlight that comes back is news.
    pub fn moved_to(&mut self, now: Option<f64>) -> Option<f64> {
        if shown(self.0) == shown(now) {
            None
        } else {
            self.0 = now;
            now
        }
    }

    /// The level to send a chrome that has just connected.
    pub fn again(&self) -> Option<f64> {
        self.0
    }
}

fn shown(level: Option<f64>) -> Option<i64> {
    level.map(|level| (level * 100.0).round() as i64)
}
