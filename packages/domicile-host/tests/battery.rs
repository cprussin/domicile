//! Reading battery charge from `/sys/class/power_supply`.
//!
//! `navigator.getBattery` needs UPower over D-Bus. Without it, Chromium
//! reports a full, charging battery, which a page cannot tell from a real one.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use domicile_host::battery::{announces_a_power_supply, reading, Charge, PowerSupplies, Reading};

/// A fake `/sys/class/power_supply`, keyed by supply directory and file name
/// (`BAT0/energy_now`, `AC/online`).
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
    // A small full cell and a large empty one are not at half charge, so
    // energy is summed rather than `capacity` averaged.
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
    // `charge_*` and `energy_*` differ only in units, and the ratio is
    // unitless.
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
    // `capacity` is the last resort because percentages cannot be summed
    // across batteries.
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
    // A USB-C charger is a `USB` supply, not `Mains`, so any online
    // non-battery supply counts.
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
    // With no charger supply, any battery `status` other than `Discharging`
    // (charging, full, or held at a threshold) means plugged in.
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
    // A desktop PC: no message, so the bar draws no meter.
    let machine = sysfs(&[("AC", &[("type", "Mains"), ("online", "1")][..])]);

    assert_eq!(reading(&machine), None);
}

/// A half-charged battery, the starting point for the cases below.
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
    // `energy_now` changes on every read. The bar shows whole percents, so a
    // smaller change would send a message per poll for no visible change.
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
    // Plugging in must update the charging icon even if the percent is
    // unchanged.
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
    // A reloaded page needs the current reading; the next change may be
    // minutes away.
    let mut charge = Charge::default();
    charge.moved_to(Some(HALF));
    assert_eq!(charge.again(), Some(HALF));
}

#[test]
fn there_is_nothing_to_tell_a_chrome_before_the_first_reading() {
    assert_eq!(Charge::default().again(), None);
}

/// A uevent datagram: NUL-separated fields, `ACTION@DEVPATH` then
/// `KEY=VALUE` pairs.
fn datagram(fields: &[&str]) -> Vec<u8> {
    fields.join("\0").into_bytes()
}

#[test]
fn a_power_supply_change_is_worth_reading_the_charge_again() {
    // The uevent the kernel sends when a charger is plugged in or out.
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
    // Uevents arrive for every device, so other subsystems must not trigger a
    // `/sys` read.
    assert!(!announces_a_power_supply(&datagram(&[
        "add@/devices/pci0000:00/0000:00:14.0/usb2/2-1",
        "ACTION=add",
        "SUBSYSTEM=usb",
        "SEQNUM=4243",
    ])));
}

#[test]
fn a_subsystem_that_merely_starts_the_same_is_not_one() {
    // The subsystem must match exactly, not by prefix.
    assert!(!announces_a_power_supply(&datagram(&[
        "change@/devices/made/up",
        "SUBSYSTEM=power_supply_wireless",
    ])));
}

#[test]
fn a_datagram_that_is_not_a_uevent_at_all_is_not_one() {
    // A netlink socket can receive anything. A spoofed datagram can only
    // trigger one `/sys` read, since the charge is never taken from it.
    assert!(!announces_a_power_supply(b""));
    assert!(!announces_a_power_supply(b"\0\0\0"));
    assert!(!announces_a_power_supply(b"SUBSYSTEM=power_sup"));
}
