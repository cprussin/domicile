//! Tests for `zwp_keyboard_shortcuts_inhibit_manager_v1` in a running
//! compositor: a client's inhibitor is honored and the chrome hears of it.

mod running;

use domicile_protocol::HostMessage;

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
