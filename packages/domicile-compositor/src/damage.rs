//! What changed on the output since the last frame.
//!
//! The compositor redraws the whole output every frame. It used to *say* so
//! as well — `submit(None)` means "assume all of it", which is always correct
//! and always the most expensive thing to say, since a nested host re-reads
//! the entire surface for it and a display controller can skip nothing. This
//! is what it says instead.
//!
//! Reporting damage is not the same as *drawing* only the damage. This module
//! is the first: the frame is still composited in full, so nothing here
//! depends on what the previous buffer still holds — which is the thing a
//! swapchain does not promise and which partial redraw would have to handle.
//! Getting the report right is what a partial redraw would later be built on.

use std::collections::HashMap;

use crate::compose::Shadow;
use domicile_scene::{Point, Transform};

/// A rectangle of the output, in output pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// How a layer was drawn, beyond where it landed.
///
/// The compositor's own shader applies these, so a window can look completely
/// different without moving and without its client committing anything — a
/// shell fading one out changes nothing else. Keyed on geometry and content
/// alone, such a frame reported no damage at all and the change never
/// appeared.
///
/// In the units the shader was handed, not the scene's: the radius and the
/// shadow are scaled into output pixels on the way to `draw_layers`, and a
/// frame where the scene shrank while the output scale grew to match draws a
/// different picture from the same logical numbers. Comparing the logical ones
/// would call that no change.
///
/// The shadow is here as well as in [`covered`] for two different reasons: the
/// box it needs is about *where* pixels are, and this is about whether they
/// changed. A shadow that only changed colour moves no box.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Look {
    pub opacity: f64,
    /// In output pixels — the number the shader is given, before the `f32`
    /// cast it is given it as. Two radii that collapse to one `f32` compare
    /// unequal here and report a rectangle the shader would have drawn the
    /// same, which is a wasted re-read rather than a stale pixel.
    pub corner_radius: f64,
    /// In output pixels, which is the form the shader is handed.
    pub shadow: Option<Shadow>,
}

/// One thing as it was painted: where it landed, and which content it showed.
///
/// `content` is a counter the compositor bumps when a client commits, not the
/// pixels themselves. Comparing it is what tells a window that redrew in place
/// from one that merely stayed there — which nothing about its geometry says.
///
/// Four things are compared, and each catches something the others cannot:
/// `placed` (it moved, or turned inside its own box), `content` (its client
/// drew something new), `look` (the compositor's shader drew it differently),
/// and its rank in the draw order (it changed places with something it
/// overlaps).
#[derive(Clone, Debug, PartialEq)]
pub struct Painted {
    pub app_id: String,
    pub rect: Rect,
    /// The placement the rectangle is the box *of*.
    ///
    /// Both, because the box is not the placement. Many different affine
    /// placements share one axis-aligned rectangle — a window rotated half a
    /// turn about its own centre has exactly the box it had upright — so
    /// comparing rectangles alone calls a window that turned unchanged. The
    /// rectangle is what gets reported; this is what decides whether to report
    /// it.
    pub placed: Transform,
    pub content: u64,
    pub look: Look,
}

