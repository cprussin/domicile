//! Window states the shell sets, and the maximize, fullscreen and minimize
//! requests clients make, through the page's system calls.
//!
//! The compositor sets only what the shell asks for. A client's request is
//! reported to the shell and answered with a configure of the current states.

mod running;

use std::time::Duration;

use domicile_protocol::{
    ChromeMessage, HostMessage, ResizeEdges, SystemErrorKind, SystemEvent, SystemReply,
    SystemRequest, WindowRequest, WindowState,
};

use crate::running::{Client, Compositor};

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

#[test]
fn the_states_a_shell_sets_reach_the_client() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("app");
    let app_id = appeared(&mut chrome);

    let tiled = set(
        &mut chrome,
        1,
        &app_id,
        vec![
            WindowState::TiledLeft,
            WindowState::TiledRight,
            WindowState::TiledTop,
            WindowState::TiledBottom,
        ],
    );
    assert_eq!(tiled, SystemReply::Set);
    assert!(
        client.wait_for_trace(".states(tiled_left tiled_right tiled_top tiled_bottom)", 1),
        "the client was never told it is tiled; it traced:\n{}",
        client.trace()
    );

    set(&mut chrome, 2, &app_id, vec![WindowState::Fullscreen]);
    assert!(
        client.wait_for_trace(".states(fullscreen)", 1),
        "the shell's new states did not replace the old; it traced:\n{}",
        client.trace()
    );
}

/// A client bound below `xdg_wm_base` version 2 has no tiled states, so it is
/// told `maximized` instead, as sway does: it then drops its shadows and takes
/// the size it is given.
#[test]
fn a_tiled_client_too_old_for_tiled_states_is_maximized() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client_with("app", &["--xdg-wm-base-v1"]);
    let app_id = appeared(&mut chrome);
    let tiled = vec![WindowState::TiledLeft, WindowState::TiledRight];

    set(&mut chrome, 1, &app_id, tiled.clone());
    assert!(
        client.wait_for_trace(".states(maximized)", 1),
        "the client was not maximized in place of tiled; it traced:\n{}",
        client.trace()
    );

    set(&mut chrome, 2, &app_id, tiled.clone());
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(
        client.trace().matches(".states(").count(),
        2,
        "the same states configured the client again; it traced:\n{}",
        client.trace()
    );

    set(
        &mut chrome,
        3,
        &app_id,
        vec![WindowState::Fullscreen, WindowState::TiledLeft],
    );
    assert!(
        client.wait_for_trace(".states(fullscreen)", 1),
        "a fullscreen window was maximized too; it traced:\n{}",
        client.trace()
    );
}

#[test]
fn states_for_a_window_the_compositor_does_not_know_are_refused() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    let refused = set(
        &mut chrome,
        1,
        "no-such-window",
        vec![WindowState::Maximized],
    );

    let SystemReply::Failed { error } = refused else {
        panic!("expected a failure, got {refused:?}");
    };
    assert_eq!(error.kind, SystemErrorKind::NotFound);
}

/// A reloaded page keeps the windows as the last page left them, so a shell
/// that sets the same states again causes no configure and no redraw.
#[test]
fn states_outlive_the_page_that_set_them() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("app");
    let app_id = appeared(&mut chrome);
    set(&mut chrome, 1, &app_id, vec![WindowState::Maximized]);
    assert!(client.wait_for_trace(".states(maximized)", 1));

    drop(chrome);
    let mut reloaded = compositor.chrome();
    appeared(&mut reloaded);
    std::thread::sleep(Duration::from_millis(500));

    assert_eq!(
        last_states(&client),
        "states(maximized)",
        "a new page took the states away; the client traced:\n{}",
        client.trace()
    );
}

#[test]
fn a_client_asking_to_maximize_is_reported_and_configured_as_it_was() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let mut client = compositor.client_with("app", &["--ask-to", "maximize"]);
    let app_id = appeared(&mut chrome);

    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id,
            request: WindowRequest::Maximize,
        }
    );
    // xdg-shell requires a configure in answer, even with nothing changed.
    assert!(
        configured_after(&mut client, "set_maximized()"),
        "the client was not configured after asking; it traced:\n{}",
        client.trace()
    );
    assert_eq!(
        last_states(&client),
        "states()",
        "the compositor maximized the window itself; it traced:\n{}",
        client.trace()
    );
}

