//! Tests that input a chrome forwards reaches a real Wayland client, and that
//! the keymap reaches both.
//!
//! The compositor passes keys and pointer events from the chrome socket into
//! the Smithay seat. Unit tests stop at the request reaching the Wayland
//! thread; only a real client shows delivery.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// A Dvorak keyboard.
///
/// Uses `dvorak`, not the default `dvp`, so the keymap can only come from this
/// config.
const A_DVORAK_KEYBOARD: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "xkb_layout": "us", "xkb_variant": "dvorak" } }
}
"#;

/// A US QWERTY keyboard.
///
/// The displays match [`A_DVORAK_KEYBOARD`] so a reload changes only the
/// keyboard.
const A_PLAIN_KEYBOARD: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "xkb_layout": "us" } }
}
"#;

/// A keyboard config that parses but xkb cannot compile.
///
/// Uses missing rules because xkb reports those, while it silently falls back
/// on an unknown layout.
const A_KEYBOARD_XKB_HAS_NEVER_HEARD_OF: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "input": { "keyboard": { "xkb_rules": "no-such-rules" } }
}
"#;

/// The Linux code for the left mouse button.
const BTN_LEFT: u32 = 0x110;

/// The Linux code for the right mouse button.
const BTN_RIGHT: u32 = 0x111;

/// The evdev code for `a`, which a chrome sends. The keymap uses X keycodes,
/// which are 8 higher.
const EVDEV_KEY_A: u32 = 30;

/// Evdev codes for `b` and `c`, keys that `drive` does not type.
const EVDEV_KEY_B: u32 = 48;
const EVDEV_KEY_C: u32 = 46;

/// Focuses the window, then moves the pointer, clicks and types `a`.
///
/// Coordinates are surface-local, so the window needs no placement.
fn drive(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    for message in [
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

/// Connects a chrome, starts a client and drives input at its window.
///
/// Returns the window's app id so tests can reject messages naming another
/// window. Waits for the log line `keyboard focus -> client`, which shows the
/// fixture worked; a window with no surface logs a different line.
///
/// One pass is enough: the test client binds its keyboard and pointer before
/// it creates the toplevel that `app_appeared` announces.
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

/// Forwarded key and button presses and releases reach the client.
///
/// The client traces `key(serial, time, code, state)`, so matching the tail
/// checks the code and the state. A dropped release would leave the key held.
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

/// A release for a key the seat never saw pressed is not forwarded.
///
/// The page forwards every release, including keys pressed while it had focus.
#[test]
fn a_release_the_seat_never_saw_pressed_does_not_reach_the_client() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let (mut chrome, mut client, app) = a_client_being_typed_at(&compositor);

    for (keycode, pressed) in [(EVDEV_KEY_B, false), (EVDEV_KEY_C, true)] {
        chrome
            .say(&ChromeMessage::Key {
                app_id: app.clone(),
                keycode,
                pressed,
            })
            .expect("the chrome socket takes a key");
    }

    // Events arrive in order, so once this press is traced, a forwarded
    // release would be too.
    assert!(
        client.wait_for_trace(&format!(", {EVDEV_KEY_C}, 1)"), 1),
        "the key pressed after the stray release never arrived; it traced:\n{}",
        client.trace()
    );
    assert!(
        !client.trace().contains(&format!(", {EVDEV_KEY_B}, 0)")),
        "a key nobody pressed was released at the client; it traced:\n{}",
        client.trace()
    );
}

/// A click on one window reaches it after the chrome lost a release on another.
///
/// The page forwards a release only over the window's own element, so a button
/// let go over the shell never reaches the seat. Until the seat lets go of that
/// button, the window that had the press keeps every later click.
#[test]
fn a_click_reaches_its_window_after_the_chrome_lost_a_release_on_another() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut held = compositor.client("held");
    let held_id = appeared(&mut chrome);
    let mut clicked = compositor.client("clicked");
    let clicked_id = appeared(&mut chrome);

    for message in [
        motion(&held_id),
        button(&held_id, BTN_RIGHT, true),
        ChromeMessage::PointerLeave {
            app_id: held_id.clone(),
        },
        motion(&clicked_id),
        button(&clicked_id, BTN_LEFT, true),
        button(&clicked_id, BTN_LEFT, false),
    ] {
        chrome.say(&message).expect("the chrome socket takes input");
    }

    assert!(
        clicked.wait_for_trace(&format!(", {BTN_LEFT}, 1)"), 1),
        "the click went to the window holding the lost press; it traced:\n{}",
        clicked.trace()
    );
    assert!(
        held.wait_for_trace(&format!(", {BTN_RIGHT}, 0)"), 1),
        "the window that had the press was never told it came up; it traced:\n{}",
        held.trace()
    );
}

