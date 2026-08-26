//! A chrome on a real socket: the deadlines, and keeping what it heard.

use std::io::Write;
use std::os::unix::net::UnixStream;
use std::time::Duration;

use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};
use domicile_test_chrome::{Chrome, ChromeError};

/// A host on the other end of a socket pair, as a test can play one.
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
        writeln!(host, "{{\"type\":\"render_band\",\"band\":7}}").expect("write");
        host
    });

    let found = chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { band: 7 }))
        .expect("it arrives");

    assert!(matches!(found, HostMessage::RenderBand { band: 7 }));
    drop(sender.join().expect("the sender finishes"));
}

/// The failure that matters most in a test: the thing never came. It has to be
/// a deadline rather than a hang, and it has to say what *did* arrive — a wait
/// that reports only "timed out" sends the reader to the compositor's log to
/// find out what happened instead.
#[test]
fn waiting_for_something_that_never_comes_says_what_did() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_millis(200)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "{{\"type\":\"focus_changed\",\"app_id\":null}}").expect("write");

    let err = chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { .. }))
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

/// A host that goes away while a test is waiting is a compositor that died,
/// and that is a different report from one that is merely slow.
#[test]
fn a_host_that_leaves_mid_wait_says_so() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");
    drop(host);

    let err = chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { .. }))
        .expect_err("the host is gone");

    assert!(matches!(err, ChromeError::Closed), "got {err:?}");
}

/// A socket nothing is listening on, waited out.
///
/// The most common way a compositor test fails first, so it has to say which
/// socket and for how long: a bare `NotFound` reads like a bug in the stand-in
/// rather than a compositor that never came up.
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

/// A wait is for the *next* such message, not for any such message.
///
/// The bug this exists for: with no cursor, a test that waits for a desktop,
/// makes something change, and waits for a desktop again is answered the
/// second time by the first frame — and passes in milliseconds against a
/// compositor that did nothing at all.
#[test]
fn waiting_twice_for_one_shape_waits_for_a_second_message() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "{{\"type\":\"render_band\",\"band\":1}}").expect("write");

    let first = chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { .. }))
        .expect("the first one");
    // Sent only after the first wait has been answered, so nothing but a
    // cursor can tell the two apart.
    writeln!(host, "{{\"type\":\"render_band\",\"band\":2}}").expect("write");
    let second = chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { .. }))
        .expect("the second one");

    assert!(
        matches!(first, HostMessage::RenderBand { band: 1 }),
        "{first:?}"
    );
    assert!(
        matches!(second, HostMessage::RenderBand { band: 2 }),
        "the second wait was answered by the first message: {second:?}"
    );
}

/// And the same wait still finds what arrived before it was asked for.
///
/// The other half of the cursor, and the reason it starts where it does: the
/// desktop rides with the handshake, so a compositor test's first wait is
/// usually answered from the transcript rather than from the socket. A cursor
/// that skipped what `greet` collected would break every one of them.
#[test]
fn a_message_that_beat_the_handshake_still_answers_the_first_wait() {
    let (host, ours) = a_host();
    let mut writing = &host;
    writeln!(writing, "{{\"type\":\"render_band\",\"band\":9}}").expect("write");
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");

    let found = chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { .. }))
        .expect("what came before the welcome is still waitable");

    assert!(
        matches!(found, HostMessage::RenderBand { band: 9 }),
        "{found:?}"
    );
}

/// And a message that arrived *before* the one a wait matched is still there.
///
/// The other half of the mark, and why it is per-message rather than a
/// high-water mark. The host promises no order: a chrome joins the
/// compositor's broadcast list at connect rather than at handshake, so
/// something can land ahead of what a test is waiting for. A cursor that
/// skipped the whole prefix threw it away — and the next wait for it sat out
/// its full patience, then reported the compositor for something it had done,
/// quoting the missing message in its own "never came" transcript.
#[test]
fn a_message_passed_over_by_one_wait_is_still_there_for_the_next() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_millis(200)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "{{\"type\":\"focus_changed\",\"app_id\":null}}").expect("write");
    writeln!(host, "{{\"type\":\"render_band\",\"band\":1}}").expect("write");

    chrome
        .wait_for(|message| matches!(message, HostMessage::RenderBand { .. }))
        .expect("the band, found behind the focus change");
    let passed_over =
        chrome.wait_for(|message| matches!(message, HostMessage::FocusChanged { .. }));

    assert!(
        passed_over.is_ok(),
        "what arrived first was never handed to anybody: {passed_over:?}"
    );
}

/// A line that is not a message this chrome can read says which line.
///
/// The failure the first client-driven test will meet: `app_frame` is a header
/// line followed by the pixels themselves on the same socket, and this reads
/// newline-delimited JSON with no notion of that. Naming the line is the
/// difference between "the stand-in does not speak frames" and a mystery.
#[test]
fn a_line_that_is_not_a_message_is_reported_with_the_line() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_millis(500)).expect("the handshake works");
    let mut host = host;
    writeln!(host, "not json at all").expect("write");

    let refused = chrome.wait_for(|message| matches!(message, HostMessage::RenderBand { .. }));

    let Err(ChromeError::Unreadable { line, .. }) = refused else {
        panic!("got {refused:?}");
    };
    assert_eq!(line, "not json at all");
}

/// Saying something to a host that has gone is an I/O failure, not a wait.
///
/// `say` is the one place this stand-in writes, and a socket whose peer has
/// closed is what a test that outlives its compositor hits. Reported as what
/// it is rather than swallowed: a write that silently did nothing would turn
/// into a `NeverCame` about the answer, blaming the compositor for not
/// replying to something it was never sent.
#[test]
fn saying_something_to_a_host_that_has_gone_says_so() {
    let (host, ours) = a_host();
    welcome(&host);
    let mut chrome = Chrome::on(ours, Duration::from_secs(2)).expect("the handshake works");
    drop(host);

    // Once. A closed `AF_UNIX` peer is known to the kernel at the moment of
    // the call, so this is `EPIPE` on the first write — there is no buffered
    // send to lose a race against, the way there would be over TCP.
    let said = chrome.say(&ChromeMessage::SetDevicePixelRatio { ratio: 2.0 });

    assert!(
        matches!(said, Err(ChromeError::Io(_))),
        "a write to a closed socket is an I/O failure: {said:?}"
    );
}
