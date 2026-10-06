//! The system calls a locked desktop still runs, so a lock screen can show the
//! battery, brightness and volume: each shape the libraries send, and the
//! near misses that stay refused.

use std::collections::BTreeMap;

use domicile_host::system::{reach, Reach};
use domicile_protocol::{Bus, SystemRequest};

const UPOWER: &str = "org.freedesktop.UPower";
const DISPLAY_DEVICE: &str = "/org/freedesktop/UPower/devices/DisplayDevice";
const PROPERTIES: &str = "org.freedesktop.DBus.Properties";
const LOGIND: &str = "org.freedesktop.login1";
const SESSION: &str = "/org/freedesktop/login1/session/auto";

/// `@domicile-desktop/system-battery`'s read of the battery.
fn battery_read() -> SystemRequest {
    SystemRequest::DbusCall {
        bus: Bus::System,
        destination: UPOWER.into(),
        path: DISPLAY_DEVICE.into(),
        interface: PROPERTIES.into(),
        member: "GetAll".into(),
        signature: "s".into(),
        body: r#"["org.freedesktop.UPower.Device"]"#.into(),
    }
}

/// `@domicile-desktop/system-battery`'s watch of the battery.
fn battery_watch() -> SystemRequest {
    SystemRequest::DbusMatch {
        bus: Bus::System,
        sender: Some(UPOWER.into()),
        path: Some(DISPLAY_DEVICE.into()),
        interface: Some(PROPERTIES.into()),
        member: Some("PropertiesChanged".into()),
    }
}

/// `@domicile-desktop/system-backlight`'s brightness setter.
fn set_brightness(body: &str) -> SystemRequest {
    SystemRequest::DbusCall {
        bus: Bus::System,
        destination: LOGIND.into(),
        path: SESSION.into(),
        interface: "org.freedesktop.login1.Session".into(),
        member: "SetBrightness".into(),
        signature: "ssu".into(),
        body: body.into(),
    }
}

fn spawn(argv: &[&str], env: &[(&str, &str)]) -> SystemRequest {
    SystemRequest::Spawn {
        argv: argv.iter().map(|arg| arg.to_string()).collect(),
        cwd: None,
        env: env
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect::<BTreeMap<_, _>>(),
        stdin: false,
    }
}

/// `@domicile-desktop/system-audio` runs `pactl` in the C locale.
fn pactl(args: &[&str]) -> SystemRequest {
    let argv: Vec<&str> = std::iter::once("pactl")
        .chain(args.iter().copied())
        .collect();
    spawn(&argv, &[("LC_ALL", "C")])
}

const UDEVADM: [&str; 4] = [
    "udevadm",
    "monitor",
    "--kernel",
    "--subsystem-match=backlight",
];

fn allowed(request: &SystemRequest) -> bool {
    reach(request) == Reach::Readout
}

