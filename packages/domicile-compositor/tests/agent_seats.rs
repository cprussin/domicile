//! Tests that an agent's emulated input goes down its own seat: to the window
//! it points at or focused, never moving the user's pointer or keyboard, and
//! never into an app the user is in. See `src/agent_seats.rs`.

mod running;

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

use domicile_protocol::{
    AgentPageInput, AgentReach, ChromeMessage, EmulatedInput, HostMessage, PointerButton,
    PortalAnswer, PortalKind, SystemEvent, SystemReply, SystemRequest,
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
    as_the_agent_on(compositor.socket(), session, input)
}

/// [`as_the_agent`], on the compositor at `socket`.
fn as_the_agent_on(
    socket: &std::path::Path,
    session: u32,
    input: Vec<EmulatedInput>,
) -> Option<String> {
    let mut asking = UnixStream::connect(socket).expect("the chrome socket is up");
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

/// Why the browser refuses a point where the shell itself is.
const THE_SHELL: &str = "the shell is at that point: act on it by ref";

/// [`as_the_agent`], with the test chrome as the browser: it answers the
/// first `asks` questions the input asks of the browser's pages with
/// `browser`, the window the event reached or why it refused, and returns
/// why the input was refused.
fn as_the_agent_over_pages(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    session: u32,
    input: Vec<EmulatedInput>,
    asks: usize,
    mut browser: impl FnMut(&AgentPageInput, &[String]) -> Result<String, String>,
) -> Option<String> {
    let socket = compositor.socket().to_path_buf();
    let sent = std::thread::spawn(move || as_the_agent_on(&socket, session, input));
    for _ in 0..asks {
        let asked = chrome
            .wait_for(|message| matches!(message, HostMessage::AgentInput { quiet: false, .. }))
            .expect("the browser is asked");
        let HostMessage::AgentInput {
            serial,
            seat,
            input,
            barred,
            ..
        } = asked
        else {
            unreachable!("the wait matched on this variant")
        };
        assert_eq!(seat, format!("agent-{session}"));
        let (window, refused) = match browser(&input, &barred) {
            Ok(window) => (Some(window), None),
            Err(why) => (None, Some(why)),
        };
        chrome
            .say(&ChromeMessage::AgentInputReached {
                serial,
                window,
                refused,
            })
            .expect("the browser answers");
    }
    sent.join().expect("the agent's call ends")
}

/// The next quiet event an agent seat's input sent the browser.
fn quietly_told(chrome: &mut domicile_test_chrome::Chrome) -> AgentPageInput {
    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::AgentInput { quiet: true, .. }))
        .expect("the browser is told");
    let HostMessage::AgentInput { input, .. } = told else {
        unreachable!("the wait matched on this variant")
    };
    input
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
    /// The other window's id as `list-windows` gives it.
    other_listed: String,
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
        let HostMessage::AppAppeared {
            app_id,
            toplevel_id,
            ..
        } = appeared
        else {
            unreachable!("the wait matched on this variant")
        };
        ((client, app_id), toplevel_id)
    };
    let (users, _) = opened("users", &[]);
    let (other, other_listed) = opened("other", extra);
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
        other_listed,
    }
}

/// An agent focuses a native window by the id `list-windows` gives it, as
/// its MCP tools name windows, and types there.
#[test]
fn an_agent_focuses_a_native_window_by_its_listed_id() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    assert_eq!(
        as_the_agent(
            &compositor,
            session,
            vec![EmulatedInput::Focus {
                window: desk.other_listed.clone()
            }]
        ),
        None
    );
    assert_eq!(as_the_agent(&compositor, session, tap("a")), None);
    assert!(
        desk.other
            .0
            .wait_for_trace(&format!(", {EVDEV_KEY_A}, 1)"), 1),
        "the agent's key never reached the window it focused; it traced:\n{}",
        desk.other.0.trace()
    );
}

