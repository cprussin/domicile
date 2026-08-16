//! Behaviour tests for the host orchestrator, written before the implementation.
//!
//! `Host` is the compositor's brain: it tracks connected Wayland apps, applies
//! the placement/focus decisions the chrome makes, and routes input. It sits
//! between `dm-protocol` (the chrome wire messages) and `dm-scene` (the on-screen
//! geometry), so these tests exercise the whole pipeline end to end without any
//! Wayland or GPU dependency.

use dm_host::{Host, InputDelivery};
use dm_protocol::{ChromeMessage, HostMessage};
use dm_scene::KeyboardTarget;

fn place(app_id: &str, transform: [f64; 6], size: [f64; 2], z: i32, visible: bool) -> ChromeMessage {
    ChromeMessage::PlacePortal { app_id: app_id.into(), transform, size, z_index: z, visible }
}

const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

// ---- app lifecycle --------------------------------------------------------

#[test]
fn app_appeared_assigns_ids_and_announces_to_chrome() {
    let mut host = Host::new();
    let (id1, msg1) = host.app_appeared(Some("Terminal".into()), (640.0, 480.0));
    let (id2, _) = host.app_appeared(None, (800.0, 600.0));

    assert_ne!(id1, id2, "each app gets a distinct id");
    match msg1 {
        HostMessage::AppAppeared { app_id, title, size } => {
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

    host.handle_chrome_message(place(&id, [1.0, 0.0, 0.0, 1.0, 50.0, 50.0], [100.0, 100.0], 0, true))
        .unwrap();

    match host.route_pointer(60.0, 70.0) {
        InputDelivery::App { app_id, local } => {
            assert_eq!(app_id, id);
            assert!((local.0 - 10.0).abs() < 1e-9 && (local.1 - 20.0).abs() < 1e-9, "local {local:?}");
        }
        other => panic!("expected App delivery, got {other:?}"),
    }
}

#[test]
fn placement_transform_is_honoured_when_routing() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    // Drawn at 2x scale: a 100x100 app covers 200x200 of screen.
    host.handle_chrome_message(place(&id, [2.0, 0.0, 0.0, 2.0, 0.0, 0.0], [100.0, 100.0], 0, true))
        .unwrap();

    match host.route_pointer(150.0, 150.0) {
        InputDelivery::App { local, .. } => {
            assert!((local.0 - 75.0).abs() < 1e-9 && (local.1 - 75.0).abs() < 1e-9, "local {local:?}");
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
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, false)).unwrap();

    // A hidden app is not hit-tested — pointer falls through to the chrome.
    assert!(matches!(host.route_pointer(50.0, 50.0), InputDelivery::Chrome { .. }));
}

#[test]
fn removing_a_portal_stops_routing_to_it() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true)).unwrap();
    host.handle_chrome_message(ChromeMessage::RemovePortal { app_id: id.clone() }).unwrap();

    assert!(matches!(host.route_pointer(50.0, 50.0), InputDelivery::Chrome { .. }));
}

#[test]
fn closing_an_app_also_tears_down_its_portal() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true)).unwrap();
    host.app_closed(&id);

    assert_eq!(host.scene().len(), 0);
    assert!(matches!(host.route_pointer(50.0, 50.0), InputDelivery::Chrome { .. }));
}

// ---- focus ----------------------------------------------------------------

#[test]
fn focus_routes_keyboard_between_app_and_chrome() {
    let mut host = Host::new();
    let (id, _) = host.app_appeared(None, (100.0, 100.0));
    host.handle_chrome_message(place(&id, IDENTITY, [100.0, 100.0], 0, true)).unwrap();

    assert_eq!(host.keyboard_target(), KeyboardTarget::Chrome);

    host.handle_chrome_message(ChromeMessage::FocusApp { app_id: id.clone() }).unwrap();
    assert_eq!(host.keyboard_target(), KeyboardTarget::App(id.clone()));

    host.handle_chrome_message(ChromeMessage::FocusChrome).unwrap();
    assert_eq!(host.keyboard_target(), KeyboardTarget::Chrome);
}

#[test]
fn pointer_over_empty_space_goes_to_chrome() {
    let host = Host::new();
    assert!(matches!(host.route_pointer(10.0, 10.0), InputDelivery::Chrome { .. }));
}

#[test]
fn spawn_is_a_no_op_in_the_brain() {
    // The compositor intercepts Spawn; the brain must just ignore it.
    let mut host = Host::new();
    host.handle_chrome_message(ChromeMessage::Spawn { command: vec!["kitty".into()] }).unwrap();
    assert_eq!(host.scene().len(), 0);
    assert_eq!(host.app_count(), 0);
}
