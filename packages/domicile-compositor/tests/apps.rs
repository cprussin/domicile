//! What a chrome can do to the things running on the desktop.
//!
//! A chrome asks for a window to be closed and for a program to be started,
//! and neither request finishes inside the compositor: the close has to reach
//! a real client's `xdg_toplevel`, and the spawn has to reach a real process
//! with a real environment. Unit tests reach as far as the request landing on
//! the Wayland thread, which is the near side of both.
//!
//! So these start a real client and a real process, and ask the far side.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"{
  "output": { "displays": [ { "name": "left", "size": [1920, 1080] } ] }
}"#;

/// A chrome's `close_app` reaches the client's toplevel, and the client goes.
///
/// Ported from `e2e-close.sh`, and asserts something stricter than it did.
/// That script read `WAYLAND_DEBUG` for the string `xdg_toplevel@N.close`,
/// which says the event was *sent*; this waits for the client process to
/// exit, which says it was received and acted on. `domicile-test-client`
/// exits zero on `xdg_toplevel::Event::Close` for exactly this purpose.
///
/// Both halves are asserted, because they fail apart: a close that reaches the
/// client but produces no `app_closed` leaves the window on the chrome's rail
/// for ever, pointing at a client that is gone.
#[test]
fn a_close_from_the_chrome_reaches_the_client_and_comes_back() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    // Connected before the client starts, so the announcement is heard live
    // rather than through the replay a late chrome gets on `hello`. One less
    // moving part between the close and the assertion.
    let mut chrome = compositor.chrome();
    let mut client = compositor.client("closer");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("a client that opened a window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };

    chrome
        .say(&ChromeMessage::CloseApp {
            app_id: app_id.clone(),
        })
        .expect("the chrome socket takes a close");

    assert!(
        client.wait_for_exit(),
        "the client was asked to close and did not exit cleanly; it traced:\n{}",
        client.trace()
    );

    chrome
        .wait_for(|message| matches!(message, HostMessage::AppClosed { .. }))
        .expect("the chrome is told the window it closed is gone");
}

/// A client that names its window has the chrome told the name.
///
/// Ported from `e2e-chrome.sh`, and the only part of it that was not already
/// covered — see that change's description for the other three, each of which
/// was mutated to check.
///
/// `title_changed` is the compositor's whole answer to a window being named,
/// and nothing below the e2e level reaches it: it needs a real client making a
/// real `set_title`, on a real toplevel the host has already announced. Cutting
/// the function to a bare `return` passed the entire Rust suite before this
/// test existed.
///
/// The name arrives *after* the announcement rather than with it — a client
/// creates its toplevel and names it in the next request — which is why this
/// is a message of its own rather than a field of `app_appeared`, and why a
/// chrome that ignored it would show every window unnamed.
///
/// *Renames* are out of scope here and it is worth saying so rather than
/// leaving it to be discovered: a terminal renames itself on every command it
/// runs, but a compositor that forwards only the first `set_title` of the
/// process and goes deaf afterwards passes this test and the whole suite —
/// measured. `e2e-chrome.sh` did not cover that either (it grepped once for
/// `app_titled`), so nothing was lost in the move; covering it needs
/// `domicile-test-client` to be able to rename, which it cannot today.
#[test]
fn a_client_that_names_its_window_has_the_chrome_told() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    // Before the client, because the name has to be heard live. The catch-up
    // a late chrome gets on `hello` is `Host::open_apps`, which replays
    // `app_appeared` — carrying whatever the title is by then — and then
    // `focus_changed`, and never sends `app_titled` at all. So a chrome that
    // connected after the `set_title` would wait here for a message that is
    // not coming: the ordering is load-bearing, but it earns a *failure*
    // against a correct compositor rather than a pass against a broken one.
    let mut chrome = compositor.chrome();
    let _client = compositor.client("a named window");

    let titled = chrome
        .wait_for(|message| matches!(message, HostMessage::AppTitled { .. }))
        .expect("a client that named its window has the chrome told");
    let HostMessage::AppTitled { title, .. } = titled else {
        unreachable!("the wait matched on this variant")
    };

    // The name itself, not merely that something was sent: a compositor that
    // forwards the event with an empty title leaves the chrome showing a
    // window with no name, which is the failure this is about.
    assert_eq!(
        title.as_deref(),
        Some("a named window"),
        "the chrome was told the window is called {title:?}"
    );
}

/// A chrome's `spawn` starts a process, aimed at Domicile rather than at
/// whatever session the compositor is itself presenting into.
///
/// Ported from `e2e-spawn.sh`. That script proved the aim by `sed`-ing a
/// display name out of a log line and comparing it to a file the spawned
/// program wrote; this asks the spawned program directly and compares against
/// the display the compositor *published*, which is the same value a shell
/// would have read.
///
/// The aim is the whole point rather than a detail: a client that inherits the
/// compositor's own `WAYLAND_DISPLAY` opens on the host desktop the compositor
/// is presenting into, which looks like nothing happening at all.
#[test]
fn a_spawned_program_is_pointed_at_this_compositor() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    let reported = compositor.scratch_file("spawned-display");
    chrome
        .say(&ChromeMessage::Spawn {
            command: vec![
                "sh".to_string(),
                "-c".to_string(),
                // Written by rename, for the reason the compositor publishes
                // its own session that way: the reader below polls for the
                // file, and a plain redirect is observable while it is still
                // empty. That is a race this test would lose intermittently
                // and blame on the spawn.
                format!(
                    "printf '%s' \"$WAYLAND_DISPLAY\" > {0}.new && mv {0}.new {0}",
                    reported.display()
                ),
            ],
        })
        .expect("the chrome socket takes a spawn");

    let said = compositor.await_file(&reported);
    assert_eq!(
        said,
        compositor.wayland_display(),
        "the spawned program was aimed at {said:?}, not at the display this \
         compositor published ({:?})",
        compositor.wayland_display()
    );
}

/// A spawn with nothing to run does not stop the compositor listening to the
/// chrome that sent it.
///
/// The refusal itself is unit-tested (`an_empty_command_spawns_nothing`), so
/// what this adds is the part no unit test can see: that the connection which
/// sent it is still being *read* afterwards. An empty command is what a chrome
/// sends when someone presses enter on an empty box, and the failure it guards
/// is an index into an empty argument list — which panics the thread serving
/// that one socket while the compositor stays up.
///
/// The follow-up is a second spawn, and it has to be: two weaker versions of
/// this test both passed with the panic in place.
///
///   - Opening a *fresh* chrome proves nothing — a new connection handshakes
///     perfectly against a compositor whose other reader thread has died.
///   - Waiting for a broadcast on the same chrome proves nothing either. The
///     writer stays in the hub's list when its reader dies, so the desktop
///     still arrives down a socket nobody is listening to. That is the shape
///     of the bug, not evidence against it.
///
/// Only something the compositor has to *read* and act on distinguishes them.
#[test]
fn a_spawn_with_no_command_does_not_stop_the_compositor_listening() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    chrome
        .say(&ChromeMessage::Spawn { command: vec![] })
        .expect("the chrome socket takes it");

    let after = compositor.scratch_file("ran-after-the-empty-spawn");
    chrome
        .say(&ChromeMessage::Spawn {
            command: vec![
                "sh".to_string(),
                "-c".to_string(),
                format!("printf ran > {0}.new && mv {0}.new {0}", after.display()),
            ],
        })
        .expect("the chrome socket takes the second one");

    assert_eq!(
        compositor.await_file(&after),
        "ran",
        "the compositor stopped reading this chrome after it sent an empty spawn"
    );
}