/// Sends shell command `command` on `window` for agent `session`, as
/// `domicile send-shell --agent` does, and returns how it ended.
fn shell_command_as_the_agent(
    compositor: &Compositor,
    session: u32,
    window: Option<&str>,
    command: &[&str],
) -> std::thread::JoinHandle<SystemReply> {
    let mut asking = UnixStream::connect(compositor.socket()).expect("the chrome socket is up");
    let said = serde_json::to_string(&ChromeMessage::SystemRequest {
        id: 1,
        request: SystemRequest::SendShell {
            command: command.iter().map(|word| word.to_string()).collect(),
            window: window.map(str::to_string),
            agent: Some(session),
        },
    })
    .unwrap();
    writeln!(asking, "{said}").expect("the compositor reads the command");
    std::thread::spawn(move || {
        let mut answer = String::new();
        BufReader::new(asking)
            .read_line(&mut answer)
            .expect("the compositor answers");
        match serde_json::from_str(&answer) {
            Ok(HostMessage::SystemReply { reply, .. }) => reply,
            _ => panic!("not an answer to a shell command: {answer}"),
        }
    })
}

/// An agent's shell command on a window its seat holds reaches the shell
/// aimed at that window, by the id the shell knows it by, so the shell acts
/// on it and not on the user's focus.
#[test]
fn an_agents_shell_command_acts_on_a_window_it_holds() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    desk.chrome
        .say(&ChromeMessage::SystemRequest {
            id: 7,
            request: SystemRequest::ShellCommands {
                commands: Vec::new(),
                bindings: Vec::new(),
                on_a_window: true,
            },
        })
        .expect("the chrome socket takes a request");
    assert_eq!(
        as_the_agent(
            &compositor,
            session,
            vec![EmulatedInput::Focus {
                window: desk.other_listed.clone()
            }]
        ),
        None
    );

    let sent = shell_command_as_the_agent(
        &compositor,
        session,
        Some(&desk.other_listed),
        &["move", "container", "to", "workspace", "3"],
    );

    let heard = desk
        .chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 7,
                    event: SystemEvent::ShellCommand { .. },
                }
            )
        })
        .expect("the shell hears the agent's command");
    let HostMessage::SystemEvent {
        event:
            SystemEvent::ShellCommand {
                sent: number,
                window,
                ..
            },
        ..
    } = heard
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(window, Some(desk.other.1.clone()));
    desk.chrome
        .say(&ChromeMessage::SystemRequest {
            id: 8,
            request: SystemRequest::AnswerShellCommand {
                sent: number,
                refused: None,
                output: None,
            },
        })
        .expect("the chrome socket takes an answer");
    assert_eq!(
        sent.join().expect("the agent's call ends"),
        SystemReply::Sent { output: None }
    );
}

/// An agent's shell command that names no window acts on the window the
/// agent's own keyboard is in, not the user's focus; with its keyboard in no
/// window, it is refused.
#[test]
fn an_agents_shell_command_naming_no_window_acts_on_its_own_focus() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    desk.chrome
        .say(&ChromeMessage::SystemRequest {
            id: 7,
            request: SystemRequest::ShellCommands {
                commands: Vec::new(),
                bindings: Vec::new(),
                on_a_window: true,
            },
        })
        .expect("the chrome socket takes a request");

    let unfocused = shell_command_as_the_agent(&compositor, session, None, &["floating", "toggle"]);
    let SystemReply::Failed { error } = unfocused.join().expect("the agent's call ends") else {
        panic!("a command from a seat focusing nothing was sent");
    };
    assert_eq!(
        error.message,
        "your seat's keyboard is in no window: name one, or focus_window one first"
    );

    assert_eq!(
        as_the_agent(
            &compositor,
            session,
            vec![EmulatedInput::Focus {
                window: desk.other_listed.clone()
            }]
        ),
        None
    );
    let _sent = shell_command_as_the_agent(&compositor, session, None, &["floating", "toggle"]);
    let heard = desk
        .chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: 7,
                    event: SystemEvent::ShellCommand { .. },
                }
            )
        })
        .expect("the shell hears the agent's command");
    let HostMessage::SystemEvent {
        event: SystemEvent::ShellCommand { window, .. },
        ..
    } = heard
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(window, Some(desk.other.1.clone()));
}

/// An agent's shell command on a window its seat doesn't hold, such as the
/// user's, is refused before the shell hears it.
#[test]
fn an_agents_shell_command_on_a_window_it_does_not_hold_is_refused() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    let sent = shell_command_as_the_agent(&compositor, session, Some(&desk.users.1), &["kill"]);

    let SystemReply::Failed { error } = sent.join().expect("the agent's call ends") else {
        panic!("the agent's command on the user's window was sent");
    };
    assert_eq!(
        error.message,
        format!(
            "your seat doesn't hold window {}: focus_window it first, or act on it by ref",
            desk.users.1
        )
    );
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
/// So is the shell, under the agent's pointer, which the browser refuses.
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
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        click_at(900.0, 900.0),
        1,
        |_, _| Err(THE_SHELL.to_string()),
    );
    assert_eq!(refused.as_deref(), Some(THE_SHELL));
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

    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        click_at(900.0, 900.0),
        1,
        |_, _| Err(THE_SHELL.to_string()),
    );

    assert_eq!(refused.as_deref(), Some(THE_SHELL));
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