/// The axis-aligned box a layer covers, in output pixels.
///
/// A layer is drawn by mapping the unit square through `surface_to_output`,
/// which composes the window's own placement with the transform onto the
/// target — so it can rotate and skew, and the box that has to be re-read is
/// the one that contains the result rather than the shape itself. All four
/// corners, because under a rotation no two of them are the extremes.
///
/// Rounded outward. A box that is a fraction of a pixel small leaves a seam of
/// stale pixels along the edge of a window that moved, which is the one thing
/// reporting damage must not do.
pub fn covered(surface_to_output: Transform, shadow: Option<Transform>) -> Rect {
    let corners = [
        surface_to_output.apply(Point::new(0.0, 0.0)),
        surface_to_output.apply(Point::new(1.0, 0.0)),
        surface_to_output.apply(Point::new(0.0, 1.0)),
        surface_to_output.apply(Point::new(1.0, 1.0)),
    ];
    let left = corners.iter().fold(f64::INFINITY, |at, c| at.min(c.x));
    let top = corners.iter().fold(f64::INFINITY, |at, c| at.min(c.y));
    let right = corners.iter().fold(f64::NEG_INFINITY, |at, c| at.max(c.x));
    let bottom = corners.iter().fold(f64::NEG_INFINITY, |at, c| at.max(c.y));
    // The shadow is drawn from a quad of its own, bigger than the window's and
    // pushed by the offset, so the box has to hold both. Its *placement* comes
    // from `compose::shadow_quad` rather than being reconstructed here, and
    // that is the point: the quad is built in the window's own space and put
    // back through the layer's transform, so a rotated window rotates its
    // shadow's offset too. Growing this box by an axis-aligned margin instead
    // — which is what this did — reports the shadow of a turned window in
    // entirely the wrong direction.
    let (left, top, right, bottom) = match shadow {
        None => (left, top, right, bottom),
        Some(quad) => {
            let cast = [
                quad.apply(Point::new(0.0, 0.0)),
                quad.apply(Point::new(1.0, 0.0)),
                quad.apply(Point::new(0.0, 1.0)),
                quad.apply(Point::new(1.0, 1.0)),
            ];
            (
                cast.iter().fold(left, |at, c| at.min(c.x)),
                cast.iter().fold(top, |at, c| at.min(c.y)),
                cast.iter().fold(right, |at, c| at.max(c.x)),
                cast.iter().fold(bottom, |at, c| at.max(c.y)),
            )
        }
    };
    let (x, y) = (left.floor(), top.floor());
    Rect {
        x: x as i32,
        y: y as i32,
        width: (right.ceil() - x) as i32,
        height: (bottom.ceil() - y) as i32,
    }
}

/// Every part of the output that `current` shows differently from `previous`.
///
/// Matched by `app_id` rather than by position in the list, so a window is
/// compared with itself rather than with whatever now sits at its index.
/// Where it sits is not ignored, though — see the ranking below, which is what
/// catches a restack.
///
/// A window that *moved* damages both rectangles: where it is now, and where
/// it no longer is. Reporting only the new one leaves whatever it uncovered
/// stale on a surface nobody redrew.
///
/// A window that changed only how it *looks* — opacity, corner radius, the
/// shadow it casts — damages itself too. Those are the compositor's own
/// shader's doing rather than the client's, so neither the rectangle nor the
/// commit counter moves for them.
///
/// Rectangles rather than a merged region: they are what `submit` takes, and
/// overlapping ones cost a little repeated reading rather than a wrong
/// picture. Merging them is an optimisation this does not need to be correct.
pub fn between(previous: &[Painted], current: &[Painted]) -> Vec<Rect> {
    // Where each layer sits relative to the layers that are in *both* frames.
    //
    // Draw order is the one scene property whose effect is not confined to a
    // layer's own rectangle: raising one of two overlapping windows changes
    // every pixel of their intersection while both stay exactly where they
    // were, with the same content and the same look. So it has to be compared
    // — but compared against the right thing.
    //
    // The slices are already in draw order, so an index into them would do,
    // except that it moves for reasons that are not a restack: a window
    // appearing or closing shifts the index of everything above it, and each
    // of those would then damage its whole rectangle for a frame in which it
    // did not move. Ranking only among the layers both frames have leaves
    // those indices alone, and still moves for every real restack — two
    // surviving layers cannot swap without at least one of their ranks
    // changing.
    let rank = |layers: &[Painted], other: &[Painted]| -> HashMap<String, usize> {
        layers
            .iter()
            .filter(|layer| other.iter().any(|o| o.app_id == layer.app_id))
            .enumerate()
            .map(|(rank, layer)| (layer.app_id.clone(), rank))
            .collect()
    };
    let (was_ranked, now_ranked) = (rank(previous, current), rank(current, previous));
    let mut changed = Vec::new();
    for now in current {
        match previous.iter().find(|was| was.app_id == now.app_id) {
            // It has just appeared, so all of it is new.
            None => changed.push(now.rect),
            Some(was) if was.rect != now.rect => {
                // Both, and in this order only for readability: where it went,
                // and where it came from.
                changed.push(now.rect);
                changed.push(was.rect);
            }
            Some(was)
                if was.content != now.content
                    || was.look != now.look
                    || was.placed != now.placed
                    || was_ranked.get(&was.app_id) != now_ranked.get(&now.app_id) =>
            {
                changed.push(now.rect);
            }
            // Same place, same content: it is still there and it is unchanged.
            Some(_) => {}
        }
    }
    // And what is no longer drawn at all, which nothing above sees: the loop
    // is over what is on screen now, and a window that closed is not.
    for was in previous {
        if !current.iter().any(|now| now.app_id == was.app_id) {
            changed.push(was.rect);
        }
    }
    changed
}

