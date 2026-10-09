//! Behavior tests for `Host`.
//!
//! `Host` tracks Wayland apps, applies the chrome's focus requests and reports
//! changes back as `HostMessage`s. These tests need no Wayland or GPU.

use domicile_host::ipc::apply_chrome_message;
use domicile_host::{AppId, Host};
use domicile_protocol::{
    Appearance, ChromeMessage, DisplayInfo, DisplayTransform, HostMessage, Theme, PROTOCOL_VERSION,
};
use domicile_scene::KeyboardTarget;

// ---- app lifecycle --------------------------------------------------------

#[test]
fn a_window_says_what_it_is_called_when_the_client_says_it() {
    // A toplevel is announced before its first `set_title`, and a terminal
    // retitles on every command, so title changes need their own message.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, None);

    assert_eq!(
        host.app_titled(&app, Some("a terminal".to_string())),
        Some(HostMessage::AppTitled {
            app_id: app.clone(),
            title: Some("a terminal".to_string()),
        })
    );
    // The replay for a reloading chrome includes the title.
    assert_eq!(
        host.open_apps().first(),
        Some(&HostMessage::AppAppeared {
            app_id: app.clone(),
            title: Some("a terminal".to_string()),
            desktop_id: None,
            size: None,
        })
    );
    // An unchanged title sends nothing.
    assert_eq!(host.app_titled(&app, Some("a terminal".to_string())), None);
    // An unknown app sends nothing.
    assert_eq!(host.app_titled("app-nowhere", None), None);
}

#[test]
fn a_window_says_which_desktop_entry_it_is_when_the_client_says_it() {
    // `set_app_id` comes after the toplevel, like `set_title`, and a shell
    // reads it to find the app's icon.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, None);

    assert_eq!(
        host.app_desktop_id(&app, "org.gnome.Nautilus".to_string()),
        Some(HostMessage::AppDesktopId {
            app_id: app.clone(),
            desktop_id: "org.gnome.Nautilus".to_string(),
        })
    );
    // The replay for a reloading chrome includes it.
    assert_eq!(
        host.open_apps().first(),
        Some(&HostMessage::AppAppeared {
            app_id: app.clone(),
            title: None,
            desktop_id: Some("org.gnome.Nautilus".to_string()),
            size: None,
        })
    );
    // An unchanged id sends nothing.
    assert_eq!(
        host.app_desktop_id(&app, "org.gnome.Nautilus".to_string()),
        None
    );
    // An unknown app sends nothing.
    assert_eq!(host.app_desktop_id("app-nowhere", String::new()), None);
}

#[test]
fn a_client_that_has_not_committed_is_announced_with_no_size() {
    // A toplevel maps before its first buffer commit, so it has no size yet.
    // A `0x0` size would make the chrome open a window with no box, which is
    // never composited. The size arrives with the following `app_resized`.
    let mut host = Host::new();
    let (app, announce) = host.app_appeared(None, None);
    let announced = |size| HostMessage::AppAppeared {
        app_id: app.clone(),
        title: None,
        desktop_id: None,
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
    // `app_appeared` is sent once, when the client maps. A chrome that
    // connects later, or reloads, learns about existing windows only from
    // this replay.
    let mut host = Host::new();
    let (first, _) = host.app_appeared(Some("a terminal".to_string()), Some((640.0, 480.0)));
    let (second, _) = host.app_appeared(None, Some((100.0, 200.0)));
    // Enough apps that hash map order almost surely differs from arrival
    // order. With two, an unordered implementation passes half the time.
    let rest: Vec<AppId> = (0..10)
        .map(|n| host.app_appeared(None, Some((f64::from(n), 0.0))).0)
        .collect();

    let announcements = host.open_apps();

    // In arrival order, so the chrome mounts windows the same way on each
    // reload.
    let expected: Vec<HostMessage> = [
        HostMessage::AppAppeared {
            app_id: first,
            title: Some("a terminal".to_string()),
            desktop_id: None,
            size: Some([640.0, 480.0]),
        },
        HostMessage::AppAppeared {
            app_id: second,
            title: None,
            desktop_id: None,
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
                desktop_id: None,
                size: Some([n as f64, 0.0]),
            }),
    )
    // Then the focus holder: the chrome, since no app has focus.
    .chain(std::iter::once(HostMessage::FocusChanged { app_id: None }))
    .collect();
    assert_eq!(announcements, expected);
}