/// Opens a window titled `title` whose client is started with `extra`, and
/// returns it with its app id.
fn a_window(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    title: &str,
    extra: &[&str],
) -> (Client, String) {
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
}

/// Gives the user's keyboard to `app_id`, as the shell does on a click.
fn the_user_focuses(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    app_id: &str,
    times: usize,
) {
    chrome
        .say(&ChromeMessage::FocusApp {
            app_id: app_id.to_string(),
        })
        .expect("the chrome forwards the user's focus");
    compositor.wait_for_log_times("keyboard focus -> client", times);
}

/// An agent copies and pastes on a clipboard of its own: its copy reaches
/// the window it pastes in, never the user's clipboard, and the user's copy
/// never reaches the agent.
#[test]
fn an_agent_copies_and_pastes_on_its_own_clipboard() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let (mut users_copying, users_copier) = a_window(
        &compositor,
        &mut chrome,
        "users copier",
        &[
            "--copy",
            "the user's copy",
            "--copy-primary",
            "the user's selection",
        ],
    );
    let (mut agents_copying, agents_copier) = a_window(
        &compositor,
        &mut chrome,
        "agents copier",
        &[
            "--copy",
            "the agent's copy",
            "--copy-primary",
            "the agent's selection",
        ],
    );
    let (mut agents_paste, agents_pasting) =
        a_window(&compositor, &mut chrome, "agents paste", &["--paste"]);
    let (mut users_paste, users_pasting) =
        a_window(&compositor, &mut chrome, "users paste", &["--paste"]);
    // The protocol denies `set_selection` from a client without the
    // keyboard, so each copier must have its copy handled (as
    // `tests/selection.rs` waits for it) before the
    // keyboard that let it copy moves on.
    the_user_focuses(&compositor, &mut chrome, &users_copier, 1);
    assert!(
        users_copying.wait_for_trace("copy handled", 1),
        "the window the user focused could not copy; it traced:\n{}",
        users_copying.trace()
    );
    let (_held, session) = an_agent_let_in(&compositor, &mut chrome);

    let agent_focuses = |window: &str| {
        assert_eq!(
            as_the_agent(
                &compositor,
                session,
                vec![EmulatedInput::Focus {
                    window: window.to_string()
                }]
            ),
            None
        );
    };
    agent_focuses(&agents_copier);
    assert!(
        agents_copying.wait_for_trace("copy handled", 1),
        "the window the agent focused could not copy; it traced:\n{}",
        agents_copying.trace()
    );
    agent_focuses(&agents_pasting);
    for (what, line) in [
        ("clipboard", "clipboard: the agent's copy"),
        ("middle-click selection", "primary: the agent's selection"),
    ] {
        assert!(
            agents_paste.wait_for_trace(line, 1),
            "the agent's {what} never reached the window it pasted in; it traced:\n{}",
            agents_paste.trace()
        );
    }

    the_user_focuses(&compositor, &mut chrome, &users_pasting, 2);
    for (what, line) in [
        ("clipboard", "clipboard: the user's copy"),
        ("middle-click selection", "primary: the user's selection"),
    ] {
        assert!(
            users_paste.wait_for_trace(line, 1),
            "the user's {what} did not survive the agent's copy; their window traced:\n{}",
            users_paste.trace()
        );
    }
    let (agents, users) = (agents_paste.trace(), users_paste.trace());
    assert!(
        !agents.contains("the user's"),
        "the user's clipboard reached the agent:\n{agents}"
    );
    assert!(
        !users.contains("the agent's"),
        "the agent's clipboard reached the user:\n{users}"
    );
}

