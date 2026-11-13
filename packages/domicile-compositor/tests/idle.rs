//! Tests for screen blanking in a running compositor.
//!
//! `crate::idle` unit-tests the timing logic. These cover the calloop timer
//! armed in `run`, config reloads, and idle inhibitors held by real clients.
//!
//! Assertions read the compositor's log because the connectors belong to the
//! engine, which is not attached here.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage, SystemEvent, SystemReply, SystemRequest};

use crate::running::bus::Bus;
use crate::running::Compositor;

const SCREEN_SAVER: &str = "org.freedesktop.ScreenSaver";

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

/// Whether `message` tells watch `id` the desk is `idle`.
fn idle(id: u32, idle: bool) -> impl Fn(&HostMessage) -> bool {
    move |message| {
        matches!(
            message,
            HostMessage::SystemEvent {
                id: heard,
                event: SystemEvent::Idle { idle: heard_idle },
            } if *heard == id && *heard_idle == idle
        )
    }
}

/// Starts watch `id` going idle after `seconds`.
fn watch(chrome: &mut domicile_test_chrome::Chrome, id: u32, seconds: u64) {
    chrome
        .say(&ChromeMessage::SystemRequest {
            id,
            request: SystemRequest::IdleAfter { seconds },
        })
        .expect("the chrome socket takes a system call");
}

/// The shell's watches go idle in the order of their times, on a desk with no
/// timeout of its own, and a key ends both.
#[test]
fn a_page_hears_each_time_it_chose_pass_and_a_key_end_them() {
    let compositor = Compositor::started_with(NOBODY_MENTIONED_IDLE);
    let mut chrome = compositor.chrome();
    watch(&mut chrome, 2, 2);
    watch(&mut chrome, 1, 1);

    let first = chrome
        .wait_for(|message| idle(1, true)(message) || idle(2, true)(message))
        .expect("a watch goes idle");
    assert!(idle(1, true)(&first), "the shorter goes first: {first:?}");
    chrome
        .wait_for(idle(2, true))
        .expect("the longer goes idle after");
    chrome
        .say(&ChromeMessage::Key {
            app_id: "nothing".into(),
            keycode: 30,
            pressed: true,
        })
        .expect("the chrome socket takes a key");

    chrome
        .wait_for(idle(1, false))
        .expect("the key ends the first");
    chrome
        .wait_for(idle(2, false))
        .expect("the key ends the second");
}

/// An idle inhibitor holds the shell's watches as it holds blanking, and
/// letting go after the time is up goes idle at once.
#[test]
fn a_film_holds_the_shells_idle_watches_until_it_is_gone() {
    let compositor = Compositor::started_with(NOBODY_MENTIONED_IDLE);
    let mut chrome = compositor.chrome();
    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 2,
            request: SystemRequest::IdleHolds,
        })
        .expect("the chrome socket takes a system call");
    let film = compositor.client_with("film", &["--hold-the-screens-on"]);
    chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 2,
                    event: SystemEvent::IdleHolds { holders },
                } if !holders.is_empty()
            )
        })
        .expect("the film holds the desktop awake");
    watch(&mut chrome, 1, 1);

    std::thread::sleep(std::time::Duration::from_secs(2));
    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 3,
            request: SystemRequest::IdleHolds,
        })
        .expect("the chrome socket takes a system call");
    let heard = chrome
        .wait_for(|message| {
            idle(1, true)(message) || matches!(message, HostMessage::SystemReply { id: 3, .. })
        })
        .expect("the page hears something");
    assert!(
        !idle(1, true)(&heard),
        "the film held the watch past its time"
    );

    drop(film);
    chrome
        .wait_for(idle(1, true))
        .expect("the watch goes idle once the film is gone");
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
/// for the shell to name, and hears nothing holds once the client is gone.
#[test]
fn a_page_hears_which_application_holds_the_desktop_awake() {
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

/// A window the page hides, on another workspace or behind a tab, stops
/// holding the desktop awake, and holds it again when shown. The protocol lets
/// an inhibitor go once its surface is not visible.
#[test]
fn a_hidden_window_holds_the_desktop_awake_only_while_shown() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let mut chrome = compositor.chrome();
    let _film = compositor.client_with("film", &["--hold-the-screens-on"]);
    compositor.wait_for_log("a client is holding this desktop awake");
    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the film's window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    placed(&mut chrome, &app_id, [0.0, 0.0]);
    compositor.wait_for_log("a window was hidden; this desktop's screens go dark");

    placed(&mut chrome, &app_id, [640.0, 480.0]);
    compositor.wait_for_log("a window was shown; this desktop's screens come back on");
}