/// Clicks reach each window after one closed holding a press the chrome lost.
///
/// The seat forgets a grab whose window is gone but still counts the button as
/// held. Each later click would then keep the pointer on whatever it clicked.
#[test]
fn clicks_reach_each_window_after_one_closed_holding_a_lost_press() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut held = compositor.client("held");
    let held_id = appeared(&mut chrome);
    let mut first = compositor.client("first");
    let first_id = appeared(&mut chrome);
    let mut second = compositor.client("second");
    let second_id = appeared(&mut chrome);

    for message in [motion(&held_id), button(&held_id, BTN_RIGHT, true)] {
        chrome.say(&message).expect("the chrome socket takes input");
    }
    assert!(
        held.wait_for_trace(&format!(", {BTN_RIGHT}, 1)"), 1),
        "the window that closes was never pressed; it traced:\n{}",
        held.trace()
    );
    drop(held);
    chrome
        .wait_for(
            |message| matches!(message, HostMessage::AppClosed { app_id } if *app_id == held_id),
        )
        .expect("the window holding the press closes");

    for app_id in [&first_id, &second_id] {
        for message in [
            motion(app_id),
            button(app_id, BTN_LEFT, true),
            button(app_id, BTN_LEFT, false),
        ] {
            chrome.say(&message).expect("the chrome socket takes input");
        }
    }

    assert!(
        first.wait_for_trace(&format!(", {BTN_LEFT}, 1)"), 1),
        "the first window was never clicked; it traced:\n{}",
        first.trace()
    );
    assert!(
        second.wait_for_trace(&format!(", {BTN_LEFT}, 1)"), 1),
        "the second click stayed with the first window; it traced:\n{}",
        second.trace()
    );
}

/// The pointer at a point inside `app_id`'s window.
fn motion(app_id: &str) -> ChromeMessage {
    ChromeMessage::PointerMotion {
        app_id: app_id.to_string(),
        x: 10.0,
        y: 10.0,
    }
}

/// A press or release of `button` over `app_id`'s window.
fn button(app_id: &str, button: u32, pressed: bool) -> ChromeMessage {
    ChromeMessage::PointerButton {
        app_id: app_id.to_string(),
        button,
        pressed,
    }
}

/// The id of the next window the chrome is told about.
fn appeared(chrome: &mut domicile_test_chrome::Chrome) -> String {
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    app_id
}

/// A focus the chrome requested is reported back over the socket.
///
/// `a_chrome_asking_for_focus_is_answered_to_every_chrome` checks the hub's
/// queue. This checks `serve_outbound` writes it to the socket.
#[test]
fn a_focus_the_chrome_asked_for_comes_back_over_the_socket() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let (mut chrome, _client, app) = a_client_being_typed_at(&compositor);

    // Match this window's id: the handshake already sent a `focus_changed`
    // naming none, and `Some(_)` would accept the wrong window.
    chrome
        .wait_for(|message| {
            matches!(message, HostMessage::FocusChanged { app_id: Some(id) } if *id == app)
        })
        .expect("the chrome is told the window it focused has the keyboard");
}

/// A client's cursor on pointer enter reaches the chrome as `app_cursor`.
///
/// The chrome draws the pointer, so the compositor converts the client's
/// cursor into a CSS keyword for the app's element.
#[test]
fn a_pointer_over_a_window_asks_the_chrome_for_that_window_s_cursor() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let (mut chrome, _client, app) = a_client_being_typed_at(&compositor);

    // Match this window's id. The shape is not checked: the client always
    // sends `Default`.
    chrome
        .wait_for(
            |message| matches!(message, HostMessage::AppCursor { app_id, .. } if *app_id == app),
        )
        .expect("a client the pointer entered asks the chrome for a cursor");
}

