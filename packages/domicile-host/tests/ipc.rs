//! Tests for the host<->chrome IPC seam, written before the implementation.
//!
//! Messages are newline-delimited JSON. A `Session` wraps the host: it performs
//! the version handshake and, once ready, feeds chrome messages into the host
//! brain. The final test drives a real `UnixStream` to prove the framing works
//! over an actual socket.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::thread;

use domicile_host::audio::Audio;
use domicile_host::ipc::{parse_chrome, to_line, Session};
use domicile_protocol::{
    ChromeMessage, HostMessage, KeyAction, KeyBinding, Notification, Shortcut, Theme, TrayItem,
    Urgency, PROTOCOL_VERSION,
};

#[test]
fn hello_completes_the_handshake_with_a_welcome_and_the_desktop() {
    // Three messages, in this order. The desktop rides with the handshake
    // because a chrome has no other way to learn what it is laying out
    // against — and it comes second, after the version it is written in has
    // been agreed. The theme rides for the same reason one layer up: it is
    // what the page paints in, and a page told it late paints once in the
    // wrong one.
    let mut session = Session::new();
    assert!(!session.is_ready());

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));
    assert!(session.is_ready());
    assert_eq!(
        out,
        vec![
            HostMessage::Welcome {
                protocol_version: PROTOCOL_VERSION
            },
            HostMessage::Displays { displays: vec![] },
            HostMessage::Theme { theme: Theme::Dark },
            HostMessage::WindowsTheme { theme: Theme::Dark },
        ]
    );
}

#[test]
fn version_mismatch_is_refused_out_loud() {
    // Refused — `ready` stays false and no desktop follows — but answered.
    // The chrome's own version-mismatch failure names both halves, and the
    // only thing that can trigger it is being told what this half speaks.
    // Answering with nothing leaves the page waiting on a `welcome` that is
    // never coming: a desktop that does not start and does not say why.
    let mut session = Session::new();

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: 999,
    }));

    assert!(!session.is_ready());
    assert_eq!(
        out,
        vec![HostMessage::Welcome {
            protocol_version: PROTOCOL_VERSION
        }],
        "a mismatched hello is told what this build speaks, and nothing else"
    );
}

#[test]
fn a_version_refused_after_one_was_agreed_takes_the_handshake_back() {
    // A flag that only ever goes up says "some hello here was accepted", and
    // the compositor reads it as "this connection is a peer" — it is what
    // decides who gets broadcast to. A page that agreed a version and then
    // announced one this build cannot speak has stopped being a peer, so
    // leaving it up hands protocol it cannot read to a page that has just
    // said so.
    let mut session = Session::new();
    session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));
    assert!(session.is_ready(), "the first hello agreed");

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: 999,
    }));

    assert!(!session.is_ready(), "the second took the agreement back");
    assert_eq!(
        out,
        vec![HostMessage::Welcome {
            protocol_version: PROTOCOL_VERSION
        }],
        "and it is still answered, so the page can report the mismatch"
    );
}

#[test]
fn messages_before_the_handshake_are_ignored() {
    // The vehicle is a focus rather than a placement now, but the rule is the
    // same one: nothing a page says counts until it has said hello.
    let mut session = Session::new();
    let (id, _) = session.host_mut().app_appeared(None, Some((100.0, 100.0)));
    let _ = session.ingest(&to_line(&ChromeMessage::FocusApp { app_id: id.clone() }));
    assert_eq!(
        session.host_mut().keyboard_target(),
        domicile_scene::KeyboardTarget::Chrome
    );
}

#[test]
fn a_message_after_the_handshake_reaches_the_host() {
    let mut session = Session::new();
    let (id, _) = session.host_mut().app_appeared(None, Some((100.0, 100.0)));
    session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    session.ingest(&to_line(&ChromeMessage::FocusApp { app_id: id.clone() }));
    assert_eq!(
        session.host_mut().keyboard_target(),
        domicile_scene::KeyboardTarget::App(id)
    );
}

#[test]
fn malformed_lines_are_ignored() {
    let mut session = Session::new();
    session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));
    // Should not panic.
    let out = session.ingest("{ this is not valid json");
    assert!(out.is_empty());
}

