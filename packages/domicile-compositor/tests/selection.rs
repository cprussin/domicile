//! The two clipboards, and that they are two.
//!
//! Every desktop this one means to replace has a pair: what an explicit copy
//! puts somewhere, and what selecting a word puts somewhere else for the
//! middle button to paste. They are separate protocols — `wl_data_device` and
//! `zwp_primary_selection_device_v1` — with separate contents, and a desktop
//! carrying one of them is a desktop where half of copy and paste does
//! nothing.
//!
//! Nothing but real clients can show this. A selection is an *offer*: the
//! client names the mime types it can serve and every paste is that client
//! writing into a descriptor the pasting client reads, so both ends of the
//! claim are processes the compositor does not contain. What the compositor
//! does on its own — what it records, what it hands back — is covered where
//! it lives, in `domicile_host::clipboard` and `crate::clipboard`.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

/// What Ctrl-C copied and what the pointer brushed past are different bytes,
/// and a client that asks for one of them gets that one.
///
/// Both clipboards in one check rather than two, because the claim is that
/// they are separate: a compositor serving the clipboard's bytes on the
/// primary selection would pass either half on its own.
#[test]
fn the_middle_click_selection_and_the_clipboard_are_two_clipboards() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // Connected before either client, so the announcements are heard live
    // rather than through the replay a late chrome gets.
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

    // A COPY IS SOMETHING A FOCUSED WINDOW DOES, which is the protocol's rule
    // and not this check's arrangement: `set_selection` from a client that
    // does not hold the keyboard is denied, so a desktop where nothing ever
    // holds it has no clipboard to test. The keyboard therefore goes to the
    // copier first and to the pasting client second — which is also what
    // copying out of one window and pasting into another *is*.
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
/// Waited for rather than assumed: a selection is offered to the client that
/// holds the keyboard, so every claim below the move is about a seat that has
/// already moved.
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
