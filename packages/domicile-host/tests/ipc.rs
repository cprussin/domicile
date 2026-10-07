//! Tests for the host-chrome IPC `Session`.
//!
//! Messages are newline-delimited JSON. A `Session` performs the version
//! handshake, then passes chrome messages to the `Host`.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::thread;

use domicile_host::ipc::{parse_chrome, to_line, Session};
use domicile_protocol::{
    AccessDialog, ChromeMessage, HostMessage, Notification, PortalKind, PortalRequest, Theme,
    TrayItem, Urgency, PROTOCOL_VERSION,
};

#[test]
fn hello_completes_the_handshake_with_a_welcome_and_the_desktop() {
    // The chrome needs the displays to lay out, and the theme to avoid a
    // first paint in the wrong one. Both follow the agreed version.
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
    // The session stays not ready but still sends a `Welcome` with its own
    // version. The chrome needs it to report the mismatch; without a reply
    // it would wait forever and fail silently.
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
    // The compositor broadcasts only to ready sessions. A page that later
    // sends an unsupported version cannot read those broadcasts, so `ready`
    // must go back to false.
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
    // No message takes effect before `Hello`.
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
    // The browser process reads this, not the page. Outside ChromeOS its
    // `XkbKeyboardLayoutEngine` has no keymap and resolves no printable keys,
    // so on a tty typing fails until it gets the compositor's keymap. A
    // reload opens a new channel, so the handshake must resend it.
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
    // The browser process installs these. A reload opens a new channel, so
    // the handshake resends the list, like the keymap.
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
fn the_keyboard_rides_with_the_handshake() {
    // A reloaded page has no resolved keys, so the handshake resends them.
    // They follow the keymap they were resolved against.
    let mut session = Session::new();
    session.host_mut().set_keymap(KEYMAP.into());
    session
        .host_mut()
        .set_shell_config([("Return".to_string(), 28)].into());

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
            keys: [("Return".to_string(), 28)].into(),
        })
    );
}

#[test]
fn the_tray_rides_with_the_handshake() {
    // A reloaded page missed earlier icons, and unchanged icons are not
    // resent.
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
    // Items emit signals without real changes, such as an unchanged tooltip.
    // Broadcasting each would redraw every bar for nothing.
    let mut session = Session::new();
    session.host_mut().set_tray(vec![]);

    assert_eq!(session.host_mut().set_tray(vec![]), None);
}

#[test]
fn a_host_nobody_gave_a_tray_says_nothing_about_one() {
    // The `domicile` daemon has no D-Bus connection, so it must not report
    // an empty tray.
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
    // The compositor owns notification history, so a reloaded page gets it
    // back. Sent after the tray.
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
    // Same as the tray: the `domicile` daemon has no D-Bus connection.
    let mut session = Session::new();

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert!(!out
        .iter()
        .any(|message| matches!(message, HostMessage::Notifications { .. })));
}

#[test]
fn the_portal_requests_ride_with_the_handshake() {
    // A reloaded page must still see a dialog an application is waiting on.
    let mut session = Session::new();
    let request = PortalRequest {
        id: 1,
        app_id: "org.example.App".into(),
        parent_app_id: None,
        kind: PortalKind::Access(AccessDialog {
            title: "Use the camera?".into(),
            subtitle: String::new(),
            body: String::new(),
            grant_label: None,
            deny_label: None,
        }),
    };
    let told = session
        .host_mut()
        .set_portal_requests(vec![request.clone()]);
    assert_eq!(
        told,
        Some(HostMessage::PortalRequests {
            items: vec![request.clone()]
        })
    );
    assert_eq!(
        session
            .host_mut()
            .set_portal_requests(vec![request.clone()]),
        None,
        "an unchanged list says nothing"
    );

    let out = session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    assert!(out.contains(&HostMessage::PortalRequests {
        items: vec![request]
    }));
}

/// A stand-in keymap. The host passes it through as text without compiling
/// it.
const KEYMAP: &str = "xkb_keymap { /* the compositor's */ };";
