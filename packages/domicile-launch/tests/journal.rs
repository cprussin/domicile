//! Writing entries to the journal over its native protocol.
//!
//! The tests check the bytes journald reads, since a malformed entry is
//! dropped by journald without a word.

use std::os::unix::net::UnixDatagram;

use domicile_launch::journal::{self, Entry, Journal, Priority};

fn entry(message: &str) -> Entry {
    Entry {
        identifier: "domicile-engine",
        priority: Priority::Error,
        message: message.to_string(),
        fields: vec![("CODE_FILE", "dbus/bus.cc".to_string())],
    }
}

#[test]
fn an_entry_is_one_field_per_line() {
    assert_eq!(
        journal::encoded(&entry("the bus is gone")),
        b"PRIORITY=3\n\
          SYSLOG_IDENTIFIER=domicile-engine\n\
          MESSAGE=the bus is gone\n\
          CODE_FILE=dbus/bus.cc\n"
    );
}

#[test]
fn a_value_with_a_newline_is_sent_with_its_length() {
    // A bare newline would end the field and start a malformed one.
    let encoded = journal::encoded(&entry("two\nlines"));
    let mut expected = b"PRIORITY=3\nSYSLOG_IDENTIFIER=domicile-engine\nMESSAGE\n".to_vec();
    expected.extend_from_slice(&9u64.to_le_bytes());
    expected.extend_from_slice(b"two\nlines\n");
    expected.extend_from_slice(b"CODE_FILE=dbus/bus.cc\n");
    assert_eq!(encoded, expected);
}

#[test]
fn a_stream_is_the_journal_when_journal_stream_names_it() {
    // systemd sets `JOURNAL_STREAM` to the device and inode of the stream it
    // connected stdout and stderr to. A child whose stderr was redirected
    // inherits the variable, so the numbers must match.
    assert!(journal::names(Some("8:1234"), 8, 1234));
    assert!(!journal::names(Some("8:1234"), 8, 99));
    assert!(!journal::names(Some("8:1234"), 9, 1234));
    assert!(!journal::names(None, 8, 1234));
}

#[test]
fn a_sent_entry_reaches_the_socket_as_encoded() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("socket");
    let listening = UnixDatagram::bind(&path).expect("the socket binds");

    Journal::at(&path)
        .expect("it connects")
        .send(&entry("the bus is gone"))
        .expect("it sends");

    let mut received = vec![0; 4096];
    let length = listening.recv(&mut received).expect("it arrives");
    assert_eq!(
        &received[..length],
        journal::encoded(&entry("the bus is gone"))
    );
}
