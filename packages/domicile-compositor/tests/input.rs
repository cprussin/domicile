//! What a chrome forwards, and whether a real client receives it.
//!
//! Ported from `scripts/e2e-input.sh`, deleted in the change that added this
//! file.
//!
//! Input is the one path where the compositor is a *courier* rather than a
//! decider: a chrome routes a pointer or a key over its socket, the compositor
//! puts it into the seat, and a Wayland client is supposed to be given it. Both
//! ends of that are real processes, and the middle is Smithay — so nothing
//! below this level can see it happen. The unit tests reach as far as a
//! `ClientRequest` landing on the Wayland thread, which is the near side.
//!
//! # Every claim here was uncovered
//!
//! Measured before writing any of it, by mutation against the whole workspace:
//!
//! | mutation | before | after |
//! |---|---|---|
//! | the keyboard filter intercepts instead of forwarding | passes | **fails** |
//! | the `pointer.button` call is removed | passes | **fails** |
//! | the `app_cursor` broadcast is removed | passes | **fails** |
//!
//! "Passes" there is the entire Rust suite, 37 binaries — so a compositor that
//! took every key out of the stream, or never gave a client a button, or never
//! told the chrome which cursor to draw, was caught by this script and by
//! nothing else in the repo.
//!
//! # A window has to be placed before any of it works
//!
//! `Scene::focus_app` refuses an app with no portal — a window that is not on
//! screen is not one the keyboard can go to — and the pointer is routed against
//! the portal's geometry. A real chrome places one when it mounts the element;
//! a test that forgets makes `focus_app` a silent no-op and then reports the
//! compositor for delivering no input.
//!
//! So the placement is not merely done here, it is *asserted*, by waiting for
//! the compositor to say `keyboard focus -> client` before any test looks at
//! anything. It logs a different line for the window with no surface, so the
//! fixture's own fault and the compositor's are distinguishable rather than
//! both arriving as "no input was delivered". `e2e-chrome-layer.sh` is on
//! record in the ROADMAP as getting this wrong and passing anyway.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// The left mouse button, as Linux names it and the protocol carries it.
const BTN_LEFT: u32 = 0x110;

/// `a`, in evdev codes — what a chrome sends. The compositor adds the 8 that
/// turns it into an X keycode, which is what a `wl_keyboard` keymap speaks.
const EVDEV_KEY_A: u32 = 30;

