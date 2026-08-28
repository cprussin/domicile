//! What a chrome that stops reading does to everyone else.
//!
//! Ported from `scripts/e2e-slow-chrome.sh`, deleted in the change that added
//! this file.
//!
//! A frame is large next to a socket buffer. This test's client draws 320x240,
//! so 307,200 bytes against a default `AF_UNIX` buffer of about 208 KB — one
//! frame more than fills it, and a chrome that has stopped reading never
//! empties it again. The failure this guards is a compositor that waits for
//! that chrome: the queue is one frame deep and never blocks, so the right
//! answer is to drop, because the next frame supersedes the one lost anyway.
//!
//! `outbound.rs` unit-tests that queue against a pair of counters, which says
//! nothing about a real socket filling. What is here is the part that needs
//! one: a chrome that has genuinely stopped reading, a client genuinely
//! drawing, and a real `wl_shm` buffer big enough to matter.
//!
//! # Both halves are here, and the second one nearly was not
//!
//! `e2e-slow-chrome.sh` asked `wayland-info` whether the compositor still
//! answered while a chrome was wedged — its headline claim, and the reason it
//! existed. A first version of this file dropped that check for killing
//! nothing: three mutations were tried against it, including the faithful
//! shape of the bug, and a late client was served under every one.
//!
//! The check was fine; the way it was being run was not. Two things have to
//! hold or it cannot fail:
//!
//!   - **The late client connects after the writer is genuinely stuck**, not
//!     merely after the wedged chrome has handshaked. Until the socket fills
//!     the compositor is still live, and the assertion passes against any
//!     mutation. A wait is what makes the difference, and it is the reason
//!     this test costs seconds rather than milliseconds.
//!   - **It does not wait on the drop line.** Every mutation that blocks the
//!     loop also stops `chrome is behind; dropped a frame` from ever being
//!     logged, so a liveness check gated on that fails at the wait instead of
//!     at its own assertion — which reads as the mutation being caught when it
//!     is not.
//!
//! With both, the mutation that matters kills it deterministically: a spin on
//! `has_room` inside `send_frame` leaves a late client with an empty trace,
//! having never been told about the screen at all. That is the freeze, and
//! nothing else in this repo catches it — `serve_outbound` exists to prevent
//! exactly it, and says so.
//!
//! The lesson is worth more than the check: an assertion that survives every
//! mutation is not evidence that the behaviour is safe. It can equally mean
//! the harness never reached the state the assertion is about.

mod running;

use std::os::unix::net::UnixStream;
use std::time::Duration;

use domicile_test_chrome::Chrome;

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// How long a stand-in chrome will wait for its handshake.
const PATIENCE: Duration = Duration::from_secs(20);

/// Long enough for the outbound writer to be stuck on a socket nobody drains.
///
/// A wait rather than a signal because what is being waited for is a kernel
/// buffer filling, which the compositor does not report and which this side
/// could see only by reaching past the socket abstraction — `FIONREAD` on a
/// clone of the wedged connection does read the queue depth, at the cost of
/// `libc` and an `unsafe` ioctl in a test file. Measured, the queue goes from
/// 257 to 219,686 bytes about ten milliseconds after the drawing client's
/// first frame, so five seconds is a margin of roughly five hundred times.
///
/// The failure mode of getting this wrong is worth naming: a wait that is too
/// short does not make the test flaky, it makes it *pass* — the late client is
/// served because nothing is stuck yet. Too short is a silent false green,
/// never an intermittent red.
const WEDGED: Duration = Duration::from_secs(5);

/// The compositor drops frames for a chrome that is behind, rather than
/// waiting for it.
///
/// The wedged chrome is held rather than used: the handshake is what makes the
/// compositor start writing to it, and never reading is what makes those
/// writes pile up. `Chrome::on` does the handshake and nothing after, so the
/// socket is genuinely unread — dropping the binding would close it, which is
/// the opposite of the wedge.
#[test]
fn frames_for_a_chrome_that_is_behind_are_dropped() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let socket =
        UnixStream::connect(compositor.socket()).expect("the chrome socket is there to connect to");
    let _wedged = Chrome::on(socket, PATIENCE).expect("the compositor agrees the protocol");

    // Drawing, so there is something for the wedged chrome to fall behind on:
    // frames only leave for a chrome once an app has committed one.
    let mut drawing = compositor.client("drawing");
    assert!(
        drawing.wait_for_trace(".done(", 1),
        "the client never got a screen, so it never drew; it traced:\n{}",
        drawing.trace()
    );

    compositor.wait_for_log("chrome is behind; dropped a frame");
}

/// A chrome that stopped reading does not stop the compositor serving anyone
/// else.
///
/// The script's headline question, and the one `serve_outbound` exists to
/// answer: before it, a slow chrome blocked `commit()`, which stopped frame
/// callbacks, which stopped every client. A page that fell behind took the
/// desktop down with it.
///
/// The client that answers it connects *after* the wait below, and that
/// ordering is the whole test. Until the writer thread is genuinely stuck on a
/// full socket the compositor is still live, so a client that connects too
/// early is served under any mutation — which is how a first version of this
/// file concluded, wrongly, that nothing could break it.
///
/// `wl_buffer.release` as well as the screen, because being told about an
/// output only proves the globals were sent. A release comes back only once
/// the compositor has processed a commit, which is the loop actually turning.
#[test]
fn a_chrome_that_stopped_reading_does_not_freeze_the_others() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let socket =
        UnixStream::connect(compositor.socket()).expect("the chrome socket is there to connect to");
    let _wedged = Chrome::on(socket, PATIENCE).expect("the compositor agrees the protocol");

    let mut drawing = compositor.client("drawing");
    assert!(
        drawing.wait_for_trace(".done(", 1),
        "the first client never got a screen; it traced:\n{}",
        drawing.trace()
    );

    // Not waiting on the drop line, deliberately: a mutation that blocks the
    // loop also stops that line being logged, so gating here would fail at the
    // wait rather than at the assertion below and read as a catch.
    std::thread::sleep(WEDGED);

    let mut late = compositor.client("late");
    assert!(
        late.wait_for_trace(".done(", 1),
        "a client that connected while a chrome was wedged was never told \
         about the screen — the compositor's loop is waiting on that chrome. \
         It traced:\n{}",
        late.trace()
    );
    assert!(
        late.wait_for_trace(".release(", 1),
        "the late client was told about the screen but never had a buffer \
         released, so nothing processed its commit. It traced:\n{}",
        late.trace()
    );
}