/// One composited frame, kept to be the next one's `previous`.
#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    /// The output size it was measured in.
    pub into: (i32, i32),
    pub layers: Vec<Painted>,
}

/// What to tell the presentation layer changed, or `None` for "all of it".
///
/// `None` is always correct and always the most expensive thing to say, so it
/// is kept for the cases a difference cannot honestly be taken against:
///
/// - **no previous frame** — the first one, and equally a frame whose submit
///   failed, which the caller drops rather than keeping: the screen still
///   shows the one before it, so there is nothing here to differ from;
/// - **a resize**, which invalidates every rectangle at once — they were
///   measured against a differently-shaped screen, and a box from the old one
///   names the wrong pixels on the new.
///
/// Note what is *not* in that list: an empty `Vec`. A frame where nothing moved
/// and nothing redrew reports no rectangles, and that is an answer rather than
/// a missing one — "nothing changed" and "I cannot say" are different claims,
/// and only one of them is true of an idle desktop.
///
/// Smithay's winit backend does not currently act on the difference: `submit`
/// treats `Some(empty)` as `None` and swaps the whole buffer either way, so an
/// idle desktop costs the same there today. The distinction is kept because it
/// is the honest one to make at this layer and because the backend that will
/// act on it is the DRM one this is groundwork for — not because it saves
/// anything yet.
pub fn reported(previous: Option<&Frame>, now: &[Painted], into: (i32, i32)) -> Option<Vec<Rect>> {
    let last = previous.filter(|last| last.into == into)?;
    Some(between(&last.layers, now))
}

#[cfg(test)]
mod tests {
    use domicile_scene::Transform;

    use crate::compose::{shadow_quad, Shadow as Cast};

    use super::{between, covered, reported, Frame, Look, Painted, Rect};

    fn at(app_id: &str, x: i32, y: i32, content: u64) -> Painted {
        Painted {
            app_id: app_id.to_string(),
            rect: Rect {
                x,
                y,
                width: 100,
                height: 50,
            },
            placed: Transform::scale(100.0, 50.0)
                .then(Transform::translate(f64::from(x), f64::from(y))),
            content,
            look: Look {
                opacity: 1.0,
                corner_radius: 0.0,
                shadow: None,
            },
        }
    }

    /// A layer at a given placement, boxed the way `present` boxes it.
    fn placed(app_id: &str, onto_output: Transform) -> Painted {
        Painted {
            app_id: app_id.to_string(),
            rect: covered(onto_output, None),
            placed: onto_output,
            content: 1,
            look: Look {
                opacity: 1.0,
                corner_radius: 0.0,
                shadow: None,
            },
        }
    }

    #[test]
    fn a_desktop_that_did_not_move_damages_nothing() {
        // The idle case, and the one the whole thing is for: a desktop nobody
        // is touching should tell the display there is nothing to re-read.
        let frame = vec![at("a", 0, 0, 1), at("b", 200, 0, 1)];
        assert_eq!(between(&frame, &frame), vec![]);
    }

    #[test]
    fn a_window_that_appeared_damages_where_it_is() {
        let after = vec![at("a", 0, 0, 1), at("b", 200, 0, 1)];
        assert_eq!(
            between(&[at("a", 0, 0, 1)], &after),
            vec![at("b", 200, 0, 1).rect]
        );
    }

    #[test]
    fn a_window_that_closed_damages_where_it_was() {
        // Nothing in the new frame mentions it, so the loop over what is on
        // screen cannot see it — which is why there is a second loop.
        let before = vec![at("a", 0, 0, 1), at("b", 200, 0, 1)];
        assert_eq!(
            between(&before, &[at("a", 0, 0, 1)]),
            vec![at("b", 200, 0, 1).rect]
        );
    }

