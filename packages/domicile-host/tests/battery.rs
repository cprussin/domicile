//! The charge, read off `/sys/class/power_supply` the way every Linux bar
//! reads it — and not off `navigator.getBattery`, which is where this desktop
//! read it first and is why these tests exist.
//!
//! That API answers through UPower over D-Bus, and a desktop on a bare tty has
//! neither: Chromium falls back to its default `BatteryStatus` — charging,
//! and full — which is indistinguishable from a real laptop on a full battery
//! and so cannot be detected from the page. `/sys/class/power_supply` is in
//! every kernel, needs no daemon and no bus, and is the compositor's to read.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use domicile_host::battery::{announces_a_power_supply, reading, Charge, PowerSupplies, Reading};

/// The `/sys/class/power_supply` of a machine that is not this one.
///
/// Keyed by the supply's directory name and the file in it, which is the whole
/// of what the reading reads: `BAT0/energy_now`, `AC/online`.
struct Sysfs(BTreeMap<(String, String), String>);

fn sysfs(entries: &[(&str, &[(&str, &str)])]) -> Sysfs {
    Sysfs(
        entries
            .iter()
            .flat_map(|(supply, files)| {
                files.iter().map(move |(name, value)| {
                    (
                        ((*supply).to_string(), (*name).to_string()),
                        (*value).to_string(),
                    )
                })
            })
            .collect(),
    )
}

impl PowerSupplies for Sysfs {
    fn supplies(&self) -> Vec<PathBuf> {
        let mut names: Vec<String> = self.0.keys().map(|(supply, _)| supply.clone()).collect();
        names.dedup();
        names.into_iter().map(PathBuf::from).collect()
    }

    fn read(&self, supply: &Path, name: &str) -> Option<String> {
        let supply = supply.to_str()?.to_string();
        self.0.get(&(supply, name.to_string())).cloned()
    }
}

#[test]
fn reads_the_charge_and_the_lead_off_one_battery() {
    let machine = sysfs(&[
        (
            "BAT0",
            &[
                ("type", "Battery"),
                ("energy_full", "50000000"),
                ("energy_now", "21000000"),
            ][..],
        ),
        ("AC", &[("type", "Mains"), ("online", "1")]),
    ]);

    assert_eq!(
        reading(&machine),
        Some(Reading {
            charge: 0.42,
            charging: true
        })
    );
}

#[test]
fn adds_the_batteries_up_rather_than_averaging_them() {
    // The one thing a per-battery percentage cannot do. A small cell nearly
    // full beside a large one nearly empty is not a machine at half charge,
    // and a laptop with two batteries is the reason this sums the energy
    // rather than taking `capacity` and dividing by two.
    let machine = sysfs(&[
        (
            "BAT0",
            &[
                ("type", "Battery"),
                ("energy_full", "10000000"),
                ("energy_now", "9000000"),
            ][..],
        ),
        (
            "BAT1",
            &[
                ("type", "Battery"),
                ("energy_full", "90000000"),
                ("energy_now", "9000000"),
            ],
        ),
    ]);

    assert_eq!(reading(&machine).map(|read| read.charge), Some(0.18));
}

#[test]
fn reads_a_battery_that_counts_in_amp_hours_instead() {
    // `charge_*` and `energy_*` are the same measurement in different units,
    // and which one a battery reports is the driver's business. A ratio is
    // unitless, so nothing here needs to know which it got.
    let machine = sysfs(&[(
        "BAT0",
        &[
            ("type", "Battery"),
            ("charge_full", "4000000"),
            ("charge_now", "3000000"),
        ][..],
    )]);

    assert_eq!(reading(&machine).map(|read| read.charge), Some(0.75));
}

#[test]
fn falls_back_to_the_percentage_a_battery_reports_itself() {
    // Some batteries report only `capacity`, which the kernel has already
    // worked out. It is the last resort rather than the first because it is
    // the one reading that cannot be added up.
    let machine = sysfs(&[("BAT0", &[("type", "Battery"), ("capacity", "37")][..])]);

    assert_eq!(reading(&machine).map(|read| read.charge), Some(0.37));
}

#[test]
fn says_the_lead_is_out_when_every_supply_is_offline() {
    let machine = sysfs(&[
        (
            "BAT0",
            &[
                ("type", "Battery"),
                ("energy_full", "100"),
                ("energy_now", "50"),
                ("status", "Discharging"),
            ][..],
        ),
        ("AC", &[("type", "Mains"), ("online", "0")]),
    ]);

    assert_eq!(reading(&machine).map(|read| read.charging), Some(false));
}

#[test]
fn counts_a_usb_c_charger_as_a_lead() {
    // A laptop charging over USB-C reports the charger as a `USB` supply
    // rather than as `Mains`, so the question is whether anything that is not
    // a battery is online — not whether the one called `AC` is.
    let machine = sysfs(&[
        (
            "BAT0",
            &[
                ("type", "Battery"),
                ("energy_full", "100"),
                ("energy_now", "50"),
            ][..],
        ),
        ("AC", &[("type", "Mains"), ("online", "0")]),
        (
            "ucsi-source-psy-USBC000:001",
            &[("type", "USB"), ("online", "1")],
        ),
    ]);

    assert_eq!(reading(&machine).map(|read| read.charging), Some(true));
}

