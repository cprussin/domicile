//! Behaviour tests for `dm-scene`, written before the implementation.
//!
//! `dm-scene` is the host-side model of where app windows live on screen and
//! how pointer/keyboard input is routed between the chrome and the apps.
//!
//! Because `<app>` is a full CSS element, an app's placement is an affine
//! transform (translate/scale/rotate) from the app's local pixels to screen
//! space, plus a stacking order. Hit-testing inverts that transform to recover
//! the local coordinate to forward to the Wayland client.

use dm_scene::{KeyboardTarget, Point, PointerTarget, Portal, Scene, Transform};

const EPS: f64 = 1e-9;

fn assert_point(p: Point, x: f64, y: f64) {
    assert!(
        (p.x - x).abs() < EPS && (p.y - y).abs() < EPS,
        "expected ({x}, {y}), got ({}, {})",
        p.x,
        p.y
    );
}

fn portal(app_id: &str, w: f64, h: f64, transform: Transform, z: i32) -> Portal {
    Portal::new(app_id, (w, h), transform, z)
}

// ---- Transform ------------------------------------------------------------

#[test]
fn identity_is_a_noop() {
    assert_point(Transform::identity().apply(Point::new(3.0, 4.0)), 3.0, 4.0);
}

#[test]
fn translate_and_scale_apply() {
    assert_point(Transform::translate(10.0, 20.0).apply(Point::new(1.0, 2.0)), 11.0, 22.0);
    assert_point(Transform::scale(2.0, 3.0).apply(Point::new(4.0, 5.0)), 8.0, 15.0);
}

#[test]
fn rotate_90_degrees_ccw() {
    let r = Transform::rotate(std::f64::consts::FRAC_PI_2);
    // (1, 0) rotates to (0, 1)
    assert_point(r.apply(Point::new(1.0, 0.0)), 0.0, 1.0);
}

#[test]
fn then_composes_self_before_next() {
    // Translate first, then scale the translated result.
    let t = Transform::translate(10.0, 20.0).then(Transform::scale(2.0, 2.0));
    assert_point(t.apply(Point::new(0.0, 0.0)), 20.0, 40.0);
    assert_point(t.apply(Point::new(1.0, 1.0)), 22.0, 42.0);
}

#[test]
fn inverse_round_trips() {
    let t = Transform::translate(30.0, -5.0)
        .then(Transform::rotate(0.7))
        .then(Transform::scale(2.0, 1.5));
    let inv = t.inverse().expect("non-singular transform has an inverse");
    let p = Point::new(12.0, 34.0);
    assert_point(inv.apply(t.apply(p)), p.x, p.y);
}

#[test]
fn singular_transform_has_no_inverse() {
    assert!(Transform::scale(0.0, 0.0).inverse().is_none());
}

// ---- hit-testing ----------------------------------------------------------

#[test]
fn hit_inside_an_untransformed_portal() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    let hit = scene.hit_test(Point::new(40.0, 60.0)).expect("point is inside");
    assert_eq!(hit.app_id, "term");
    assert_point(hit.local, 40.0, 60.0);
}

#[test]
fn miss_outside_all_portals() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    assert!(scene.hit_test(Point::new(200.0, 200.0)).is_none());
}

#[test]
fn translated_portal_maps_to_local_coords() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::translate(50.0, 50.0), 0));
    let hit = scene.hit_test(Point::new(60.0, 60.0)).expect("inside");
    assert_point(hit.local, 10.0, 10.0);
}

#[test]
fn scaled_portal_maps_to_local_coords() {
    let mut scene = Scene::new();
    // A 100x100 app drawn at 2x covers a 200x200 screen region.
    scene.upsert(portal("term", 100.0, 100.0, Transform::scale(2.0, 2.0), 0));
    let hit = scene.hit_test(Point::new(150.0, 150.0)).expect("inside scaled region");
    assert_point(hit.local, 75.0, 75.0);
    // Beyond the scaled extent is a miss.
    assert!(scene.hit_test(Point::new(250.0, 250.0)).is_none());
}

#[test]
fn topmost_z_index_wins_when_overlapping() {
    let mut scene = Scene::new();
    scene.upsert(portal("under", 100.0, 100.0, Transform::identity(), 0));
    scene.upsert(portal("over", 100.0, 100.0, Transform::identity(), 5));
    let hit = scene.hit_test(Point::new(50.0, 50.0)).expect("inside both");
    assert_eq!(hit.app_id, "over");
}

#[test]
fn insertion_order_breaks_z_index_ties() {
    let mut scene = Scene::new();
    scene.upsert(portal("first", 100.0, 100.0, Transform::identity(), 0));
    scene.upsert(portal("second", 100.0, 100.0, Transform::identity(), 0));
    // Same z: the most recently added sits on top.
    assert_eq!(scene.hit_test(Point::new(50.0, 50.0)).unwrap().app_id, "second");
}

// ---- registry management --------------------------------------------------

#[test]
fn upsert_replaces_an_existing_app_rather_than_duplicating() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    scene.upsert(portal("term", 100.0, 100.0, Transform::translate(500.0, 0.0), 0));
    assert_eq!(scene.len(), 1);
    // Old location is now empty; new location hits.
    assert!(scene.hit_test(Point::new(50.0, 50.0)).is_none());
    assert!(scene.hit_test(Point::new(550.0, 50.0)).is_some());
}

#[test]
fn remove_deletes_a_portal() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    assert!(scene.remove("term"));
    assert!(scene.is_empty());
    assert!(!scene.remove("term"), "removing a missing app returns false");
}

// ---- input routing --------------------------------------------------------

#[test]
fn pointer_over_app_routes_to_app_with_local_coords() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::translate(50.0, 50.0), 0));
    match scene.route_pointer(Point::new(60.0, 70.0)) {
        PointerTarget::App { app_id, local } => {
            assert_eq!(app_id, "term");
            assert_point(local, 10.0, 20.0);
        }
        other => panic!("expected App target, got {other:?}"),
    }
}

#[test]
fn pointer_over_empty_space_routes_to_chrome() {
    let scene = Scene::new();
    match scene.route_pointer(Point::new(10.0, 10.0)) {
        PointerTarget::Chrome { screen } => assert_point(screen, 10.0, 10.0),
        other => panic!("expected Chrome target, got {other:?}"),
    }
}

// ---- keyboard focus -------------------------------------------------------

#[test]
fn focus_defaults_to_chrome() {
    assert_eq!(Scene::new().keyboard_target(), KeyboardTarget::Chrome);
}

#[test]
fn focusing_an_app_requires_it_to_exist() {
    let mut scene = Scene::new();
    assert!(!scene.focus_app("ghost"), "cannot focus a nonexistent app");
    assert_eq!(scene.keyboard_target(), KeyboardTarget::Chrome);

    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    assert!(scene.focus_app("term"));
    assert_eq!(scene.keyboard_target(), KeyboardTarget::App("term".into()));
}

#[test]
fn removing_the_focused_app_falls_back_to_chrome() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    scene.focus_app("term");
    scene.remove("term");
    assert_eq!(scene.keyboard_target(), KeyboardTarget::Chrome);
}