#[test]
fn line_codec_round_trips() {
    let line = to_line(&ChromeMessage::FocusApp {
        app_id: "term".into(),
    });
    assert!(line.ends_with('\n'), "messages are newline-delimited");
    let back = parse_chrome(line.trim()).unwrap();
    assert_eq!(
        back,
        ChromeMessage::FocusApp {
            app_id: "term".into()
        }
    );
}

#[test]
fn handshake_works_over_a_real_unix_socket() {
    let (client, server) = UnixStream::pair().unwrap();

    // Server side: read one line, run the session, write any responses back.
    let server_thread = thread::spawn(move || {
        let mut writer = server.try_clone().unwrap();
        let mut reader = BufReader::new(server);
        let mut session = Session::new();

        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        for msg in session.ingest(line.trim()) {
            writer.write_all(to_line(&msg).as_bytes()).unwrap();
        }
        session.is_ready()
    });

    // Client side: send hello, read welcome.
    let mut client_writer = client.try_clone().unwrap();
    client_writer
        .write_all(
            to_line(&ChromeMessage::Hello {
                protocol_version: PROTOCOL_VERSION,
            })
            .as_bytes(),
        )
        .unwrap();

    let mut client_reader = BufReader::new(client);
    let mut resp = String::new();
    client_reader.read_line(&mut resp).unwrap();
    let welcome: HostMessage = serde_json::from_str(resp.trim()).unwrap();

    assert_eq!(
        welcome,
        HostMessage::Welcome {
            protocol_version: PROTOCOL_VERSION
        }
    );
    assert!(
        server_thread.join().unwrap(),
        "server session reached ready"
    );
}

#[test]
fn a_keymap_the_compositor_compiled_rides_with_the_handshake() {
    // THE BROWSER PROCESS IS THE READER OF THIS ONE, not the page. Its
    // KeyboardLayoutEngine is a `XkbKeyboardLayoutEngine` with no keymap in
    // it — off ChromeOS nothing sets one, and it answers every printable key
    // with `No current XKB state` and an unidentified DomKey — so a desktop on
    // a tty types nothing until it is handed the keymap the compositor
    // compiled. Like the desktop above it is a fact rather than a stream, so
    // it rides with the handshake: a reload opens a new channel, and a channel
    // with no keymap on it is a keyboard that stopped working.
    let mut session = Session::new();
    session.host_mut().set_keymap(KEYMAP.into());

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert_eq!(
        out,
        vec![
            HostMessage::Welcome {
                protocol_version: PROTOCOL_VERSION
            },
            HostMessage::Displays { displays: vec![] },
            HostMessage::Theme { theme: Theme::Dark },
            HostMessage::WindowsTheme { theme: Theme::Dark },
            HostMessage::Keymap {
                keymap: KEYMAP.into()
            },
        ],
        "after the version it is written in, and after the desktop"
    );
}

#[test]
fn the_extensions_the_config_names_ride_with_the_handshake() {
    // The browser process installs these, and one whose page reloaded has a
    // new control channel -- so, like the keymap, the list is told again
    // rather than having had to be heard the first time.
    let mut session = Session::new();
    session.host_mut().set_keymap(KEYMAP.into());
    session.host_mut().set_extensions(
        vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".into()],
        vec!["/home/you/src/my-extension".into()],
    );

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert_eq!(
        out.last(),
        Some(&HostMessage::Extensions {
            web_store: vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".into()],
            unpacked: vec!["/home/you/src/my-extension".into()],
        }),
        "after the keymap, the other fact only the browser process reads"
    );
}

