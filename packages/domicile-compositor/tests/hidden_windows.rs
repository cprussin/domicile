//! A window the page does not draw stops drawing too.
//!
//! The page reports a hidden window (another workspace, a background tab) with
//! an empty box (`set_app_bounds`). Its client gets a `wl_surface.frame`
//! callback once a second and is marked `suspended` until the page gives it a
//! box again.

mod running;

use std::time::{Duration, Instant};

use domicile_host::theme_turnover::REPAINT_WITHIN;
use domicile_protocol::{ChromeMessage, HostMessage, Theme};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

const SHOWN: [f64; 2] = [800.0, 600.0];

const HIDDEN: [f64; 2] = [0.0, 0.0];

/// A hidden window draws about once a second until it is shown, then at full
/// rate again.
///
/// The client draws on each frame callback, and the compositor releases a
/// buffer for each frame it draws, so releases count frames.
#[test]
fn a_hidden_window_draws_once_a_second_until_it_is_shown() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("app");
    let app_id = appeared(&mut chrome);
    placed(&mut chrome, &app_id, SHOWN);
    assert!(
        client.wait_for_trace(".release()", 3),
        "a shown window never drew; it traced:\n{}",
        client.trace()
    );

    placed(&mut chrome, &app_id, HIDDEN);
    assert!(
        client.wait_for_trace(".suspended(true)", 1),
        "a hidden window was never told it is suspended; it traced:\n{}",
        client.trace()
    );
    // A frame already asked for before the hide may still land.
    std::thread::sleep(Duration::from_millis(200));
    let before = frames(&client);
    std::thread::sleep(Duration::from_millis(2500));
    let held = frames(&client);
    // Two or three trickles. A client blocked on its callback still gets one,
    // so it reads a close.
    assert!(
        (before + 1..=before + 4).contains(&held),
        "a hidden window drew {} frames in 2.5 s; it traced:\n{}",
        held - before,
        client.trace()
    );

    let resumed = client.trace().matches(".suspended(false)").count();
    placed(&mut chrome, &app_id, SHOWN);
    assert!(
        client.wait_for_trace(".suspended(false)", resumed + 1),
        "a window shown again is still suspended; it traced:\n{}",
        client.trace()
    );
    assert!(
        client.wait_for_trace(".release()", held + 3),
        "a window shown again never drew; it traced:\n{}",
        client.trace()
    );
}

/// A new page has not reported any boxes, so every window draws again.
#[test]
fn a_new_page_shows_every_hidden_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("app");
    let app_id = appeared(&mut chrome);
    placed(&mut chrome, &app_id, HIDDEN);
    assert!(
        client.wait_for_trace(".suspended(true)", 1),
        "a hidden window was never told it is suspended; it traced:\n{}",
        client.trace()
    );
    let resumed = client.trace().matches(".suspended(false)").count();

    chrome
        .say(&ChromeMessage::Hello {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
        })
        .expect("the chrome socket takes a second hello");

    assert!(
        client.wait_for_trace(".suspended(false)", resumed + 1),
        "a window hidden by the old page is still suspended; it traced:\n{}",
        client.trace()
    );
}

/// A theme change does not wait for a hidden window to repaint, which it
/// cannot do until it is shown.
#[test]
fn a_theme_change_does_not_wait_for_a_hidden_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("app");
    let app_id = appeared(&mut chrome);
    placed(&mut chrome, &app_id, HIDDEN);
    assert!(
        client.wait_for_trace(".suspended(true)", 1),
        "a hidden window was never told it is suspended; it traced:\n{}",
        client.trace()
    );

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
        .wait_for(|message| {
            *message
                == HostMessage::WindowsTheme {
                    theme: Theme::Light,
                }
        })
        .expect("the windows turn");
    assert!(
        captured.elapsed() < REPAINT_WITHIN,
        "the windows waited for the hidden one to repaint ({:?})",
        captured.elapsed()
    );
}

/// How many frames the client has drawn.
fn frames(client: &running::Client) -> usize {
    client.trace().matches(".release()").count()
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

/// The page put `app_id`'s window at the origin with `size`.
fn placed(chrome: &mut domicile_test_chrome::Chrome, app_id: &str, size: [f64; 2]) {
    chrome
        .say(&ChromeMessage::SetAppBounds {
            app_id: app_id.to_string(),
            position: [0.0, 0.0],
            size,
        })
        .expect("the chrome reports where it put the window");
}
