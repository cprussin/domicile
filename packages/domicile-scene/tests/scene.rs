//! Behaviour tests for `domicile-scene`, written before the implementation.
//!
//! What is left of it is the affine transform type the compositor lays screens
//! out with, the box it derives from one, and which app has the keyboard.
//!
//! Because `<app>` is a full CSS element, an app's placement is an affine
//! transform (translate/scale/rotate) from the app's local pixels to screen
//! space, plus a stacking order. Pointer routing is not here and does not come
//! back: the page hit-tests in the DOM and forwards coordinates already
//! resolved to a window.

use domicile_scene::{Bounds, KeyboardTarget, Point, Scene, Transform};

const EPS: f64 = 1e-9;

fn assert_point(p: Point, x: f64, y: f64) {
    assert!(
        (p.x - x).abs() < EPS && (p.y - y).abs() < EPS,
        "expected ({x}, {y}), got ({}, {})",
        p.x,
        p.y
    );
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

// ---- input routing --------------------------------------------------------

// ---- keyboard focus -------------------------------------------------------

#[test]
fn focus_defaults_to_chrome() {
    assert_eq!(Scene::new().keyboard_target(), KeyboardTarget::Chrome);
}

// ---- the drawing transform (what the compositor renders through) ---------
//
// A renderer draws a textured quad from the *unit square*, so a portal's size
// belongs in the matrix rather than in the vertices. These map a portal onto
// the output the same way `hit_test` maps the output back onto a portal, and
// the two disagreeing is the bug that looks like a window drawn correctly
// whose clicks land somewhere else.

// ---- which screen a window reaches ----------------------------------------

// ---- The chrome claiming the pointer where it paints -----------------------

// ---- what a window's box overlaps ------------------------------------------
//
// `Bounds` outlived the portals it used to be derived from: `screens.rs` lays
// displays out with it, and "is this window on that screen" is the same
// question as "do these two boxes share any area".

fn box_of(min: (f64, f64), max: (f64, f64)) -> Bounds {
    Bounds {
        min: Point::new(min.0, min.1),
        max: Point::new(max.0, max.1),
    }
}

#[test]
fn two_boxes_side_by_side_do_not_overlap() {
    // Touching edges do not count. Two displays laid out side by side abut
    // exactly, and a window ending on the seam is on the screen it is *in*.
    assert!(!box_of((0.0, 0.0), (100.0, 100.0)).overlaps(&box_of((100.0, 0.0), (200.0, 100.0))));
}

#[test]
fn two_boxes_over_each_other_overlap() {
    assert!(box_of((0.0, 0.0), (100.0, 100.0)).overlaps(&box_of((50.0, 50.0), (150.0, 150.0))));
}

// ---- the keyboard ----------------------------------------------------------

#[test]
fn the_keyboard_starts_with_the_chrome() {
    assert_eq!(Scene::new().keyboard_target(), KeyboardTarget::Chrome);
}

#[test]
fn focus_is_given_to_whoever_is_asked_for() {
    // Ungated here now. It used to refuse an app with no portal, which was a
    // second opinion about whether a window existed; `Host` holds the only one
    // there is and asks its own map before calling.
    let mut scene = Scene::new();
    scene.focus_app("term");
    assert_eq!(
        scene.keyboard_target(),
        KeyboardTarget::App("term".to_string())
    );
}

#[test]
fn a_window_that_goes_away_hands_the_keyboard_back() {
    // Nothing else says so, and a focus naming a window that has gone is a
    // keyboard pointed at nothing.
    let mut scene = Scene::new();
    scene.focus_app("term");
    scene.window_gone("term");
    assert_eq!(scene.keyboard_target(), KeyboardTarget::Chrome);
}

#[test]
fn another_windows_going_leaves_the_focus_alone() {
    let mut scene = Scene::new();
    scene.focus_app("term");
    scene.window_gone("browser");
    assert_eq!(
        scene.keyboard_target(),
        KeyboardTarget::App("term".to_string())
    );
}

#[test]
fn the_chrome_can_take_the_keyboard_back() {
    let mut scene = Scene::new();
    scene.focus_app("term");
    scene.focus_chrome();
    assert_eq!(scene.keyboard_target(), KeyboardTarget::Chrome);
}