/// Why a request is a near miss, and the change that makes it one.
type Miss<T> = (&'static str, fn(&mut T));

/// A [`SystemRequest::DbusCall`]'s fields, to change one.
struct Call {
    bus: Bus,
    destination: String,
    path: String,
    member: String,
    body: String,
}

/// `request`, a D-Bus call, with `change` made to it.
fn changed(request: SystemRequest, change: fn(&mut Call)) -> SystemRequest {
    let SystemRequest::DbusCall {
        bus,
        destination,
        path,
        interface,
        member,
        signature,
        body,
    } = request
    else {
        panic!("not a D-Bus call");
    };
    let mut call = Call {
        bus,
        destination,
        path,
        member,
        body,
    };
    change(&mut call);
    SystemRequest::DbusCall {
        bus: call.bus,
        destination: call.destination,
        path: call.path,
        interface,
        member: call.member,
        signature,
        body: call.body,
    }
}

/// A [`SystemRequest::DbusMatch`]'s fields, to change one.
struct Match {
    bus: Bus,
    sender: Option<String>,
    member: Option<String>,
}

/// `request`, a D-Bus match, with `change` made to it.
fn matching(request: SystemRequest, change: fn(&mut Match)) -> SystemRequest {
    let SystemRequest::DbusMatch {
        bus,
        sender,
        path,
        interface,
        member,
    } = request
    else {
        panic!("not a D-Bus match");
    };
    let mut watch = Match {
        bus,
        sender,
        member,
    };
    change(&mut watch);
    SystemRequest::DbusMatch {
        bus: watch.bus,
        sender: watch.sender,
        path,
        interface,
        member: watch.member,
    }
}

mod battery {
    use super::*;

    #[test]
    fn its_read_and_watch_are_readouts() {
        assert!(allowed(&battery_read()));
        assert!(allowed(&battery_watch()));
    }

    #[test]
    fn a_read_of_anything_else_on_the_bus_is_not() {
        let misses: [Miss<Call>; 5] = [
            ("session bus", |call| call.bus = Bus::Session),
            ("other service", |call| {
                call.destination = "org.example.Evil".into()
            }),
            ("other device", |call| {
                call.path = "/org/freedesktop/UPower/devices/battery_BAT0".into();
            }),
            ("other member", |call| call.member = "Set".into()),
            ("other interface's properties", |call| {
                call.body = r#"["org.freedesktop.UPower"]"#.into();
            }),
        ];
        for (why, change) in misses {
            assert_eq!(
                reach(&changed(battery_read(), change)),
                Reach::Acts,
                "{why}"
            );
        }
    }

    #[test]
    fn a_match_on_more_than_the_battery_is_not() {
        let misses: [Miss<Match>; 3] = [
            ("session bus", |watch| watch.bus = Bus::Session),
            ("any sender", |watch| watch.sender = None),
            ("any member", |watch| watch.member = None),
        ];
        for (why, change) in misses {
            assert_eq!(
                reach(&matching(battery_watch(), change)),
                Reach::Acts,
                "{why}"
            );
        }
    }
}

mod brightness {
    use super::*;

    #[test]
    fn its_watch_and_setter_are_readouts() {
        assert!(allowed(&spawn(&UDEVADM, &[])));
        assert!(allowed(&set_brightness(
            r#"["backlight","intel_backlight",120]"#
        )));
    }

    #[test]
    fn setting_another_kind_of_light_is_not() {
        assert_eq!(
            reach(&set_brightness(r#"["leds","input3::capslock",1]"#)),
            Reach::Acts
        );
        assert_eq!(
            reach(&set_brightness(r#"["backlight","",1]"#)),
            Reach::Acts,
            "no device"
        );
        let setter = || set_brightness(r#"["backlight","intel_backlight",120]"#);
        let misses: [Miss<Call>; 2] = [
            ("another session", |call| {
                call.path = "/org/freedesktop/login1/session/c2".into();
            }),
            ("another member", |call| call.member = "Terminate".into()),
        ];
        for (why, change) in misses {
            assert_eq!(reach(&changed(setter(), change)), Reach::Acts, "{why}");
        }
    }

    #[test]
    fn another_udevadm_is_not() {
        assert_eq!(
            reach(&spawn(
                &["udevadm", "monitor", "--kernel", "--subsystem-match=input"],
                &[]
            )),
            Reach::Acts
        );
        assert_eq!(reach(&spawn(&["udevadm", "trigger"], &[])), Reach::Acts);
        assert_eq!(
            reach(&spawn(&[&UDEVADM[..], &["--udev"]].concat(), &[])),
            Reach::Acts,
            "an extra argument"
        );
    }
}

mod audio {
    use super::*;

    #[test]
    fn reading_and_following_the_server_are_readouts() {
        for verb in ["subscribe", "info", "list"] {
            assert!(allowed(&pactl(&["-f", "json", verb])), "{verb}");
        }
    }

    #[test]
    fn setting_an_outputs_volume_or_mute_is_a_readout() {
        assert!(allowed(&pactl(&[
            "--",
            "set-sink-volume",
            "alsa_output.pci",
            "65536"
        ])));
        assert!(allowed(&pactl(&[
            "--",
            "set-sink-mute",
            "alsa_output.pci",
            "1"
        ])));
        assert!(allowed(&pactl(&[
            "--",
            "set-sink-mute",
            "alsa_output.pci",
            "0"
        ])));
    }

    #[test]
    fn anything_else_pactl_does_is_not() {
        for args in [
            &["-f", "json", "list", "sinks"][..],
            &["load-module", "module-null-sink"],
            &["--", "set-sink-volume", "alsa_output.pci", "+5%"],
            &["--", "set-sink-volume", "alsa_output.pci", ""],
            &["set-sink-volume", "alsa_output.pci", "65536"],
            &["--", "set-sink-mute", "alsa_output.pci", "toggle"],
            &["--", "set-sink-mute", "", "1"],
            &["--", "set-source-mute", "alsa_input.pci", "0"],
            &["--", "set-default-sink", "alsa_output.pci"],
        ] {
            assert_eq!(reach(&pactl(args)), Reach::Acts, "{args:?}");
        }
    }

    /// The meters record what plays or a microphone; the lock screen shows
    /// none.
    #[test]
    fn a_meter_is_not() {
        assert_eq!(
            reach(&spawn(
                &["parec", "--raw", "--device=alsa_input.pci"],
                &[("LC_ALL", "C")]
            )),
            Reach::Acts
        );
    }
}

/// What a spawn runs with, beyond its argv.
mod spawning {
    use super::*;

    #[test]
    fn another_environment_directory_or_stdin_is_not_a_readout() {
        let subscribe = || pactl(&["-f", "json", "subscribe"]);
        let with = |change: fn(&mut SystemRequest)| {
            let mut request = subscribe();
            change(&mut request);
            reach(&request)
        };
        assert_eq!(
            with(|request| {
                if let SystemRequest::Spawn { env, .. } = request {
                    env.insert("LD_PRELOAD".into(), "/tmp/evil.so".into());
                }
            }),
            Reach::Acts
        );
        assert_eq!(
            with(|request| {
                if let SystemRequest::Spawn { env, .. } = request {
                    env.clear();
                }
            }),
            Reach::Acts
        );
        assert_eq!(
            with(|request| {
                if let SystemRequest::Spawn { cwd, .. } = request {
                    *cwd = Some("/tmp".into());
                }
            }),
            Reach::Acts
        );
        assert_eq!(
            with(|request| {
                if let SystemRequest::Spawn { stdin, .. } = request {
                    *stdin = true;
                }
            }),
            Reach::Acts
        );
        assert_eq!(
            reach(&spawn(&UDEVADM, &[("LC_ALL", "C")])),
            Reach::Acts,
            "udevadm runs with no changes to its environment"
        );
    }

    #[test]
    fn a_program_named_by_path_is_not_a_readout() {
        assert_eq!(
            reach(&spawn(
                &["/tmp/pactl", "-f", "json", "info"],
                &[("LC_ALL", "C")]
            )),
            Reach::Acts
        );
    }
}
