//! Behaviour tests for `domicile-scene`, written before the implementation.
//!
//! `domicile-scene` is the host-side model of where app windows live on screen and
//! how pointer/keyboard input is routed between the chrome and the apps.
//!
//! Because `<app>` is a full CSS element, an app's placement is an affine
//! transform (translate/scale/rotate) from the app's local pixels to screen
//! space, plus a stacking order. Hit-testing inverts that transform to recover
//! the local coordinate to forward to the Wayland client.

use domicile_scene::{KeyboardTarget, Point, PointerTarget, Portal, Scene, Transform};

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
    assert_point(
        Transform::translate(10.0, 20.0).apply(Point::new(1.0, 2.0)),
        11.0,
        22.0,
    );
    assert_point(
        Transform::scale(2.0, 3.0).apply(Point::new(4.0, 5.0)),
        8.0,
        15.0,
    );
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
    let hit = scene
        .hit_test(Point::new(40.0, 60.0))
        .expect("point is inside");
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
    scene.upsert(portal(
        "term",
        100.0,
        100.0,
        Transform::translate(50.0, 50.0),
        0,
    ));
    let hit = scene.hit_test(Point::new(60.0, 60.0)).expect("inside");
    assert_point(hit.local, 10.0, 10.0);
}

#[test]
fn scaled_portal_maps_to_local_coords() {
    let mut scene = Scene::new();
    // A 100x100 app drawn at 2x covers a 200x200 screen region.
    scene.upsert(portal("term", 100.0, 100.0, Transform::scale(2.0, 2.0), 0));
    let hit = scene
        .hit_test(Point::new(150.0, 150.0))
        .expect("inside scaled region");
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
    assert_eq!(
        scene.hit_test(Point::new(50.0, 50.0)).unwrap().app_id,
        "second"
    );
}

// ---- registry management --------------------------------------------------

#[test]
fn upsert_replaces_an_existing_app_rather_than_duplicating() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    scene.upsert(portal(
        "term",
        100.0,
        100.0,
        Transform::translate(500.0, 0.0),
        0,
    ));
    assert_eq!(scene.len(), 1);
    // Old location is now empty; new location hits.
    assert!(scene.hit_test(Point::new(50.0, 50.0)).is_none());
    assert!(scene.hit_test(Point::new(550.0, 50.0)).is_some());
}

#[test]
fn re_placing_an_app_keeps_its_place_in_the_stack() {
    let mut scene = Scene::new();
    scene.upsert(portal("first", 100.0, 100.0, Transform::identity(), 0));
    scene.upsert(portal("second", 100.0, 100.0, Transform::identity(), 0));
    // The chrome re-places an app whenever its element moves or resizes; that
    // must not reshuffle the stack under the user.
    scene.upsert(portal("first", 200.0, 200.0, Transform::identity(), 0));
    assert_eq!(
        scene.hit_test(Point::new(50.0, 50.0)).unwrap().app_id,
        "second"
    );
}

#[test]
fn raising_an_app_puts_it_above_its_tie_mates() {
    let mut scene = Scene::new();
    scene.upsert(portal("first", 100.0, 100.0, Transform::identity(), 0));
    scene.upsert(portal("second", 100.0, 100.0, Transform::identity(), 0));

    assert!(scene.raise("first"));
    assert_eq!(
        scene.hit_test(Point::new(50.0, 50.0)).unwrap().app_id,
        "first"
    );
    // A higher z-index still wins: raising only settles ties.
    scene.upsert(portal("second", 100.0, 100.0, Transform::identity(), 1));
    assert_eq!(
        scene.hit_test(Point::new(50.0, 50.0)).unwrap().app_id,
        "second"
    );
}

#[test]
fn raising_an_unplaced_app_is_a_no_op() {
    let mut scene = Scene::new();
    assert!(!scene.raise("ghost"));
}

#[test]
fn remove_deletes_a_portal() {
    let mut scene = Scene::new();
    scene.upsert(portal("term", 100.0, 100.0, Transform::identity(), 0));
    assert!(scene.remove("term"));
    assert!(scene.is_empty());
    assert!(
        !scene.remove("term"),
        "removing a missing app returns false"
    );
}

// ---- input routing --------------------------------------------------------

