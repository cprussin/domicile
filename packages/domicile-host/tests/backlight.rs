//! The screen's brightness, read off `/sys/class/backlight` and turned into
//! the raw value logind is asked to write.

use std::collections::BTreeMap;

use domicile_host::backlight::{announces_a_backlight, reading, Backlight, Backlights, Brightness};

/// The `/sys/class/backlight` of a machine that is not this one, keyed by the
/// device's directory name and the file in it.
struct Sysfs(BTreeMap<(String, String), String>);

fn sysfs(entries: &[(&str, &[(&str, &str)])]) -> Sysfs {
    Sysfs(
        entries
            .iter()
            .flat_map(|(device, files)| {
                files.iter().map(move |(name, value)| {
                    (
                        ((*device).to_string(), (*name).to_string()),
                        (*value).to_string(),
                    )
                })
            })
            .collect(),
    )
}

impl Backlights for Sysfs {
    fn devices(&self) -> Vec<String> {
        let mut names: Vec<String> = self.0.keys().map(|(device, _)| device.clone()).collect();
        names.dedup();
        names
    }

    fn read(&self, device: &str, name: &str) -> Option<String> {
        self.0.get(&(device.to_string(), name.to_string())).cloned()
    }
}

fn panel(kind: &'static str, brightness: &'static str) -> [(&'static str, &'static str); 3] {
    [
        ("type", kind),
        ("brightness", brightness),
        ("max_brightness", "1000"),
    ]
}

#[test]
fn reads_the_level_off_the_backlight() {
    let machine = sysfs(&[("intel_backlight", &panel("raw", "420")[..])]);

    let read = reading(&machine).expect("a laptop panel has a backlight");

    assert_eq!(read.device, "intel_backlight");
    assert!((read.level() - 0.42).abs() < 1e-9);
}

/// systemd's order, and for its reason: a firmware interface knows the panel's
/// curve, and a raw one beside it is the same panel driven around it.
#[test]
fn prefers_firmware_over_platform_over_raw() {
    let machine = sysfs(&[
        ("a_raw", &panel("raw", "1")[..]),
        ("b_platform", &panel("platform", "2")[..]),
        ("c_firmware", &panel("firmware", "3")[..]),
    ]);

    assert_eq!(reading(&machine).unwrap().device, "c_firmware");

    let without_firmware = sysfs(&[
        ("a_raw", &panel("raw", "1")[..]),
        ("b_platform", &panel("platform", "2")[..]),
    ]);
    assert_eq!(reading(&without_firmware).unwrap().device, "b_platform");
}

/// A desktop on an external monitor has no backlight, which is no reading
/// rather than a dark one — and so is a device too broken to read.
#[test]
fn no_backlight_is_no_reading() {
    assert_eq!(reading(&sysfs(&[])), None);
    assert_eq!(
        reading(&sysfs(&[(
            "acpi_video0",
            &[("type", "firmware"), ("max_brightness", "0")][..]
        )])),
        None
    );
}

#[test]
fn the_raw_value_for_a_level_is_rounded() {
    let backlight = Backlight {
        device: "intel_backlight".into(),
        raw: 0,
        max: 1000,
    };

    assert_eq!(backlight.raw_for(0.4204), Some(420));
    assert_eq!(backlight.raw_for(1.0), Some(1000));
}

/// Zero is a screen that is off on most panels, and a slider dragged to its
/// end must not leave a desk nobody can see to drag it back.
#[test]
fn a_level_never_turns_the_screen_off_or_overshoots() {
    let backlight = Backlight {
        device: "intel_backlight".into(),
        raw: 0,
        max: 1000,
    };

    assert_eq!(backlight.raw_for(0.0), Some(1));
    assert_eq!(backlight.raw_for(-3.0), Some(1));
    assert_eq!(backlight.raw_for(7.0), Some(1000));
}

#[test]
fn a_level_that_is_not_a_number_is_refused() {
    let backlight = Backlight {
        device: "intel_backlight".into(),
        raw: 0,
        max: 1000,
    };

    assert_eq!(backlight.raw_for(f64::NAN), None);
    assert_eq!(backlight.raw_for(f64::INFINITY), None);
}

#[test]
fn a_backlight_uevent_is_a_doorbell_and_nothing_else_is() {
    assert!(announces_a_backlight(
        b"change@/devices/pci0000:00/0000:00:02.0/drm/card1/card1-eDP-1/intel_backlight\0ACTION=change\0SUBSYSTEM=backlight\0SOURCE=sysfs"
    ));
    assert!(!announces_a_backlight(
        b"change@/devices/LNXSYSTM:00/ACPI0003:00/power_supply/AC\0SUBSYSTEM=power_supply"
    ));
    assert!(!announces_a_backlight(b"add@/x\0SUBSYSTEM=backlight_ish"));
}

/// News is a whole percent, which is what the slider's figures show.
#[test]
fn only_a_move_the_figures_would_show_is_news() {
    let mut brightness = Brightness::default();

    assert_eq!(brightness.moved_to(Some(0.42)), Some(0.42));
    assert_eq!(brightness.moved_to(Some(0.4201)), None);
    assert_eq!(brightness.moved_to(Some(0.43)), Some(0.43));
    assert_eq!(brightness.again(), Some(0.43));
}

/// A backlight that went away says nothing, and one that comes back is news.
#[test]
fn a_backlight_that_comes_back_is_news() {
    let mut brightness = Brightness::default();
    brightness.moved_to(Some(0.5));

    assert_eq!(brightness.moved_to(None), None);
    assert_eq!(brightness.again(), None);
    assert_eq!(brightness.moved_to(Some(0.5)), Some(0.5));
}
