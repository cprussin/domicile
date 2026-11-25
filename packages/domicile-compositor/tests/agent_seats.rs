//! Tests that an agent's emulated input goes down its own seat: to the window
//! it points at or focused, never moving the user's pointer or keyboard, and
//! never into an app the user is in. See `src/agent_seats.rs`.

mod running;

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

use domicile_protocol::{
    AgentReach, ChromeMessage, EmulatedInput, HostMessage, PointerButton, PortalAnswer, PortalKind,
    SystemReply, SystemRequest,
};

use crate::running::{Client, Compositor};

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// The evdev codes for `a` and `b`.
const EVDEV_KEY_A: u32 = 30;
const EVDEV_KEY_B: u32 = 48;

/// The Linux code for the left mouse button.
const BTN_LEFT: u32 = 0x110;

/// Asks to let an agent in, as `domicile agent` does, and lets it reach the
/// whole desk from the shell's dialog. Returns the connection that holds it
/// in, and its session.
fn an_agent_let_in(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
) -> (UnixStream, u32) {
    let mut held = UnixStream::connect(compositor.socket()).expect("the chrome socket is up");
    let asked = serde_json::to_string(&ChromeMessage::SystemRequest {
        id: 1,
        request: SystemRequest::Agent {
            agent: "Claude Code".to_string(),
        },
    })
    .unwrap();
    writeln!(held, "{asked}").expect("the compositor reads the ask");
    let dialog = chrome
        .wait_for(|message| {
            matches!(message, HostMessage::PortalRequests { items, .. }
                if items.iter().any(|item| matches!(item.kind, PortalKind::Agent(_))))
        })
        .expect("the shell is asked to let the agent in");
    let HostMessage::PortalRequests { items, .. } = dialog else {
        unreachable!("the wait matched on this variant")
    };
    chrome
        .say(&ChromeMessage::AnswerPortalRequest {
            id: items[0].id,
            answer: PortalAnswer::Agent {
                reach: AgentReach::Desk,
                remember: false,
            },
        })
        .expect("the chrome socket takes an answer");
    let mut said = String::new();
    BufReader::new(held.try_clone().unwrap())
        .read_line(&mut said)
        .expect("the agent hears it is in");
    match serde_json::from_str(&said) {
        Ok(HostMessage::SystemReply {
            reply: SystemReply::Agent { session, .. },
            ..
        }) => (held, session),
        _ => panic!("the agent was not let in: {said}"),
    }
}

/// Sends `input` on agent `session`'s seat, as `domicile pointer --agent`
/// does, and returns why it was refused.
fn as_the_agent(
    compositor: &Compositor,
    session: u32,
    input: Vec<EmulatedInput>,
) -> Option<String> {
    let mut asking = UnixStream::connect(compositor.socket()).expect("the chrome socket is up");
    let said = serde_json::to_string(&ChromeMessage::Emulate {
        input,
        agent: Some(session),
    })
    .unwrap();
    writeln!(asking, "{said}").expect("the compositor reads the input");
    let mut answer = String::new();
    BufReader::new(asking)
        .read_line(&mut answer)
        .expect("the compositor answers");
    match serde_json::from_str(&answer) {
        Ok(HostMessage::Emulated { refused }) => refused,
        _ => panic!("not an answer to emulated input: {answer}"),
    }
}

fn click_at(x: f64, y: f64) -> Vec<EmulatedInput> {
    vec![
        EmulatedInput::PointTo { x, y },
        EmulatedInput::Button {
            button: PointerButton::Left,
            pressed: true,
        },
        EmulatedInput::Button {
            button: PointerButton::Left,
            pressed: false,
        },
    ]
}

fn tap(key: &str) -> Vec<EmulatedInput> {
    [true, false]
        .map(|pressed| EmulatedInput::Key {
            key: key.to_string(),
            pressed,
        })
        .to_vec()
}

