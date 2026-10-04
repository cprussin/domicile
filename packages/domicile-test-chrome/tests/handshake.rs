//! Tests for the chrome handshake and reading, using in-memory buffers.

use std::io::{BufReader, Cursor, Read};
use std::time::Duration;

use domicile_protocol::{HostMessage, PROTOCOL_VERSION};
use domicile_test_chrome::{greet, hear, ChromeError};

/// A host's welcome as a wire line.
fn welcome(version: u32) -> String {
    format!("{{\"type\":\"welcome\",\"protocol_version\":{version}}}\n")
}

#[test]
fn a_greeting_says_which_version_it_speaks() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(welcome(PROTOCOL_VERSION).into_bytes());

    greet(&mut heard, &mut said, Duration::from_secs(2)).expect("the host agreed");

    let line = String::from_utf8(said).expect("what we said is text");
    assert_eq!(
        line,
        format!("{{\"type\":\"hello\",\"protocol_version\":{PROTOCOL_VERSION}}}\n")
    );
}

#[test]
fn a_host_that_agrees_is_a_chrome_that_can_go_on() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(welcome(PROTOCOL_VERSION).into_bytes());

    let greeting = greet(&mut heard, &mut said, Duration::from_secs(2)).expect("the host agreed");

    assert_eq!(greeting.agreed, PROTOCOL_VERSION);
    assert_eq!(greeting.early, vec![], "nothing came before it here");
}

/// A version mismatch is an error naming both versions, not a timeout.
#[test]
fn a_host_speaking_another_version_is_refused_here() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(welcome(PROTOCOL_VERSION + 1).into_bytes());

    let err =
        greet(&mut heard, &mut said, Duration::from_secs(2)).expect_err("the versions differ");

    assert_eq!(
        err,
        ChromeError::ProtocolMismatch {
            host: PROTOCOL_VERSION + 1,
            chrome: PROTOCOL_VERSION,
        }
    );
}

/// A host that closes without answering is reported as closed, not as a
/// version mismatch.
#[test]
fn a_host_that_says_nothing_is_not_a_version_problem() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(Vec::new());

    let err = greet(&mut heard, &mut said, Duration::from_secs(2)).expect_err("nothing came back");

    assert_eq!(err, ChromeError::Closed);
}

/// The welcome is matched by type, not position.
///
/// A broadcast can reach the socket before the welcome.
#[test]
fn a_message_that_arrives_before_the_welcome_is_kept_rather_than_refused() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(
        [
            "{\"type\":\"focus_changed\",\"app_id\":null}\n".to_string(),
            welcome(PROTOCOL_VERSION),
        ]
        .concat()
        .into_bytes(),
    );

    let greeting =
        greet(&mut heard, &mut said, Duration::from_secs(2)).expect("the welcome is still found");

    assert_eq!(greeting.agreed, PROTOCOL_VERSION);
    assert!(
        matches!(
            greeting.early.as_slice(),
            [HostMessage::FocusChanged { .. }]
        ),
        "what came first is kept: {:?}",
        greeting.early
    );
}

/// Messages after the handshake are read back in order.
#[test]
fn what_the_host_says_next_is_read_back_in_order() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(
        [
            welcome(PROTOCOL_VERSION),
            "{\"type\":\"focus_changed\",\"app_id\":null}\n".to_string(),
            "{\"type\":\"app_closed\",\"app_id\":\"app-2\"}\n".to_string(),
        ]
        .concat()
        .into_bytes(),
    );

    greet(&mut heard, &mut said, Duration::from_secs(2)).expect("the host agreed");
    let first = hear(&mut heard).expect("a message");
    let second = hear(&mut heard).expect("a message");

    assert!(
        matches!(first, Some(HostMessage::FocusChanged { .. })),
        "got {first:?}"
    );
    assert!(
        matches!(second, Some(HostMessage::AppClosed { ref app_id }) if app_id == "app-2"),
        "got {second:?}"
    );
    assert_eq!(
        hear(&mut heard).expect("the end"),
        None,
        "a closed connection is the end rather than an error"
    );
}

/// A host that keeps talking without a welcome hits the deadline.
///
/// Every read succeeds, so only the overall deadline, not a read timeout, can
/// stop it.
#[test]
fn a_host_that_talks_without_welcoming_gives_up_and_says_what_it_heard() {
    let mut said = Vec::new();
    let mut heard = BufReader::new(Chatty);

    let err =
        greet(&mut heard, &mut said, Duration::from_millis(50)).expect_err("no welcome ever came");

    let ChromeError::NeverCame { heard } = err else {
        panic!("got {err:?}");
    };
    assert!(
        heard.contains("focus_changed"),
        "the failure carries what did come: {heard}"
    );
}

/// A read timeout is reported the same way as the deadline.
#[test]
fn a_read_that_runs_out_of_time_is_the_same_answer_as_the_deadline() {
    let mut said = Vec::new();
    let mut heard = BufReader::new(Mute);

    let err = greet(&mut heard, &mut said, Duration::from_secs(2)).expect_err("the read timed out");

    assert_eq!(
        err,
        ChromeError::NeverCame {
            heard: "nothing at all".to_string()
        }
    );
}

/// A reader that repeats one message forever and never welcomes.
struct Chatty;

impl Read for Chatty {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let line = b"{\"type\":\"focus_changed\",\"app_id\":null}\n";
        let taken = buffer.len().min(line.len());
        buffer[..taken].copy_from_slice(&line[..taken]);
        Ok(taken)
    }
}

/// A reader whose every read times out.
struct Mute;

impl Read for Mute {
    fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
        Err(std::io::Error::from(std::io::ErrorKind::WouldBlock))
    }
}