/// Where a chrome would put the window: the whole of a small screen.
const PLACEMENT: ([f64; 2], [f64; 6]) = ([500.0, 400.0], [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

/// Place the window, take the keyboard to it, then move, click and type.
fn drive(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    let (size, transform) = PLACEMENT;
    for message in [
        ChromeMessage::PlacePortal {
            app_id: app_id.to_string(),
            corner_radius: 0.0,
            native: true,
            opacity: 1.0,
            shadow: None,
            size,
            takes_pointer: true,
            transform,
            visible: true,
            z_index: 0,
        },
        ChromeMessage::FocusApp {
            app_id: app_id.to_string(),
        },
        ChromeMessage::PointerMotion {
            app_id: app_id.to_string(),
            x: 10.0,
            y: 10.0,
        },
        ChromeMessage::PointerMotion {
            app_id: app_id.to_string(),
            x: 20.0,
            y: 20.0,
        },
        ChromeMessage::PointerButton {
            app_id: app_id.to_string(),
            button: BTN_LEFT,
            pressed: true,
        },
        ChromeMessage::PointerButton {
            app_id: app_id.to_string(),
            button: BTN_LEFT,
            pressed: false,
        },
        ChromeMessage::Key {
            app_id: app_id.to_string(),
            keycode: EVDEV_KEY_A,
            pressed: true,
        },
        ChromeMessage::Key {
            app_id: app_id.to_string(),
            keycode: EVDEV_KEY_A,
            pressed: false,
        },
    ] {
        chrome.say(&message).expect("the chrome socket takes input");
    }
}

/// Connect a chrome, start a client, place its window and drive input at it.
///
/// Every test here needs the same arrangement and it costs a real client
/// start, so they share the setup rather than the assertions. The app id comes
/// back with it: every assertion below is about *this* window, and a
/// `focus_changed` or an `app_cursor` naming some other one is the failure
/// they exist to catch.
///
/// The wait is on the compositor saying the keyboard reached a client, not on
/// a clock. That line is the premise of all three tests — `Scene::focus_app`
/// refuses an app with no portal, so a placement that stopped landing would
/// make `focus_app` a silent no-op and every assertion below would convict the
/// compositor of the fixture's fault. The compositor distinguishes the two out
/// loud, and this reads it:
///
///   - `keyboard focus -> client` — the window was placed and took the keyboard
///   - `keyboard focus -> a window with no surface; the chrome keeps it` — not
///
/// An earlier version sent the sequence twice, 750ms apart, against a race in
/// which the chrome hears about an app before its client has bound
/// `wl_pointer`. The client's own start-up rules that out — `run()` is `bind()`,
/// then a roundtrip in which the seat's capabilities are answered with
/// `get_keyboard`/`get_pointer`, and only then `open()`, which creates the
/// toplevel that `app_appeared` announces. The retry was also never delivered:
/// a test that stops draining its chrome fills the socket, `serve_outbound`
/// blocks holding the writer, and the reader blocks behind it — measured, the
/// compositor read one message of the second wave and nothing more for twenty
/// seconds. One wave and a signal is both shorter and honest.
fn a_client_being_typed_at(
    compositor: &Compositor,
) -> (domicile_test_chrome::Chrome, crate::running::Client, String) {
    let mut chrome = compositor.chrome();
    let client = compositor.client("app");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    drive(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    (chrome, client, app_id)
}

/// A key and a click a chrome forwarded arrive at the client as protocol
/// events.
///
/// Both in one test because they fail together and for the same reason — the
/// seat never got the window — and because separating them would cost a second
/// real client start for no extra mutation killed.
///
/// The release as well as the press, and the code as well as the interface.
/// The client traces `key(serial, time, code, state)`, so the tail of that is
/// what names which key and which half of it — waiting on `.key(` alone is
/// answered by a press, and a compositor that delivers presses and swallows
/// releases leaves every key down in the seat for good. Waiting on any
/// `wl_keyboard` line is worse still: the keymap arrives the moment the client
/// binds the seat, before a single key has been forwarded.
#[test]
fn a_key_and_a_click_the_chrome_forwarded_reach_the_client() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let (_chrome, mut client, _app) = a_client_being_typed_at(&compositor);

    for (what, tail) in [
        ("a key press", format!(", {EVDEV_KEY_A}, 1)")),
        ("that key's release", format!(", {EVDEV_KEY_A}, 0)")),
        ("a click", format!(", {BTN_LEFT}, 1)")),
        ("that click's release", format!(", {BTN_LEFT}, 0)")),
    ] {
        assert!(
            client.wait_for_trace(&tail, 1),
            "the chrome forwarded {what} and the client was never given one; \
             it traced:\n{}",
            client.trace()
        );
    }
}

/// A focus the chrome asked for comes back to it over the socket.
///
/// The gap this closes is a narrow one and worth naming, because a unit test
/// already covers most of it. `a_chrome_asking_for_focus_is_answered_to_every_chrome`
/// drives a real connection and asserts the move reaches the hub's *queue* —
/// so a focus written back to the asking socket instead of broadcast is caught
/// there. What that cannot see is the other end: `serve_outbound` draining
/// that queue onto the sockets. Dropping `focus_changed` on the way out passes
/// the unit test, because the message did reach the queue.
///
/// A separate test rather than another assertion above, because it fails for a
/// different reason than a key that never arrived: this one is the compositor
/// not telling the chrome what it did, and a desktop whose active-window
/// marker is right until the first click and wrong afterwards.
#[test]
fn a_focus_the_chrome_asked_for_comes_back_over_the_socket() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let (mut chrome, _client, app) = a_client_being_typed_at(&compositor);

    // The *named* window, not merely some `focus_changed`. Two reasons, and
    // the second is why the script this replaces matched on the id too: a
    // chrome is caught up with the current holder as it connects, and with
    // nothing focused yet that catch-up is `None`; and a compositor that names
    // a window which does not exist is the failure this test is about — an
    // active-window marker that is right until the first click and wrong
    // afterwards — which `Some(_)` accepts.
    chrome
        .wait_for(|message| {
            matches!(message, HostMessage::FocusChanged { app_id: Some(id) } if *id == app)
        })
        .expect("the chrome is told the window it focused has the keyboard");
}

/// A pointer entering a window has the client ask the chrome for a cursor.
///
/// The way back out, and the only message in this file that travels client →
/// compositor → chrome rather than the other way. A client sets its cursor on
/// `wl_pointer.enter`; the compositor turns that into a CSS keyword for the
/// app's element, because the chrome draws the pointer and cannot know what the
/// window under it wants.
///
/// Without it every window on the desktop shows whatever cursor the page last
/// set — a text field over a terminal keeps an arrow, and a resize edge never
/// appears.
#[test]
fn a_pointer_over_a_window_asks_the_chrome_for_that_window_s_cursor() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let (mut chrome, _client, app) = a_client_being_typed_at(&compositor);

    // Named, for the same reason as the focus above: a cursor attributed to
    // the wrong element gives every other window on the desktop whatever that
    // one asked for. The *shape* is deliberately not asserted — the client
    // sends `Default`, so pinning the keyword would pin the client's choice
    // rather than the compositor's translation of it.
    chrome
        .wait_for(
            |message| matches!(message, HostMessage::AppCursor { app_id, .. } if *app_id == app),
        )
        .expect("a client the pointer entered asks the chrome for a cursor");
}
