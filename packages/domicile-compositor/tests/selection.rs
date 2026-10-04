//! The clipboard and the primary selection, and that they are separate.
//!
//! An explicit copy fills the clipboard (`wl_data_device`); selecting text
//! fills the primary selection (`zwp_primary_selection_device_v1`) for
//! middle-click paste. Each has its own contents.
//!
//! A paste is the source client writing into a pipe the pasting client reads,
//! so this needs real clients. The compositor's own state is unit-tested in
//! `domicile_host::clipboard` and `crate::clipboard`.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// The clipboard and the primary selection hold different bytes, and a client
/// gets the one it asks for.
///
/// One check, because a compositor serving the clipboard on the primary
/// selection would pass either half alone.
#[test]
fn the_middle_click_selection_and_the_clipboard_are_two_clipboards() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // Connected before the clients, so it hears the announcements live rather
    // than as a replay.
    let mut chrome = compositor.chrome();

    let mut copier = compositor.client_with(
        "copier",
        &[
            "--copy",
            "an explicit copy",
            "--copy-primary",
            "brushed past",
        ],
    );
    let mut pasting = compositor.client_with("pasting", &["--paste"]);

    // The protocol denies `set_selection` from a client without the keyboard,
    // so focus the copying client first, then the pasting one.
    focus(&mut chrome, "copier");
    assert!(
        copier.wait_for_trace("set_selection", 2),
        "the client holding the keyboard could not copy; it traced:\n{}",
        copier.trace()
    );

    focus(&mut chrome, "pasting");
    assert!(
        pasting.wait_for_trace("clipboard: an explicit copy", 1),
        "the client holding the keyboard never read the clipboard; it traced:\n{}",
        pasting.trace()
    );
    assert!(
        pasting.wait_for_trace("primary: brushed past", 1),
        "the client holding the keyboard never read the middle-click selection; it traced:\n{}",
        pasting.trace()
    );
}

/// Give the keyboard to the window with this title, and wait until it has it.
///
/// Selections are offered to the client with the keyboard, so the move must
/// be complete first.
fn focus(chrome: &mut domicile_test_chrome::Chrome, title: &str) {
    let named = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::AppTitled { title: Some(named), .. } if named == title)
        })
        .expect("a client that named its window is announced to the chrome");
    let HostMessage::AppTitled { app_id, .. } = named else {
        unreachable!("the wait matched on this variant")
    };
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes a focus");
    chrome
        .wait_for(|message| {
            matches!(message, HostMessage::FocusChanged { app_id: Some(moved) } if *moved == app_id)
        })
        .expect("the keyboard moves to the window the chrome named");
}
