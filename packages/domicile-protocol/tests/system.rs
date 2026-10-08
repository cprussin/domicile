//! Wire shapes for the shell's system access: files, processes and watches.
//!
//! Pinned as JSON because the SDK hard-codes them. See
//! `docs/SHELL-SYSTEM-ACCESS.md`.

use std::collections::BTreeMap;

use domicile_protocol::{
    Bus, ChromeMessage, DirEntry, FileType, HostMessage, Signal, Stream, SystemEnd, SystemError,
    SystemErrorKind, SystemEvent, SystemReply, SystemRequest,
};

fn chrome(json: &str) -> ChromeMessage {
    serde_json::from_str(json).expect("a chrome message")
}

fn host(message: &HostMessage) -> String {
    serde_json::to_string(message).expect("it serializes")
}

#[test]
fn file_calls_name_a_path() {
    assert_eq!(
        chrome(
            r#"{"type":"system_request","id":1,"request":{"call":"read_file","path":"/sys/x"}}"#
        ),
        ChromeMessage::SystemRequest {
            id: 1,
            request: SystemRequest::ReadFile {
                path: "/sys/x".into(),
                offset: 0,
                length: None,
            },
        }
    );
    assert_eq!(
        chrome(
            r#"{"type":"system_request","id":1,"request":{"call":"read_file","path":"a","offset":10,"length":4}}"#
        ),
        ChromeMessage::SystemRequest {
            id: 1,
            request: SystemRequest::ReadFile {
                path: "a".into(),
                offset: 10,
                length: Some(4),
            },
        }
    );
    assert_eq!(
        chrome(
            r#"{"type":"system_request","id":2,"request":{"call":"write_file","path":"a","data":"aGk=","atomic":true}}"#
        ),
        ChromeMessage::SystemRequest {
            id: 2,
            request: SystemRequest::WriteFile {
                path: "a".into(),
                data: "aGk=".into(),
                atomic: true,
            },
        }
    );
    assert_eq!(
        chrome(r#"{"type":"system_request","id":3,"request":{"call":"read_dir","path":"/"}}"#),
        ChromeMessage::SystemRequest {
            id: 3,
            request: SystemRequest::ReadDir { path: "/".into() },
        }
    );
    assert_eq!(
        chrome(r#"{"type":"system_request","id":4,"request":{"call":"stat","path":"/"}}"#),
        ChromeMessage::SystemRequest {
            id: 4,
            request: SystemRequest::Stat { path: "/".into() },
        }
    );
}

#[test]
fn a_watch_is_started_and_stopped_by_its_id() {
    assert_eq!(
        chrome(r#"{"type":"system_request","id":5,"request":{"call":"watch","path":"/tmp"}}"#),
        ChromeMessage::SystemRequest {
            id: 5,
            request: SystemRequest::Watch {
                path: "/tmp".into()
            },
        }
    );
    assert_eq!(
        chrome(r#"{"type":"system_request","id":5,"request":{"call":"unwatch"}}"#),
        ChromeMessage::SystemRequest {
            id: 5,
            request: SystemRequest::Unwatch,
        }
    );
}

#[test]
fn a_process_is_an_argv_and_is_driven_by_its_id() {
    assert_eq!(
        chrome(
            r#"{"type":"system_request","id":6,"request":{"call":"spawn","argv":["pactl","subscribe"],"cwd":"/tmp","env":{"LANG":"C"},"stdin":true}}"#
        ),
        ChromeMessage::SystemRequest {
            id: 6,
            request: SystemRequest::Spawn {
                argv: vec!["pactl".into(), "subscribe".into()],
                cwd: Some("/tmp".into()),
                env: BTreeMap::from([("LANG".into(), "C".into())]),
                stdin: true,
            },
        }
    );
    assert_eq!(
        chrome(r#"{"type":"system_request","id":6,"request":{"call":"stdin","data":"aGk="}}"#),
        ChromeMessage::SystemRequest {
            id: 6,
            request: SystemRequest::Stdin {
                data: "aGk=".into()
            },
        }
    );
    assert_eq!(
        chrome(r#"{"type":"system_request","id":6,"request":{"call":"close_stdin"}}"#),
        ChromeMessage::SystemRequest {
            id: 6,
            request: SystemRequest::CloseStdin,
        }
    );
    assert_eq!(
        chrome(r#"{"type":"system_request","id":6,"request":{"call":"kill","signal":"term"}}"#),
        ChromeMessage::SystemRequest {
            id: 6,
            request: SystemRequest::Kill {
                signal: Signal::Term
            },
        }
    );
}

/// `cwd` and `env` may be left out; the process then runs in the home with the
/// compositor's environment.
#[test]
fn a_spawn_needs_only_its_argv() {
    assert_eq!(
        chrome(r#"{"type":"system_request","id":7,"request":{"call":"spawn","argv":["true"]}}"#),
        ChromeMessage::SystemRequest {
            id: 7,
            request: SystemRequest::Spawn {
                argv: vec!["true".into()],
                cwd: None,
                env: BTreeMap::new(),
                stdin: false,
            },
        }
    );
}

#[test]
fn replies_carry_the_requests_id() {
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 1,
            reply: SystemReply::Read {
                data: "aGk=".into()
            },
        }),
        r#"{"type":"system_reply","id":1,"reply":{"kind":"read","data":"aGk="}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 2,
            reply: SystemReply::Written,
        }),
        r#"{"type":"system_reply","id":2,"reply":{"kind":"written"}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 3,
            reply: SystemReply::Entries {
                entries: vec![DirEntry {
                    name: "BAT0".into(),
                    file_type: FileType::Symlink,
                }],
            },
        }),
        r#"{"type":"system_reply","id":3,"reply":{"kind":"entries","entries":[{"name":"BAT0","file_type":"symlink"}]}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 4,
            reply: SystemReply::Stat {
                file_type: FileType::Directory,
                size: 4096,
                modified_ms: Some(1_700_000_000_000),
            },
        }),
        r#"{"type":"system_reply","id":4,"reply":{"kind":"stat","file_type":"directory","size":4096,"modified_ms":1700000000000}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 6,
            reply: SystemReply::Started,
        }),
        r#"{"type":"system_reply","id":6,"reply":{"kind":"started"}}"#
    );
}

