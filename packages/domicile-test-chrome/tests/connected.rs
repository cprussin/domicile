//! Tests for `Chrome` on a real socket: deadlines and the message transcript.

use std::io::Write;
use std::os::unix::net::UnixStream;
use std::time::Duration;

use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};
use domicile_test_chrome::{Chrome, ChromeError};

/// A socket pair: the first end plays the host.
fn a_host() -> (UnixStream, UnixStream) {
    UnixStream::pair().expect("a socket pair")
}

fn welcome(mut host: &UnixStream) {
    writeln!(
        host,
        "{{\"type\":\"welcome\",\"protocol_version\":{PROTOCOL_VERSION}}}"
    )
    .expect("the host can write");
}

#[test]
fn waiting_finds_a_message_the_host_sends_later() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");

    let sender = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        let mut host = host;
        writeln!(host, "{{\"type\":\"focus_changed\",\"app_id\":null}}").expect("write");
        writeln!(host, "{{\"type\":\"app_closed\",\"app_id\":\"app-7\"}}").expect("write");
        host
    });

    let found = chrome
        .wait_for(
            |message| matches!(message, HostMessage::AppClosed { ref app_id } if app_id == "app-7"),
        )
        .expect("it arrives");

    assert!(matches!(found, HostMessage::AppClosed { ref app_id } if app_id == "app-7"));
    drop(sender.join().expect("the sender finishes"));
}

/// A wait that times out reports what did arrive.
#[test]
fn waiting_for_something_that_never_comes_says_what_did() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_millis(200)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "{{\"type\":\"focus_changed\",\"app_id\":null}}").expect("write");

    let err = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect_err("nothing like that is coming");

    match err {
        ChromeError::NeverCame { heard } => {
            assert!(
                heard.contains("focus_changed"),
                "it should say what did arrive: {heard}"
            );
        }
        other => panic!("expected a deadline, got {other:?}"),
    }
}

/// A host that closes mid-wait is reported as closed, not as a timeout.
#[test]
fn a_host_that_leaves_mid_wait_says_so() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");
    drop(host);

    let err = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect_err("the host is gone");

    assert!(matches!(err, ChromeError::Closed), "got {err:?}");
}

/// Connecting to a socket nobody listens on names the socket and the wait.
#[test]
fn a_socket_nobody_answers_says_which_one_and_for_how_long() {
    let directory = tempfile::tempdir().expect("a directory");
    let socket = directory.path().join("nobody-here.sock");

    let refused = Chrome::connect(&socket, Duration::from_millis(50));

    let Err(ChromeError::NeverListened {
        socket: named,
        patience,
        ..
    }) = refused
    else {
        panic!("there was nothing to connect to");
    };
    assert_eq!(named, socket.display().to_string());
    assert_eq!(patience, Duration::from_millis(50));
}

/// A second wait for the same shape needs a second message.
///
/// Otherwise a test that waits for a change would pass on the earlier message.
#[test]
fn waiting_twice_for_one_shape_waits_for_a_second_message() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "{{\"type\":\"app_closed\",\"app_id\":\"app-1\"}}").expect("write");

    let first = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("the first one");
    // Sent after the first wait returns, so only the returned marks can tell
    // the two apart.
    writeln!(host, "{{\"type\":\"app_closed\",\"app_id\":\"app-2\"}}").expect("write");
    let second = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("the second one");

    assert!(
        matches!(first, HostMessage::AppClosed { ref app_id } if app_id == "app-1"),
        "{first:?}"
    );
    assert!(
        matches!(second, HostMessage::AppClosed { ref app_id } if app_id == "app-2"),
        "the second wait was answered by the first message: {second:?}"
    );
}

/// A message that arrived before the welcome can answer the first wait.
///
/// The desktop arrives with the handshake, so most first waits rely on this.
#[test]
fn a_message_that_beat_the_handshake_still_answers_the_first_wait() {
    let (host, ours) = a_host();
    let mut writing = &host;
    writeln!(writing, "{{\"type\":\"app_closed\",\"app_id\":\"app-9\"}}").expect("write");
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");

    let found = chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("what came before the welcome is still waitable");

    assert!(
        matches!(found, HostMessage::AppClosed { ref app_id } if app_id == "app-9"),
        "{found:?}"
    );
}

/// A message skipped by one wait is still available to the next.
///
/// The host promises no order, so messages ahead of a match must not be lost.
#[test]
fn a_message_passed_over_by_one_wait_is_still_there_for_the_next() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_millis(200)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "{{\"type\":\"focus_changed\",\"app_id\":null}}").expect("write");
    writeln!(host, "{{\"type\":\"app_closed\",\"app_id\":\"app-1\"}}").expect("write");

    chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("the message, found behind the focus change");
    let passed_over =
        chrome.wait_for(|message| matches!(message, HostMessage::FocusChanged { .. }));

    assert!(
        passed_over.is_ok(),
        "what arrived first was never handed to anybody: {passed_over:?}"
    );
}

/// An unparseable line is reported with the line itself.
#[test]
fn a_line_that_is_not_a_message_is_reported_with_the_line() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_millis(500)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "not json at all").expect("write");

    let refused = chrome.wait_for(|message| matches!(message, HostMessage::AppClosed { .. }));

    let Err(ChromeError::Unreadable { line, .. }) = refused else {
        panic!("got {refused:?}");
    };
    assert_eq!(line, "not json at all");
}

/// Writing to a closed host is an I/O error.
///
/// A silently dropped write would later surface as a misleading `NeverCame`.
#[test]
fn saying_something_to_a_host_that_has_gone_says_so() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");
    drop(host);

    // One write is enough: a closed `AF_UNIX` peer fails the first write with
    // `EPIPE`, unlike TCP, which may buffer it.
    let said = chrome.say(&ChromeMessage::SetDevicePixelRatio { ratio: 2.0 });

    assert!(
        matches!(said, Err(ChromeError::Io(_))),
        "a write to a closed socket is an I/O failure: {said:?}"
    );
}
