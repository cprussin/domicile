//! A theme turns the chromes over first and the windows once every chrome has
//! captured the frame its wipe starts from.
//!
//! `domicile_host::theme_turnover` holds the order and its tests. What needs a
//! real compositor is that the order is kept across its threads: the capture
//! arrives on a chrome's socket, the deadline is a timer on the Wayland
//! thread, and the answer is a broadcast.

mod running;

use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage, Theme};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

/// What `CAPTURE_WITHIN` is, less a margin for a loaded machine. A window
/// theme that arrives sooner than this was not held for the capture.
const HELD_AT_LEAST: Duration = Duration::from_millis(800);

fn windows_theme(theme: Theme) -> impl Fn(&HostMessage) -> bool {
    move |message| *message == HostMessage::WindowsTheme { theme }
}

#[test]
fn the_windows_turn_when_the_chrome_has_captured() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(windows_theme(Theme::Dark))
        .expect("the windows' theme rides with the handshake");

    chrome
        .say(&ChromeMessage::SetTheme {
            theme: Theme::Light,
        })
        .expect("the chrome socket takes a theme");
    chrome
        .wait_for(|message| {
            *message
                == HostMessage::Theme {
                    theme: Theme::Light,
                }
        })
        .expect("the chrome is told first");
    let captured = Instant::now();
    chrome
        .say(&ChromeMessage::ThemeCaptured {
            theme: Theme::Light,
        })
        .expect("the chrome socket takes a capture");

    chrome
        .wait_for(windows_theme(Theme::Light))
        .expect("and the windows once it has captured");
    assert!(
        captured.elapsed() < HELD_AT_LEAST,
        "the windows turned on the capture, not on the deadline ({:?})",
        captured.elapsed()
    );
}

#[test]
fn a_chrome_that_never_captures_holds_the_windows_only_until_the_deadline() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    // A window on the desk, which never repaints: the repaint wait has to end
    // on its own deadline too.
    let _client = compositor.client("still");
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the client's window maps");

    chrome
        .say(&ChromeMessage::SetTheme {
            theme: Theme::Light,
        })
        .expect("the chrome socket takes a theme");
    let asked = Instant::now();

    chrome
        .wait_for(windows_theme(Theme::Light))
        .expect("the windows turn without a capture, late");
    assert!(
        asked.elapsed() >= HELD_AT_LEAST,
        "but not before the chrome had its chance to capture ({:?})",
        asked.elapsed()
    );
}

#[test]
fn a_desk_that_comes_up_light_says_its_windows_are_light() {
    // The browser draws its own pages in what the handshake says, so a config
    // of light must reach it as light before anything is toggled.
    let compositor =
        Compositor::started_with(&format!("{ONE_DISPLAY}\n[theme]\nmode = \"light\"\n"));
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(windows_theme(Theme::Light))
        .expect("the handshake names the windows' theme as the config states it");
}
