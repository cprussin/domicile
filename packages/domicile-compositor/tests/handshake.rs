//! Tests that broadcasts reach only chromes that agreed a protocol version.
//!
//! Unit tests cover the version refusal in `negotiate` and
//! `apply_chrome_message`. Broadcast membership is the hub's, so it needs a
//! running compositor. A reconfigure supplies the broadcast.

mod running;

use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};
use domicile_test_chrome::{hear, say, ChromeError};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

const TWO_DISPLAYS: &str = r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [2560, 1440] }
    ]
  }
}
"#;

/// How long to wait for a message that should not come.
///
/// Short because tests first wait for an accepted chrome to receive the
/// broadcast, so it has already gone out.
const LONG_ENOUGH_TO_HAVE_ARRIVED: Duration = Duration::from_secs(2);

/// How long to wait for a message that should come.
///
/// The config watcher coalesces events for up to two seconds, and the run
/// directory is never quiet, so a reload takes about two seconds. This must
/// be well above that; it only costs time when the test fails.
const AS_LONG_AS_THE_COMPOSITOR_TAKES: Duration = Duration::from_secs(20);

/// A chrome whose version was refused gets a `welcome` but no broadcasts.
#[test]
fn a_chrome_whose_version_was_refused_is_not_broadcast_to() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut refused = Raw::connected(&compositor);
    refused.say_hello(PROTOCOL_VERSION + 1);

    // The `welcome` lets the page report the mismatch instead of hanging.
    let answer = refused
        .next_message()
        .expect("a refused chrome is still told what this build speaks");
    assert!(
        matches!(answer, HostMessage::Welcome { .. }),
        "the refusal is a welcome carrying this build's version, got {answer:?}"
    );

    // An accepted chrome proves the broadcast happened.
    let mut accepted = compositor.chrome();
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    compositor.reconfigure(TWO_DISPLAYS);

    let described = accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("a chrome past the handshake is told the desktop changed");
    let HostMessage::Displays { displays } = described else {
        unreachable!("the wait matched on this");
    };
    assert_eq!(
        displays.len(),
        2,
        "the reconfigure is what is being broadcast"
    );

    let overheard = refused.next_message();
    assert!(
        overheard.is_none(),
        "a chrome told its version is wrong was then sent {overheard:?}"
    );
}

/// A chrome that has not said `hello` gets no broadcasts.
#[test]
fn a_chrome_that_has_not_said_hello_is_not_broadcast_to() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    // A real page is silent like this while its bundle loads.
    let mut silent = Raw::connected(&compositor);

    let mut accepted = compositor.chrome();
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    compositor.reconfigure(TWO_DISPLAYS);
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("a chrome past the handshake is told the desktop changed");

    let overheard = silent.next_message();
    assert!(
        overheard.is_none(),
        "a chrome that has agreed no version was sent {overheard:?}"
    );
}

/// A second `hello` on one socket does not add the chrome to the broadcast
/// list twice.
///
/// A duplicate entry sends every broadcast twice. A page that reloads its
/// bundle without closing the socket sends a second `hello`.
#[test]
fn a_chrome_that_says_hello_twice_is_only_in_the_list_once() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut twice = Raw::connected(&compositor);
    twice.say_hello(PROTOCOL_VERSION);
    twice.say_hello(PROTOCOL_VERSION);
    // Discard the handshake replies, which are sent regardless of the list.
    twice.drain();

    compositor.reconfigure(TWO_DISPLAYS);

    // Wait for the first description rather than timing it: this test has no
    // accepted chrome to wait on, and the short read timeout would race the
    // config watcher's two-second coalescing.
    twice.await_message(|message| matches!(message, HostMessage::Displays { .. }));

    // A duplicate would be sent in the same broadcast as the first, so a
    // short timeout is enough here.
    let described_again = twice.count(|message| matches!(message, HostMessage::Displays { .. }));
    assert_eq!(
        described_again,
        0,
        "one desktop, described {} times down one socket",
        described_again + 1
    );
}