#[test]
fn a_failure_says_what_kind_it_was() {
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 1,
            reply: SystemReply::Failed {
                error: SystemError {
                    kind: SystemErrorKind::NotFound,
                    message: "No such file or directory (os error 2)".into(),
                },
            },
        }),
        r#"{"type":"system_reply","id":1,"reply":{"kind":"failed","error":{"kind":"not_found","message":"No such file or directory (os error 2)"}}}"#
    );
}

#[test]
fn a_stream_sends_events_then_one_end() {
    assert_eq!(
        host(&HostMessage::SystemEvent {
            id: 6,
            event: SystemEvent::Output {
                stream: Stream::Stdout,
                data: "aGk=".into(),
            },
        }),
        r#"{"type":"system_event","id":6,"event":{"kind":"output","stream":"stdout","data":"aGk="}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemEvent {
            id: 5,
            event: SystemEvent::Changed {
                path: "/tmp/a".into()
            },
        }),
        r#"{"type":"system_event","id":5,"event":{"kind":"changed","path":"/tmp/a"}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemEnd {
            id: 6,
            end: SystemEnd::Exited {
                code: None,
                signal: Some(15),
            },
        }),
        r#"{"type":"system_end","id":6,"end":{"kind":"exited","code":null,"signal":15}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemEnd {
            id: 5,
            end: SystemEnd::Stopped,
        }),
        r#"{"type":"system_end","id":5,"end":{"kind":"stopped"}}"#
    );
    assert_eq!(
        host(&HostMessage::SystemEnd {
            id: 5,
            end: SystemEnd::Failed {
                error: SystemError {
                    kind: SystemErrorKind::Other,
                    message: "the watch broke".into(),
                },
            },
        }),
        r#"{"type":"system_end","id":5,"end":{"kind":"failed","error":{"kind":"other","message":"the watch broke"}}}"#
    );
}

/// D-Bus bodies cross as JSON text, read against the D-Bus signature beside
/// them, so this crate stays serde-only.
#[test]
fn a_d_bus_call_names_its_method_and_carries_a_typed_body() {
    assert_eq!(
        chrome(
            r#"{"type":"system_request","id":8,"request":{"call":"dbus_call","bus":"system","destination":"org.freedesktop.UPower","path":"/org/freedesktop/UPower/devices/DisplayDevice","interface":"org.freedesktop.DBus.Properties","member":"GetAll","signature":"s","body":"[\"org.freedesktop.UPower.Device\"]"}}"#
        ),
        ChromeMessage::SystemRequest {
            id: 8,
            request: SystemRequest::DbusCall {
                bus: Bus::System,
                destination: "org.freedesktop.UPower".into(),
                path: "/org/freedesktop/UPower/devices/DisplayDevice".into(),
                interface: "org.freedesktop.DBus.Properties".into(),
                member: "GetAll".into(),
                signature: "s".into(),
                body: r#"["org.freedesktop.UPower.Device"]"#.into(),
            },
        }
    );
    assert_eq!(
        host(&HostMessage::SystemReply {
            id: 8,
            reply: SystemReply::Returned {
                signature: "a{sv}".into(),
                body: "[{}]".into(),
            },
        }),
        r#"{"type":"system_reply","id":8,"reply":{"kind":"returned","signature":"a{sv}","body":"[{}]"}}"#
    );
}

/// A match names any of the four fields a signal is routed by; the rest are
/// left open.
#[test]
fn a_d_bus_match_streams_the_signals_it_names() {
    assert_eq!(
        chrome(
            r#"{"type":"system_request","id":9,"request":{"call":"dbus_match","bus":"session","interface":"org.freedesktop.DBus.Properties","member":"PropertiesChanged"}}"#
        ),
        ChromeMessage::SystemRequest {
            id: 9,
            request: SystemRequest::DbusMatch {
                bus: Bus::Session,
                sender: None,
                path: None,
                interface: Some("org.freedesktop.DBus.Properties".into()),
                member: Some("PropertiesChanged".into()),
            },
        }
    );
    assert_eq!(
        host(&HostMessage::SystemEvent {
            id: 9,
            event: SystemEvent::Signal {
                sender: ":1.4".into(),
                path: "/org/mpris/MediaPlayer2".into(),
                interface: "org.freedesktop.DBus.Properties".into(),
                member: "PropertiesChanged".into(),
                signature: "sa{sv}as".into(),
                body: r#"["org.mpris.MediaPlayer2.Player",{},[]]"#.into(),
            },
        }),
        r#"{"type":"system_event","id":9,"event":{"kind":"signal","sender":":1.4","path":"/org/mpris/MediaPlayer2","interface":"org.freedesktop.DBus.Properties","member":"PropertiesChanged","signature":"sa{sv}as","body":"[\"org.mpris.MediaPlayer2.Player\",{},[]]"}}"#
    );
}