/// Two windows: the user's on the left, at the origin, and another to the
/// right of it, at x 1000. The user's has their pointer and keyboard.
struct TwoWindows {
    chrome: domicile_test_chrome::Chrome,
    users: (Client, String),
    other: (Client, String),
}

fn two_windows(compositor: &Compositor) -> TwoWindows {
    two_windows_with(compositor, &[])
}

/// [`two_windows`], the other window's client started with `extra`.
fn two_windows_with(compositor: &Compositor, extra: &[&str]) -> TwoWindows {
    let mut chrome = compositor.chrome();
    let mut opened = |title: &str, extra: &[&str]| {
        let client = compositor.client_with(title, extra);
        let appeared = chrome
            .wait_for(|message| {
                matches!(message, HostMessage::AppAppeared { title: Some(t), .. } if t == title)
            })
            .expect("a client that opened a window is announced to the chrome");
        let HostMessage::AppAppeared { app_id, .. } = appeared else {
            unreachable!("the wait matched on this variant")
        };
        (client, app_id)
    };
    let users = opened("users", &[]);
    let other = opened("other", extra);
    for (app_id, x) in [(&users.1, 0.0), (&other.1, 1000.0)] {
        chrome
            .say(&ChromeMessage::SetAppBounds {
                app_id: app_id.clone(),
                position: [x, 0.0],
                size: [800.0, 600.0],
            })
            .expect("the chrome places the window");
    }
    for message in [
        ChromeMessage::FocusApp {
            app_id: users.1.clone(),
        },
        ChromeMessage::PointerMotion {
            app_id: users.1.clone(),
            x: 10.0,
            y: 10.0,
            moved: true,
        },
    ] {
        chrome
            .say(&message)
            .expect("the chrome forwards the user's input");
    }
    compositor.wait_for_log("keyboard focus -> client");
    TwoWindows {
        chrome,
        users,
        other,
    }
}

/// The agent clicks and types in the other window while the user's pointer
/// and keyboard stay in theirs: the user's window hears none of it, and the
/// user's next key still reaches their own window.
#[test]
fn an_agent_clicks_and_types_in_another_window_without_moving_the_user() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
    assert_eq!(as_the_agent(&compositor, session, tap("a")), None);

    let (other, users) = (&mut desk.other.0, &mut desk.users.0);
    for (what, tail) in [
        ("the agent's click", format!(", {BTN_LEFT}, 1)")),
        ("the agent's key", format!(", {EVDEV_KEY_A}, 1)")),
        ("the agent's key's release", format!(", {EVDEV_KEY_A}, 0)")),
    ] {
        assert!(
            other.wait_for_trace(&tail, 1),
            "{what} never reached the window it went to; it traced:\n{}",
            other.trace()
        );
    }
    desk.chrome
        .say(&ChromeMessage::Key {
            app_id: desk.users.1.clone(),
            keycode: EVDEV_KEY_B,
            pressed: true,
        })
        .expect("the chrome forwards the user's key");
    assert!(
        users.wait_for_trace(&format!(", {EVDEV_KEY_B}, 1)"), 1),
        "the user's key went elsewhere after the agent typed; their window traced:\n{}",
        users.trace()
    );
    let traced = users.trace();
    assert!(
        !traced.contains(&format!(", {EVDEV_KEY_A}, 1)"))
            && !traced.contains(&format!(", {BTN_LEFT}, 1)")),
        "the agent's input reached the user's window:\n{traced}"
    );
}

/// An app the user is in is theirs: the agent is told to act on it by ref.
/// So is nothing at all, under the agent's pointer.
#[test]
fn an_agent_is_refused_the_users_app_and_the_empty_desk() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    let refused = as_the_agent(&compositor, session, click_at(100.0, 100.0));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("the user is using this app")),
        "the agent clicked in the user's window: {refused:?}"
    );
    let refused = as_the_agent(&compositor, session, click_at(900.0, 900.0));
    assert!(
        refused.as_deref().is_some_and(|why| why.contains("by ref")),
        "the agent's pointer went to the empty desk: {refused:?}"
    );
    let refused = as_the_agent(&compositor, session, tap("a"));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("in no window")),
        "the agent typed with no window of its own: {refused:?}"
    );
}