/// A menu the user opens in the app an agent types in takes the app from the
/// agent: the agent's keys there are refused, rather than both keyboards
/// sharing the app and its clipboard.
#[test]
fn a_menu_the_user_opens_takes_the_app_from_the_agents_keyboard() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows_with(&compositor, &["--grabbing-menu"]);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(
            &compositor,
            session,
            vec![EmulatedInput::Focus {
                window: desk.other.1.clone()
            }]
        ),
        None
    );

    let app_id = desk.other.1.clone();
    desk.chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: app_id.clone(),
            x: 100.0,
            y: 100.0,
            moved: true,
        })
        .expect("the chrome forwards the user's pointer");
    for pressed in [true, false] {
        desk.chrome
            .say(&ChromeMessage::PointerButton {
                app_id: app_id.clone(),
                button: BTN_LEFT,
                pressed,
            })
            .expect("the chrome forwards the user's click");
    }
    let menu = menu_surface(&mut desk.other.0);
    assert!(
        desk.other.0.wait_for_trace(&format!("enter({menu})"), 1),
        "the user's keyboard did not go to their menu:\n{}",
        desk.other.0.trace()
    );
    let traced = desk.other.0.trace();
    let left = traced.find("keys_left(");
    let menu_entered = traced.find(&format!("enter({menu})"));
    assert!(
        left.is_some() && left < menu_entered,
        "the agent's keyboard stayed in the app while the user's entered it:\n{traced}"
    );

    let refused = as_the_agent(&compositor, session, tap("a"));
    assert!(
        refused.is_some(),
        "the agent kept typing in the app the user opened a menu in"
    );
}

/// The seats the shell was last told of.
fn told_seats(
    chrome: &mut domicile_test_chrome::Chrome,
    until: impl Fn(&[domicile_protocol::AgentSeat]) -> bool,
) -> Vec<domicile_protocol::AgentSeat> {
    let told = chrome
        .wait_for(|message| matches!(message, HostMessage::Seats { seats } if until(seats)))
        .expect("the shell is told the agent seats");
    let HostMessage::Seats { seats } = told else {
        unreachable!("the wait matched on this variant")
    };
    seats
}

/// The shell hears where an agent's pointer is and which window it holds,
/// to draw it.
#[test]
fn the_shell_is_told_what_an_agents_seat_holds() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );

    let other = desk.other.1.clone();
    let seats = told_seats(&mut desk.chrome, |seats| {
        seats
            .iter()
            .any(|seat| seat.focused.as_deref() == Some(other.as_str()))
    });
    assert_eq!(
        seats,
        vec![domicile_protocol::AgentSeat {
            id: format!("agent-{session}"),
            name: "Claude Code".to_string(),
            pointer: Some([1100.0, 100.0]),
            focused: Some(other.clone()),
            holds: vec![other],
            taken: Vec::new(),
        }]
    );
}

/// The shell takes a window from an agent: the agent's input there is
/// refused until the shell gives it back.
#[test]
fn the_shell_takes_a_window_from_an_agent_and_gives_it_back() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
    let other = desk.other.1.clone();

    desk.chrome
        .say(&ChromeMessage::TakeOver {
            app_id: other.clone(),
        })
        .expect("the chrome takes the window");
    let seats = told_seats(&mut desk.chrome, |seats| {
        seats.iter().any(|seat| !seat.taken.is_empty())
    });
    assert_eq!(seats[0].taken, vec![other.clone()]);
    assert!(
        seats[0].holds.is_empty(),
        "the agent still holds what was taken: {seats:?}"
    );
    let refused = as_the_agent(&compositor, session, click_at(1100.0, 100.0));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("took over")),
        "the agent clicked in a window the user took: {refused:?}"
    );

    // Seats from before the takeover also have nothing taken.
    desk.chrome.pass_over_heard();
    desk.chrome
        .say(&ChromeMessage::GiveBack {
            app_id: other.clone(),
        })
        .expect("the chrome gives the window back");
    told_seats(&mut desk.chrome, |seats| {
        seats.iter().all(|seat| seat.taken.is_empty())
    });
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
}

/// The user's keyboard taking an app from an agent keeps it theirs after they
/// move on, until they give it back.
#[test]
fn a_window_the_user_took_stays_theirs_after_they_leave_it() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
    the_user_focuses(&compositor, &mut desk.chrome, &desk.other.1, 2);
    the_user_focuses(&compositor, &mut desk.chrome, &desk.users.1, 3);

    let refused = as_the_agent(&compositor, session, click_at(1100.0, 100.0));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("took over")),
        "the agent took back a window the user took: {refused:?}"
    );
}

