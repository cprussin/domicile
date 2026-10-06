//! Tests for chrome requests that act on clients and processes.
//!
//! Closing a window and spawning a program both finish outside the compositor,
//! so these tests use a real client and a real process. Unit tests stop at the
//! request reaching the Wayland thread.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// A chrome's `close_app` closes the client and the chrome hears `app_closed`.
///
/// Waiting for the client to exit shows the close was received, not only sent.
/// `domicile-test-client` exits zero on `xdg_toplevel::Event::Close`. Both
/// halves are checked because they fail independently.
#[test]
fn a_close_from_the_chrome_reaches_the_client_and_comes_back() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    // Connect before the client so the announcement arrives live, not through
    // the `hello` replay.
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

/// A chrome that connects after a client mapped is told about that window.
///
/// `app_appeared` is sent once, at map time, so a chrome that connects later
/// (for example after a page reload) relies on `announce_open_apps` on `hello`.
/// The client must be mapped before the chrome connects, or the announcement
/// arrives live and the test checks nothing.
///
/// The unit test `a_page_that_says_hello_is_told_what_is_already_running`
/// covers the replay against a hand-made `Host`; this checks a real mapped
/// `xdg_toplevel` is in `open_apps`.
#[test]
fn a_chrome_that_connects_late_is_told_about_a_window_already_open() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let client = compositor.client("early");
    // Wait for the map, not the start: until then there is no window to replay.
    compositor.wait_for_log("toplevel mapped");

    // `Compositor::chrome` completes the handshake, which sends `hello`.
    let mut chrome = compositor.chrome();

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .unwrap_or_else(|_| {
            panic!(
                "a chrome that says hello is told about the windows already \
                 open; this one came up to an empty desktop with a client \
                 still drawing. The client traced:\n{}",
                client.trace()
            )
        });

    // A map-time `app_appeared` carries no title or size; those follow as
    // separate messages. With one client, any non-empty id is that client's.
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    assert!(
        !app_id.to_string().is_empty(),
        "the late chrome was told about a window with no id, which is a window \
         nothing can be said about afterward"
    );

    // The replay also sends `focus_changed`, which a new page cannot learn any
    // other way.
    chrome
        .wait_for(|message| matches!(message, HostMessage::FocusChanged { .. }))
        .expect("the catch-up names who has the keyboard, after the windows");
}

/// A client's `set_title` reaches the chrome as `app_titled`.
///
/// Only a real client exercises `title_changed`. Renames are not covered:
/// `domicile-test-client` cannot rename its window.
#[test]
fn a_client_that_names_its_window_has_the_chrome_told() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    // Connect before the client: the `hello` replay never sends `app_titled`,
    // so a late chrome would wait for it forever.
    let mut chrome = compositor.chrome();
    let _client = compositor.client("a named window");

    let titled = chrome
        .wait_for(|message| matches!(message, HostMessage::AppTitled { .. }))
        .expect("a client that named its window has the chrome told");
    let HostMessage::AppTitled { title, .. } = titled else {
        unreachable!("the wait matched on this variant")
    };

    // Check the title itself, not only that a message was sent.
    assert_eq!(
        title.as_deref(),
        Some("a named window"),
        "the chrome was told the window is called {title:?}"
    );
}

/// A chrome's `spawn` starts a process on this compositor's display.
///
/// A process that inherits the compositor's own `WAYLAND_DISPLAY` opens on the
/// host desktop instead, which looks like nothing happened.
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
                // Write by rename: `await_file` polls, and a plain redirect
                // can be read while still empty.
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

/// A desk's startup commands run on this compositor's display, with no chrome.
#[test]
fn a_startup_command_runs_on_this_compositor() {
    let directory = tempfile::tempdir().expect("a directory to report into");
    let reported = directory.path().join("started-display");
    let compositor = Compositor::started_with(&format!(
        r#"{{
  "output": {{ "displays": [{{ "name": "left", "size": [1920, 1080] }}] }},
  "startup": {{
    "commands": [["sh", "-c", "printf '%s' \"$WAYLAND_DISPLAY\" > {0}.new && mv {0}.new {0}"]]
  }}
}}"#,
        reported.display()
    ));

    assert_eq!(
        compositor.await_file(&reported),
        compositor.wayland_display()
    );
}

/// An empty spawn does not stop the compositor reading that chrome.
///
/// `an_empty_command_spawns_nothing` unit-tests the refusal. This checks the
/// connection's reader thread survives, since indexing an empty command would
/// panic it. The follow-up must be a second request on the same chrome: a new
/// connection, or a broadcast to this one, still works after the reader dies.
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

/// A spawn logs the pid of the process it started.
///
/// With the arrival log below, this splits a slow launch into app startup and
/// time to connect. The pid matches the two lines when several spawns are in
/// flight. `$$` is the shell's pid, which is the process the compositor
/// started.
#[test]
fn a_spawn_says_which_process_it_started() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();

    let reported = compositor.scratch_file("spawned-pid");
    chrome
        .say(&ChromeMessage::Spawn {
            command: vec![
                "sh".to_string(),
                "-c".to_string(),
                // Write by rename, as above.
                format!(
                    "printf '%s' $$ > {0}.new && mv {0}.new {0}",
                    reported.display()
                ),
            ],
        })
        .expect("the chrome socket takes a spawn");

    let pid = compositor.await_file(&reported);

    compositor.wait_for_log(&format!("spawning client pid={pid}"));
}

/// A client that connects is logged with its pid.
///
/// The pid comes from the kernel's peer credentials, which a unit test on a
/// socket pair cannot show belong to the real client.
#[test]
fn a_client_that_reaches_the_socket_is_said_to_have_arrived() {
    let compositor = Compositor::started_with(ONE_DISPLAY);

    let client = compositor.client("arriving");

    compositor.wait_for_log(&format!("app client connected pid=Some({})", client.pid()));
}

/// A client's minimum and maximum sizes reach the chrome.
///
/// Electron apps set a minimum size and do not draw below it. Both limits are
/// checked because separate code forwards each.
#[test]
fn a_client_that_limits_its_size_has_the_chrome_told() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with(
        "a window with limits",
        &["--min-size", "680x500", "--max-size", "1920x0"],
    );

    let smallest = chrome
        .wait_for(|message| matches!(message, HostMessage::AppMinSize { .. }))
        .expect("a client with a minimum size has the chrome told");
    let HostMessage::AppMinSize { size, .. } = smallest else {
        unreachable!("the wait matched on this variant")
    };
    assert_eq!(size, [680.0, 500.0]);

    let largest = chrome
        .wait_for(|message| matches!(message, HostMessage::AppMaxSize { .. }))
        .expect("a client with a maximum size has the chrome told");
    let HostMessage::AppMaxSize { size, .. } = largest else {
        unreachable!("the wait matched on this variant")
    };
    // `0` means no limit on that axis.
    assert_eq!(size, [1920.0, 0.0]);
}
