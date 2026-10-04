//! Tests for keyboard focus, which the shell decides.
//!
//! A client asks for focus over `xdg-activation`, and the compositor forwards
//! the request to the shell. Unit tests cover the forwarding. These check the
//! global is advertised, a real request arrives, and the shell's answer moves
//! the seat.

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

#[test]
fn a_client_asks_for_the_keyboard_and_the_shell_is_what_gives_it() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // Connect before the client: the `hello` replay does not include focus
    // requests.
    let mut chrome = compositor.chrome();
    let _client = compositor.client_asking_for_focus("eager");

    let requested = chrome
        .wait_for(|message| matches!(message, HostMessage::FocusRequested { .. }))
        .expect("a client that binds xdg_activation_v1 and activates its surface is heard");
    let HostMessage::FocusRequested { app_id } = requested else {
        unreachable!("the wait matched on this variant")
    };

    // The seat moves only when the shell answers.
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes an answer");

    // Match a window, not any `focus_changed`: the handshake already sent
    // one naming no window.
    assert_eq!(
        chrome
            .wait_for(|message| matches!(message, HostMessage::FocusChanged { app_id: Some(_) }))
            .expect("answering the request moves the keyboard"),
        HostMessage::FocusChanged {
            app_id: Some(app_id)
        }
    );
}