#[test]
fn a_client_asking_for_fullscreen_names_the_display_it_wants() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let mut client = compositor.client_with("app", &["--ask-to", "fullscreen"]);
    let app_id = appeared(&mut chrome);

    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id,
            request: WindowRequest::Fullscreen {
                display: Some("left".into()),
            },
        }
    );
    assert!(
        configured_after(&mut client, "set_fullscreen("),
        "the client was not configured after asking; it traced:\n{}",
        client.trace()
    );
}

#[test]
fn a_client_asking_to_leave_a_state_is_reported() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let _unmaximizes = compositor.client_with("app", &["--ask-to", "unmaximize"]);
    let unmaximized = appeared(&mut chrome);
    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id: unmaximized,
            request: WindowRequest::Unmaximize,
        }
    );

    let _unfullscreens = compositor.client_with("other", &["--ask-to", "unfullscreen"]);
    let unfullscreened = appeared(&mut chrome);
    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id: unfullscreened,
            request: WindowRequest::Unfullscreen,
        }
    );
}

/// The shell marks a window resizing for the length of its own drag, as sway
/// does for an interactive resize, beside whatever else it holds.
#[test]
fn a_window_the_shell_resizes_is_told_so() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("app");
    let app_id = appeared(&mut chrome);

    set(
        &mut chrome,
        1,
        &app_id,
        vec![WindowState::TiledLeft, WindowState::Resizing],
    );
    assert!(
        client.wait_for_trace(".states(tiled_left resizing)", 1),
        "the client was never told it is resizing; it traced:\n{}",
        client.trace()
    );

    set(&mut chrome, 2, &app_id, vec![WindowState::TiledLeft]);
    assert!(
        client.wait_for_trace(".states(tiled_left)", 1),
        "the resize never ended for the client; it traced:\n{}",
        client.trace()
    );
}

/// xdg-shell has no minimized state, so a minimize is only reported; the
/// shell decides what minimized means.
#[test]
fn a_client_asking_to_minimize_is_reported() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let mut client = compositor.client_with("app", &["--ask-to", "minimize"]);
    let app_id = appeared(&mut chrome);

    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id,
            request: WindowRequest::Minimize,
        }
    );
    assert!(
        client.wait_for_trace("set_minimized()", 1),
        "the client never asked; it traced:\n{}",
        client.trace()
    );
}

/// A press on a client's own title bar that asks to move the window is handed
/// to the shell: the client's press ends with a leave, not a release, and the
/// shell hears the request so it can drag the window.
#[test]
fn a_press_that_asks_to_move_is_handed_to_the_shell() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let mut client = compositor.client_with("app", &["--ask-to-drag", "move"]);
    let app_id = appeared(&mut chrome);

    point_at(&mut chrome, &app_id);
    button(&mut chrome, &app_id, true);

    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id: app_id.clone(),
            request: WindowRequest::Move,
        }
    );
    assert!(
        pointer_said(&mut client, ".leave(", 1),
        "the client's press never ended; it traced:\n{}",
        client.trace()
    );
    // The shell's drag ends with a release the client never pressed for. A
    // pointer back over the window afterwards shows the release went nowhere.
    button(&mut chrome, &app_id, false);
    point_at(&mut chrome, &app_id);
    assert!(
        pointer_said(&mut client, ".enter(", 2),
        "the pointer never came back; it traced:\n{}",
        client.trace()
    );
    assert!(
        !released_after_leave(&client.trace()),
        "the release reached the client after its press was handed on; it traced:\n{}",
        client.trace()
    );
}

/// A resize by an edge is handed on the same way, naming the edge.
#[test]
fn a_press_that_asks_to_resize_names_the_edge() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let _client = compositor.client_with("app", &["--ask-to-drag", "bottom-right"]);
    let app_id = appeared(&mut chrome);

    point_at(&mut chrome, &app_id);
    button(&mut chrome, &app_id, true);

    assert_eq!(
        requested(&mut chrome, 7),
        SystemEvent::WindowRequest {
            app_id,
            request: WindowRequest::Resize {
                edges: ResizeEdges::BottomRight,
            },
        }
    );
}

