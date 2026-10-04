//! Reads battery charge from `/sys/class/power_supply`.
//!
//! Replaces `navigator.getBattery`, which needs UPower over D-Bus. Without
//! them, as on a bare tty, Chromium reports a full, charging battery. Tests
//! implement [`PowerSupplies`] with a map. See
//! `packages/shell-manganese/docs/HOST-READOUTS.md`.

use std::path::{Path, PathBuf};

/// Sysfs directory listing every battery and charger.
const POWER_SUPPLY: &str = "/sys/class/power_supply";

/// File pairs a battery may report its level in, preferred first.
///
/// `energy_*` is in watt-hours and `charge_*` in amp-hours, depending on the
/// driver. The ratio is unitless as long as both halves come from one pair.
const LEVELS: &[(&str, &str)] = &[("energy_now", "energy_full"), ("charge_now", "charge_full")];

/// The uevent field for the power supply subsystem. Matched whole, not by
/// prefix, so a future `power_supply_*` subsystem cannot match.
const POWER_SUPPLY_SUBSYSTEM: &[u8] = b"SUBSYSTEM=power_supply";

/// Whether a uevent datagram concerns a power supply, meaning [`reading`]
/// should run again.
///
/// The contents are not trusted: a forged datagram only costs a re-read of
/// `/sys`. The filter skips re-reading for unrelated devices.
///
/// Expects the kernel format from group 1 of `NETLINK_KOBJECT_UEVENT`:
/// NUL-separated fields, `ACTION@DEVPATH` then `KEY=VALUE`. udevd's messages
/// use another group and format; see `uevents.rs` in the compositor.
pub fn announces_a_power_supply(datagram: &[u8]) -> bool {
    datagram
        .split(|byte| *byte == 0)
        .any(|field| field == POWER_SUPPLY_SUBSYSTEM)
}

/// A battery reading.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    /// Charge from 0.0 to 1.0.
    pub charge: f64,
    /// Whether a charger is connected.
    pub charging: bool,
}

/// Access to power supplies, so reading can be tested without `/sys`.
pub trait PowerSupplies {
    /// Every supply, batteries and chargers alike. Each one's `type` file says
    /// which it is.
    fn supplies(&self) -> Vec<PathBuf>;

    /// One file of `supply`, trimmed, or `None` if absent. Which files exist
    /// varies by driver.
    fn read(&self, supply: &Path, name: &str) -> Option<String>;
}

/// Power supplies from the real `/sys`.
pub struct RealPowerSupplies;