#[test]
fn pointer_over_app_routes_to_app_with_local_coords() {
    let mut scene = Scene::new();
    scene.upsert(portal(
        "term",
        100.0,
        100.0,
        Transform::translate(50.0, 50.0),
        0,
    ));
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

// ---- the drawing transform (what the compositor renders through) ---------
//
// A renderer draws a textured quad from the *unit square*, so a portal's size
// belongs in the matrix rather than in the vertices. These map a portal onto
// the output the same way `hit_test` maps the output back onto a portal, and
// the two disagreeing is the bug that looks like a window drawn correctly
// whose clicks land somewhere else.

/// Where the unit square's corners land, in output pixels.
fn drawn_corners(portal: &Portal) -> Vec<(f64, f64)> {
    let matrix = portal.surface_to_output();
    [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        .into_iter()
        .map(|(x, y)| {
            let p = matrix.apply(Point::new(x, y));
            (p.x, p.y)
        })
        .collect()
}

fn assert_close(actual: Vec<(f64, f64)>, expected: &[(f64, f64)]) {
    assert_eq!(actual.len(), expected.len());
    for (got, want) in actual.iter().zip(expected) {
        assert!(
            (got.0 - want.0).abs() < 1e-9 && (got.1 - want.1).abs() < 1e-9,
            "corner mismatch: got {actual:?}, want {expected:?}"
        );
    }
}

#[test]
fn the_unit_square_is_scaled_to_the_surface() {
    // The renderer's quad is the unit square whatever the surface's size, so
    // the size has to arrive through the matrix or every window draws 1px.
    let portal = Portal::new("term", (800.0, 600.0), Transform::identity(), 0);

    assert_close(
        drawn_corners(&portal),
        &[(0.0, 0.0), (800.0, 0.0), (800.0, 600.0), (0.0, 600.0)],
    );
}

#[test]
fn a_placed_portal_draws_where_it_was_placed() {
    let portal = Portal::new(
        "term",
        (400.0, 300.0),
        Transform::translate(200.0, 100.0),
        0,
    );

    assert_close(
        drawn_corners(&portal),
        &[
            (200.0, 100.0),
            (600.0, 100.0),
            (600.0, 400.0),
            (200.0, 400.0),
        ],
    );
}

#[test]
fn the_surface_is_scaled_before_it_is_placed_not_after() {
    // Composition order is the whole content of this method: scaling after
    // translating would multiply the offset by the surface size and throw the
    // window across the screen.
    let portal = Portal::new("term", (400.0, 300.0), Transform::translate(10.0, 20.0), 0);

    let corners = drawn_corners(&portal);
    assert_close(vec![corners[0]], &[(10.0, 20.0)]);
}

#[test]
fn a_rotated_portal_draws_rotated() {
    // A quarter turn maps local (x,y) to screen (-y,x), so the surface swings
    // off the left of the output. Nothing clamps it: clipping is the
    // renderer's job, and cropping here would silently truncate a window.
    let portal = Portal::new(
        "term",
        (800.0, 600.0),
        Transform::rotate(std::f64::consts::FRAC_PI_2),
        0,
    );

    assert_close(
        drawn_corners(&portal),
        &[(0.0, 0.0), (0.0, 800.0), (-600.0, 800.0), (-600.0, 0.0)],
    );
}

#[test]
fn what_is_drawn_and_what_is_clicked_are_the_same_rectangle() {
    // The property that matters: whatever the compositor draws, a click in the
    // middle of it reaches the same app at its own centre. Drawing and
    // hit-testing derive from one transform, and this pins them together.
    let portal = Portal::new(
        "term",
        (400.0, 300.0),
        Transform::translate(200.0, 100.0),
        0,
    );
    let mut scene = Scene::new();
    scene.upsert(portal.clone());

    // The centre of the drawn quad, in output pixels.
    let centre = portal.surface_to_output().apply(Point::new(0.5, 0.5));

    let hit = scene.hit_test(centre).expect("the centre is inside");
    assert_eq!(hit.app_id, "term");
    assert!((hit.local.x - 200.0).abs() < 1e-9, "local x: {hit:?}");
    assert!((hit.local.y - 150.0).abs() < 1e-9, "local y: {hit:?}");
}

// ---- draw order ------------------------------------------------------------

fn ids(portals: Vec<&Portal>) -> Vec<&str> {
    portals.iter().map(|p| p.app_id.as_str()).collect()
}

/// A portal covering the whole of a small output, so overlap is total.
fn covering(app_id: &str, z_index: i32) -> Portal {
    Portal::new(app_id, (100.0, 100.0), Transform::identity(), z_index)
}

#[test]
fn draw_order_runs_bottom_to_top() {
    let mut scene = Scene::new();
    scene.upsert(covering("top", 10));
    scene.upsert(covering("bottom", -5));
    scene.upsert(covering("middle", 0));

    assert_eq!(ids(scene.draw_order()), ["bottom", "middle", "top"]);
}

#[test]
fn a_tie_is_broken_by_which_arrived_first() {
    let mut scene = Scene::new();
    scene.upsert(covering("first", 0));
    scene.upsert(covering("second", 0));

    assert_eq!(ids(scene.draw_order()), ["first", "second"]);
}

#[test]
fn raising_a_portal_moves_it_up_the_draw_order() {
    let mut scene = Scene::new();
    scene.upsert(covering("first", 0));
    scene.upsert(covering("second", 0));

    scene.raise("first");

    assert_eq!(ids(scene.draw_order()), ["second", "first"]);
}

#[test]
fn whatever_is_drawn_last_is_what_a_click_reaches() {
    // The property tying the two halves together: where portals overlap, the
    // one painted over the others is the one that takes the click. A
    // compositor that drew in one order and routed in another would look
    // right and behave wrong.
    let mut scene = Scene::new();
    scene.upsert(covering("under", 0));
    scene.upsert(covering("over", 3));

    let drawn_last = ids(scene.draw_order()).last().copied().expect("some order");
    let clicked = scene.hit_test(Point::new(50.0, 50.0)).expect("inside both");

    assert_eq!(drawn_last, clicked.app_id);
}
