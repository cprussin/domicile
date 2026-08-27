//! The half of the protocol a chrome speaks, checked without a compositor.

use std::io::{BufReader, Cursor, Read};
use std::time::Duration;

use domicile_protocol::{HostMessage, PROTOCOL_VERSION};
use domicile_test_chrome::{greet, hear, ChromeError};

/// What a host says back, as a line on the wire.
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

/// The failure a version bump produces, and the one a test must not mistake
/// for a compositor that is simply slow: the host answered, and its answer is
/// the refusal.
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

/// A host that closes without answering. Distinct from one that answered
/// wrongly, because the two mean different things: this is a compositor that
/// died, and the message has to say so rather than blame the version.
#[test]
fn a_host_that_says_nothing_is_not_a_version_problem() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(Vec::new());

    let err = greet(&mut heard, &mut said, Duration::from_secs(2)).expect_err("nothing came back");

    assert_eq!(err, ChromeError::Closed);
}

/// The welcome is waited for by type, not by position.
///
/// Not a hypothetical: the compositor adds a chrome to its broadcast list when
/// it *connects*, not when it handshakes, so anything broadcast in between
/// reaches the socket ahead of the reply. A stand-in that insisted the first
/// line be the welcome failed a test about the desktop with a complaint about
/// a greeting, one run in three under `--test-threads=8`.
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

/// Everything the host sends after the handshake, in order. A test asserts on
/// what a compositor *said*, so the reading has to keep them rather than match
/// one and drop the rest.
#[test]
fn what_the_host_says_next_is_read_back_in_order() {
    let mut said = Vec::new();
    let mut heard = Cursor::new(
        [
            welcome(PROTOCOL_VERSION),
            "{\"type\":\"focus_changed\",\"app_id\":null}\n".to_string(),
            "{\"type\":\"render_band\",\"band\":2}\n".to_string(),
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
        matches!(second, Some(HostMessage::RenderBand { band: 2 })),
        "got {second:?}"
    );
    assert_eq!(
        hear(&mut heard).expect("the end"),
        None,
        "a closed connection is the end rather than an error"
    );
}

/// A host that is talking but never welcoming.
///
/// The failure the deadline exists for, and one no read timeout catches: every
/// read succeeds, so a socket deadline never fires — only the clock does. Left
/// unbounded this is a hang, and a hang has no message at all.
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

/// A host that says nothing at all, on a socket that gives up waiting.
///
/// The read timeout arriving instead of the clock. It means the same thing, and
/// has to read the same way: what came, rather than a complaint about a socket
/// doing exactly what it was asked to.
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

/// A frame's pixels are consumed with its header, so the next message is read
/// as a message.
///
/// The whole point of reading the payload at all. Left on the socket, the next
/// `read_line` stops at whatever byte of RGBA happens to be `0x0a` and hands
/// back a fragment of image as a line of JSON — reported against the
/// compositor, which sent exactly what it promised.
///
/// The pixels here contain a `\n` on purpose: without one this passes whether
/// the payload is skipped or not.
#[test]
fn what_follows_a_frame_is_read_as_a_message() {
    let pixels = b"\x01\x0a\x02\x0a\x03\x0a\x04\x0a";
    let mut wire = frame_header(pixels.len() as u32).into_bytes();
    wire.extend_from_slice(pixels);
    wire.extend_from_slice(welcome(PROTOCOL_VERSION).as_bytes());
    let mut heard = BufReader::new(Cursor::new(wire));

    let frame = hear(&mut heard)
        .expect("the header reads")
        .expect("it came");
    assert!(
        matches!(frame, HostMessage::AppFrame { .. }),
        "got {frame:?}"
    );

    let next = hear(&mut heard)
        .expect("the message after it reads")
        .expect("it came");
    assert!(
        matches!(next, HostMessage::Welcome { .. }),
        "the message after a frame should be the welcome, got {next:?}"
    );
}

/// A frame carrying no pixels consumes none.
///
/// The boundary `take(0)` makes easy to get wrong in the other direction — a
/// skip that read *something* here would eat the next message's first line.
#[test]
fn a_frame_of_no_bytes_eats_nothing() {
    let mut wire = frame_header(0).into_bytes();
    wire.extend_from_slice(welcome(PROTOCOL_VERSION).as_bytes());
    let mut heard = BufReader::new(Cursor::new(wire));

    hear(&mut heard)
        .expect("the header reads")
        .expect("it came");
    let next = hear(&mut heard)
        .expect("the welcome reads")
        .expect("it came");
    assert!(matches!(next, HostMessage::Welcome { .. }), "got {next:?}");
}

/// A connection that ends mid-frame says so, with both counts.
///
/// Rather than `Closed`, whose message is "the host went away before it said
/// anything" — untrue of a host that said plenty and then stopped halfway
/// through an image, and the wrong place to send the reader looking.
#[test]
fn a_frame_cut_short_is_reported_with_what_was_promised() {
    let mut wire = frame_header(64).into_bytes();
    wire.extend_from_slice(b"only ten..");
    let mut heard = BufReader::new(Cursor::new(wire));

    let why = hear(&mut heard).expect_err("a frame that stops early is a failure");
    assert_eq!(
        why,
        ChromeError::TruncatedFrame {
            expected: 64,
            got: 10
        },
        "got {why:?}"
    );
}

/// A host with plenty to say and no welcome in it.
struct Chatty;

impl Read for Chatty {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let line = b"{\"type\":\"focus_changed\",\"app_id\":null}\n";
        let taken = buffer.len().min(line.len());
        buffer[..taken].copy_from_slice(&line[..taken]);
        Ok(taken)
    }
}

/// A socket whose read timeout has expired.
struct Mute;

impl Read for Mute {
    fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
        Err(std::io::Error::from(std::io::ErrorKind::WouldBlock))
    }
}

/// A frame's header, as a line on the wire.
fn frame_header(bytes: u32) -> String {
    format!(
        "{{\"type\":\"app_frame\",\"app_id\":\"a\",\"width\":2,\"height\":1,\
         \"scale\":1,\"format\":\"rgba\",\"bytes\":{bytes}}}\n"
    )
}
