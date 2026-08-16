//! Unit test for the connection loop, written before the implementation.

use std::io::Cursor;

use domicile::run_connection;
use domicile_host::ipc::Session;
use domicile_protocol::PROTOCOL_VERSION;

#[test]
fn connection_loop_answers_hello_and_stops_at_eof() {
    // Two lines: a handshake and a follow-up focus message, then EOF.
    let input = format!(
        "{{\"type\":\"hello\",\"protocol_version\":{PROTOCOL_VERSION}}}\n{{\"type\":\"focus_chrome\"}}\n"
    );
    let reader = Cursor::new(input.into_bytes());
    let mut output: Vec<u8> = Vec::new();
    let mut session = Session::new();

    run_connection(reader, &mut output, &mut session).unwrap();

    let text = String::from_utf8(output).unwrap();
    // The handshake produced exactly one welcome line; focus_chrome is silent.
    assert_eq!(text.matches("\"welcome\"").count(), 1);
    assert!(session.is_ready());
}
