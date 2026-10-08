//! A theme change reaches the chromes first, and the windows once every chrome
//! has captured the frame its transition starts from.
//!
//! `domicile_host::theme_turnover` holds the ordering and its tests. These
//! tests check the order holds across threads: the capture arrives on a chrome
//! socket, the deadline is a timer on the Wayland thread, and the result is a
//! broadcast.

mod running;

use std::time::{Duration, Instant};

use domicile_protocol::{Appearance, ChromeMessage, HostMessage, Theme};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// `CAPTURE_WITHIN` less a margin for a loaded machine. A window theme that
/// arrives sooner was not held for the capture.
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
    // A window that never repaints, so the repaint wait must also end on its
    // deadline.
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
    // The browser draws its own pages in the handshake's theme, so a light
    // config must reach it as light before anything is toggled.
    let compositor = Compositor::started_with(
        r#"{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "mode": "light" }
}"#,
    );
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(windows_theme(Theme::Light))
        .expect("the handshake names the windows' theme as the config states it");
}

#[test]
fn the_shell_follows_the_configs_look_and_its_reloads() {
    // The settings portal serves these to windows; the shell must match them.
    let compositor = Compositor::started_with(
        r##"{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "accent_color": "#3584e4", "contrast": "high" }
}"##,
    );
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(appearance(Appearance {
            accent_color: Some("#3584e4".into()),
            high_contrast: true,
            reduced_motion: false,
        }))
        .expect("the handshake carries the config's look");

    compositor.reconfigure(
        r#"{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "reduced_motion": true }
}"#,
    );

    chrome
        .wait_for(appearance(Appearance {
            accent_color: None,
            high_contrast: false,
            reduced_motion: true,
        }))
        .expect("a connected chrome is told the look the edit names");
}

fn appearance(wanted: Appearance) -> impl Fn(&HostMessage) -> bool {
    move |message| *message == HostMessage::Appearance(wanted.clone())
}
