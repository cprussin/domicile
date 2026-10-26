//! Tests for screen blanking in a running compositor.
//!
//! `crate::idle` unit-tests the timing logic. These cover the calloop timer
//! armed in `run`, config reloads, and idle inhibitors held by real clients.
//!
//! Assertions read the compositor's log because the connectors belong to the
//! engine, which is not attached here.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage, SystemEvent, SystemReply, SystemRequest};

use crate::running::Compositor;

/// A desk with no idle timeout, which never blanks.
const NOBODY_MENTIONED_IDLE: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// A desk that blanks after one second, the shortest timeout the config
/// allows.
const A_DESK_THAT_BLANKS: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "idle": { "blank_after_seconds": 1 }
}
"#;

/// A desk that blanks after 30 seconds, for changing rather than removing the
/// timeout.
const A_DESK_THAT_BLANKS_LATER: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "idle": { "blank_after_seconds": 30 }
}
"#;

/// A desk that warns its shell a second before it blanks, the shortest the
/// config allows.
const A_DESK_THAT_WARNS: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "idle": { "blank_after_seconds": 2, "warn_before_seconds": 1 }
}
"#;

/// The page hears the warning from the armed timer, and a key calls it off.
#[test]
fn a_key_during_the_warning_keeps_the_screens_on() {
    let compositor = Compositor::started_with(A_DESK_THAT_WARNS);
    let mut chrome = compositor.chrome();
    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 1,
            request: SystemRequest::IdleWarnings,
        })
        .expect("the chrome socket takes a system call");

    chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 1,
                    event: SystemEvent::IdleWarning {
                        blanks_in_ms: Some(_)
                    },
                }
            )
        })
        .expect("the page is warned");
    chrome
        .say(&ChromeMessage::Key {
            app_id: "nothing".into(),
            keycode: 30,
            pressed: true,
        })
        .expect("the chrome socket takes a key");

    chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 1,
                    event: SystemEvent::IdleWarning { blanks_in_ms: None },
                }
            )
        })
        .expect("the warning is called off");
    compositor.wait_for_log("somebody is at this desktop again; its screens stay on");
}

/// Blanking alone leaves the desktop unlocked: a page on the dark desk still
/// starts a process, which a locked one refuses.
#[test]
fn a_desk_that_blanks_without_a_lock_timeout_stays_unlocked() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    let mut chrome = compositor.chrome();
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 2,
            request: SystemRequest::Spawn {
                argv: vec!["true".into()],
                cwd: None,
                env: Default::default(),
                stdin: false,
            },
        })
        .expect("the chrome socket takes a system call");
    let replied = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemReply { id: 2, .. }))
        .expect("the call is answered");
    assert_eq!(
        replied,
        HostMessage::SystemReply {
            id: 2,
            reply: SystemReply::Started,
        }
    );
}

/// A timeout added by reload blanks a desk that started with none.
///
/// A desk with no timeout has no timer, so the reload must insert one.
#[test]
fn a_timeout_added_on_disk_blanks_a_desk_that_had_no_clock() {
    let compositor = Compositor::started_with(NOBODY_MENTIONED_IDLE);

    compositor.reconfigure(A_DESK_THAT_BLANKS);

    compositor.wait_for_log("nobody is at this desktop; its screens go dark");
}

/// Changing the timeout while the screens are off turns them back on.
///
/// The reload replaces the clock with one from `Idle::after`, which starts
/// active. The screens must match, or the next input would not relight them.
#[test]
fn a_timeout_edited_while_the_screens_are_off_turns_them_back_on() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    compositor.reconfigure(A_DESK_THAT_BLANKS_LATER);

    compositor.wait_for_log("the idle timeout changed while the screens were off");
}

/// An idle inhibitor wakes a dark desk, and is released when its client dies.
///
/// The client is killed, so it sends no `zwp_idle_inhibitor_v1.destroy`. The
/// compositor must release the inhibitor when the window or surface goes;
/// smithay's cleanup order decides which, so the final log line matches both.
#[test]
fn a_film_holds_the_screens_on_until_the_client_playing_it_is_gone() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let film = compositor.client_with("film", &["--hold-the-screens-on"]);
    compositor.wait_for_log("a client is holding this desktop awake");

    drop(film);
    compositor.wait_for_log("this desktop's screens go dark");
}

/// A page listening hears the window holding the desktop awake by its app id,
/// and hears nothing holds once the client is gone.
#[test]
fn a_page_hears_which_window_holds_the_desktop_awake() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    let mut chrome = compositor.chrome();
    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 1,
            request: SystemRequest::IdleHolds,
        })
        .expect("the chrome socket takes a system call");
    let holders = |holders: &[&str]| {
        let holders: Vec<String> = holders.iter().map(|name| name.to_string()).collect();
        move |message: &HostMessage| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 1,
                    event: SystemEvent::IdleHolds { holders: heard },
                } if *heard == holders
            )
        }
    };

    let film = compositor.client_with("film", &["--hold-the-screens-on"]);
    chrome
        .wait_for(holders(&["dev.domicile.test-client"]))
        .expect("the page hears the film hold the desktop awake");

    drop(film);
    chrome
        .wait_for(holders(&[]))
        .expect("the page hears nothing holds once the film is gone");
}

/// An inhibitor on a surface with no role takes effect when the surface
/// becomes a window.
///
/// The log line appears only if the desk was still dark when the window
/// arrived, so it checks both halves.
#[test]
fn an_inhibitor_taken_before_a_window_holds_nothing_until_the_window_is_there() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let _film = compositor.client_with("film", &["--hold-the-screens-on-before-it-has-a-window"]);

    compositor
        .wait_for_log("a window appeared under an inhibitor; this desktop's screens come back on");
}

/// Closing a window releases its inhibitor even if the client keeps running.
///
/// The client destroys its `xdg_toplevel` but keeps its surface and inhibitor.
/// A dying client logs the same line, so the test checks the client is still
/// running.
#[test]
fn the_screens_go_dark_when_the_window_holding_them_on_is_closed() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let mut chrome = compositor.chrome();
    let mut film =
        compositor.client_with("film", &["--hold-the-screens-on", "--outlive-its-window"]);
    compositor.wait_for_log("a client is holding this desktop awake");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the film's window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    chrome
        .say(&ChromeMessage::CloseApp { app_id })
        .expect("the chrome socket takes a close");

    compositor.wait_for_log(
        "the window holding this desktop awake is gone; this desktop's screens go dark",
    );
    assert!(
        film.is_running(),
        "the client outlived its window, so what let the screens go was the window and not a death",
    );
}
