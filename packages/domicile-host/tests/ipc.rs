//! Tests for the host<->chrome IPC seam, written before the implementation.
//!
//! Messages are newline-delimited JSON. A `Session` wraps the host: it performs
//! the version handshake and, once ready, feeds chrome messages into the host
//! brain. The final test drives a real `UnixStream` to prove the framing works
//! over an actual socket.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::thread;

use domicile_host::ipc::{parse_chrome, to_line, Session};
use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};

#[test]
fn hello_completes_the_handshake_with_a_welcome_and_the_desktop() {
    // Two messages, in this order. The desktop rides with the handshake
    // because a chrome has no other way to learn what it is laying out
    // against — and it comes second, after the version it is written in has
    // been agreed.
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
fn messages_before_the_handshake_are_ignored() {
    let mut session = Session::new();
    session.host_mut().app_appeared(None, Some((100.0, 100.0)));
    // Not ready yet: a place is dropped rather than applied.
    let _ = session.ingest(&to_line(&ChromeMessage::PlacePortal {
        app_id: "app-1".into(),
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        size: [100.0, 100.0],
        z_index: 0,
        visible: true,
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: None,
        native: true,
        takes_pointer: true,
    }));
    assert_eq!(session.host_mut().scene().len(), 0);
}

#[test]
fn placement_after_handshake_reaches_the_host() {
    let mut session = Session::new();
    let (id, _) = session.host_mut().app_appeared(None, Some((100.0, 100.0)));
    session.ingest(&to_line(&ChromeMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
    }));

    session.ingest(&to_line(&ChromeMessage::PlacePortal {
        app_id: id.clone(),
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        size: [100.0, 100.0],
        z_index: 0,
        visible: true,
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: None,
        native: true,
        takes_pointer: true,
    }));
    assert_eq!(session.host_mut().scene().len(), 1);
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