/// A pointer that left a window between calls is not still over it: a click
/// on the empty desk after one in a window is refused, and the window hears
/// one click.
#[test]
fn an_agents_pointer_that_moved_off_a_window_clicks_nothing_there() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );

    let refused = as_the_agent(&compositor, session, click_at(900.0, 900.0));

    assert!(
        refused.as_deref().is_some_and(|why| why.contains("by ref")),
        "the agent's click off its window went through: {refused:?}"
    );
    let other = &mut desk.other.0;
    assert!(other.wait_for_trace(&format!(", {BTN_LEFT}, 0)"), 1));
    assert_eq!(
        other.trace().matches(&format!(", {BTN_LEFT}, 1)")).count(),
        1,
        "the window under the agent's last call was clicked again:\n{}",
        other.trace()
    );
}

/// The surface a client's menu is, from its trace.
fn menu_surface(client: &mut Client) -> String {
    assert!(
        client.wait_for_trace(".opened(", 1),
        "no menu opened:\n{}",
        client.trace()
    );
    client
        .trace()
        .lines()
        .find_map(|line| line.split_once(".opened(").map(|(_, rest)| rest))
        .and_then(|rest| rest.strip_suffix(')'))
        .expect("the client says which surface its menu is")
        .to_string()
}

/// A menu the agent opens grabs the agent's keyboard, not the user's: the
/// user keeps typing in their window, and the agent's clicks reach the menu.
#[test]
fn a_menu_an_agent_opens_takes_the_agents_keyboard_and_pointer() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows_with(&compositor, &["--grabbing-menu"]);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
    let menu = menu_surface(&mut desk.other.0);
    assert!(
        desk.other.0.wait_for_trace(&format!("enter({menu})"), 1),
        "the agent's keyboard did not go to its menu:\n{}",
        desk.other.0.trace()
    );

    desk.chrome
        .say(&ChromeMessage::Key {
            app_id: desk.users.1.clone(),
            keycode: EVDEV_KEY_B,
            pressed: true,
        })
        .expect("the chrome forwards the user's key");
    assert!(
        desk.users
            .0
            .wait_for_trace(&format!(", {EVDEV_KEY_B}, 1)"), 1),
        "the agent's menu took the user's keyboard; their window traced:\n{}",
        desk.users.0.trace()
    );

    // The menu is at 10,20 in its window, 120 by 80.
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1050.0, 60.0)),
        None
    );
    assert!(
        desk.other.0.wait_for_trace(&format!("{menu}, 40, 40)"), 1),
        "the agent's pointer did not enter its menu:\n{}",
        desk.other.0.trace()
    );
}

/// The user focusing the window an agent types in takes it: the agent's keys
/// stop there, and its next is refused.
#[test]
fn the_user_takes_a_window_from_an_agent_by_focusing_it() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );

    desk.chrome
        .say(&ChromeMessage::FocusApp {
            app_id: desk.other.1.clone(),
        })
        .expect("the chrome forwards the user's focus");
    compositor.wait_for_log_times("keyboard focus -> client", 2);

    let refused = as_the_agent(&compositor, session, tap("a"));
    assert!(
        refused.is_some(),
        "the agent typed into the window the user took"
    );
}

/// An agent that has gone has no seat to send on.
#[test]
fn an_agent_that_left_sends_nothing() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );

    drop(held);
    compositor.wait_for_log("an agent's seat went with its session");

    let refused = as_the_agent(&compositor, session, tap("a"));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("no agent is in")),
        "a gone agent still typed: {refused:?}"
    );
}
