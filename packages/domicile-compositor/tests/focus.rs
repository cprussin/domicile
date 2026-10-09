//! Tests for keyboard focus, which the shell decides.
//!
//! A client asks for focus over `xdg-activation`. The compositor forwards a
//! request made since the keyboard last moved to the shell and drops the rest
//! (`src/activation.rs`). Unit tests cover the forwarding. These check real
//! requests on each side of that line, and that the shell's answer moves the
//! seat.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// Focus sets `activated` on the new window and clears it on the old one.
///
/// Chromium and Electron read `activated` as page focus. Without it, Electron
/// ignores Backspace and shortcuts.
#[test]
fn the_window_with_the_keyboard_is_the_activated_one() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut first = compositor.client("first");
    let first_id = appeared(&mut chrome);
    let mut second = compositor.client("second");
    let second_id = appeared(&mut chrome);

    chrome
        .say(&ChromeMessage::FocusApp { app_id: first_id })
        .expect("the chrome socket takes a focus");
    assert!(
        first.wait_for_trace("activated(true)", 1),
        "the window given the keyboard was never activated; it traced:\n{}",
        first.trace()
    );

    // Count from here: earlier configures also said `false`.
    let inactive = first.trace().matches("activated(false)").count();
    chrome
        .say(&ChromeMessage::FocusApp { app_id: second_id })
        .expect("the chrome socket takes a focus");
    assert!(
        second.wait_for_trace("activated(true)", 1),
        "the window the keyboard moved to was never activated; it traced:\n{}",
        second.trace()
    );
    assert!(
        first.wait_for_trace("activated(false)", inactive + 1),
        "the window the keyboard left was never deactivated; it traced:\n{}",
        first.trace()
    );
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

/// A request backed by the user's own focus change reaches the shell, which
/// decides.
#[test]
fn a_request_made_since_the_keyboard_last_moved_reaches_the_shell() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // Connect before the client: the `hello` replay does not include focus
    // requests.
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("eager", &["--ask-for-focus-when-entered"]);
    let app_id = appeared(&mut chrome);

    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes a focus");

    assert_eq!(
        chrome
            .wait_for(|message| matches!(message, HostMessage::FocusRequested { .. }))
            .expect("a request with the serial of the keyboard's last enter is heard"),
        HostMessage::FocusRequested { app_id }
    );
}

/// A window that asks for the keyboard back after the user moved on is not
/// heard, so it cannot take focus from where the user went.
#[test]
fn a_window_asking_for_the_keyboard_back_is_not_heard() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _eager = compositor.client_with("eager", &["--ask-for-focus-when-left"]);
    let eager_id = appeared(&mut chrome);
    let _other = compositor.client("other");
    let other_id = appeared(&mut chrome);
    focus(&mut chrome, &eager_id);

    // The keyboard leaving `eager` makes it ask, with its old enter's serial.
    focus(&mut chrome, &other_id);
    compositor.wait_for_log("focus request from before the keyboard last moved");

    assert_not_heard(&mut chrome, &eager_id);
}

/// A request with no serial says nothing of the user, so it is not heard.
#[test]
fn a_request_without_a_serial_is_not_heard() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("eager", &["--ask-for-focus"]);
    let app_id = appeared(&mut chrome);
    compositor.wait_for_log("focus request from before the keyboard last moved");

    assert_not_heard(&mut chrome, &app_id);
}

/// Gives `app_id` the keyboard and waits for the chrome to be told.
fn focus(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.to_string(),
        })
        .expect("the chrome socket takes a focus");
    chrome
        .wait_for(|message| {
            *message
                == HostMessage::FocusChanged {
                    app_id: Some(app_id.to_string()),
                }
        })
        .expect("the chrome is told where the keyboard went");
}

/// Checks no focus request reached the chrome before a fresh focus change.
///
/// Messages arrive in order, so a request broadcast before the dropped one
/// was logged would come ahead of the change.
fn assert_not_heard(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    chrome
        .say(&ChromeMessage::FocusChrome)
        .expect("the chrome socket takes a focus");
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.to_string(),
        })
        .expect("the chrome socket takes a focus");
    assert_eq!(
        chrome
            .wait_for(|message| matches!(
                message,
                HostMessage::FocusRequested { .. } | HostMessage::FocusChanged { app_id: Some(_) }
            ))
            .expect("the chrome is told where the keyboard went"),
        HostMessage::FocusChanged {
            app_id: Some(app_id.to_string())
        },
        "a focus request reached the chrome"
    );
}
