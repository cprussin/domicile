//! The charge, read where a Linux kernel keeps it.
//!
//! **Not `navigator.getBattery`, and that is the whole reason this module is
//! here.** The Battery Status API answers through UPower over D-Bus, and a
//! desktop on a bare tty has neither a session bus nor that daemon — see the
//! `ERROR:dbus/bus.cc` line `scripts/test-shell-guard.sh` already treats as
//! ordinary engine noise. Chromium then resolves with its *default*
//! `BatteryStatus`: charging, and full. That reading is indistinguishable from
//! a real laptop on a full battery, so no page can tell it from the truth, and
//! the bar said `100%` on a machine running flat.
//!
//! `/sys/class/power_supply` is in every kernel, needs no daemon and no bus,
//! and belongs to the process that already owns the machine. [`Directory`]'s
//! opposite number is [`PowerSupplies`]: the compositor passes
//! [`RealPowerSupplies`], the tests pass a map.
//!
//! [`Directory`]: crate::files::Directory

use std::path::{Path, PathBuf};

/// Where the kernel publishes every battery and every lead.
const POWER_SUPPLY: &str = "/sys/class/power_supply";

/// The pairs of files a battery may report its level in, best first.
///
/// `energy_*` is watt-hours and `charge_*` is amp-hours; which one a battery
/// reports is its driver's business. A ratio is unitless, so nothing below
/// needs to know which it got — only that both halves came from the same pair.
const LEVELS: &[(&str, &str)] = &[("energy_now", "energy_full"), ("charge_now", "charge_full")];

/// What the desktop can say about the machine's battery.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    /// How full, 0.0 through 1.0 — the scale the page draws the meter on.
    pub charge: f64,
    /// Whether a lead is in.
    pub charging: bool,
}

/// The machine's power supplies, so the reading can be tested without a `/sys`.
pub trait PowerSupplies {
    /// Every supply the kernel lists: the batteries and the leads together,
    /// because which is which is a file inside each one.
    fn supplies(&self) -> Vec<PathBuf>;

    /// One file of one supply, whitespace trimmed, or `None` when this supply
    /// does not have it. Which files exist varies by driver, so an absent one
    /// is the ordinary case rather than a failure.
    fn read(&self, supply: &Path, name: &str) -> Option<String>;
}

/// The machine this compositor is running on.
pub struct RealPowerSupplies;

impl PowerSupplies for RealPowerSupplies {
    /// Nothing at all when the class is not there to read.
    ///
    /// A machine with no `/sys/class/power_supply` has no battery to report,
    /// which is a fact about it rather than a failure to read one — the same
    /// answer a desktop PC gives, and [`reading`] turns both into no message.
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

/// The charge, or `None` for a machine with no battery.
///
/// `None` is a desktop PC rather than a broken reading: there is no meter to
/// draw, so the compositor sends nothing and the bar shows nothing. The
/// failure this module exists to prevent is the opposite one — an invented
/// reading that looks like a real one.
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

/// How full every battery is together, 0.0 through 1.0.
///
/// **Summed rather than averaged**, which is the one thing a per-battery
/// percentage cannot do: a small cell nearly full beside a large one nearly
/// empty is not a machine at half charge. `capacity` is the last resort for
/// exactly that reason — it is already a ratio, so the sizes it came from are
/// gone and a second battery can only be averaged in.
fn charge(batteries: &[PathBuf], supplies: &impl PowerSupplies) -> Option<f64> {
    LEVELS
        .iter()
        .find_map(|(now, full)| ratio(batteries, now, full, supplies))
        .or_else(|| percentage(batteries, supplies))
}

/// The summed `now` over the summed `full`, or `None` unless every battery
/// reported both — a machine where one of two batteries is missing a file
/// would otherwise read as that battery being empty.
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

/// The mean of what the batteries say about themselves, for the ones that
/// report no absolute level at all.
fn percentage(batteries: &[PathBuf], supplies: &impl PowerSupplies) -> Option<f64> {
    let reported: Vec<f64> = batteries
        .iter()
        .filter_map(|battery| number(battery, "capacity", supplies))
        .collect();
    (!reported.is_empty()).then(|| reported.iter().sum::<f64>() / (reported.len() as f64 * 100.0))
}

/// Whether a lead is in.
///
/// **Anything that is not a battery and is online**, rather than the one
/// called `AC`: a laptop charging over USB-C reports its charger as a `USB`
/// supply, and a desktop that looked for `Mains` alone would say the lead was
/// out while the machine charged.
///
/// A machine that lists no charger at all is asked the other way about, off
/// the battery's own account of itself. Anything but `Discharging` is a
/// battery that is not running the machine — charging, full, or held at a
/// threshold its owner set.
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

/// Whether this supply's `type` is the one named. A supply with no `type` is
/// none of them, which keeps a driver that omits it out of both lists rather
/// than counting it as a lead that is never online.
fn is_a(supply: &Path, kind: &str, supplies: &impl PowerSupplies) -> bool {
    supplies
        .read(supply, "type")
        .is_some_and(|found| found == kind)
}

/// One file read as a number, or `None` when it is absent or is not one.
fn number(supply: &Path, name: &str, supplies: &impl PowerSupplies) -> Option<f64> {
    supplies.read(supply, name)?.parse().ok()
}

/// What the chromes have been told about the battery.
///
/// The charge is polled rather than delivered — nothing signals a percent — so
/// unlike every other thing a compositor broadcasts this one has a reading on
/// every turn of a timer, and almost none of them are worth a message:
/// `energy_now` moves by a few units a second on a machine doing nothing.
///
/// **News is a whole percent, or the lead.** That is the resolution the bar
/// draws at — it rounds the fraction to figures and fills a meter with the
/// same number — so a change too small to move the figures is a change nothing
/// on screen could show. What goes out is still the fraction: rounding belongs
/// where it is drawn, once, so the meter and the figures cannot disagree.
#[derive(Debug, Default)]
pub struct Charge(Option<Reading>);

impl Charge {
    /// The reading to broadcast now, or `None` when the chromes already have
    /// this one.
    ///
    /// `now` is `None` for a machine with no battery, which is never a
    /// message: there is no reading to draw, and there is no "the battery is
    /// gone" to send. It is recorded all the same, so a battery that comes
    /// back is news.
    pub fn moved_to(&mut self, now: Option<Reading>) -> Option<Reading> {
        if shown(self.0) == shown(now) {
            None
        } else {
            self.0 = now;
            now
        }
    }

    /// The reading to send a chrome that has just connected, whether or not it
    /// has moved.
    ///
    /// A page that reloaded has no charge at all until something says one, and
    /// what [`Charge::moved_to`] says is what *changed* — so on a settled
    /// machine the next thing it says could be minutes away, and the bar would
    /// carry a gap where the meter goes for all of it.
    pub fn again(&self) -> Option<Reading> {
        self.0
    }
}

/// The reading as the bar would draw it: the whole percent, and the lead.
///
/// Two readings that agree here are one reading as far as anything on screen
/// is concerned, which is what makes the difference between them silence.
fn shown(reading: Option<Reading>) -> Option<(i64, bool)> {
    reading.map(|read| ((read.charge * 100.0).round() as i64, read.charging))
}
