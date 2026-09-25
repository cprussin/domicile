//! Behavior tests for the host orchestrator, written before the implementation.
//!
//! `Host` is the compositor's brain: it tracks connected Wayland apps, applies
//! the placement/focus decisions the chrome makes, and routes input. It sits
//! between `domicile-protocol` (the chrome wire messages) and `domicile-scene` (the on-screen
//! geometry), so these tests exercise the whole pipeline end to end without any
//! Wayland or GPU dependency.

use domicile_host::ipc::apply_chrome_message;
use domicile_host::{AppId, Host};
use domicile_protocol::{
    ChromeMessage, DisplayInfo, DisplayTransform, HostMessage, Theme, PROTOCOL_VERSION,
};
use domicile_scene::KeyboardTarget;

// ---- app lifecycle --------------------------------------------------------

#[test]
fn a_window_says_what_it_is_called_when_the_client_says_it() {
    // A toplevel is announced when the client creates it, which is before
    // `set_title` — and the name changes again whenever the window's own idea
    // of itself does, which for a terminal is every command it runs. Without
    // this the title stayed whatever it was at announcement, which was
    // nothing, and a chrome with a tab rail had nothing to write in it.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, None);

    assert_eq!(
        host.app_titled(&app, Some("a terminal".to_string())),
        Some(HostMessage::AppTitled {
            app_id: app.clone(),
            title: Some("a terminal".to_string()),
        })
    );
    // And it is remembered, so the replay a reloading chrome gets says it too.
    assert_eq!(
        host.open_apps().first(),
        Some(&HostMessage::AppAppeared {
            app_id: app.clone(),
            title: Some("a terminal".to_string()),
            size: None,
        })
    );
    // Saying the same thing again is not news — the contract this type keeps
    // so its state and the chromes' stay in step whatever a caller repeats.
    assert_eq!(host.app_titled(&app, Some("a terminal".to_string())), None);
    // A client nobody has heard of is not an error to report to every chrome.
    assert_eq!(host.app_titled("app-nowhere", None), None);
}

#[test]
fn a_client_that_has_not_committed_is_announced_with_no_size() {
    // `app_appeared` goes out when the toplevel maps, which is before the
    // client has committed a buffer — so there is no size to announce. Saying
    // `0x0` instead made every chrome that believed the field open a window
    // with no box, which is a window that is never composited and never
    // configured to a size to redraw at. The size arrives on the `app_resized`
    // that follows, and the replay a reloading chrome gets says the same
    // nothing until it has.
    let mut host = Host::new();
    let (app, announce) = host.app_appeared(None, None);
    let announced = |size| HostMessage::AppAppeared {
        app_id: app.clone(),
        title: None,
        size,
    };

    assert_eq!(announce, announced(None));
    assert_eq!(host.open_apps().first(), Some(&announced(None)));

    host.app_resized(&app, (640.0, 480.0));

    assert_eq!(
        host.open_apps().first(),
        Some(&announced(Some([640.0, 480.0])))
    );
}

#[test]
fn a_chrome_that_arrives_late_is_told_about_every_window_already_open() {
    // A chrome learns about a window from `app_appeared`, which is sent once,
    // when the client maps — and nothing ever says it again. A page that was
    // not listening at that moment loses that window permanently, though the
    // client is alive and drawing: it happens when a client maps in the
    // milliseconds after the chrome's handshake, and every time the page
    // reloads.
    let mut host = Host::new();
    let (first, _) = host.app_appeared(Some("a terminal".to_string()), Some((640.0, 480.0)));
    let (second, _) = host.app_appeared(None, Some((100.0, 200.0)));
    // Enough of them that arrival order and a hash map's order are all but
    // certain to differ. With two, an unordered implementation passes this
    // about half the time, which is a test that reports luck.
    let rest: Vec<AppId> = (0..10)
        .map(|n| host.app_appeared(None, Some((f64::from(n), 0.0))).0)
        .collect();

    let announcements = host.open_apps();

    // Everything the chrome would have been told, and in the order the apps
    // arrived — a desktop that mounts its windows differently on each reload
    // is its own bug.
    let expected: Vec<HostMessage> = [
        HostMessage::AppAppeared {
            app_id: first,
            title: Some("a terminal".to_string()),
            size: Some([640.0, 480.0]),
        },
        HostMessage::AppAppeared {
            app_id: second,
            title: None,
            size: Some([100.0, 200.0]),
        },
    ]
    .into_iter()
    .chain(
        rest.into_iter()
            .enumerate()
            .map(|(n, app_id)| HostMessage::AppAppeared {
                app_id,
                title: None,
                size: Some([n as f64, 0.0]),
            }),
    )
    // And who has the keyboard, which is the chrome while nothing is placed.
    .chain(std::iter::once(HostMessage::FocusChanged { app_id: None }))
    .collect();
    assert_eq!(announcements, expected);
}

