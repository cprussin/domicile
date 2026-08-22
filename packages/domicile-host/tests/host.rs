//! Behaviour tests for the host orchestrator, written before the implementation.
//!
//! `Host` is the compositor's brain: it tracks connected Wayland apps, applies
//! the placement/focus decisions the chrome makes, and routes input. It sits
//! between `domicile-protocol` (the chrome wire messages) and `domicile-scene` (the on-screen
//! geometry), so these tests exercise the whole pipeline end to end without any
//! Wayland or GPU dependency.

use domicile_host::{AppId, Host, HostError, InputDelivery};
use domicile_protocol::{ChromeMessage, HostMessage, Shadow};
use domicile_scene::KeyboardTarget;

fn place(
    app_id: &str,
    transform: [f64; 6],
    size: [f64; 2],
    z: i32,
    visible: bool,
) -> ChromeMessage {
    ChromeMessage::PlacePortal {
        app_id: app_id.into(),
        transform,
        size,
        z_index: z,
        visible,
        // Unstyled: what these tests are about is where a portal goes, and a
        // style would be a second thing changing in every one of them.
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: None,
        native: true,
        takes_pointer: true,
    }
}

const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

/// The same, with a style — the compositor draws the window itself, so how it
/// should look travels with where it goes.
fn place_styled(
    app_id: &str,
    corner_radius: f64,
    opacity: f64,
    shadow: Option<Shadow>,
) -> ChromeMessage {
    ChromeMessage::PlacePortal {
        app_id: app_id.into(),
        transform: IDENTITY,
        size: [100.0, 50.0],
        z_index: 0,
        visible: true,
        corner_radius,
        opacity,
        shadow,
        native: true,
        takes_pointer: true,
    }
}

// ---- app lifecycle --------------------------------------------------------