    #[test]
    fn a_window_that_moved_damages_both_ends_of_the_move() {
        // Where it went *and* where it came from. Reporting only the new place
        // leaves whatever it uncovered stale on a surface nobody redrew, which
        // is the bug this rule exists for.
        let damage = between(&[at("a", 0, 0, 1)], &[at("a", 300, 0, 1)]);
        assert!(damage.contains(&at("a", 300, 0, 1).rect), "where it went");
        assert!(
            damage.contains(&at("a", 0, 0, 1).rect),
            "where it came from"
        );
        assert_eq!(damage.len(), 2);
    }

    #[test]
    fn a_window_that_redrew_in_place_damages_itself_once() {
        // Same rectangle, new content: the only difference is the counter.
        assert_eq!(
            between(&[at("a", 0, 0, 1)], &[at("a", 0, 0, 2)]),
            vec![at("a", 0, 0, 2).rect]
        );
    }

    #[test]
    fn only_the_window_that_changed_is_damaged() {
        let before = vec![at("a", 0, 0, 1), at("b", 200, 0, 1)];
        let after = vec![at("a", 0, 0, 1), at("b", 200, 0, 2)];
        assert_eq!(between(&before, &after), vec![at("b", 200, 0, 2).rect]);
    }

    #[test]
    fn each_window_is_compared_with_itself_rather_than_with_its_index() {
        // The same two windows, listed the other way round and each with the
        // draw order it already had. Matched positionally, this would report
        // both as having moved to each other's place — two rectangles of
        // damage for a frame in which nothing moved at all.
        //
        // Not to be read as "restacking is free": a window that actually
        // changed places in the order damages itself, which is
        // `a_window_that_was_raised_over_another_damages_itself`. This is
        // about which entry is compared with which.
        // Listed the other way round, with *different* contents, and each
        // otherwise unchanged. Matched positionally, entry 0's content 1 would
        // be compared against entry 0's content 2 and both would be reported
        // as having redrawn — two rectangles for a frame in which nothing did.
        //
        // The differing contents are what make this fail under a positional
        // match; with the same content in both entries it passes either way,
        // which is what this test used to be.
        //
        // The reordering here is a restack, so both ranks move and both
        // windows are damaged for that reason — which is
        // `a_window_that_was_raised_over_another_damages_itself`. What is
        // pinned here is *which entry is compared with which*, so the fixture
        // is two windows that do not overlap and the expectation is the rank
        // change alone.
        let before = vec![at("a", 0, 0, 1), at("b", 200, 0, 2)];
        let after = vec![at("b", 200, 0, 2), at("a", 0, 0, 1)];
        let damage = between(&before, &after);
        assert_eq!(
            damage.len(),
            2,
            "a restack damages both, once each — not twice each: {damage:?}"
        );
    }

    #[test]
    fn a_square_layer_covers_the_box_it_was_scaled_to() {
        assert_eq!(
            covered(
                Transform::scale(100.0, 50.0).then(Transform::translate(10.0, 20.0)),
                None,
            ),
            Rect {
                x: 10,
                y: 20,
                width: 100,
                height: 50,
            }
        );
    }

    #[test]
    fn a_turned_layer_covers_the_box_that_contains_it() {
        // Rotated a quarter turn about the origin, a 100x50 window reaches 50
        // across and 100 down — and no two corners are the extremes, which is
        // why all four are transformed rather than two.
        //
        // At least that, rather than exactly: `FRAC_PI_2` is not exactly a
        // quarter turn in binary, so a corner lands a fraction past where the
        // arithmetic says and the outward rounding takes the box a pixel
        // wider. Asserting the exact number would be asserting that a rotation
        // rounds *inward*, which is the seam this must never leave. One pixel
        // per edge is the most it can add.
        let turned =
            Transform::scale(100.0, 50.0).then(Transform::rotate(std::f64::consts::FRAC_PI_2));
        let box_of_it = covered(turned, None);
        assert!(
            (50..=51).contains(&box_of_it.width),
            "width {} does not contain the turned window",
            box_of_it.width
        );
        assert!(
            (100..=101).contains(&box_of_it.height),
            "height {} does not contain the turned window",
            box_of_it.height
        );
    }