#[test]
fn focus_is_reported_when_it_moves_and_not_when_it_does_not() {
    // The chrome asks for focus, but it is not the only thing that moves it —
    // a click on a window focuses it in the compositor. Without a message the
    // chrome's idea of the active window is right until the first click and
    // wrong afterward, which is every focus affordance a desktop has.
    //
    // And silent when nothing moved: this is asked after *every* chrome
    // message, so a report per ask would be a message per mouse move.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, Some((100.0, 100.0)));

    host.handle_chrome_message(ChromeMessage::FocusApp {
        app_id: app.clone(),
    })
    .unwrap();

    assert_eq!(
        host.focus_change(),
        Some(HostMessage::FocusChanged {
            app_id: Some(app.clone())
        })
    );
    assert_eq!(host.focus_change(), None, "nothing moved the second time");
}

#[test]
fn the_keyboard_coming_back_to_the_chrome_is_reported_too() {
    // The mirror, and the one a chrome cannot infer: it did not ask for this.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, Some((100.0, 100.0)));
    host.handle_chrome_message(ChromeMessage::FocusApp {
        app_id: app.clone(),
    })
    .unwrap();
    host.focus_change();

    host.handle_chrome_message(ChromeMessage::FocusChrome)
        .unwrap();

    assert_eq!(
        host.focus_change(),
        Some(HostMessage::FocusChanged { app_id: None })
    );
}

#[test]
fn a_client_asking_for_the_keyboard_is_a_question_rather_than_a_move() {
    // The whole point of the message: a client that asks is telling the shell
    // it wants the keyboard, and the shell is what decides whether it gets it.
    // A host that moved the seat here would be writing the shell's focus
    // policy for it, and no desktop built on this could refuse a window that
    // interrupts what its user is typing into.
    let mut host = Host::new();
    let (asking, _) = host.app_appeared(None, None);
    let (typing, _) = host.app_appeared(None, None);
    host.handle_chrome_message(ChromeMessage::FocusApp {
        app_id: typing.clone(),
    })
    .unwrap();
    host.focus_change();

    assert_eq!(
        host.focus_requested(&asking),
        Some(HostMessage::FocusRequested {
            app_id: asking.clone(),
        })
    );
    assert_eq!(
        host.focus_holder(),
        Some(typing),
        "asking is not getting: the keyboard has not moved"
    );
    assert_eq!(
        host.focus_change(),
        None,
        "and the chromes are told nothing"
    );
}

#[test]
fn a_client_nobody_has_heard_of_cannot_ask_for_the_keyboard() {
    // The same gate `focus_app` keeps. A request naming a window no chrome has
    // an element for is one no shell could answer, and forwarding it would
    // have every shell write the check this one owes them.
    let host = Host::new();

    assert_eq!(host.focus_requested("app-404"), None);
}

#[test]
fn a_focused_window_closing_hands_the_keyboard_back_and_says_so() {
    // Nothing asked for this at all — the client went away, possibly by
    // crashing. A chrome told only that the app closed would go on marking it
    // active, and there is nothing else it could consult.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, Some((100.0, 100.0)));
    host.handle_chrome_message(ChromeMessage::FocusApp {
        app_id: app.clone(),
    })
    .unwrap();
    host.focus_change();

    host.app_closed(&app);

    assert_eq!(
        host.focus_change(),
        Some(HostMessage::FocusChanged { app_id: None })
    );
}

