//! The system calls a locked desktop still runs, so a lock screen can show the
//! battery and Bluetooth and adjust the brightness and volume.
//!
//! [`READOUTS`] lists each call that `@domicile-desktop/system-battery`,
//! `system-backlight`, `system-audio` and `system-bluetooth` make, field by
//! field. Anything else is refused while locked. See `docs/LOCK.md`.
//!
//! `packages/domicile-protocol/wire/lock-screen-readouts.jsonl` records the
//! calls the libraries send; their tests and this crate's check against it.

use std::collections::BTreeMap;

use domicile_protocol::{Bus, SystemRequest};
use serde_json::Value as Json;

const UPOWER: &str = "org.freedesktop.UPower";
const DISPLAY_DEVICE: &str = "/org/freedesktop/UPower/devices/DisplayDevice";
const PROPERTIES: &str = "org.freedesktop.DBus.Properties";
const BLUEZ: &str = "org.bluez";

/// One word of an argv, or one value of a D-Bus body.
#[derive(Clone, Copy)]
enum Word {
    Is(&'static str),
    OneOf(&'static [&'static str]),
    /// Any non-empty string.
    Name,
    /// A whole number: ASCII digits in an argv, an unsigned integer in a body.
    Whole,
}

/// A call a lock screen's readouts make.
enum Readout {
    Call {
        destination: &'static str,
        path: &'static str,
        interface: &'static str,
        member: &'static str,
        signature: &'static str,
        body: &'static [Word],
    },
    /// A match on the system bus. Each field must equal the request's; `None`
    /// matches only a request that leaves the field out.
    Match {
        sender: &'static str,
        path: Option<&'static str>,
        interface: Option<&'static str>,
        member: Option<&'static str>,
    },
    /// A process from `PATH` with no `cwd` or `stdin`, run with exactly `env`.
    Spawn {
        argv: &'static [Word],
        env: &'static [(&'static str, &'static str)],
    },
}

/// `pactl`'s environment: `system-audio` reads its output in the C locale.
const C_LOCALE: &[(&str, &str)] = &[("LC_ALL", "C")];

/// Every call a locked desktop runs. All are on the system bus or run from
/// `PATH`, so a page names no service or program of its own.
const READOUTS: &[Readout] = &[
    // The battery's charge. Reads UPower's combined device; changes nothing.
    Readout::Call {
        destination: UPOWER,
        path: DISPLAY_DEVICE,
        interface: PROPERTIES,
        member: "GetAll",
        signature: "s",
        body: &[Word::Is("org.freedesktop.UPower.Device")],
    },
    // Changes to the battery's charge. Hears one service's one signal.
    Readout::Match {
        sender: UPOWER,
        path: Some(DISPLAY_DEVICE),
        interface: Some(PROPERTIES),
        member: Some("PropertiesChanged"),
    },
    // Backlight changes. Prints kernel uevents for backlights only.
    Readout::Spawn {
        argv: &[
            Word::Is("udevadm"),
            Word::Is("monitor"),
            Word::Is("--kernel"),
            Word::Is("--subsystem-match=backlight"),
        ],
        env: &[],
    },
    // Sets a backlight, as the keyboard's brightness keys may. logind allows
    // only the session's own seat, and only a device that exists.
    Readout::Call {
        destination: "org.freedesktop.login1",
        path: "/org/freedesktop/login1/session/auto",
        interface: "org.freedesktop.login1.Session",
        member: "SetBrightness",
        signature: "ssu",
        body: &[Word::Is("backlight"), Word::Name, Word::Whole],
    },
    // The sound server's state, and its changes. Reads only.
    Readout::Spawn {
        argv: &[
            Word::Is("pactl"),
            Word::Is("-f"),
            Word::Is("json"),
            Word::OneOf(&["info", "list", "subscribe"]),
        ],
        env: C_LOCALE,
    },
    // An output's volume or mute, as the keyboard's volume keys may. `--` stops
    // the device name being read as an option. Inputs are left out: unmuting
    // a microphone would let a locked desktop record.
    Readout::Spawn {
        argv: &[
            Word::Is("pactl"),
            Word::Is("--"),
            Word::Is("set-sink-volume"),
            Word::Name,
            Word::Whole,
        ],
        env: C_LOCALE,
    },
    Readout::Spawn {
        argv: &[
            Word::Is("pactl"),
            Word::Is("--"),
            Word::Is("set-sink-mute"),
            Word::Name,
            Word::OneOf(&["0", "1"]),
        ],
        env: C_LOCALE,
    },
    // Bluetooth adapters, connected devices and their batteries. Reads BlueZ's
    // objects; pairing, connecting, power and scanning stay refused.
    Readout::Call {
        destination: BLUEZ,
        path: "/",
        interface: "org.freedesktop.DBus.ObjectManager",
        member: "GetManagedObjects",
        signature: "",
        body: &[],
    },
    // Changes to them. Hears BlueZ's signals only.
    Readout::Match {
        sender: BLUEZ,
        path: None,
        interface: None,
        member: None,
    },
];

/// Whether `request` is one of [`READOUTS`].
pub(crate) fn is_a_readout(request: &SystemRequest) -> bool {
    READOUTS.iter().any(|readout| fits(readout, request))
}

fn fits(readout: &Readout, request: &SystemRequest) -> bool {
    match (readout, request) {
        (
            Readout::Call {
                destination,
                path,
                interface,
                member,
                signature,
                body,
            },
            SystemRequest::DbusCall {
                bus: Bus::System,
                destination: called,
                path: at,
                interface: on,
                member: calling,
                signature: typed,
                body: with,
            },
        ) => {
            called == destination
                && at == path
                && on == interface
                && calling == member
                && typed == signature
                && body_fits(body, with)
        }
        (
            Readout::Match {
                sender,
                path,
                interface,
                member,
            },
            SystemRequest::DbusMatch {
                bus: Bus::System,
                sender: Some(from),
                path: at,
                interface: on,
                member: heard,
            },
        ) => {
            from == sender
                && at.as_deref() == *path
                && on.as_deref() == *interface
                && heard.as_deref() == *member
        }
        (
            Readout::Spawn { argv, env },
            SystemRequest::Spawn {
                argv: run,
                cwd: None,
                env: with,
                stdin: false,
            },
        ) => {
            argv.len() == run.len()
                && argv
                    .iter()
                    .zip(run)
                    .all(|(word, arg)| word_fits(*word, arg))
                && *with == environment(env)
        }
        _ => false,
    }
}

fn word_fits(word: Word, arg: &str) -> bool {
    match word {
        Word::Is(is) => arg == is,
        Word::OneOf(words) => words.contains(&arg),
        Word::Name => !arg.is_empty(),
        Word::Whole => !arg.is_empty() && arg.bytes().all(|byte| byte.is_ascii_digit()),
    }
}

/// Whether `body`, JSON text, holds one value per word that fits it.
fn body_fits(words: &[Word], body: &str) -> bool {
    match serde_json::from_str::<Json>(body) {
        Ok(Json::Array(values)) => {
            values.len() == words.len()
                && words.iter().zip(&values).all(|(word, value)| match word {
                    Word::Whole => value.is_u64(),
                    _ => value.as_str().is_some_and(|text| word_fits(*word, text)),
                })
        }
        _ => false,
    }
}

fn environment(env: &[(&str, &str)]) -> BTreeMap<String, String> {
    env.iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}