/// A browser holding a screen wake lock, as for a video call, asks
/// `org.freedesktop.ScreenSaver` to keep the screens on. The screens go dark
/// once it lets go, or once it is gone without letting go.
#[test]
fn a_video_call_in_a_browser_holds_the_screens_on_until_it_lets_go() {
    let bus = Bus::started();
    let compositor = Compositor::started_on_a_bus(A_DESK_THAT_BLANKS, &bus.address);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let browser = bus.client_once(SCREEN_SAVER);
    let cookie = inhibit(&browser);
    compositor.wait_for_log(
        "an application asked to keep the screens on; this desktop's screens come back on",
    );
    browser
        .call_method(
            Some(SCREEN_SAVER),
            "/org/freedesktop/ScreenSaver",
            Some(SCREEN_SAVER),
            "UnInhibit",
            &(cookie,),
        )
        .expect("UnInhibit answers");
    compositor.wait_for_log(
        "an application asked to keep the screens on; this desktop's screens go dark",
    );

    inhibit(&browser);
    compositor.wait_for_log("this desktop's screens come back on");
    drop(browser);
    compositor.wait_for_log(
        "an application that kept the screens on is gone; this desktop's screens go dark",
    );
}

/// A screen saver hold from the engine's own browser process is a page in a
/// browser window, so a page hears it as `domicile-browser` for the shell to
/// name the site. The test is both the engine and the page: its pid dialed the
/// chrome socket.
#[test]
fn a_page_hears_a_browser_window_hold_the_desktop_awake_as_the_browser() {
    let bus = Bus::started();
    let compositor = Compositor::started_on_a_bus(A_DESK_THAT_BLANKS, &bus.address);
    let mut chrome = compositor.chrome();
    chrome
        .say(&ChromeMessage::Hello {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
            checked: false,
        })
        .expect("the chrome socket takes a hello");
    chrome
        .say(&ChromeMessage::SystemRequest {
            id: 1,
            request: SystemRequest::IdleHolds,
        })
        .expect("the chrome socket takes a system call");

    let engine = bus.client_once(SCREEN_SAVER);
    inhibit(&engine);
    chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 1,
                    event: SystemEvent::IdleHolds { holders },
                } if *holders == ["domicile-browser"]
            )
        })
        .expect("the page hears a browser window hold the desktop awake");
}

/// Asks the screen saver to stay off, as Chromium does, returning the cookie.
fn inhibit(connection: &zbus::blocking::Connection) -> u32 {
    connection
        .call_method(
            Some(SCREEN_SAVER),
            "/org/freedesktop/ScreenSaver",
            Some(SCREEN_SAVER),
            "Inhibit",
            &("Chromium", "WebRTC has active PeerConnections"),
        )
        .expect("Inhibit answers")
        .body()
        .deserialize()
        .expect("a cookie")
}

/// The page put `app_id`'s window at the origin with `size`; an empty one
/// hides it.
fn placed(chrome: &mut domicile_test_chrome::Chrome, app_id: &str, size: [f64; 2]) {
    chrome
        .say(&ChromeMessage::SetAppBounds {
            app_id: app_id.to_string(),
            position: [0.0, 0.0],
            size,
        })
        .expect("the chrome reports where it put the window");
}