#[test]
fn a_chrome_that_arrives_late_is_told_who_has_the_keyboard() {
    // A page that has just loaded has no other way to learn it, and every
    // other route to this message is a *change* it was not there for.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, Some((100.0, 100.0)));
    host.handle_chrome_message(ChromeMessage::FocusApp {
        app_id: app.clone(),
    })
    .unwrap();

    let announced = host.open_apps();

    assert_eq!(
        announced.last(),
        Some(&HostMessage::FocusChanged {
            app_id: Some(app.clone())
        }),
        "after the windows, since it names one of them"
    );
    // And telling one chrome does not make the others think focus moved.
    assert_eq!(
        host.focus_change(),
        Some(HostMessage::FocusChanged { app_id: Some(app) }),
        "the delta the other chromes are still owed is untouched"
    );
}

#[test]
fn app_appeared_assigns_ids_and_announces_to_chrome() {
    let mut host = Host::new();
    let (id1, msg1) = host.app_appeared(Some("Terminal".into()), Some((640.0, 480.0)));
    let (id2, _) = host.app_appeared(None, Some((800.0, 600.0)));

    assert_ne!(id1, id2, "each app gets a distinct id");
    match msg1 {
        HostMessage::AppAppeared {
            app_id,
            title,
            size,
        } => {
            assert_eq!(app_id, id1);
            assert_eq!(title.as_deref(), Some("Terminal"));
            assert_eq!(size, Some([640.0, 480.0]));
        }
        other => panic!("expected AppAppeared, got {other:?}"),
    }

    // An app exists but has no on-screen portal until the chrome places it.
}

#[test]
fn resizing_and_closing_report_to_chrome() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, Some((100.0, 100.0)));

    match host.app_resized(&id, (200.0, 150.0)) {
        Some(HostMessage::AppResized { app_id, size }) => {
            assert_eq!(app_id, id);
            assert_eq!(size, [200.0, 150.0]);
        }
        other => panic!("expected AppResized, got {other:?}"),
    }
    assert!(host.app_resized("ghost", (1.0, 1.0)).is_none());

    match host.app_closed(&id) {
        Some(HostMessage::AppClosed { app_id }) => assert_eq!(app_id, id),
        other => panic!("expected AppClosed, got {other:?}"),
    }
    assert!(host.app_closed(&id).is_none(), "closing twice is a no-op");
}

// ---- placement from the chrome --------------------------------------------

// ---- focus ----------------------------------------------------------------

#[test]
fn focus_routes_keyboard_between_app_and_chrome() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, Some((100.0, 100.0)));

    assert_eq!(host.keyboard_target(), KeyboardTarget::Chrome);

    host.handle_chrome_message(ChromeMessage::FocusApp { app_id: id.clone() })
        .unwrap();
    assert_eq!(host.keyboard_target(), KeyboardTarget::App(id.clone()));

    host.handle_chrome_message(ChromeMessage::FocusChrome)
        .unwrap();
    assert_eq!(host.keyboard_target(), KeyboardTarget::Chrome);
}

#[test]
fn spawn_is_a_no_op_in_the_brain() {
    // The compositor intercepts Spawn; the brain must just ignore it.
    let mut host = Host::new();
    host.handle_chrome_message(ChromeMessage::Spawn {
        command: vec!["kitty".into()],
    })
    .unwrap();
    assert_eq!(host.app_count(), 0);
}

#[test]
fn asking_a_client_to_close_leaves_the_window_where_it_is() {
    // The compositor sends the toplevel a close and the client decides: an
    // editor with unsaved work stays up. A brain that dropped the window here
    // would take the tab away from a window still on screen, and nothing ever
    // puts it back — `app_appeared` is sent once.
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, Some((100.0, 100.0)));

    host.handle_chrome_message(ChromeMessage::CloseApp { app_id: id.clone() })
        .unwrap();

    assert_eq!(host.app_count(), 1);
}

// ---- how a window is drawn, as opposed to where ---------------------------

// ---- the desktop the chrome is told about --------------------------------

#[test]
fn the_displays_are_answered_after_the_welcome() {
    // Order matters on this path: a chrome that read the handshake's `displays`
    // before it knew the version agreed would be acting on a message from a
    // host it has not finished negotiating with. Only on this path — a change
    // broadcast reaches a connection that has not been welcomed, which is what
    // latest-wins retention is for.
    let mut host = Host::new();
    host.describe_displays(vec![lying_down("left", [0, 0], [1920, 1080], 1)]);
    let mut ready = false;
    let answered = apply_chrome_message(
        &mut host,
        &mut ready,
        ChromeMessage::Hello {
            protocol_version: PROTOCOL_VERSION,
        },
    );
    assert_eq!(
        answered,
        vec![
            HostMessage::Welcome {
                protocol_version: PROTOCOL_VERSION,
            },
            HostMessage::Displays {
                displays: vec![lying_down("left", [0, 0], [1920, 1080], 1)],
            },
            HostMessage::Theme { theme: Theme::Dark },
            HostMessage::WindowsTheme { theme: Theme::Dark },
        ]
    );
}