impl PowerSupplies for RealPowerSupplies {
    /// Empty when the class directory is missing, which means no battery.
    fn supplies(&self) -> Vec<PathBuf> {
        std::fs::read_dir(POWER_SUPPLY)
            .map(|entries| {
                entries
                    .filter_map(|entry| Some(entry.ok()?.path()))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn read(&self, supply: &Path, name: &str) -> Option<String> {
        std::fs::read_to_string(supply.join(name))
            .ok()
            .map(|value| value.trim().to_string())
    }
}

/// The battery reading, or `None` if the machine has no battery. On `None`
/// the compositor sends nothing and the bar shows no meter.
pub fn reading(supplies: &impl PowerSupplies) -> Option<Reading> {
    let batteries: Vec<PathBuf> = supplies
        .supplies()
        .into_iter()
        .filter(|supply| is_a(supply, "Battery", supplies))
        .collect();
    Some(Reading {
        charge: charge(&batteries, supplies)?,
        charging: charging(&batteries, supplies),
    })
}

/// Combined charge of all batteries, from 0.0 to 1.0.
///
/// Sums absolute levels so batteries of different sizes weigh correctly.
/// Falls back to averaging `capacity` percentages, which lose the sizes.
fn charge(batteries: &[PathBuf], supplies: &impl PowerSupplies) -> Option<f64> {
    LEVELS
        .iter()
        .find_map(|(now, full)| ratio(batteries, now, full, supplies))
        .or_else(|| percentage(batteries, supplies))
}

/// Summed `now` over summed `full`. `None` unless every battery reports both,
/// so a missing file does not read as an empty battery.
fn ratio(
    batteries: &[PathBuf],
    now: &str,
    full: &str,
    supplies: &impl PowerSupplies,
) -> Option<f64> {
    let (held, capacity) = batteries
        .iter()
        .map(|battery| {
            Some((
                number(battery, now, supplies)?,
                number(battery, full, supplies)?,
            ))
        })
        .try_fold((0.0, 0.0), |(held, capacity), battery| {
            let (now, full) = battery?;
            Some((held + now, capacity + full))
        })?;
    (capacity > 0.0).then_some(held / capacity)
}

/// Mean `capacity` percentage, for batteries with no absolute level.
fn percentage(batteries: &[PathBuf], supplies: &impl PowerSupplies) -> Option<f64> {
    let reported: Vec<f64> = batteries
        .iter()
        .filter_map(|battery| number(battery, "capacity", supplies))
        .collect();
    (!reported.is_empty()).then(|| reported.iter().sum::<f64>() / (reported.len() as f64 * 100.0))
}

/// Whether a charger is connected.
///
/// Any online non-battery supply counts, since USB-C chargers report as `USB`
/// rather than `Mains`. With no charger listed, falls back to battery
/// `status`: anything but `Discharging` (charging, full, or held at a charge
/// threshold) counts.
fn charging(batteries: &[PathBuf], supplies: &impl PowerSupplies) -> bool {
    let leads: Vec<PathBuf> = supplies
        .supplies()
        .into_iter()
        .filter(|supply| !is_a(supply, "Battery", supplies))
        .collect();
    if leads.is_empty() {
        batteries
            .iter()
            .filter_map(|battery| supplies.read(battery, "status"))
            .any(|status| status != "Discharging")
    } else {
        leads
            .iter()
            .filter_map(|lead| supplies.read(lead, "online"))
            .any(|online| online == "1")
    }
}

/// Whether this supply's `type` is `kind`. A supply with no `type` matches
/// nothing, keeping it out of both the battery and charger lists.
fn is_a(supply: &Path, kind: &str, supplies: &impl PowerSupplies) -> bool {
    supplies
        .read(supply, "type")
        .is_some_and(|found| found == kind)
}

/// One file parsed as a number, or `None` if absent or not numeric.
fn number(supply: &Path, name: &str, supplies: &impl PowerSupplies) -> Option<f64> {
    supplies.read(supply, name)?.parse().ok()
}

/// The battery reading last sent to the chromes.
///
/// Readings are frequent and mostly noise: `energy_now` drifts constantly and
/// plugging in a charger sends two uevents. Only a whole-percent change or a
/// charger change is sent, since the bar shows no finer. The value sent is
/// still the unrounded fraction, so the bar rounds it in one place.
#[derive(Debug, Default)]
pub struct Charge(Option<Reading>);

impl Charge {
    /// The reading to broadcast, or `None` if the chromes already have it.
    ///
    /// A `None` reading is never sent but is recorded, so a battery that
    /// reappears is broadcast.
    pub fn moved_to(&mut self, now: Option<Reading>) -> Option<Reading> {
        if shown(self.0) == shown(now) {
            None
        } else {
            self.0 = now;
            now
        }
    }

    /// The reading to send a newly connected chrome.
    ///
    /// [`Charge::moved_to`] only reports changes, which may be minutes apart,
    /// so a reloaded page needs the current reading.
    pub fn again(&self) -> Option<Reading> {
        self.0
    }
}

/// The reading at the bar's resolution: whole percent and charger state.
fn shown(reading: Option<Reading>) -> Option<(i64, bool)> {
    reading.map(|read| ((read.charge * 100.0).round() as i64, read.charging))
}