#[test]
fn a_chrome_that_arrives_late_is_told_about_every_window_already_open() {
    // A chrome learns about a window from `app_appeared`, which is sent once,
    // when the client maps — and nothing ever says it again. A page that was
    // not listening at that moment loses that window permanently, though the
    // client is alive and drawing: it happens when a client maps in the
    // milliseconds after the chrome's handshake, and every time the page
    // reloads.
    let mut host = Host::new();
    let (first, _) = host.app_appeared(Some("a terminal".to_string()), (640.0, 480.0));
    let (second, _) = host.app_appeared(None, (100.0, 200.0));
    // Enough of them that arrival order and a hash map's order are all but
    // certain to differ. With two, an unordered implementation passes this
    // about half the time, which is a test that reports luck.
    let rest: Vec<AppId> = (0..10)
        .map(|n| host.app_appeared(None, (f64::from(n), 0.0)).0)
        .collect();

    let announcements = host.open_apps();

    // Everything the chrome would have been told, and in the order the apps
    // arrived — a desktop that mounts its windows differently on each reload
    // is its own bug.
    let expected: Vec<HostMessage> = [
        HostMessage::AppAppeared {
            app_id: first,
            title: Some("a terminal".to_string()),
            size: [640.0, 480.0],
        },
        HostMessage::AppAppeared {
            app_id: second,
            title: None,
            size: [100.0, 200.0],
        },
    ]
    .into_iter()
    .chain(
        rest.into_iter()
            .enumerate()
            .map(|(n, app_id)| HostMessage::AppAppeared {
                app_id,
                title: None,
                size: [n as f64, 0.0],
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
    // wrong afterwards, which is every focus affordance a desktop has.
    //
    // And silent when nothing moved: this is asked after *every* chrome
    // message, so a report per ask would be a message per mouse move.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&app, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();

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
    let (app, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&app, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();
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
fn a_focused_window_closing_hands_the_keyboard_back_and_says_so() {
    // Nothing asked for this at all — the client went away, possibly by
    // crashing. A chrome told only that the app closed would go on marking it
    // active, and there is nothing else it could consult.
    let mut host = Host::new();
    let (app, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&app, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();
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
    let (app, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&app, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();
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
fn chrome_resize_records_the_size_to_configure_the_client_to() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (640.0, 480.0));
    assert_eq!(host.app(&id).unwrap().requested_size, None);

    host.handle_chrome_message(ChromeMessage::ResizeApp {
        app_id: id.clone(),
        size: [800.0, 600.0],
    })
    .unwrap();

    // The request is recorded separately from the client's own content size,
    // which only changes once the client has actually redrawn.
    assert_eq!(host.app(&id).unwrap().requested_size, Some((800.0, 600.0)));
    assert_eq!(host.app(&id).unwrap().size, (640.0, 480.0));
}

#[test]
fn focusing_an_app_raises_it_above_the_apps_it_ties_with() {
    let mut host = Host::new();
    let (first, _) = host.app_appeared(None, (100.0, 100.0));
    let (second, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&first, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();
    host.handle_chrome_message(place(&second, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();

    host.handle_chrome_message(ChromeMessage::FocusApp {
        app_id: first.clone(),
    })
    .unwrap();

    // Clicking an app both focuses it and brings it to the front, so the next
    // pointer event over the overlap goes to the app the user just picked.
    assert_eq!(
        host.route_pointer(50.0, 50.0),
        InputDelivery::App {
            app_id: first,
            local: (50.0, 50.0)
        }
    );
}

#[test]
fn chrome_resize_of_an_unknown_app_is_an_error() {
    let mut host = Host::new();
    assert_eq!(
        host.handle_chrome_message(ChromeMessage::ResizeApp {
            app_id: "ghost".into(),
            size: [800.0, 600.0],
        }),
        Err(HostError::UnknownApp("ghost".into()))
    );
}

#[test]
fn app_appeared_assigns_ids_and_announces_to_chrome() {
    let mut host = Host::new();
    let (id1, msg1) = host.app_appeared(Some("Terminal".into()), (640.0, 480.0));
    let (id2, _) = host.app_appeared(None, (800.0, 600.0));

    assert_ne!(id1, id2, "each app gets a distinct id");
    match msg1 {
        HostMessage::AppAppeared {
            app_id,
            title,
            size,
        } => {
            assert_eq!(app_id, id1);
            assert_eq!(title.as_deref(), Some("Terminal"));
            assert_eq!(size, [640.0, 480.0]);
        }
        other => panic!("expected AppAppeared, got {other:?}"),
    }

    // An app exists but has no on-screen portal until the chrome places it.
    assert_eq!(host.scene().len(), 0);
}

#[test]
fn resizing_and_closing_report_to_chrome() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));

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

#[test]
fn placing_a_known_app_creates_a_routable_portal() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));

    host.handle_chrome_message(place(
        &id,
        [1.0, 0.0, 0.0, 1.0, 50.0, 50.0],
        [100.0, 100.0],
        0,
        true,
    ))
    .unwrap();

    match host.route_pointer(60.0, 70.0) {
        InputDelivery::App { app_id, local } => {
            assert_eq!(app_id, id);
            assert!(
                (local.0 - 10.0).abs() < 1e-9 && (local.1 - 20.0).abs() < 1e-9,
                "local {local:?}"
            );
        }
        other => panic!("expected App delivery, got {other:?}"),
    }
}

#[test]
fn placement_transform_is_honoured_when_routing() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    // Drawn at 2x scale: a 100x100 app covers 200x200 of screen.
    host.handle_chrome_message(place(
        &id,
        [2.0, 0.0, 0.0, 2.0, 0.0, 0.0],
        [100.0, 100.0],
        0,
        true,
    ))
    .unwrap();

    match host.route_pointer(150.0, 150.0) {
        InputDelivery::App { local, .. } => {
            assert!(
                (local.0 - 75.0).abs() < 1e-9 && (local.1 - 75.0).abs() < 1e-9,
                "local {local:?}"
            );
        }
        other => panic!("expected App delivery, got {other:?}"),
    }
}

#[test]
fn placing_an_unknown_app_is_an_error() {
    let mut host = Host::new();
    assert!(host
        .handle_chrome_message(place("ghost", IDENTITY, [10.0, 10.0], 0, true))
        .is_err());
}

#[test]
fn invisible_placement_is_not_composited() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, false))
        .unwrap();

    // A hidden app is not hit-tested — pointer falls through to the chrome.
    assert!(matches!(
        host.route_pointer(50.0, 50.0),
        InputDelivery::Chrome { .. }
    ));
}

