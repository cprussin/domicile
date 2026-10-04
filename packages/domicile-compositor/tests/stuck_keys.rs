//! What happens to a key the page was holding when the page went away.
//!
//! The seat's keyboard state outlives every page and window. A page that
//! reloads or crashes mid-press never sends the release, so the key would stay
//! down for the rest of the session.
//!
//! For a lock key this cannot be recovered: xkb unlocks only on the release of
//! the press that locked it. The default keymap's `caps:swapescape` puts
//! `Caps_Lock` on evdev 1, so one lost release would leave every window typing
//! in capitals until restart.
//!
//! `tests/modifiers.rs` checks the chrome is told the modifiers were released.
//! This checks the client actually receives the release: a compositor that
//! clears the seat but intercepts the release would pass that file and fail
//! this one.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// `a`, in the evdev code a chrome sends.
///
/// Not a code of 1: the release assertion matches the trace's tail, and
/// `, 1, 0)` would also match a `modifiers(...)` line.
const KEY_A: u32 = 30;

/// The `app_id` on a `key`, which the compositor ignores. See [`key`].
const WHEREVER_THE_KEYBOARD_IS: &str = "wherever-the-keyboard-is";

/// Type one key at whatever holds the keyboard.
///
/// The compositor ignores `app_id` and sends the key to the seat's focus. A
/// placeholder is used instead of the window's id so nobody reads it as a
/// route.
fn key(chrome: &mut domicile_test_chrome::Chrome, keycode: u32, pressed: bool) {
    chrome
        .say(&ChromeMessage::Key {
            app_id: WHEREVER_THE_KEYBOARD_IS.to_string(),
            keycode,
            pressed,
        })
        .expect("the chrome socket takes a key");
}

/// Give the window the keyboard.
fn focus(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
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

    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    // This chrome is not read again. That is safe because only `hello` gets a
    // response; see `Compositor::chrome`.

    // Pressed and never released: the page dies holding it.
    key(&mut chrome, KEY_A, true);
    assert!(
        window.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "the client never received the press, so it is not holding the key \
         this test is about; it traced:\n{}",
        window.trace()
    );

    // The reload. A page sends `hello` when it starts, so this is the
    // compositor's only signal that the old page's keys are gone.
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