// ---- the theme the desktop is drawn in ------------------------------------

#[test]
fn a_host_nobody_told_a_theme_is_the_one_the_chrome_was_drawn_against() {
    // Unlike the keymap beside it, this is never absent. A keymap a host has
    // not been handed is a desk with no keyboard behind it and inventing a
    // layout for it would be a desktop typing in one nobody chose; a theme is
    // not like that -- a page paints in one or the other, and the one it
    // paints in when nothing said is the dark the chrome was designed for.
    assert_eq!(
        Host::new().describe_theme(),
        HostMessage::Theme { theme: Theme::Dark }
    );
}

#[test]
fn a_theme_that_moved_is_what_every_chrome_is_told() {
    // The answer is the broadcast: a toggle clicked on one monitor's page is
    // the whole desktop changing, and the compositor sends what this hands
    // back to every chrome rather than only to the one that asked.
    let mut host = Host::new();

    assert_eq!(
        host.set_theme(Theme::Light),
        Some(HostMessage::Theme {
            theme: Theme::Light
        })
    );
    assert_eq!(
        host.describe_theme(),
        HostMessage::Theme {
            theme: Theme::Light
        },
        "and the chrome that connects next is told the one the desk is on"
    );
}

#[test]
fn a_theme_that_did_not_move_is_not_restated() {
    // A config file is rewritten for all sorts of reasons and a page that just
    // connected is told the theme it is already painting in -- so "set it to
    // what it is" is the ordinary case rather than the odd one, and a
    // broadcast for it would be every chrome on the desk running the wipe
    // animation over a theme that did not change.
    let mut host = Host::new();
    host.set_theme(Theme::Light);

    assert_eq!(host.set_theme(Theme::Light), None);
}

#[test]
fn the_windows_theme_is_kept_apart_from_the_chromes() {
    // The chrome turns over when it is told; the windows only once every
    // chrome has captured the frame its wipe starts from. So between the two
    // the desk has one theme on its panels and the other on its windows, and
    // a host that kept one value would tell a chrome connecting in that gap
    // the wrong thing about half of them.
    let mut host = Host::new();
    host.set_theme(Theme::Light);

    assert_eq!(
        host.describe_windows_theme(),
        HostMessage::WindowsTheme { theme: Theme::Dark }
    );
    assert_eq!(
        host.set_windows_theme(Theme::Light),
        Some(HostMessage::WindowsTheme {
            theme: Theme::Light
        })
    );
    assert_eq!(host.set_windows_theme(Theme::Light), None);
}

#[test]
fn a_desktop_described_again_replaces_the_one_before_it() {
    // The compositor re-describes whenever the desktop changes at runtime,
    // which with no displays configured is every time Domicile's own window is
    // resized or its density changes. Appending would leave a chrome laying
    // out against every size the window has ever been.
    //
    // Asserted on `describe_desktop` rather than through a handshake: replacing
    // is a property of `describe_displays`, and driving it through
    // `apply_chrome_message` would make this fail for a handshake bug too.
    let mut host = Host::new();
    host.describe_displays(vec![lying_down("old", [0, 0], [800, 600], 1)]);
    host.describe_displays(vec![lying_down("new", [0, 0], [1920, 1080], 2)]);
    assert_eq!(
        host.describe_desktop(),
        HostMessage::Displays {
            displays: vec![lying_down("new", [0, 0], [1920, 1080], 2)],
        }
    );
}

/// One monitor lying down and at its own pixels, which is the uninteresting
/// case: `mode` is `size` and nothing is turned. A test that wants otherwise
/// writes the `DisplayInfo` out, so the shape it is about is on the page.
fn lying_down(name: &str, position: [i32; 2], size: [u32; 2], scale: u32) -> DisplayInfo {
    DisplayInfo {
        name: name.to_string(),
        position,
        size,
        scale,
        mode: size,
        transform: DisplayTransform::Normal,
        fills_the_window: false,
    }
}

