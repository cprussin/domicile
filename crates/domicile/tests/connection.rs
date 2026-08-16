//! Unit test for the connection loop, written before the implementation.

use std::io::Cursor;

use domicile::run_connection;
use dm_host::ipc::Session;

#[test]
fn connection_loop_answers_hello_and_stops_at_eof() {
    // Two lines: a handshake and a follow-up focus message, then EOF.
    let input = concat!(
        "{\"type\":\"hello\",\"protocol_version\":1}\n",
        "{\"type\":\"focus_chrome\"}\n",
    );
    let reader = Cursor::new(input.as_bytes().to_vec());
    let mut output: Vec<u8> = Vec::new();
    let mut session = Session::new();

    run_connection(reader, &mut output, &mut session).unwrap();

    let text = String::from_utf8(output).unwrap();
    // The handshake produced exactly one welcome line; focus_chrome is silent.
    assert_eq!(text.matches("\"welcome\"").count(), 1);
    assert!(session.is_ready());
}