    #[test]
    fn a_fractional_box_is_rounded_outward() {
        // Never inward: a box a fraction of a pixel small leaves a seam of
        // stale pixels along the edge of a window that moved.
        let box_of_it = covered(
            Transform::scale(10.5, 10.5).then(Transform::translate(0.25, 0.25)),
            None,
        );
        assert_eq!(box_of_it.x, 0);
        assert_eq!(box_of_it.y, 0);
        assert!(
            box_of_it.width >= 11,
            "width {} swallowed the edge",
            box_of_it.width
        );
        assert!(
            box_of_it.height >= 11,
            "height {} swallowed the edge",
            box_of_it.height
        );
    }

    fn frame(into: (i32, i32), layers: Vec<Painted>) -> Frame {
        Frame { into, layers }
    }

    #[test]
    fn the_first_frame_reports_everything() {
        // Nothing to differ from, so the only honest answer is all of it.
        assert_eq!(reported(None, &[at("a", 0, 0, 1)], (800, 600)), None);
    }

    #[test]
    fn a_resized_output_reports_everything() {
        // Every rectangle in the previous frame was measured against a
        // differently-shaped screen, so each of them names the wrong pixels
        // now — including the ones that did not change.
        let last = frame((800, 600), vec![at("a", 0, 0, 1)]);
        assert_eq!(
            reported(Some(&last), &[at("a", 0, 0, 1)], (1024, 768)),
            None
        );
    }

    #[test]
    fn an_idle_desktop_reports_no_rectangles_rather_than_all_of_them() {
        // The case the whole thing is for, and the one an `Option` makes easy
        // to get backwards: nothing changed is an answer, not the absence of
        // one.
        let layers = vec![at("a", 0, 0, 1)];
        let last = frame((800, 600), layers.clone());
        assert_eq!(reported(Some(&last), &layers, (800, 600)), Some(vec![]));
    }

    #[test]
    fn a_frame_at_the_same_size_reports_its_difference() {
        let last = frame((800, 600), vec![at("a", 0, 0, 1)]);
        assert_eq!(
            reported(Some(&last), &[at("a", 0, 0, 2)], (800, 600)),
            Some(vec![at("a", 0, 0, 2).rect])
        );
    }

    #[test]
    fn a_window_whose_style_changed_damages_itself() {
        // The hole this closes. Opacity, corner radius and shadow are drawn by
        // the compositor's own shader, so a window can look completely
        // different without moving and without its client committing anything
        // — a shell fading one out is exactly that. Keyed on rect and content
        // alone, the frame reported nothing changed and the fade never
        // appeared.
        let before = at("a", 0, 0, 1);
        let mut after = before.clone();
        after.look = Look {
            opacity: 0.5,
            ..before.look
        };
        assert_eq!(
            between(&[before], std::slice::from_ref(&after)),
            vec![after.rect]
        );
    }

    /// A shadow placed the way the compositor places it, so these tests and
    /// the drawing cannot disagree about where it lands.
    fn cast(surface_to_output: Transform, dx: f32, dy: f32, blur: f32) -> Option<Transform> {
        shadow_quad(
            surface_to_output,
            Cast {
                dx,
                dy,
                blur,
                spread: 0.0,
                color: [0.0, 0.0, 0.0, 1.0],
            },
        )
        .map(|(quad, _)| quad)
    }

    #[test]
    fn a_shadow_is_part_of_what_a_window_covers() {
        // Drawn from a bigger quad than the window's own — `draw_shadow` adds
        // `blur * 0.5 + spread` on every side — so a box that stops at the
        // window leaves the shadow's pixels unreported. A window that moved
        // would drag its old shadow along behind it.
        let window = Transform::scale(100.0, 50.0);
        let bare = covered(window, None);
        let shadowed = covered(window, cast(window, 0.0, 0.0, 20.0));
        assert!(
            shadowed.width > bare.width && shadowed.height > bare.height,
            "the shadow is outside the window and has to be covered too"
        );
    }