/// A desk, as the compositor describes it to a chrome that has not said which
/// window it is: three 4K monitors on their sides, side by side, in the
/// desktop's own coordinates.
///
/// Turned rather than lying down because this is the desk `as_seen_from`
/// exists for, and a turned monitor is where its two jobs come apart: the
/// corner it moves, and the mode and transform it hands on unchanged for the
/// page to draw itself over.
fn desk() -> Vec<DisplayInfo> {
    let sideways = |name: &str, x: i32| DisplayInfo {
        name: name.to_string(),
        position: [x, 0],
        scale: 2,
        size: [1800, 3200],
        mode: [3840, 2160],
        transform: DisplayTransform::Rotate270,
        fills_the_window: false,
    };
    vec![
        sideways("drm-1", 0),
        sideways("drm-2", 1800),
        sideways("drm-3", 3600),
    ]
}

#[test]
fn a_window_is_told_the_whole_desk_it_is_part_of() {
    // A shell decides things about the desk that it cannot decide about one
    // monitor -- which screen the chrome goes on, what a box spanning every
    // screen is -- and told only its own it decides them all about itself.
    // Every page then believes it is the first screen, draws the whole chrome,
    // and embeds every window: a client's frame sink takes ONE parent, so the
    // last page to embed takes the window off all the others, which is a
    // terminal that answers the keyboard and draws nothing.
    let desk = domicile_host::as_seen_from(&desk(), "drm-2");

    let named: Vec<_> = desk.iter().map(|display| display.name.as_str()).collect();
    assert_eq!(
        named,
        vec!["drm-1", "drm-2", "drm-3"],
        "in the desk's own order, which is the order a shell reads as first"
    );
}

#[test]
fn the_display_a_window_covers_starts_at_the_origin() {
    // A window IS its display, so within it that display begins at zero and a
    // page places a region against the initial containing block exactly as it
    // always has.
    let desk = domicile_host::as_seen_from(&desk(), "drm-3");

    assert_eq!(desk[2].position, [0, 0]);
}

#[test]
fn every_other_display_keeps_its_place_relative_to_that_one() {
    // The desk is one space and moving its origin moves all of it. A shell
    // reads these to lay out against the desk -- a box spanning every screen,
    // which monitor is left of which -- and a list whose own screen had been
    // moved and whose others had not is a desk that overlaps itself.
    let desk = domicile_host::as_seen_from(&desk(), "drm-2");

    assert_eq!(desk[0].position, [-1800, 0], "the one to its left");
    assert_eq!(desk[2].position, [1800, 0], "and the one to its right");
}

#[test]
fn nothing_but_the_corner_moves() {
    // The size and the scale are the display's own and are not this function's
    // to touch -- a window that was told a smaller screen than it covers would
    // draw a margin it cannot fill. The mode and the turn likewise: they are
    // the panel's, read off the hardware, and this only forwards them.
    let desk = domicile_host::as_seen_from(&desk(), "drm-2");

    assert_eq!(desk[1].size, [1800, 3200]);
    assert_eq!(desk[1].scale, 2);
    assert_eq!(desk[1].mode, [3840, 2160]);
    assert_eq!(desk[1].transform, DisplayTransform::Rotate270);
}

#[test]
fn only_the_display_a_window_covers_is_the_whole_of_it() {
    // The mode and the transform are on every display as description. This is
    // what turns them into instructions for ONE of them: the page's viewport
    // IS that mode, so the logical box it lays out in has to be turned and
    // scaled to cover it. The others are monitors this page can see and draw
    // nothing on, so a region for one of them is a claim nobody can honor.
    let desk = domicile_host::as_seen_from(&desk(), "drm-2");

    assert!(desk[1].fills_the_window);
    assert!(
        !desk[0].fills_the_window && !desk[2].fills_the_window,
        "a page is one window, and one window is one monitor: {desk:?}"
    );
}

#[test]
fn a_window_on_a_display_the_desk_no_longer_has_is_told_nothing() {
    // The monitor went between the engine naming it and the desktop being
    // described. The two readings are a blank screen and the WRONG screen:
    // this one is blank until the reconciliation closes the window, where
    // handing over the desk with no window in it would leave the page laying
    // out in a desktop it has no corner of.
    let gone = domicile_host::as_seen_from(&desk(), "drm-9");

    assert!(gone.is_empty(), "{gone:?}");
}