#[test]
fn removing_a_portal_stops_routing_to_it() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();
    host.handle_chrome_message(ChromeMessage::RemovePortal { app_id: id.clone() })
        .unwrap();

    assert!(matches!(
        host.route_pointer(50.0, 50.0),
        InputDelivery::Chrome { .. }
    ));
}

#[test]
fn closing_an_app_also_tears_down_its_portal() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();
    host.app_closed(&id);

    assert_eq!(host.scene().len(), 0);
    assert!(matches!(
        host.route_pointer(50.0, 50.0),
        InputDelivery::Chrome { .. }
    ));
}

// ---- focus ----------------------------------------------------------------

#[test]
fn focus_routes_keyboard_between_app_and_chrome() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();

    assert_eq!(host.keyboard_target(), KeyboardTarget::Chrome);

    host.handle_chrome_message(ChromeMessage::FocusApp { app_id: id.clone() })
        .unwrap();
    assert_eq!(host.keyboard_target(), KeyboardTarget::App(id.clone()));

    host.handle_chrome_message(ChromeMessage::FocusChrome)
        .unwrap();
    assert_eq!(host.keyboard_target(), KeyboardTarget::Chrome);
}

#[test]
fn pointer_over_empty_space_goes_to_chrome() {
    let host = Host::new();
    assert!(matches!(
        host.route_pointer(10.0, 10.0),
        InputDelivery::Chrome { .. }
    ));
}

#[test]
fn spawn_is_a_no_op_in_the_brain() {
    // The compositor intercepts Spawn; the brain must just ignore it.
    let mut host = Host::new();
    host.handle_chrome_message(ChromeMessage::Spawn {
        command: vec!["kitty".into()],
    })
    .unwrap();
    assert_eq!(host.scene().len(), 0);
    assert_eq!(host.app_count(), 0);
}

#[test]
fn asking_a_client_to_close_leaves_the_window_where_it_is() {
    // The compositor sends the toplevel a close and the client decides: an
    // editor with unsaved work stays up. A brain that dropped the window here
    // would take the tab away from a window still on screen, and nothing ever
    // puts it back — `app_appeared` is sent once.
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true))
        .unwrap();

    host.handle_chrome_message(ChromeMessage::CloseApp { app_id: id.clone() })
        .unwrap();

    assert_eq!(host.app_count(), 1);
    assert_eq!(host.scene().len(), 1);
}

// ---- how a window is drawn, as opposed to where ---------------------------

#[test]
fn a_portals_style_reaches_the_scene() {
    // The compositor reads this off the scene to draw with, so a radius the
    // brain drops is a window that stays square however it is styled.
    let mut host = Host::new();
    let (app_id, _) = host.app_appeared(None, (100.0, 50.0));

    host.handle_chrome_message(place_styled(&app_id, 12.0, 0.5, None))
        .expect("a styled placement is applied");

    let portal = host.scene().get(&app_id).expect("the portal is placed");
    assert_eq!(portal.style.corner_radius, 12.0);
    assert_eq!(portal.style.opacity, 0.5);
}