#[test]
fn reads_the_lead_off_the_battery_when_the_machine_lists_no_charger() {
    // Not every machine has a supply for the lead at all. `status` is the
    // battery's own account of it, and anything that is not `Discharging` is
    // a battery that is not running the machine — charging, full, or held at
    // a threshold the user set.
    let machine = sysfs(&[(
        "BAT0",
        &[
            ("type", "Battery"),
            ("capacity", "80"),
            ("status", "Not charging"),
        ][..],
    )]);

    assert_eq!(reading(&machine).map(|read| read.charging), Some(true));
}

#[test]
fn has_nothing_to_say_about_a_machine_with_no_battery() {
    // A desktop PC, which is a real machine rather than a broken reading. The
    // compositor sends no message and the bar draws no meter.
    let machine = sysfs(&[("AC", &[("type", "Mains"), ("online", "1")][..])]);

    assert_eq!(reading(&machine), None);
}

/// Half a battery, which every case below starts from.
const HALF: Reading = Reading {
    charge: 0.5,
    charging: false,
};

#[test]
fn the_first_reading_is_a_message() {
    assert_eq!(Charge::default().moved_to(Some(HALF)), Some(HALF));
}

#[test]
fn a_percent_that_has_not_moved_says_nothing() {
    let mut charge = Charge::default();
    charge.moved_to(Some(HALF));
    assert_eq!(charge.moved_to(Some(HALF)), None);
}

#[test]
fn a_drift_too_small_to_draw_says_nothing() {
    // `energy_now` moves every time it is read. What the bar draws is the
    // whole percent, so a reading that rounds to the same figure is a reading
    // nothing on screen could show — and a message per poll for the life of
    // the desktop.
    let mut charge = Charge::default();
    charge.moved_to(Some(HALF));
    assert_eq!(
        charge.moved_to(Some(Reading {
            charge: 0.5004,
            ..HALF
        })),
        None
    );
}

#[test]
fn a_whole_percent_is_news() {
    let mut charge = Charge::default();
    charge.moved_to(Some(HALF));
    let moved = Reading {
        charge: 0.49,
        ..HALF
    };
    assert_eq!(charge.moved_to(Some(moved)), Some(moved));
}

#[test]
fn the_lead_going_in_is_news_at_the_same_percent() {
    // The half of this a user watches for: plugging in moves the bolt and not
    // the figures, and a desktop that only watched the percent would leave the
    // bolt off until the charge happened to move.
    let mut charge = Charge::default();
    charge.moved_to(Some(HALF));
    let plugged = Reading {
        charging: true,
        ..HALF
    };
    assert_eq!(charge.moved_to(Some(plugged)), Some(plugged));
}

#[test]
fn a_machine_with_no_battery_is_never_a_message() {
    assert_eq!(Charge::default().moved_to(None), None);
}

#[test]
fn a_chrome_that_has_just_connected_is_told_the_reading_again() {
    // Not news, and the page still has to have it: a reload starts a bar with
    // no meter on it, and the next change could be minutes off.
    let mut charge = Charge::default();
    charge.moved_to(Some(HALF));
    assert_eq!(charge.again(), Some(HALF));
}

#[test]
fn there_is_nothing_to_tell_a_chrome_before_the_first_reading() {
    assert_eq!(Charge::default().again(), None);
}

/// One uevent datagram, in the kernel's own format: NUL-separated fields, the
/// first of them `ACTION@DEVPATH` and the rest `KEY=VALUE`.
fn datagram(fields: &[&str]) -> Vec<u8> {
    fields.join("\0").into_bytes()
}

#[test]
fn a_power_supply_change_is_worth_reading_the_charge_again() {
    // What the kernel sends when a lead goes in or out: `power_supply_changed`
    // in the driver becomes a KOBJ_CHANGE uevent on the supply's device.
    assert!(announces_a_power_supply(&datagram(&[
        "change@/devices/LNXSYSTM:00/device:00/ACPI0003:00/power_supply/AC",
        "ACTION=change",
        "DEVPATH=/devices/LNXSYSTM:00/device:00/ACPI0003:00/power_supply/AC",
        "SUBSYSTEM=power_supply",
        "POWER_SUPPLY_NAME=AC",
        "SEQNUM=4242",
    ])));
}

#[test]
fn every_other_device_on_the_machine_is_not() {
    // The filter is the whole reason this is read at all: a desktop sees a
    // uevent for every device that changes, and re-reading `/sys` for a USB
    // stick would be the polling this replaced, on somebody else's clock.
    assert!(!announces_a_power_supply(&datagram(&[
        "add@/devices/pci0000:00/0000:00:14.0/usb2/2-1",
        "ACTION=add",
        "SUBSYSTEM=usb",
        "SEQNUM=4243",
    ])));
}

#[test]
fn a_subsystem_that_merely_starts_the_same_is_not_one() {
    // The field is matched whole. Nothing in the kernel is called this today,
    // and a prefix match is the kind of thing that stays right until it is
    // not.
    assert!(!announces_a_power_supply(&datagram(&[
        "change@/devices/made/up",
        "SUBSYSTEM=power_supply_wireless",
    ])));
}

#[test]
fn a_datagram_that_is_not_a_uevent_at_all_is_not_one() {
    // Anything at all may arrive on a netlink socket. None of these is a
    // power supply, and the worst a datagram that said it was could do is
    // cost one read of `/sys` — the message is a doorbell and never a
    // reading.
    assert!(!announces_a_power_supply(b""));
    assert!(!announces_a_power_supply(b"\0\0\0"));
    assert!(!announces_a_power_supply(b"SUBSYSTEM=power_sup"));
}
