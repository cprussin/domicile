//! A theme change reaches the chromes first, and the windows once every chrome
//! has captured the frame its transition starts from.
//!
//! `domicile_host::theme_turnover` holds the ordering and its tests. These
//! tests check the order holds across threads: the capture arrives on a chrome
//! socket, the deadline is a timer on the Wayland thread, and the result is a
//! broadcast.

mod running;

use std::time::{Duration, Instant};

use domicile_launch::compositor_socket::theme;
use domicile_protocol::{Appearance, ChromeMessage, CursorTheme, HostMessage, Theme};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// `CAPTURE_WITHIN` less a margin for a loaded machine. A window theme that
/// arrives sooner was not held for the capture.
const HELD_AT_LEAST: Duration = Duration::from_millis(800);

/// How long `domicile theme` waits for an answer.
const PATIENCE: Duration = Duration::from_secs(5);

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
fn domicile_theme_sets_the_theme_every_chrome_hears_and_reads_it_back() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(windows_theme(Theme::Dark))
        .expect("the windows' theme rides with the handshake");

    assert_eq!(
        theme(compositor.socket(), None, Some(PATIENCE)),
        Ok(Theme::Dark),
        "a question reads the theme"
    );
    assert_eq!(
        theme(compositor.socket(), Some(Theme::Light), Some(PATIENCE)),
        Ok(Theme::Light),
        "a change answers with the new theme"
    );
    chrome
        .wait_for(|message| {
            *message
                == HostMessage::Theme {
                    theme: Theme::Light,
                }
        })
        .expect("and the shell hears it, as from its own toggle");
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
            cursor: None,
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
            cursor: None,
        }))
        .expect("a connected chrome is told the look the edit names");
}

#[test]
fn the_browser_draws_the_configs_pointer_and_follows_its_reloads() {
    let compositor = Compositor::started_with(
        r#"{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "cursor_theme": "Bibata-Modern-Amber-Right", "cursor_size": 64 }
}"#,
    );
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(appearance(Appearance {
            cursor: Some(CursorTheme {
                name: "Bibata-Modern-Amber-Right".into(),
                size: 64,
            }),
            ..Appearance::default()
        }))
        .expect("the handshake carries the config's pointer");

    compositor.reconfigure(ONE_DISPLAY);

    chrome
        .wait_for(appearance(Appearance::default()))
        .expect("an edit that drops the pointer theme says so");
}

#[test]
fn the_browser_draws_each_modes_pointer_when_the_theme_flips() {
    let compositor = Compositor::started_with(
        r#"{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "theme": { "cursor_theme": { "dark": "Numix-Cursor", "light": "Numix-Cursor-Light" } }
}"#,
    );
    let pointer = |name: &str| Appearance {
        cursor: Some(CursorTheme {
            name: name.into(),
            size: 24,
        }),
        ..Appearance::default()
    };
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(appearance(pointer("Numix-Cursor")))
        .expect("the handshake carries the dark mode's pointer");

    chrome
        .say(&ChromeMessage::SetTheme {
            theme: Theme::Light,
        })
        .expect("the chrome socket takes a theme");

    chrome
        .wait_for(appearance(pointer("Numix-Cursor-Light")))
        .expect("the light mode's pointer follows the toggle");
}

fn appearance(wanted: Appearance) -> impl Fn(&HostMessage) -> bool {
    move |message| *message == HostMessage::Appearance(wanted.clone())
}