/// A move asked for once the button is up has no press to hand over, so it
/// is dropped: the shell hears nothing.
#[test]
fn a_move_after_the_release_is_dropped() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    listen(&mut chrome, 7);
    let mut client = compositor.client_with("app", &["--ask-to-drag", "move-after-release"]);
    let app_id = appeared(&mut chrome);

    point_at(&mut chrome, &app_id);
    button(&mut chrome, &app_id, true);
    button(&mut chrome, &app_id, false);

    assert!(
        client.wait_for_trace("move(", 1),
        "the client never asked; it traced:\n{}",
        client.trace()
    );
    compositor.wait_for_log("a move or resize with no press of its own held -> dropped");
    assert!(
        !compositor
            .complaint()
            .contains("a window request -> the shell"),
        "a move with no press held reached the shell"
    );
}

/// The pointer over `app_id`'s corner.
fn point_at(chrome: &mut domicile_test_chrome::Chrome, app_id: &str) {
    chrome
        .say(&ChromeMessage::PointerMotion {
            app_id: app_id.to_string(),
            x: 1.0,
            y: 1.0,
            moved: true,
        })
        .expect("the chrome can move the pointer");
}

/// The left button pressed or released over `app_id`.
fn button(chrome: &mut domicile_test_chrome::Chrome, app_id: &str, pressed: bool) {
    chrome
        .say(&ChromeMessage::PointerButton {
            app_id: app_id.to_string(),
            button: 0x110,
            pressed,
        })
        .expect("the chrome can press");
}

/// The client's pointer lines, in order.
fn pointer_lines(trace: &str) -> Vec<&str> {
    trace
        .lines()
        .filter(|line| line.contains("wl_pointer@"))
        .collect()
}

/// Whether the client's pointer said `event` `wanted` times, waiting for it.
fn pointer_said(client: &mut Client, event: &str, wanted: usize) -> bool {
    let said = |trace: &str| {
        pointer_lines(trace)
            .iter()
            .filter(|line| line.contains(event))
            .count()
            >= wanted
    };
    let until = std::time::Instant::now() + Duration::from_secs(10);
    while !said(&client.trace()) && std::time::Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    said(&client.trace())
}

/// Whether the pointer had a button released after it left.
fn released_after_leave(trace: &str) -> bool {
    pointer_lines(trace)
        .iter()
        .skip_while(|line| !line.contains(".leave("))
        .any(|line| line.contains(".button(") && line.ends_with(", 0)"))
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

/// Set `app_id`'s states under `id`, and return the reply.
fn set(
    chrome: &mut domicile_test_chrome::Chrome,
    id: u32,
    app_id: &str,
    states: Vec<WindowState>,
) -> SystemReply {
    chrome
        .say(&ChromeMessage::SystemRequest {
            id,
            request: SystemRequest::SetWindowStates {
                app_id: app_id.to_string(),
                states,
            },
        })
        .expect("the chrome socket takes a system call");
    let replied = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemReply { id: of, .. } if *of == id))
        .expect("a system call is answered");
    let HostMessage::SystemReply { reply, .. } = replied else {
        unreachable!("the wait matched on this variant")
    };
    reply
}

/// Listen for window requests under `id`.
fn listen(chrome: &mut domicile_test_chrome::Chrome, id: u32) {
    chrome
        .say(&ChromeMessage::SystemRequest {
            id,
            request: SystemRequest::WindowRequests,
        })
        .expect("the chrome socket takes a system call");
    chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemReply { id: of, reply: SystemReply::Started } if *of == id
            )
        })
        .expect("listening starts");
}

/// The next window request heard under `id`.
fn requested(chrome: &mut domicile_test_chrome::Chrome, id: u32) -> SystemEvent {
    let heard = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemEvent { id: of, .. } if *of == id))
        .expect("a client's request reaches the page");
    let HostMessage::SystemEvent { event, .. } = heard else {
        unreachable!("the wait matched on this variant")
    };
    event
}

/// Whether the client traced a configure after `request`.
fn configured_after(client: &mut Client, request: &str) -> bool {
    client.wait_for_trace(request, 1) && {
        let after = |trace: &str| {
            trace
                .split_once(request)
                .is_some_and(|(_, after)| after.contains(".configure("))
        };
        let until = std::time::Instant::now() + Duration::from_secs(10);
        while !after(&client.trace()) && std::time::Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        after(&client.trace())
    }
}

/// The states the client was last configured with, as `states(…)`.
fn last_states(client: &Client) -> String {
    let trace = client.trace();
    let line = trace
        .lines()
        .rev()
        .find(|line| line.contains(".states("))
        .expect("the client was configured");
    let (_, states) = line.split_once('.').expect("an object and an event");
    states.trim().to_string()
}
