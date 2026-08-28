//! What happens to a key the page was holding when the page went away.
//!
//! Ported from `scripts/e2e-stuck-key.sh`, deleted in the change that added
//! this file.
//!
//! The compositor's keyboard state is one seat's, and it outlives every page
//! and every window. A page that reloads or crashes mid-press never sends the
//! release, so without help that key stays down in the seat for the rest of the
//! session.
//!
//! For an ordinary key that is a modifier nobody can let go of. For a lock key
//! it cannot be recovered from at all: xkb unlocks one only on the release of
//! the press it saw lock it, so while that press is unfinished every later
//! press is a refcount on the lock already held rather than a new toggle. The
//! desktop's own default keymap is what makes this the bug it is —
//! `caps:swapescape` puts `Caps_Lock` on evdev 1, so one lost release is every
//! window typing in capitals, including the windows opened afterwards, until
//! Domicile is restarted.
//!
//! # What this adds over `tests/modifiers.rs`
//!
//! That file covers the same reload from the *chrome's* side: it asserts the
//! chrome is told the modifiers were let go. This is the client's side, and
//! they come apart. Measured — a compositor that clears the seat's own record
//! but intercepts the release instead of forwarding it:
//!
//! ```text
//! FilterResult::Intercept(())   // the client is never told
//! ```
//!
//! passes the whole Rust suite, `tests/modifiers.rs` included, because
//! `tell_the_chromes_the_modifiers` reads the seat and the seat *is* clear. The
//! client that actually holds the key is the only thing that can see the
//! difference.
//!
//! The release is the mechanism rather than a proxy for it: `release_pressed_keys`
//! says so where it forwards, and it is the half that clears a stuck lock.
//!
//! # The lock itself is not separately asserted, and that was measured
//!
//! The deleted script pressed `Caps_Lock`, reloaded, pressed it again and read
//! `wl_keyboard.modifiers`' `locked` field back to zero. That test was written
//! here too, parsing the same field — and it killed nothing this file does not.
//! The mutation that stops the release reaching the client fails only the test
//! below; the one that stops `release_pressed_keys` running at all fails both.
//! So it went, under the rule this migration applies to everything else. The
//! lock is *why* the release matters, not a second thing to check.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// `a`, in the evdev code a chrome sends.
///
/// An ordinary key for the *release* assertion, because that one reads the
/// client's trace as text: the client writes `key(serial, time, code, state)`,
/// and a code of 1 would make the tail `, 1, 0)` — which a
/// `modifiers(serial, depressed, latched, 1, 0)` line matches too. A code no
/// modifier field can hold keeps that assertion about the key it names.
const KEY_A: u32 = 30;

/// The `app_id` on a `key`, which the compositor discards — see [`key`].
const WHEREVER_THE_KEYBOARD_IS: &str = "wherever-the-keyboard-is";

/// Type one key at whatever holds the keyboard.
///
/// *Whatever holds it*, and not an id: the compositor destructures that field
/// away and `ClientRequest::Key` carries none at all, so the key goes where
/// the seat's focus is. One placeholder rather than the focused window's own
/// id, so that no reader takes an inert field for a route — which the id here
/// would look like, since it happens to name the window that receives the key.
fn key(chrome: &mut domicile_test_chrome::Chrome, keycode: u32, pressed: bool) {
    chrome
        .say(&ChromeMessage::Key {
            app_id: WHEREVER_THE_KEYBOARD_IS.to_string(),
            keycode,
            pressed,
        })
        .expect("the chrome socket takes a key");
}

/// Put the window on screen and give it the keyboard.
///
/// Placed before focused: the scene refuses an app with no portal, and a
/// window that never took the keyboard cannot be holding a key.
fn place_and_focus(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    chrome
        .say(&ChromeMessage::PlacePortal {
            app_id: app_id.to_string(),
            corner_radius: 0.0,
            native: true,
            opacity: 1.0,
            shadow: None,
            size: [500.0, 400.0],
            takes_pointer: true,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            visible: true,
            z_index: 0,
        })
        .expect("the chrome socket takes a placement");
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.to_string(),
        })
        .expect("the chrome socket takes a focus");
}

#[test]
fn a_key_held_when_the_page_reloads_is_let_go_of_for_the_client() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut window = compositor.client("app-side");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    place_and_focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    // Nothing is read from this chrome again from here on, and it does not
    // need to be: `write_responses` returns before the writer lock for an
    // answer with nothing in it, which is every message below but the
    // `hello`. See `Compositor::chrome` for the one that is not.

    // Down, and never let go of: the press the page dies holding.
    key(&mut chrome, KEY_A, true);
    assert!(
        window.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "the client never received the press, so it is not holding the key \
         this test is about; it traced:\n{}",
        window.trace()
    );

    // The reload. A second `hello` is what a page sends when its bundle
    // starts, so it is what arrives after a reload whatever the socket did —
    // and it is the compositor's only signal that the old page's keys are
    // gone, since the page that would have sent the release cannot.
    chrome
        .say(&ChromeMessage::Hello {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
        })
        .expect("the chrome socket takes a second hello");

    assert!(
        window.wait_for_trace(&format!(", {KEY_A}, 0)"), 1),
        "the page reloaded holding a key and the client was never told it came \
         up, so that key is down in the client for as long as it runs — and a \
         lock key there can never be toggled again; it traced:\n{}",
        window.trace()
    );
}