/// The chrome receives the keymap compiled from the config.
///
/// The chrome here stands for the browser process. On DRM/Ozone, Chromium's
/// `KeyboardLayoutEngine` gets no keymap from Wayland, so without this message
/// printable keys decode as unidentified. The test checks a symbol from a
/// non-default variant.
#[test]
fn the_keymap_the_config_names_reaches_the_chrome() {
    let compositor = Compositor::started_with(A_DVORAK_KEYBOARD);
    let mut chrome = compositor.chrome();

    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("the keymap rides with the handshake");

    let HostMessage::Keymap { keymap } = told else {
        unreachable!("the wait matched on the variant");
    };
    let top_left = key_block(&keymap, "AD01");
    assert!(
        top_left.contains("apostrophe"),
        "on `dvorak` the key qwerty prints `q` on is an apostrophe, and this          keymap says: {top_left}"
    );
}

/// A reloaded keyboard reaches both open clients and the chrome.
///
/// The client gets a `wl_keyboard.keymap` fd and the chrome gets text over
/// its socket. Both are checked by layout name, so a recompile of the old
/// config fails.
#[test]
fn a_keyboard_edited_on_disk_reaches_the_client_and_the_chrome() {
    let compositor = Compositor::started_with(A_DVORAK_KEYBOARD);
    let mut typing = compositor.client("typing");
    assert!(
        typing.wait_for_trace("keymap(", 1),
        "a client binds a keyboard and is handed the config's keymap:\n{}",
        typing.trace()
    );
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("the keymap rides with the handshake");

    compositor.reconfigure(A_PLAIN_KEYBOARD);

    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("the chrome is told the keymap the reload compiled");
    let HostMessage::Keymap { keymap } = told else {
        unreachable!("the wait matched on the variant");
    };
    assert_eq!(
        group_name(&keymap),
        "English (US)",
        "the browser process is typing on the layout the file now names"
    );
    assert!(
        typing.wait_for_trace("keymap(", 2),
        "a window open across the reload is handed the new keymap too:\n{}",
        typing.trace()
    );
    let last = typing
        .trace()
        .rsplit("keymap(")
        .next()
        .expect("rsplit yields at least one piece")
        .to_string();
    assert!(
        last.starts_with("English (US)"),
        "and it is the new layout rather than a second copy of the old one: {last}"
    );
}

/// A reloaded keymap that fails to compile is logged and ignored.
///
/// At startup the same failure is fatal. On reload, exiting would close every
/// open window, so the desk keeps its last good keymap. The test checks the
/// keymap a later chrome receives, not only the log.
#[test]
fn a_keymap_the_reload_cannot_compile_leaves_the_desktop_typing() {
    let compositor = Compositor::started_with(A_DVORAK_KEYBOARD);

    compositor.reconfigure(A_KEYBOARD_XKB_HAS_NEVER_HEARD_OF);

    compositor.wait_for_log("keeping the keymap the desktop is typing on");
    let mut chrome = compositor.chrome();
    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::Keymap { .. }))
        .expect("a chrome that connects after the bad edit is told a keymap");
    let HostMessage::Keymap { keymap } = told else {
        unreachable!("the wait matched on the variant");
    };
    assert_eq!(
        group_name(&keymap),
        "English (Dvorak)",
        "the retained keymap is the last one that compiled, not xkb's own fallback"
    );
}

/// The `key <NAME> { ... };` block of a compiled keymap.
fn key_block(keymap: &str, name: &str) -> String {
    let opens = format!("key <{name}>");
    let at = keymap
        .find(&opens)
        .unwrap_or_else(|| panic!("no key <{name}> in the keymap:\n{keymap}"));
    let rest = &keymap[at..];
    let ends = rest.find("};").expect("a key block closes");
    rest[..ends].to_string()
}

/// The name of a compiled keymap's first group, such as `English (Dvorak)`.
///
/// The test client reads the same field from its keymap fd.
fn group_name(keymap: &str) -> String {
    let opens = "name[Group1]=\"";
    let at = keymap
        .find(opens)
        .unwrap_or_else(|| panic!("no group name in the keymap:\n{keymap}"));
    let rest = &keymap[at + opens.len()..];
    let ends = rest.find('"').expect("a group name closes");
    rest[..ends].to_string()
}
