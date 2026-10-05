//! Tests that a chrome's `devicePixelRatio` reaches Wayland clients.
//!
//! `desktop.rs` covers what other chromes are told. These need a real client.
//! A wrong scale only shows as slightly soft text, so each step is checked
//! directly.
//!
//! The desktop is window-following because `set_output_scale` refuses a
//! chrome's density on a described desktop
//! (`desktop.rs`'s `a_described_desktop_refuses_a_chromes_density`).

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

/// A desktop with no configured displays, so the chrome's density sets the
/// scale.
///
/// Its size is the compositor's `UNDESCRIBED_DESKTOP`. The mode assertion
/// below hardcodes that size doubled, so keep the two in sync.
const FOLLOWING: &str = "{}";

/// The density the chrome reports.
const DENSITY: f64 = 2.0;

/// A chrome past the handshake whose [`DENSITY`] the compositor has applied.
///
/// Start clients only after this returns: a client that binds the output
/// earlier is told scale 1.
fn a_chrome_reporting_two(compositor: &Compositor) -> domicile_test_chrome::Chrome {
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");
    chrome
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: DENSITY })
        .expect("the chrome reports its density");
    chrome
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => displays.iter().any(|display| display.scale == 2),
            _ => false,
        })
        .expect("the compositor takes the density up and says so");
    chrome
}

/// The output mode a client sees is the desktop size times the density.
///
/// The literals are `UNDESCRIBED_DESKTOP` times [`DENSITY`].
#[test]
fn the_mode_carries_the_density() {
    let compositor = Compositor::started_with(FOLLOWING);
    let _chrome = a_chrome_reporting_two(&compositor);
    let mut client = compositor.client("app");

    // A mode is in physical pixels. Left at the logical size, `xdg_output`
    // tells clients the screen is half the size the chrome lays out against.
    assert!(
        client.wait_for_trace(&format!(".mode(3, {}, {},", 1280 * 2, 800 * 2), 1),
        "the mode did not grow with the density, so every client computes a \
         desktop half the size the chrome is laid out at; it traced:\n{}",
        client.trace()
    );
}

/// A window open when the density changes is told its new scale.
///
/// `wp_fractional_scale_v1` counts in 120ths.
#[test]
fn an_open_window_follows_the_density_to_its_new_scale() {
    let compositor = Compositor::started_with(FOLLOWING);
    let mut client = compositor.client("app");
    assert!(
        client.wait_for_trace(".preferred_scale(120)", 1),
        "the window was never given the desktop's first scale; it traced:\n{}",
        client.trace()
    );

    let _chrome = a_chrome_reporting_two(&compositor);

    assert!(
        client.wait_for_trace(".preferred_scale(240)", 1),
        "the window kept drawing at the old density; it traced:\n{}",
        client.trace()
    );
}

/// The chrome's own window is told the new scale too, as its outputs are.
#[test]
fn the_chromes_own_window_follows_the_density() {
    let compositor = Compositor::started_with(FOLLOWING);
    let mut window = compositor.chrome_side_client("chrome");
    assert!(
        window.wait_for_trace(".preferred_scale(120)", 1),
        "the chrome's window was never given the desktop's first scale; it \
         traced:\n{}",
        window.trace()
    );

    let _chrome = a_chrome_reporting_two(&compositor);

    assert!(
        window.wait_for_trace(".preferred_scale(240)", 1),
        "the chrome's window kept drawing at the old density; it traced:\n{}",
        window.trace()
    );
}

// Known gap: nothing checks that a window at density 2 is laid out in logical
// units rather than device pixels. Getting it wrong scales every pointer
// coordinate. The check belongs in the engine path: the `<app>` element's
// layout size against the client's committed buffer.
