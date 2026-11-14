//! Tests for how `domicile list-*` prints what the desktop said.

use domicile_launch::listing::{displays_table, windows_table};
use domicile_protocol::{
    AdaptiveSync, DisplayHdr, DisplayInfo, DisplayTransform, ListedDisplay, ListedWindow,
    WindowKind,
};

#[test]
fn each_display_prints_every_name_sleep_displays_takes() {
    let laptop = ListedDisplay {
        display: DisplayInfo {
            name: "drm-1".to_string(),
            position: [0, 0],
            size: [1128, 752],
            scale: 2,
            mode: [2256, 1504],
            refresh_mhz: 59_999,
            adaptive_sync: AdaptiveSync::Off,
            hdr: DisplayHdr::Unsupported,
            peak_luminance: 0,
            sdr_white: 0,
            transform: DisplayTransform::Normal,
        },
        names: vec![
            "drm-1".to_string(),
            "eDP-1".to_string(),
            "BOE NE135A1M-NY1".to_string(),
        ],
        lit: true,
    };
    let dock = ListedDisplay {
        display: DisplayInfo {
            name: "drm-2".to_string(),
            position: [1128, 0],
            size: [1080, 1920],
            refresh_mhz: 0,
            transform: DisplayTransform::Rotate90,
            hdr: DisplayHdr::On,
            ..laptop.display.clone()
        },
        names: vec!["drm-2".to_string()],
        lit: false,
    };

    assert_eq!(
        displays_table(&[laptop, dock]),
        "\
drm-1 (lit)
  names     drm-1, eDP-1, BOE NE135A1M-NY1
  mode      2256x1504 @ 59.999 Hz
  layout    1128x752 at 0,0, scale 2, normal
  color     HDR unsupported, adaptive sync off

drm-2 (off)
  names     drm-2
  mode      2256x1504
  layout    1080x1920 at 1128,0, scale 2, rotate-90
  color     HDR on, adaptive sync off
"
    );
}

#[test]
fn windows_print_as_one_table_whoever_draws_them() {
    let editor = ListedWindow {
        id: "kD3mQ7nW1zT5yB8vC2xF6hJ9pL4sR0gA".to_string(),
        kind: WindowKind::Native,
        title: "notes.org".to_string(),
        app: Some("emacs".to_string()),
        pid: Some(4242),
        size: Some([640.0, 480.5]),
        focused: true,
        urgent: false,
    };
    let terminal = ListedWindow {
        id: "nW1zT5yB8vC2xF6hJ9pL4sR0gAkD3mQ7".to_string(),
        title: String::new(),
        app: None,
        pid: Some(7),
        focused: false,
        urgent: true,
        ..editor.clone()
    };
    let mail = ListedWindow {
        id: "Xy7pQ2mN8vB4cZ1kL6tR9wF3hD5sJ0gE".to_string(),
        kind: WindowKind::Browser,
        title: "Inbox".to_string(),
        app: Some("mail".to_string()),
        pid: None,
        size: None,
        focused: false,
        urgent: false,
    };

    assert_eq!(
        windows_table(&[editor, terminal, mail]),
        "\
ID                                KIND     APP    PID   SIZE     TITLE
kD3mQ7nW1zT5yB8vC2xF6hJ9pL4sR0gA  native   emacs  4242  640x481  notes.org (focused)
nW1zT5yB8vC2xF6hJ9pL4sR0gAkD3mQ7  native   -      7     640x481  - (urgent)
Xy7pQ2mN8vB4cZ1kL6tR9wF3hD5sJ0gE  browser  mail   -     -        Inbox
"
    );
}

#[test]
fn no_windows_prints_the_header_alone() {
    assert_eq!(windows_table(&[]), "ID  KIND  APP  PID  SIZE  TITLE\n");
}