#[test]
fn focus_is_reported_when_it_moves_and_not_when_it_does_not() {
    // A click in the compositor also moves focus, so the chrome needs a
    // message to track the active window.
    //
    // `focus_change` runs after every chrome message, so it reports only
    // actual changes. Otherwise every mouse move would send a message.
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
    // The chrome cannot infer this case, so it must be reported.
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
    // The shell owns focus policy. The host forwards the request and leaves
    // the keyboard alone, so a shell can refuse a window that would interrupt
    // typing.
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
    // Same check as `focus_app`: no shell can act on a window it does not
    // know, so the host drops the request instead of every shell checking.
    let host = Host::new();

    assert_eq!(host.focus_requested("app-404"), None);
}

#[test]
fn a_focused_window_closing_hands_the_keyboard_back_and_says_so() {
    // The client may have crashed. Without a focus message the chrome would
    // keep marking the closed app active.
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
    // A newly loaded page has no other way to learn the focus holder.
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
    // The replay must not consume the change still owed to other chromes.
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
            desktop_id: None,
            size,
        } => {
            assert_eq!(app_id, id1);
            assert_eq!(title.as_deref(), Some("Terminal"));
            assert_eq!(size, Some([640.0, 480.0]));
        }
        other => panic!("expected AppAppeared, got {other:?}"),
    }
}

#[test]
fn a_popup_is_announced_as_its_own_app_over_its_window() {
    let mut host = Host::new();
    let (window, _) = host.app_appeared(None, None);

    let (popup, placed) = host
        .popup_placed(&window, (12.0, 30.0), (180.0, 240.0), true)
        .expect("a window's popup is announced");

    // The engine embeds by id, so the popup takes one from the window
    // counter.
    assert_ne!(popup, window);
    assert_eq!(
        placed,
        HostMessage::PopupPlaced {
            app_id: popup.clone(),
            parent: window.clone(),
            position: [12.0, 30.0],
            size: [180.0, 240.0],
            grab: true,
        }
    );
    // A popup over a popup is a submenu.
    assert!(host
        .popup_placed(&popup, (180.0, 0.0), (100.0, 100.0), true)
        .is_some());
    // A popup over an unknown app is not announced.
    assert!(host
        .popup_placed("app-nowhere", (0.0, 0.0), (1.0, 1.0), false)
        .is_none());
}

#[test]
fn a_popup_moved_is_placed_again_and_closed_like_a_window() {
    let mut host = Host::new();
    let (window, _) = host.app_appeared(None, None);
    let (popup, _) = host
        .popup_placed(&window, (12.0, 30.0), (180.0, 240.0), false)
        .unwrap();

    assert_eq!(
        host.popup_moved(&popup, (40.0, 30.0), (180.0, 200.0)),
        Some(HostMessage::PopupPlaced {
            app_id: popup.clone(),
            parent: window.clone(),
            position: [40.0, 30.0],
            size: [180.0, 200.0],
            grab: false,
        })
    );
    assert_eq!(host.popup_moved(&window, (0.0, 0.0), (1.0, 1.0)), None);

    assert_eq!(
        host.app_closed(&popup),
        Some(HostMessage::AppClosed {
            app_id: popup.clone()
        })
    );
    assert_eq!(host.popup_moved(&popup, (0.0, 0.0), (1.0, 1.0)), None);
}

#[test]
fn a_reloaded_chrome_is_told_each_popup_after_what_it_is_over() {
    let mut host = Host::new();
    let (window, _) = host.app_appeared(None, None);
    let (menu, _) = host
        .popup_placed(&window, (0.0, 30.0), (180.0, 240.0), true)
        .unwrap();
    let (submenu, _) = host
        .popup_placed(&menu, (180.0, 0.0), (100.0, 100.0), true)
        .unwrap();

    let told: Vec<String> =
        host.open_apps()
            .into_iter()
            .filter_map(|message| match message {
                HostMessage::AppAppeared { app_id, .. }
                | HostMessage::PopupPlaced { app_id, .. } => Some(app_id),
                _ => None,
            })
            .collect();

    assert_eq!(told, vec![window, menu, submenu]);
}

#[test]
fn a_windows_size_limits_are_reported_when_they_change() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, None);

    assert_eq!(
        host.app_min_size(&id, (680.0, 500.0)),
        Some(HostMessage::AppMinSize {
            app_id: id.clone(),
            size: [680.0, 500.0],
        })
    );
    // Clients restate their limits on unrelated commits; only changes are
    // reported.
    assert_eq!(host.app_min_size(&id, (680.0, 500.0)), None);
    assert_eq!(
        host.app_max_size(&id, (1920.0, 0.0)),
        Some(HostMessage::AppMaxSize {
            app_id: id.clone(),
            size: [1920.0, 0.0],
        })
    );
    assert_eq!(host.app_max_size(&id, (1920.0, 0.0)), None);
    // Zero means no limit, which is the initial state.
    let (fresh, _) = host.app_appeared(None, None);
    assert_eq!(host.app_min_size(&fresh, (0.0, 0.0)), None);
    assert_eq!(host.app_min_size("app-nowhere", (1.0, 1.0)), None);
}