#[test]
fn a_portal_that_takes_no_pointer_reaches_the_scene_inert() {
    // The compositor routes the pointer off the scene, so a `pointer-events`
    // the brain drops is a window that goes on swallowing the clicks meant for
    // whatever the engine painted over it.
    let mut host = Host::new();
    let (app_id, _) = host.app_appeared(None, (100.0, 50.0));

    host.handle_chrome_message(ChromeMessage::PlacePortal {
        app_id: app_id.clone(),
        transform: IDENTITY,
        size: [100.0, 50.0],
        z_index: 0,
        visible: true,
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: None,
        native: true,
        takes_pointer: false,
    })
    .expect("an inert placement is applied");

    let portal = host.scene().get(&app_id).expect("the portal is placed");
    assert!(!portal.takes_pointer);
}

#[test]
fn a_portals_shadow_reaches_the_scene() {
    // A shadow is the one style that draws outside the window, so the
    // compositor has to be told its numbers rather than infer them from the
    // placement — nothing else in the message describes where it falls.
    let mut host = Host::new();
    let (app_id, _) = host.app_appeared(None, (100.0, 50.0));

    host.handle_chrome_message(place_styled(
        &app_id,
        0.0,
        1.0,
        Some(Shadow {
            dx: 4.0,
            dy: 8.0,
            blur: 12.0,
            spread: 2.0,
            color: [0.0, 0.0, 0.0, 0.5],
        }),
    ))
    .expect("a shadowed placement is applied");

    let portal = host.scene().get(&app_id).expect("the portal is placed");
    assert_eq!(
        portal.style.shadow,
        Some(domicile_scene::Shadow {
            dx: 4.0,
            dy: 8.0,
            blur: 12.0,
            spread: 2.0,
            color: [0.0, 0.0, 0.0, 0.5],
        })
    );
}

#[test]
fn a_window_the_shaders_cannot_draw_goes_back_down_the_copy_path() {
    // The chrome is the only one that can see a computed style, so it is the
    // one that decides. A window wearing a `filter` is drawn by the engine
    // again — slow and correct, rather than fast and wrong.
    let mut host = Host::new();
    let (app_id, _) = host.app_appeared(None, (100.0, 50.0));

    host.handle_chrome_message(ChromeMessage::PlacePortal {
        app_id: app_id.clone(),
        transform: IDENTITY,
        size: [100.0, 50.0],
        z_index: 0,
        visible: true,
        corner_radius: 0.0,
        opacity: 1.0,
        shadow: None,
        native: false,
        takes_pointer: true,
    })
    .expect("a placement on the copy path is applied");

    let portal = host.scene().get(&app_id).expect("the portal is placed");
    assert!(
        !portal.draws_natively,
        "a window the chrome could not describe is not drawn from its own buffer"
    );
}

#[test]
fn a_window_is_drawn_from_its_own_buffer_unless_the_chrome_says_otherwise() {
    // The floor. A chrome too old to have an opinion, or one whose window is
    // ordinary, gets the fast path — the whole point of the native path is
    // that it is what happens by default.
    let mut host = Host::new();
    let (app_id, _) = host.app_appeared(None, (100.0, 50.0));

    host.handle_chrome_message(place(&app_id, IDENTITY, [100.0, 50.0], 0, true))
        .expect("an ordinary placement is applied");

    let portal = host.scene().get(&app_id).expect("the portal is placed");
    assert!(portal.draws_natively);
}

#[test]
fn a_portal_that_styles_nothing_is_square_and_opaque() {
    // The floor: a chrome that reports no style must not get invisible windows,
    // which is what a zero default for opacity would mean.
    let mut host = Host::new();
    let (app_id, _) = host.app_appeared(None, (100.0, 50.0));

    host.handle_chrome_message(place(&app_id, IDENTITY, [100.0, 50.0], 0, true))
        .expect("an unstyled placement is applied");

    let portal = host.scene().get(&app_id).expect("the portal is placed");
    assert_eq!(portal.style, domicile_scene::Style::default());
    assert_eq!(portal.style.opacity, 1.0);
}