    #[test]
    fn a_shadow_is_covered_where_it_is_cast_rather_than_where_the_window_is() {
        // Offset by `dx`/`dy`, so the box has to follow it: a shadow thrown
        // well to the right of its window is pixels nothing else damages.
        let window = Transform::scale(100.0, 50.0);
        let thrown = covered(window, cast(window, 200.0, 0.0, 0.0));
        assert!(
            thrown.x + thrown.width >= 300,
            "the box stops at {}, short of a shadow cast to 300",
            thrown.x + thrown.width
        );
    }

    #[test]
    fn a_turned_window_covers_its_shadow_where_the_turn_puts_it() {
        // The shadow's offset is rotated with the window, because the quad is
        // built in the window's own space. So a shadow thrown 200 to the right
        // of an upright window is thrown 200 *downward* once the window is
        // turned a quarter turn — and a box grown by an axis-aligned margin,
        // which is what this used to do, extends to the right and misses it
        // entirely.
        let turned =
            Transform::scale(100.0, 50.0).then(Transform::rotate(std::f64::consts::FRAC_PI_2));
        let box_of_it = covered(turned, cast(turned, 200.0, 0.0, 0.0));
        assert!(
            box_of_it.y + box_of_it.height >= 200,
            "the box ends at y={}, short of a shadow thrown down to 200",
            box_of_it.y + box_of_it.height
        );
    }

    #[test]
    fn a_window_that_was_raised_over_another_damages_itself() {
        // Nothing about either window changed except which is on top, and in
        // their overlap that is every pixel. Keyed on geometry, content and
        // look alone this reported nothing at all — a raise-on-hover showed
        // the wrong window until something else happened to damage it.
        // Two overlapping windows, swapped in the draw order and otherwise
        // untouched. Both ranks move, so both are damaged — and either
        // rectangle alone contains their whole intersection.
        let before = vec![at("a", 0, 0, 1), at("b", 50, 0, 1)];
        let after = vec![at("b", 50, 0, 1), at("a", 0, 0, 1)];
        let damage = between(&before, &after);
        assert!(damage.contains(&at("a", 0, 0, 1).rect), "the raised window");
        assert!(
            damage.contains(&at("b", 50, 0, 1).rect),
            "the one it covered"
        );
    }

    #[test]
    fn a_window_appearing_does_not_damage_the_ones_above_it() {
        // The reason the rank is taken among the layers both frames share
        // rather than being an index into the list. `b` opened underneath, so
        // every layer above it shifted up one — and ranked by index, each of
        // them would report its whole rectangle for a frame in which it did
        // not move, did not redraw and was not restacked. In the change whose
        // whole purpose is to stop saying "all of it", that is most of it.
        let before = vec![at("a", 0, 0, 1), at("c", 400, 0, 1)];
        let after = vec![at("a", 0, 0, 1), at("b", 200, 0, 1), at("c", 400, 0, 1)];
        assert_eq!(between(&before, &after), vec![at("b", 200, 0, 1).rect]);
    }

    #[test]
    fn a_window_that_turned_in_place_damages_itself() {
        // The box is not the placement. A window rotated half a turn about its
        // own centre occupies exactly the same axis-aligned rectangle, with
        // the same content, the same look and the same rank — and every pixel
        // inside it has moved. Compared on the box alone this reported nothing
        // at all, and a window rotating slowly through 45° holds one integer
        // rect for many frames while it visibly turns.
        // Written out rather than via `rotate(PI)`, which is not exactly a half
        // turn in binary and lands the box a pixel wider — that would make the
        // rectangles differ and prove nothing.
        let upright = Transform::scale(100.0, 100.0);
        let half_turn = Transform {
            a: -1.0,
            b: 0.0,
            c: 0.0,
            d: -1.0,
            e: 1.0,
            f: 1.0,
        };
        let turned = half_turn.then(upright);
        let before = placed("a", upright);
        let after = placed("a", turned);
        assert_eq!(
            before.rect, after.rect,
            "this test is only meaningful while the two share a box"
        );
        assert_eq!(
            between(&[before], std::slice::from_ref(&after)),
            vec![after.rect]
        );
    }
}