#[test]
fn the_keys_the_config_binds_ride_with_the_handshake() {
    // A shell that reloads has a new page with no bindings in it, and the
    // config is not going to be edited again to tell it. Right after the
    // keymap, which is the layout every shortcut in it was resolved against.
    let mut session = Session::new();
    session.host_mut().set_keymap(KEYMAP.into());
    let keybindings = [(
        "default".to_string(),
        vec![KeyBinding {
            shortcut: Shortcut {
                key: 28,
                alt: false,
                ctrl: false,
                shift: false,
                logo: true,
            },
            action: KeyAction::SendShell {
                args: vec!["terminal".into()],
            },
        }],
    )];
    session
        .host_mut()
        .set_shell_config(keybindings.clone().into(), [].into());

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    let keymap_at = out
        .iter()
        .position(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("the keymap rides with the handshake");
    assert_eq!(
        out.get(keymap_at + 1),
        Some(&HostMessage::ShellConfig {
            keybindings: keybindings.into(),
            shells: [].into(),
        })
    );
}

#[test]
fn the_tray_rides_with_the_handshake() {
    // A page that reloads has missed every icon that arrived before it, and
    // nothing re-sends one that has not changed.
    let mut session = Session::new();
    let icon = TrayItem {
        id: ":1.42/StatusNotifierItem".into(),
        title: "Network".into(),
        icon: None,
    };
    let told = session.host_mut().set_tray(vec![icon.clone()]);
    assert_eq!(
        told,
        Some(HostMessage::Tray {
            items: vec![icon.clone()]
        })
    );

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert_eq!(out.last(), Some(&HostMessage::Tray { items: vec![icon] }));
}

#[test]
fn a_tray_that_did_not_change_says_nothing() {
    // An item's signals fire for all sorts of reasons -- a tooltip that
    // said the same thing again -- and a broadcast for each would redraw
    // every bar on the desk over nothing.
    let mut session = Session::new();
    session.host_mut().set_tray(vec![]);

    assert_eq!(session.host_mut().set_tray(vec![]), None);
}

#[test]
fn a_host_nobody_gave_a_tray_says_nothing_about_one() {
    // The `domicile` daemon serves this protocol with no bus behind it, and
    // an empty tray from it would be a claim rather than a silence.
    let mut session = Session::new();

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert!(!out
        .iter()
        .any(|message| matches!(message, HostMessage::Tray { .. })));
}

#[test]
fn the_notifications_ride_with_the_handshake() {
    // Last, after the tray: a page that reloads keeps the desk's history,
    // which is the compositor's and not the page's.
    let mut session = Session::new();
    let notification = Notification {
        id: 7,
        app_name: "Firefox".into(),
        summary: "New message".into(),
        body: String::new(),
        icon: None,
        urgency: Urgency::Normal,
        actions: Vec::new(),
        clickable: false,
        timeout_ms: None,
        time: 1,
    };
    session.host_mut().set_tray(vec![]);
    let told = session
        .host_mut()
        .set_notifications(vec![notification.clone()]);
    assert_eq!(
        told,
        Some(HostMessage::Notifications {
            items: vec![notification.clone()]
        })
    );

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert_eq!(
        out.last(),
        Some(&HostMessage::Notifications {
            items: vec![notification]
        })
    );
}

#[test]
fn notifications_that_did_not_change_say_nothing() {
    let mut session = Session::new();
    session.host_mut().set_notifications(vec![]);

    assert_eq!(session.host_mut().set_notifications(vec![]), None);
}

#[test]
fn a_host_nobody_gave_notifications_says_nothing_about_them() {
    // The tray's reason: the `domicile` daemon has no bus to hear them on.
    let mut session = Session::new();

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert!(!out
        .iter()
        .any(|message| matches!(message, HostMessage::Notifications { .. })));
}

fn quiet_desk() -> Audio {
    Audio {
        outputs: Vec::new(),
        inputs: Vec::new(),
        playback: Vec::new(),
        recording: Vec::new(),
        cards: Vec::new(),
        meters: Default::default(),
    }
}

#[test]
fn the_audio_rides_with_the_handshake() {
    // Last, after the notifications: a mixer that has not moved is never
    // told again, so a page that reloads would draw none until it did.
    let mut session = Session::new();
    let told = session.host_mut().set_audio(quiet_desk());
    assert_eq!(told, Some(quiet_desk().message()));

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert_eq!(out.last(), Some(&quiet_desk().message()));
}

#[test]
fn audio_that_did_not_change_says_nothing() {
    // A drag sets one volume many times, and `pactl subscribe` reports each.
    let mut session = Session::new();
    session.host_mut().set_audio(quiet_desk());

    assert_eq!(session.host_mut().set_audio(quiet_desk()), None);
}

#[test]
fn a_host_with_no_sound_server_says_nothing_about_one() {
    let mut session = Session::new();

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert!(!out
        .iter()
        .any(|message| matches!(message, HostMessage::Audio { .. })));
}

/// Standing in for the real thing, which is some 40 kilobytes of
/// `xkb_keymap { ... }`. What crosses is text and nothing here compiles it.
const KEYMAP: &str = "xkb_keymap { /* the compositor's */ };";
