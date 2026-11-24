//! Tests for `zwp_keyboard_shortcuts_inhibit_manager_v1` in a running
//! compositor: a client's inhibitor is honored and the chrome hears of it, and
//! the shell can switch it off and on again.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage, InhibitorAction, SystemReply, SystemRequest};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// A window that takes the desktop's shortcuts is told the inhibitor is
/// active, and the chrome hears it after the window appears.
///
/// The client takes its inhibitor before its first frame, so this also checks
/// the state reaches a chrome that has not heard of the window yet.
#[test]
fn a_window_that_takes_the_shortcuts_has_them_and_the_chrome_hears_it() {
    the_chrome_hears_the_window_took_the_shortcuts("--inhibit-shortcuts");
}

/// An inhibitor on a surface with no role is said of the window once the
/// surface becomes one.
#[test]
fn an_inhibitor_taken_before_a_window_is_said_of_the_window() {
    the_chrome_hears_the_window_took_the_shortcuts("--inhibit-shortcuts-before-it-has-a-window");
}

/// Start a client with `flag` and check its inhibitor is active and announced.
fn the_chrome_hears_the_window_took_the_shortcuts(flag: &str) {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut viewer = compositor.client_with("viewer", &[flag]);

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the viewer's window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    let inhibits = chrome
        .wait_for(|message| matches!(message, HostMessage::AppInhibitsShortcuts { .. }))
        .expect("the chrome hears the window took the shortcuts");

    assert_eq!(
        inhibits,
        HostMessage::AppInhibitsShortcuts {
            app_id,
            inhibits: true,
        }
    );
    assert!(
        viewer.wait_for_trace(".active", 1),
        "the compositor activates the inhibitor: {}",
        viewer.trace()
    );
}

/// The shell's way back to the desktop from a VM: deactivating the keyboard
/// window's inhibitor tells the client and the chromes, and activating or
/// toggling it brings it back.
#[test]
fn the_shell_switches_the_keyboard_windows_inhibitor() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut viewer = compositor.client_with("viewer", &["--inhibit-shortcuts"]);
    let app_id = appeared(&mut chrome);
    inhibits(&mut chrome, &app_id, true);
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome focuses the viewer");

    assert_eq!(
        switch(&mut chrome, 1, InhibitorAction::Deactivate),
        SystemReply::Set
    );
    inhibits(&mut chrome, &app_id, false);
    assert!(
        viewer.wait_for_trace(".inactive", 1),
        "the client was never told its inhibitor is off: {}",
        viewer.trace()
    );

    assert_eq!(
        switch(&mut chrome, 2, InhibitorAction::Toggle),
        SystemReply::Set
    );
    inhibits(&mut chrome, &app_id, true);
    assert!(
        viewer.wait_for_trace(".active", 2),
        "toggling did not turn it back on: {}",
        viewer.trace()
    );

    assert_eq!(
        switch(&mut chrome, 3, InhibitorAction::Toggle),
        SystemReply::Set
    );
    inhibits(&mut chrome, &app_id, false);
    assert_eq!(
        switch(&mut chrome, 4, InhibitorAction::Activate),
        SystemReply::Set
    );
    inhibits(&mut chrome, &app_id, true);
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

/// Wait for the chrome to hear whether `app_id` inhibits the shortcuts.
fn inhibits(chrome: &mut domicile_test_chrome::Chrome, app_id: &str, inhibits: bool) {
    let wanted = HostMessage::AppInhibitsShortcuts {
        app_id: app_id.to_string(),
        inhibits,
    };
    chrome
        .wait_for(|message| *message == wanted)
        .unwrap_or_else(|_| panic!("the chrome never heard {wanted:?}"));
}

/// Switch the keyboard window's inhibitor under `id`, and return the reply.
fn switch(
    chrome: &mut domicile_test_chrome::Chrome,
    id: u32,
    action: InhibitorAction,
) -> SystemReply {
    chrome
        .say(&ChromeMessage::SystemRequest {
            id,
            request: SystemRequest::ShortcutsInhibitor { action },
        })
        .expect("the chrome socket takes a system call");
    let replied = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemReply { id: of, .. } if *of == id))
        .expect("a system call is answered");
    let HostMessage::SystemReply { reply, .. } = replied else {
        unreachable!("the wait matched on this variant")
    };
    reply
}