/// The user focusing another window of the app an agent types in moves the
/// agent's keyboard off it, but takes nothing: once the user moves on, the
/// agent drives its window again.
#[test]
fn the_users_focus_on_another_window_of_the_app_takes_nothing() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows_with(&compositor, &["--dialog"]);
    let other = desk.other.1.clone();
    let dialog = desk
        .chrome
        .wait_for(|message| {
            matches!(message, HostMessage::AppTransientFor { transient_for: Some(of), .. }
                if *of == other)
        })
        .expect("the other app opens its dialog");
    let HostMessage::AppTransientFor { app_id: dialog, .. } = dialog else {
        unreachable!("the wait matched on this variant")
    };
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );

    the_user_focuses(&compositor, &mut desk.chrome, &dialog, 2);
    the_user_focuses(&compositor, &mut desk.chrome, &desk.users.1, 3);

    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
}

/// A window the user took is taken with its popups: the agent's pointer is
/// refused a popup over it.
#[test]
fn a_popup_over_a_taken_window_is_taken_too() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows_with(&compositor, &["--popup"]);
    desk.chrome
        .wait_for(|message| matches!(message, HostMessage::PopupPlaced { .. }))
        .expect("the other app opens its popup");
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 300.0)),
        None
    );

    desk.chrome
        .say(&ChromeMessage::TakeOver {
            app_id: desk.other.1.clone(),
        })
        .expect("the chrome takes the window");
    told_seats(&mut desk.chrome, |seats| {
        seats.iter().any(|seat| !seat.taken.is_empty())
    });

    // The popup is at 10,20 in its window, 120 by 80.
    let refused = as_the_agent(&compositor, session, click_at(1050.0, 60.0));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("took over")),
        "the agent clicked a popup over a window the user took: {refused:?}"
    );
}

/// A window the user took from one agent is theirs: no other agent drives it
/// either.
#[test]
fn a_window_the_user_took_is_refused_every_agent() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_first, first) = an_agent_let_in(&compositor, &mut desk.chrome);
    assert_eq!(
        as_the_agent(&compositor, first, click_at(1100.0, 100.0)),
        None
    );
    desk.chrome
        .say(&ChromeMessage::TakeOver {
            app_id: desk.other.1.clone(),
        })
        .expect("the chrome takes the window");
    told_seats(&mut desk.chrome, |seats| {
        seats.iter().any(|seat| !seat.taken.is_empty())
    });

    let (_second, second) = an_agent_let_in(&compositor, &mut desk.chrome);
    let refused = as_the_agent(&compositor, second, click_at(1100.0, 100.0));
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("took over")),
        "another agent clicked in a window the user took: {refused:?}"
    );
}

/// A window that closes leaves every agent's seat: the shell stops drawing
/// it as held, or as taken.
#[test]
fn a_closed_window_leaves_the_agents_seats() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let TwoWindows {
        mut chrome,
        users,
        other,
        ..
    } = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut chrome);
    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );
    let (closing, closing_id) = other;
    told_seats(&mut chrome, |seats| {
        seats.iter().any(|seat| seat.holds.contains(&closing_id))
    });

    // Seats from before the agent's click also hold nothing.
    chrome.pass_over_heard();
    drop(closing);
    let seats = told_seats(&mut chrome, |seats| {
        !seats.is_empty() && seats.iter().all(|seat| seat.holds.is_empty())
    });
    assert_eq!(seats[0].focused, None);
    drop(users);
}

/// Starts `domicile-test-client --title <title>` as `domicile exec --agent
/// <session>` does, under a shell so the window is the started program's
/// child's, and returns why it was refused.
fn the_agent_starts(compositor: &Compositor, session: u32, title: &str) -> Option<String> {
    let mut asking = UnixStream::connect(compositor.socket()).expect("the chrome socket is up");
    let said = serde_json::to_string(&ChromeMessage::Exec {
        command: vec![
            "sh".to_string(),
            "-c".to_string(),
            format!(
                "{} --title {title}; true",
                env!("CARGO_BIN_EXE_domicile-test-client")
            ),
        ],
        agent: Some(session),
    })
    .unwrap();
    writeln!(asking, "{said}").expect("the compositor reads the exec");
    let mut answer = String::new();
    BufReader::new(asking)
        .read_line(&mut answer)
        .expect("the compositor answers");
    match serde_json::from_str(&answer) {
        Ok(HostMessage::Executed { refused }) => refused,
        _ => panic!("not an answer to exec: {answer}"),
    }
}