/// A chrome that agrees a version and then sends an unsupported one is
/// removed from the broadcast list.
#[test]
fn a_chrome_that_takes_its_agreement_back_stops_getting_the_desktop() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut demoted = Raw::connected(&compositor);
    demoted.say_hello(PROTOCOL_VERSION);
    demoted.say_hello(PROTOCOL_VERSION + 1);
    demoted.drain();

    // An accepted chrome proves the broadcast happened.
    let mut accepted = compositor.chrome();
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    compositor.reconfigure(TWO_DISPLAYS);
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("a chrome past the handshake is told the desktop changed");

    let described = demoted.count(|message| matches!(message, HostMessage::Displays { .. }));
    assert_eq!(
        described, 0,
        "a chrome that took its agreement back was sent the desktop {described} times"
    );
}

/// A chrome that agrees again after a refusal rejoins the list exactly once.
///
/// The refusal must clear `joined`, or the `!joined` guard keeps the chrome
/// out for good.
#[test]
fn a_chrome_that_agrees_again_after_a_refusal_is_let_back_in_once() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut recovered = Raw::connected(&compositor);
    recovered.say_hello(PROTOCOL_VERSION);
    recovered.say_hello(PROTOCOL_VERSION + 1);
    recovered.say_hello(PROTOCOL_VERSION);
    recovered.drain();

    let mut accepted = compositor.chrome();
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");

    compositor.reconfigure(TWO_DISPLAYS);
    accepted
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("a chrome past the handshake is told the desktop changed");

    let described = recovered.count(|message| matches!(message, HostMessage::Displays { .. }));
    assert_eq!(
        described, 1,
        "a chrome that agreed again was described the desktop {described} times"
    );
}

/// A raw chrome socket, since `Chrome` always completes the handshake.
struct Raw {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
}

impl Raw {
    fn connected(compositor: &Compositor) -> Raw {
        let stream = UnixStream::connect(compositor.socket())
            .expect("the compositor published a socket to connect to");
        stream
            .set_read_timeout(Some(LONG_ENOUGH_TO_HAVE_ARRIVED))
            .expect("a read that can time out");
        let writer = stream.try_clone().expect("a second handle to write on");
        Raw {
            reader: BufReader::new(stream),
            writer,
        }
    }

    fn say_hello(&mut self, protocol_version: u32) {
        say(&mut self.writer, &ChromeMessage::Hello { protocol_version })
            .expect("the socket takes a hello");
    }

    /// The next message, or `None` on timeout, end of stream or reset.
    ///
    /// A dead compositor is caught by the accepted chrome each test keeps.
    /// Unparsable lines and other I/O errors panic, since treating them as
    /// silence would hide a message that was sent.
    fn next_message(&mut self) -> Option<HostMessage> {
        match hear(&mut self.reader) {
            Ok(message) => message,
            // No `BrokenPipe`: only writes get it.
            Err(ChromeError::Io(
                std::io::ErrorKind::WouldBlock
                | std::io::ErrorKind::TimedOut
                | std::io::ErrorKind::ConnectionReset,
            )) => None,
            Err(spoke) => panic!("the compositor was meant to be silent; it said: {spoke}"),
        }
    }

    /// Reads and discards until the socket goes quiet, which costs one read
    /// timeout.
    fn drain(&mut self) {
        while self.next_message().is_some() {}
    }

    /// Reads until `wanted` accepts a message, discarding the rest.
    ///
    /// Retries across short read timeouts instead of raising the timeout,
    /// which [`Raw::count`] and [`Raw::drain`] rely on to stop.
    fn await_message(&mut self, wanted: impl Fn(&HostMessage) -> bool) {
        let until = Instant::now() + AS_LONG_AS_THE_COMPOSITOR_TAKES;
        loop {
            match self.next_message() {
                Some(message) if wanted(&message) => return,
                Some(_) => {}
                None => assert!(
                    Instant::now() < until,
                    "the compositor sent nothing that was waited for in \
                     {AS_LONG_AS_THE_COMPOSITOR_TAKES:?}"
                ),
            }
        }
    }

    /// How many messages `wanted` accepts before the socket goes quiet.
    fn count(&mut self, wanted: impl Fn(&HostMessage) -> bool) -> usize {
        let mut seen = 0;
        while let Some(message) = self.next_message() {
            if wanted(&message) {
                seen += 1;
            }
        }
        seen
    }
}