#[test]
fn a_reloaded_chrome_is_told_every_windows_size_limits() {
    let mut host = Host::new();
    let (limited, _) = host.app_appeared(None, None);
    let (free, _) = host.app_appeared(None, None);
    host.app_min_size(&limited, (680.0, 500.0));
    host.app_max_size(&limited, (1000.0, 800.0));

    let replayed = host.open_apps();

    let limits: Vec<&HostMessage> = replayed
        .iter()
        .filter(|message| {
            matches!(
                message,
                HostMessage::AppMinSize { .. } | HostMessage::AppMaxSize { .. }
            )
        })
        .collect();
    assert_eq!(
        limits,
        vec![
            &HostMessage::AppMinSize {
                app_id: limited.clone(),
                size: [680.0, 500.0],
            },
            &HostMessage::AppMaxSize {
                app_id: limited.clone(),
                size: [1000.0, 800.0],
            },
        ],
        "{free} has no limits, so nothing is said about it"
    );
    // Limits follow the window's announcement, which the chrome needs first.
    let appeared = replayed
        .iter()
        .position(|message| matches!(message, HostMessage::AppAppeared { app_id, .. } if *app_id == limited))
        .unwrap();
    let limited_at = replayed
        .iter()
        .position(|message| matches!(message, HostMessage::AppMinSize { .. }))
        .unwrap();
    assert!(appeared < limited_at);
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
    // The compositor handles `Spawn` before it reaches `Host`.
    let mut host = Host::new();
    let before = format!("{host:?}");
    host.handle_chrome_message(ChromeMessage::Spawn {
        command: vec!["kitty".into()],
    })
    .unwrap();
    assert_eq!(format!("{host:?}"), before);
}

#[test]
fn asking_a_client_to_close_leaves_the_window_where_it_is() {
    // The client decides whether to close; an editor with unsaved work stays
    // up. Dropping the window here would remove its tab for good, since
    // `app_appeared` is sent once.
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, Some((100.0, 100.0)));

    host.handle_chrome_message(ChromeMessage::CloseApp { app_id: id.clone() })
        .unwrap();

    assert!(host.app(&id).is_some());
}

// ---- displays -------------------------------------------------------------

#[test]
fn the_displays_are_answered_after_the_welcome() {
    // The chrome must know the agreed protocol version before it reads any
    // other message in the handshake reply.
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
            HostMessage::Appearance(Appearance::default()),
        ]
    );
}

// ---- theme ----------------------------------------------------------------

#[test]
fn a_host_nobody_told_a_theme_is_the_one_the_chrome_was_drawn_against() {
    // Unlike the keymap, the theme always has a value. The default is dark,
    // which the chrome is designed for.
    assert_eq!(
        Host::new().describe_theme(),
        HostMessage::Theme { theme: Theme::Dark }
    );
}

#[test]
fn a_theme_that_moved_is_what_every_chrome_is_told() {
    // The compositor broadcasts the returned message to every chrome, not
    // only the one that toggled the theme.
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
    // Setting the current theme is common (config rewrites, new pages). A
    // broadcast would make every chrome run the wipe animation for nothing.
    let mut host = Host::new();
    host.set_theme(Theme::Light);

    assert_eq!(host.set_theme(Theme::Light), None);
}

#[test]
fn the_windows_theme_is_kept_apart_from_the_chromes() {
    // Windows change theme only after every chrome captures its wipe's start
    // frame. Until then the chromes and windows have different themes, and a
    // chrome connecting in that gap needs both.
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
    // When nested, the compositor re-describes on every resize or scale
    // change of its window. Appending would keep every stale size.
    //
    // Checked on `describe_desktop` so a handshake bug does not fail this
    // test.
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

/// A display with no rotation and a mode equal to its size.
fn lying_down(name: &str, position: [i32; 2], size: [u32; 2], scale: u32) -> DisplayInfo {
    DisplayInfo {
        name: name.to_string(),
        position,
        size,
        scale,
        mode: size,
        transform: DisplayTransform::Normal,
    }
}