/// A window from a program an agent started is held by the agent from its
/// first frame, before the shell hears of it, so the shell need not give it
/// the user's keyboard: the agent types in it at once, and the user's
/// keyboard stays where it was.
#[test]
fn a_window_an_agent_starts_is_held_by_it_from_the_start() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    assert_eq!(the_agent_starts(&compositor, session, "started"), None);
    let known = [desk.users.1.clone(), desk.other.1.clone()];
    let first = desk
        .chrome
        .wait_for(|message| match message {
            HostMessage::AppAppeared { title: Some(t), .. } => t == "started",
            HostMessage::Seats { seats } => seats.iter().any(|seat| {
                seat.focused
                    .as_ref()
                    .is_some_and(|focused| !known.contains(focused))
            }),
            _ => false,
        })
        .expect("the started program's window is announced");
    assert!(
        matches!(first, HostMessage::Seats { .. }),
        "the shell heard of the agent's window before it was held: {first:?}"
    );

    assert_eq!(as_the_agent(&compositor, session, tap("a")), None);
}

/// Agent session `session`'s seat as the shell was last told it, once
/// `until` holds for it.
fn told_seat(
    chrome: &mut domicile_test_chrome::Chrome,
    session: u32,
    until: impl Fn(&domicile_protocol::AgentSeat) -> bool,
) -> domicile_protocol::AgentSeat {
    let id = format!("agent-{session}");
    told_seats(chrome, |seats| {
        seats.iter().any(|seat| seat.id == id && until(seat))
    })
    .into_iter()
    .find(|seat| seat.id == id)
    .expect("the wait matched on this seat")
}

/// Off every native window the agent's pointer is over the shell's page: the
/// browser takes its clicks and keys there, and the window it says they
/// reached is held by the agent's seat.
#[test]
fn an_agent_clicks_and_types_in_a_browser_window_at_a_desk_position() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    let mut asked = Vec::new();
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        click_at(900.0, 900.0),
        2,
        |input, _| {
            asked.push(input.clone());
            Ok("7".to_string())
        },
    );
    assert_eq!(refused, None);
    assert_eq!(
        asked,
        vec![
            AgentPageInput::Pointer { x: 900.0, y: 900.0 },
            AgentPageInput::Button {
                button: BTN_LEFT,
                pressed: true
            },
        ]
    );
    assert_eq!(
        quietly_told(&mut desk.chrome),
        AgentPageInput::Button {
            button: BTN_LEFT,
            pressed: false
        }
    );
    let seat = told_seat(&mut desk.chrome, session, |seat| {
        seat.focused.as_deref() == Some("7")
    });
    assert_eq!(seat.pointer, Some([900.0, 900.0]));
    assert_eq!(seat.holds, vec!["7".to_string()]);

    let mut asked = Vec::new();
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        tap("a"),
        1,
        |input, _| {
            asked.push(input.clone());
            Ok("7".to_string())
        },
    );
    assert_eq!(refused, None);
    assert_eq!(
        asked,
        vec![AgentPageInput::Key {
            keycode: EVDEV_KEY_A,
            pressed: true
        }]
    );
    assert_eq!(
        quietly_told(&mut desk.chrome),
        AgentPageInput::Key {
            keycode: EVDEV_KEY_A,
            pressed: false
        }
    );
    // The user's windows heard none of it.
    assert!(
        !desk.users.0.trace().contains(&format!(", {BTN_LEFT}, 1)")),
        "the user's window was clicked:\n{}",
        desk.users.0.trace()
    );
}

/// Moving from a browser window onto a native window tells the browser the
/// pointer left its pages, and clicking there takes the agent's keyboard out
/// of them.
#[test]
fn an_agents_pointer_leaves_the_pages_for_a_native_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        click_at(900.0, 900.0),
        2,
        |_, _| Ok("7".to_string()),
    );
    assert_eq!(refused, None);
    quietly_told(&mut desk.chrome);

    assert_eq!(
        as_the_agent(&compositor, session, click_at(1100.0, 100.0)),
        None
    );

    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Leave);
    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Blur);
    let other = desk.other.1.clone();
    let seat = told_seat(&mut desk.chrome, session, |seat| {
        seat.focused.as_deref() == Some(other.as_str())
    });
    assert_eq!(seat.holds, vec![other]);
}

