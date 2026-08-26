//! Who the compositor talks to, and from when.
//!
//! A chrome arrives on a socket and *then* says what version it speaks. Those
//! are two moments, and everything the compositor broadcasts in between — or
//! after refusing the version — goes to a page that has not agreed to the
//! protocol it is written in.
//!
//! Unit tests cover the refusal itself: `negotiate` rejects the number and
//! `apply_chrome_message` answers with a `welcome` rather than silence, which
//! is what lets a page report the mismatch instead of hanging. What none of
//! them can show is who *else* the compositor was talking to at the time,
//! because that is the hub's business rather than the brain's.
//!
//! No display and no Wayland client: reconfiguring the desktop is a broadcast
//! with nothing else moving.

mod running;

use std::io::BufReader;
use std::os::unix::net::UnixStream;
use std::time::Duration;

use domicile_protocol::{ChromeMessage, HostMessage, PROTOCOL_VERSION};
use domicile_test_chrome::{hear, say, ChromeError};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

const TWO_DISPLAYS: &str = r#"{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [2560, 1440] }
    ]
  }
}"#;

/// How long to wait for a message that should not come.
///
/// Short on purpose, and it is the whole cost of the assertion. It does not
/// have to outlast the broadcast: the accepted chrome below is waited on
/// *first*, so by the time this is spent the desktop has already gone out to
/// everyone the compositor meant to send it to.
const LONG_ENOUGH_TO_HAVE_ARRIVED: Duration = Duration::from_secs(2);

/// A chrome that speaks a version this build does not is answered, and then
/// left out of the desktop's conversation.
///
/// The refusal is not the subject — that is unit-tested. The subject is that
/// being refused keeps it out of the broadcast list, so it is never sent a
/// message in the protocol it has just been told it cannot read.
#[test]
fn a_chrome_whose_version_was_refused_is_not_broadcast_to() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut refused = Raw::connected(&compositor);
    refused.say_hello(PROTOCOL_VERSION + 1);

    // Answered, which is the part that is already right: silence here is a
    // page waiting forever on a welcome, unable to report the mismatch.
    let answer = refused
        .next_message()
        .expect("a refused chrome is still told what this build speaks");
    assert!(
        matches!(answer, HostMessage::Welcome { .. }),
        "the refusal is a welcome carrying this build's version, got {answer:?}"
    );

    // A chrome that *did* agree, so the broadcast below is known to have
    // happened. Without it a compositor that broadcast nothing at all would
    // pass this test.
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

    // And the refused one heard none of it.
    let overheard = refused.next_message();
    assert!(
        overheard.is_none(),
        "a chrome told its version is wrong was then sent {overheard:?}"
    );
}

/// A chrome that has connected but not yet said hello is in the same position:
/// the socket is up, no version has been agreed, and anything sent to it is
/// sent on a guess.
#[test]
fn a_chrome_that_has_not_said_hello_is_not_broadcast_to() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    // Connected and silent. A real page does this for as long as its bundle
    // takes to load.
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

/// A second `hello` on one socket does not put that chrome in the list twice.
///
/// The list is walked per broadcast and written to per entry, so a duplicate
/// makes the compositor send every message down that socket twice — including
/// `app_frame`, which is the largest thing it sends. A page reloading its own
/// bundle without dropping the socket is all it takes, and `Bridge.connect()`
/// sends a `hello` with nothing forbidding a second call.
#[test]
fn a_chrome_that_says_hello_twice_is_only_in_the_list_once() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut twice = Raw::connected(&compositor);
    twice.say_hello(PROTOCOL_VERSION);
    twice.say_hello(PROTOCOL_VERSION);
    // Both handshakes answered, and both answers discarded: what is counted
    // below is what the *broadcast* sent, and a `welcome` and its `displays`
    // go to the connection that asked whether or not it is in the list.
    twice.drain();

    compositor.reconfigure(TWO_DISPLAYS);

    let described = twice.count(|message| matches!(message, HostMessage::Displays { .. }));
    assert_eq!(
        described, 1,
        "one desktop, described {described} times down one socket"
    );
}

/// A chrome that agreed a version and then names one this build cannot speak
/// is taken back out of the list.
///
/// The refusal is not only about the first `hello`. A page that agreed v17 and
/// then announces v18 has stopped being a peer just as surely as one that
/// opened with v18 — and a list that only ever grew would go on writing v17 at
/// it. `ready` going back down is what the host reports; this is the
/// compositor acting on it.
#[test]
fn a_chrome_that_takes_its_agreement_back_stops_getting_the_desktop() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let mut demoted = Raw::connected(&compositor);
    demoted.say_hello(PROTOCOL_VERSION);
    demoted.say_hello(PROTOCOL_VERSION + 1);
    demoted.drain();

    // A chrome that stayed agreed, so a compositor that broadcast nothing at
    // all cannot pass this. Four of the five tests here carry one; the
    // exception is the double-`hello` test, which counts what arrived on its
    // own socket and would fail at nought if nothing had.
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

/// A chrome that agrees again after being refused is let back in — once.
///
/// The third state the two flags can reach, and the one where getting either
/// wrong is silent: `joined` must come back down on the refusal or the
/// `!joined` guard keeps a re-agreeing chrome out of the list for good, and a
/// page that recovers would sit there drawing a desktop nobody is describing
/// to it. "Once" is the other half — coming back in twice is the duplicate
/// this suite already refuses.
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

/// A chrome socket the test drives itself, because the subject is a handshake
/// that does not happen and `Chrome` always completes one.
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

    /// The next message, or `None` once the socket has gone quiet.
    ///
    /// A read that timed out and a socket that ended are both `None`, and the
    /// difference does not matter to any caller here: each asks either in the
    /// expectation of silence or in a loop that ends on it. A reset is an
    /// ending too — a peer that went away is not a peer that spoke — and is
    /// swallowed rather than reported, which is where this parts company with
    /// `Chrome::wait_for`: that classifies a reset the same way and then
    /// surfaces it, because its callers are waiting *for* something. Here a
    /// dead compositor is caught by the chrome kept alongside, which fails
    /// loudly and says so.
    ///
    /// A line that *arrived* and would not parse is not silence, though, and
    /// neither is a genuine I/O fault. Folding those into `None` would let
    /// "nothing was sent" pass on the strength of something being sent, which
    /// is the one thing these tests exist to tell apart, so they are a panic
    /// naming what came instead.
    fn next_message(&mut self) -> Option<HostMessage> {
        match hear(&mut self.reader) {
            Ok(message) => message,
            // No `BrokenPipe`: that is what a *write* to a dead peer gets, and
            // this only reads. It would be an arm nothing can reach.
            Err(ChromeError::Io(
                std::io::ErrorKind::WouldBlock
                | std::io::ErrorKind::TimedOut
                | std::io::ErrorKind::ConnectionReset,
            )) => None,
            Err(spoke) => panic!("the compositor was meant to be silent; it said: {spoke}"),
        }
    }

    /// Read until the socket goes quiet, discarding everything.
    ///
    /// Costs one read timeout, which is the only way to know a stream has
    /// stopped rather than paused.
    fn drain(&mut self) {
        while self.next_message().is_some() {}
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
