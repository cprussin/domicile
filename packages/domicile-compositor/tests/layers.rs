//! How the compositor tells the chrome from the apps running on it.
//!
//! The compositor serves two Wayland displays. A client on the chrome's display
//! is the desktop; a client on the apps' display is a window. The display is
//! the only signal, so only a running compositor can test it. If it is wrong,
//! the chrome shows itself as a window inside itself.
//!
//! Headless, because the classification happens before anything is drawn.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// `a`, in the evdev code a chrome sends.
const KEY_A: u32 = 30;

/// The `app_id` on a `key`, which the compositor ignores. See [`key`].
const WHEREVER_THE_KEYBOARD_IS: &str = "wherever-the-keyboard-is";

/// Type one key at whatever holds the keyboard.
///
/// The compositor ignores `app_id` and sends the key to the seat's focus. One
/// placeholder is used everywhere so nobody reads it as a route.
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

/// A client on the chrome's display is the desktop; one on the apps' display is
/// a window on it.
///
/// The two clients are identical except for their display and title.
/// `app_appeared` carries no title, so `app_titled` identifies which client
/// was announced.
///
/// The chrome-side client is started and waited for first. Without the
/// classification it would be announced first, so the test fails reliably
/// rather than by race.
#[test]
fn a_client_on_the_chrome_display_is_the_desktop_rather_than_a_window_on_it() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    // Wait for the compositor's own classification, not a sleep.
    let _desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");

    let _window = compositor.client("app-side");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id: first, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    let named = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::AppTitled { title: Some(title), .. } if title == "app-side")
        })
        .expect("the client on the apps' display names its window");
    let HostMessage::AppTitled { app_id: named, .. } = named else {
        unreachable!("the wait matched on this variant")
    };

    assert_eq!(
        first, named,
        "the first window announced to the chrome was not the one on the \
         apps' display, so the compositor announced its own desktop as a \
         window on itself"
    );
}

/// Focusing a window that has no surface leaves the keyboard with the chrome.
///
/// A real chrome hits this when a window closes while its focus message is in
/// flight. If the keyboard went to nothing, nothing would take it back and
/// the desktop would stop receiving keys. An id the host has never seen is
/// handled the same as one whose window just closed, so this uses one.
///
/// Asserted by typing, not by the log: the refusal is logged before the focus
/// moves, so a compositor that logs and then moves the focus anyway keeps the
/// log line.
#[test]
fn focusing_a_window_that_never_existed_leaves_the_keyboard_with_the_chrome() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");
    let mut chrome = compositor.chrome();

    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: "app-that-went-away".to_string(),
        })
        .expect("the chrome socket takes a focus");
    compositor.wait_for_log("keyboard focus -> a window this compositor does not know");

    key(&mut chrome, KEY_A, true);

    assert!(
        desktop.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "the chrome was focused on a window that does not exist and the next key \
         reached nothing — the desktop has gone deaf. It traced:\n{}",
        desktop.trace()
    );
}

/// A window can take the keyboard the moment it appears.
///
/// `app_appeared` arrives before the shell has laid out the window, so a shell
/// that focuses windows as they open does exactly this.
///
/// Asserted by typing as well as by the log, because a compositor can log the
/// focus without moving the seat.
#[test]
fn a_window_takes_the_keyboard_before_it_has_been_laid_out() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // The desktop is started but not focused: the keyboard should go to the
    // window.
    let _desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");
    let mut chrome = compositor.chrome();

    let mut window = compositor.client("app-side");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    // Focus it at once, before the shell knows its size.
    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    key(&mut chrome, KEY_A, true);

    assert!(
        window.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "a window focused before it had been laid out never got the keyboard, \
         so a shell that focuses a window as it opens types into nothing. It \
         traced:\n{}",
        window.trace()
    );
}

/// The keyboard comes back to the chrome when the window holding it goes away.
///
/// Otherwise the desktop stops receiving keys. The chrome usually asks for the
/// keyboard back, but a crashed client gives it no chance, so the compositor
/// must do it.
///
/// The wait counts log lines because the chrome already took the keyboard once
/// when it mapped. The key confirms the seat moved, not just the log.
#[test]
fn the_keyboard_comes_back_to_the_chrome_when_a_window_goes_away() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");
    let mut chrome = compositor.chrome();

    let window = compositor.client("app-side");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");

    // The window crashes, so nothing asks for the keyboard back.
    drop(window);

    compositor.wait_for_log_times("the chrome has the window's keyboard", 2);

    key(&mut chrome, KEY_A, true);
    assert!(
        desktop.wait_for_trace(&format!(", {KEY_A}, 1)"), 1),
        "the window went away and the compositor said the chrome has the \
         keyboard, but the next key reached nothing — the desktop has gone \
         deaf. It traced:\n{}",
        desktop.trace()
    );
}

/// When the desktop's window maps, it takes the keyboard back in both the seat
/// and the chrome's record of the active window.
///
/// `focus_chrome` moves the seat and, through `broadcast_focus_decision`, tells
/// the chrome which window is active. Without the second, the page keeps a
/// window marked active that no longer gets keys.
///
/// The previous test cannot catch this: on the destroy path `broadcast_closed`
/// already sends `focus_changed`. Here the desktop maps late while an app
/// holds the keyboard, which is the one `focus_chrome` call site reachable
/// headless.
///
/// The startup `focus_changed` is consumed first, or it would answer the last
/// wait.
#[test]
fn the_desktop_mapping_late_takes_the_keyboard_back_in_the_brain_too() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: None }))
        .expect("the compositor says where the keyboard is when nothing holds it");

    let _window = compositor.client("app-side");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    focus(&mut chrome, &app_id);
    compositor.wait_for_log("keyboard focus -> client");
    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: Some(_) }))
        .expect("the brain is told the window has the keyboard");

    let _desktop = compositor.chrome_side_client("chrome-side");
    compositor.wait_for_log("the chrome mapped its toplevel");

    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: None }))
        .expect(
            "the desktop's window mapped and took the keyboard, and the chrome was never told \
             — so the page goes on marking a window active that the compositor has stopped \
             typing into",
        );
}