/// The person wins in a browser window too: the browser says their keyboard
/// went to the window the agent types in, which is then theirs. The agent is
/// refused it, and the browser is told never to let it in, until it is given
/// back.
#[test]
fn the_user_takes_a_browser_window_from_an_agent() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        click_at(900.0, 900.0),
        2,
        |_, _| Ok("7".to_string()),
    );
    assert_eq!(refused, None);
    quietly_told(&mut desk.chrome);

    desk.chrome
        .say(&ChromeMessage::PersonInAgentsWindow {
            seat: format!("agent-{session}"),
            window: "7".to_string(),
            keyboard: true,
        })
        .expect("the browser says the user is in the window");

    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Leave);
    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Blur);
    let seat = told_seat(&mut desk.chrome, session, |seat| !seat.taken.is_empty());
    assert_eq!(seat.taken, vec!["7".to_string()]);
    assert!(seat.holds.is_empty(), "the agent still holds it: {seat:?}");
    let refused = as_the_agent(
        &compositor,
        session,
        vec![EmulatedInput::Focus {
            window: "7".to_string(),
        }],
    );
    assert!(
        refused
            .as_deref()
            .is_some_and(|why| why.contains("took over")),
        "the agent focused a window the user took: {refused:?}"
    );
    let mut barred = Vec::new();
    as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        vec![EmulatedInput::PointTo { x: 800.0, y: 800.0 }],
        1,
        |_, told| {
            barred = told.to_vec();
            Ok("8".to_string())
        },
    );
    assert_eq!(barred, vec!["7".to_string()]);
}

/// An agent can focus a browser window by its id, as it does a native one;
/// the browser says whether it has it.
#[test]
fn an_agent_focuses_a_browser_window() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    let focus = |window: &str| {
        vec![EmulatedInput::Focus {
            window: window.to_string(),
        }]
    };

    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        focus("nine"),
        1,
        |_, _| Err("no browser window is nine".to_string()),
    );
    assert_eq!(refused.as_deref(), Some("no browser window is nine"));

    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        focus("7"),
        1,
        |input, _| match input {
            AgentPageInput::Focus { window } => Ok(window.clone()),
            other => Err(format!("asked {other:?}")),
        },
    );
    assert_eq!(refused, None);
    told_seat(&mut desk.chrome, session, |seat| {
        seat.focused.as_deref() == Some("7")
    });
}

/// An agent that leaves lets go of everything in the browser's pages too.
#[test]
fn an_agent_that_leaves_is_gone_from_the_pages() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        vec![EmulatedInput::PointTo { x: 900.0, y: 900.0 }],
        1,
        |_, _| Ok("7".to_string()),
    );
    assert_eq!(refused, None);

    drop(held);

    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Gone);
}

/// An agent that only drove pages by DevTools has no seat, and leaving still
/// tells the browser: the clipboard its pages copied to goes with it.
#[test]
fn an_agent_with_no_seat_that_leaves_is_gone_from_the_pages() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (held, session) = an_agent_let_in(&compositor, &mut desk.chrome);

    drop(held);

    let told = desk
        .chrome
        .wait_for(|message| matches!(message, HostMessage::AgentInput { quiet: true, .. }))
        .expect("the browser is told");
    let HostMessage::AgentInput {
        seat,
        input,
        barred,
        ..
    } = told
    else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(
        (seat, input, barred),
        (format!("agent-{session}"), AgentPageInput::Gone, Vec::new())
    );
}

/// The shell takes a browser window from an agent as it does a native one.
#[test]
fn the_shell_takes_a_browser_window_from_an_agent() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut desk = two_windows(&compositor);
    let (_held, session) = an_agent_let_in(&compositor, &mut desk.chrome);
    let refused = as_the_agent_over_pages(
        &compositor,
        &mut desk.chrome,
        session,
        click_at(900.0, 900.0),
        2,
        |_, _| Ok("7".to_string()),
    );
    assert_eq!(refused, None);
    quietly_told(&mut desk.chrome);

    desk.chrome
        .say(&ChromeMessage::TakeOver {
            app_id: "7".to_string(),
        })
        .expect("the chrome takes the window");

    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Leave);
    assert_eq!(quietly_told(&mut desk.chrome), AgentPageInput::Blur);
    let seat = told_seat(&mut desk.chrome, session, |seat| !seat.taken.is_empty());
    assert_eq!(seat.taken, vec!["7".to_string()]);
    assert!(seat.holds.is_empty(), "the agent still holds it: {seat:?}");
}
