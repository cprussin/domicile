//! Behaviour tests for `domicile-scene`, written before the implementation.
//!
//! `domicile-scene` is the host-side model of where app windows live on screen
//! and which one has the keyboard.
//!
//! Because `<app>` is a full CSS element, an app's placement is an affine
//! transform (translate/scale/rotate) from the app's local pixels to screen
//! space, plus a stacking order. Pointer routing is not here and does not come
//! back: the page hit-tests in the DOM and forwards coordinates already
//! resolved to a window.

use domicile_scene::{KeyboardTarget, Point, Portal, Scene, Transform};

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
    // And it is the new placement that is kept, not the first one.
    assert_eq!(
        scene.get("term").unwrap().transform,
        Transform::translate(500.0, 0.0)
    );
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

// ---- which screen a window reaches ----------------------------------------

/// The box `portal` reaches, as `(min x, min y, max x, max y)`.
fn box_of(portal: &Portal) -> (f64, f64, f64, f64) {
    let bounds = portal.bounds();
    (bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y)
}

#[test]
fn a_placed_window_reaches_its_own_rectangle() {
    let portal = Portal::new("term", (800.0, 600.0), Transform::translate(100.0, 50.0), 0);

    assert_eq!(box_of(&portal), (100.0, 50.0, 900.0, 650.0));
}

#[test]
fn a_scaled_window_reaches_what_the_scale_made_of_it() {
    // The size is the app's own pixels and the transform is what the page did
    // with them, so neither alone is where the window is.
    let portal = Portal::new(
        "term",
        (800.0, 600.0),
        Transform::scale(2.0, 0.5).then(Transform::translate(100.0, 0.0)),
        0,
    );

    assert_eq!(box_of(&portal), (100.0, 0.0, 1700.0, 300.0));
}

#[test]
fn a_rotated_window_reaches_the_box_around_it() {
    // Deliberately larger than the window: a quarter turn about the origin
    // puts the far corner where no edge of the window is. Squaring that off
    // is the over-report `Bounds` documents — the alternative is a window
    // reported off a screen it is visibly on.
    let portal = Portal::new(
        "term",
        (100.0, 100.0),
        Transform::rotate(std::f64::consts::FRAC_PI_4),
        0,
    );

    let (min_x, min_y, max_x, max_y) = box_of(&portal);
    let half_diagonal = (100.0_f64 * 100.0 + 100.0 * 100.0).sqrt() / 2.0;
    assert!((min_x + half_diagonal).abs() < EPS, "left edge: {min_x}");
    assert!(min_y.abs() < EPS, "top edge: {min_y}");
    assert!((max_x - half_diagonal).abs() < EPS, "right edge: {max_x}");
    assert!(
        (max_y - half_diagonal * 2.0).abs() < EPS,
        "bottom edge: {max_y}"
    );
}

#[test]
fn a_flipped_window_reaches_a_box_the_right_way_up() {
    // A negative scale swaps which corner is which. Built from the origin and
    // the far corner alone this comes out inside-out — `min` past `max` — and
    // a box like that overlaps nothing, which reads as a window on no screen
    // at all.
    let portal = Portal::new("term", (800.0, 600.0), Transform::scale(-1.0, -1.0), 0);

    assert_eq!(box_of(&portal), (-800.0, -600.0, 0.0, 0.0));
}

#[test]
fn two_windows_side_by_side_do_not_overlap() {
    // Abutting is not overlapping: displays are laid out edge to edge, so a
    // window ending exactly on the seam is on the screen it is in rather than
    // on both.
    let left = Portal::new("left", (100.0, 100.0), Transform::identity(), 0);
    let right = Portal::new("right", (100.0, 100.0), Transform::translate(100.0, 0.0), 0);

    assert!(!left.bounds().overlaps(&right.bounds()));
    assert!(!right.bounds().overlaps(&left.bounds()));
}

#[test]
fn two_windows_over_each_other_overlap() {
    let under = Portal::new("under", (100.0, 100.0), Transform::identity(), 0);
    let over = Portal::new("over", (100.0, 100.0), Transform::translate(99.0, 99.0), 0);

    assert!(under.bounds().overlaps(&over.bounds()));
    assert!(over.bounds().overlaps(&under.bounds()));
}

// ---- The chrome claiming the pointer where it paints -----------------------
