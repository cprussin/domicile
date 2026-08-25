//! What order the chrome and the windows are drawn in.
//!
//! The chrome is one texture and the windows are separate ones, so the whole
//! of CSS stacking between them has to survive being expressed as "draw these
//! things in this order".
//!
//! Some of it the page resolves before we see it. An `<app>` element paints
//! nothing, so *where nothing behind that element painted either* a panel above
//! a window reaches us as chrome pixels over transparent, and drawing the
//! chrome last blends them over the client exactly as CSS says. Both shells in
//! this repo are that case — `window-styles.ts` says in as many words that a
//! window must paint no background — which is why chrome over a window looks
//! right today whatever its alpha.
//!
//! That is a property of two stylesheets, not of the mechanism, and it is worth
//! being exact about because it is easy to conclude the opposite. The moment a
//! shell paints a wallpaper, the page hands us wallpaper-under-panel as one
//! flattened texel and the window that belongs between them cannot be put
//! there — with a single window, no overlap needed.
//!
//! What ordering *does* fix is the case that needs no wallpaper: chrome between
//! two windows that overlap each other. A hole composites nothing rather than
//! erasing, so a chrome element painted under the upper window survives into
//! the raster, and a chrome drawn once at the end lands it on top of a window
//! CSS says is in front of it.
//!
//! Fixing that means drawing the one texture more than once, each time
//! confined to the part of the screen the piece at that depth occupies —
//! by region, because a texture carries no per-fragment depth to be sliced by.
//! [`Layer::clip`](crate::compose::Layer::clip) is that confinement and the
//! renderer already does it; this module is only the decision about what is
//! drawn when, kept away from the renderer so it can be tested without one.
//!
//! What it cannot fix, and what no slicing of a single raster can: where chrome
//! that belongs above a window and chrome that belongs below it cover the same
//! pixel, that texel was blended by the page before we saw it and nothing
//! downstream can unblend it. Bands are pixels, not layers — which is the
//! wallpaper case above, and `WINDOW-COMPOSITING.md` is right that it is not a
//! corner case. The general answer is a raster per band, costed there.

/// A rectangle of the chrome's quad, in the unit square the clip is in.
///
/// `[x, y, width, height]`, matching [`Layer::clip`](crate::compose::Layer::clip)
/// so a band can be handed to the renderer without another mapping in between.
pub type Rect = [f32; 4];

/// A piece of the chrome and the depth it sits at.
///
/// The chrome reports these; they are the regions of it that belong *below*
/// something rather than above everything, which is where the default is.
#[derive(Debug, Clone, PartialEq)]
pub struct Band {
    /// Its `z-index` in the same space the portals report theirs in.
    pub z: i32,
    /// Where it is, in the chrome quad's unit square.
    pub rect: Rect,
}

/// One thing to draw, in the order it is drawn.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// The window at this index of the ordered windows handed in.
    Window(usize),
    /// The chrome, confined to these rectangles.
    ///
    /// Always spelled out, never empty-means-everything: the last draw of a
    /// frame with bands in it is the whole quad *minus* those bands, and a
    /// list that sometimes means "all of it" would make the one case that
    /// needs subtracting look like the one that does not.
    Chrome(Vec<Rect>),
}

/// The order to draw one frame's windows and chrome in.
///
/// `windows` is the `z_index` of each window, already in the order the scene
/// draws them; `bands` is the chrome's own depths. The result is every window
/// once and the chrome once per depth it occupies, interleaved.
pub fn steps(windows: &[i32], bands: &[Band]) -> Vec<Step> {
    // Deepest first, and each band reduced to the part no *higher* band
    // claimed. The chrome is one raster: where two of its pieces overlap on
    // screen, that texel is whatever the page painted on top, so it belongs at
    // the higher depth and must be drawn once. Without this the overlap is
    // drawn twice — doubling the chrome's own alpha, and at differing depths
    // putting the same texel on both sides of a window.
    let mut claimed: Vec<Rect> = Vec::new();
    let mut ordered: Vec<(i32, Vec<Rect>)> = Vec::new();
    for band in deepest_last(bands).into_iter().rev() {
        let mut mine = vec![band.rect];
        for taken in &claimed {
            mine = mine
                .iter()
                .flat_map(|rect| without(*rect, *taken))
                .collect();
        }
        claimed.push(band.rect);
        if !mine.is_empty() {
            ordered.push((band.z, mine));
        }
    }
    ordered.reverse();

    let mut steps = Vec::new();
    let mut next = 0;
    for (index, z) in windows.iter().enumerate() {
        // Strictly below: at equal depth the page has already decided, in its
        // own raster, whether that chrome element covers the `<app>` element's
        // hole, and the chrome drawn last is what honours the answer.
        let below = ordered[next..].partition_point(|(depth, _)| *depth < *z);
        if below > 0 {
            let rects: Vec<Rect> = ordered[next..next + below]
                .iter()
                .flat_map(|(_, rects)| rects.iter().copied())
                .collect();
            steps.push(Step::Chrome(rects));
            next += below;
        }
        steps.push(Step::Window(index));
    }

    // Everything above the topmost window, plus all of the chrome no band
    // claimed. Minus the bands themselves: they have been drawn already, under
    // the windows they belong under, and covering them again here would put
    // them back on top — which is the whole of the bug this exists to fix.
    let mut last: Vec<Rect> = vec![WHOLE];
    for piece in bands.iter().filter_map(|band| sane(band.rect)) {
        last = last.iter().flat_map(|rect| without(*rect, piece)).collect();
    }
    last.extend(
        ordered[next..]
            .iter()
            .flat_map(|(_, rects)| rects.iter().copied()),
    );
    if !last.is_empty() {
        steps.push(Step::Chrome(last));
    }
    debug_assert!(
        steps
            .iter()
            .all(|step| !matches!(step, Step::Chrome(rects) if rects.is_empty())),
        "an empty clip list means the whole quad to the renderer, which is the \
         opposite of what an empty band region means here",
    );
    steps
}

/// `bands` by depth, each reduced to the part of the quad it can actually be.
///
/// The bands arrive from the chrome, which is another process: a rectangle
/// reaching past the quad would be handed to the shader as an instance outside
/// its own bounds, and one carrying a NaN compares false against everything,
/// slips past the overlap check and takes the rest of the desktop with it — a
/// black half-screen from one bad number. Neither is this module's to report,
/// and the protocol boundary that will parse these is where a malformed band
/// should be named; this is the last line rather than the first.
fn deepest_last(bands: &[Band]) -> Vec<Band> {
    let mut kept: Vec<Band> = bands
        .iter()
        .flat_map(|band| sane(band.rect).map(|rect| Band { z: band.z, rect }))
        .collect();
    kept.sort_by_key(|band| band.z);
    kept
}

/// `rect` cut down to the quad, or nothing when it is not a rectangle at all.
fn sane(rect: Rect) -> Option<Rect> {
    if !rect.iter().all(|edge| edge.is_finite()) {
        return None;
    }
    let (x, y) = (rect[0].max(0.0), rect[1].max(0.0));
    let (right, bottom) = ((rect[0] + rect[2]).min(1.0), (rect[1] + rect[3]).min(1.0));
    (right > x && bottom > y).then_some([x, y, right - x, bottom - y])
}

/// The chrome's whole quad.
pub const WHOLE: Rect = [0.0, 0.0, 1.0, 1.0];

/// `rect` with `cut` taken out of it, as the pieces that are left.
///
/// Up to four: the strips above, below, left and right of the overlap. They do
/// not overlap each other, so subtracting a second rectangle from all of them
/// leaves a set that still covers each remaining pixel exactly once — which is
/// what lets the chrome be drawn over them without doubling its own alpha
/// anywhere.
///
/// No overlap gives back `rect` unchanged, and a `cut` that swallows it gives
/// back nothing.
fn without(rect: Rect, cut: Rect) -> Vec<Rect> {
    let [x, y, w, h] = rect;
    let (right, bottom) = (x + w, y + h);
    let (cut_x, cut_y) = (cut[0].max(x), cut[1].max(y));
    let (cut_right, cut_bottom) = ((cut[0] + cut[2]).min(right), (cut[1] + cut[3]).min(bottom));
    if cut_right <= cut_x || cut_bottom <= cut_y {
        return vec![rect];
    }
    // Clockwise from the top, and the sides are only as tall as the overlap so
    // they do not double up with the strips above and below it.
    [
        [x, y, w, cut_y - y],
        [cut_right, cut_y, right - cut_right, cut_bottom - cut_y],
        [x, cut_bottom, w, bottom - cut_bottom],
        [x, cut_y, cut_x - x, cut_bottom - cut_y],
    ]
    .into_iter()
    .filter(|piece| piece[2] > 0.0 && piece[3] > 0.0)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::{steps, Band, Rect, Step};

    /// The whole quad, which is what a chrome with nothing below a window is.
    const ALL: Rect = [0.0, 0.0, 1.0, 1.0];

    #[test]
    fn a_desktop_with_no_windows_is_just_the_chrome() {
        assert_eq!(steps(&[], &[]), vec![Step::Chrome(vec![ALL])]);
    }

    #[test]
    fn every_window_is_drawn_before_a_chrome_that_is_all_above_them() {
        // Today's frame, and still the common one: nothing of the chrome
        // belongs under a window, so the windows go down and the chrome covers
        // the lot — its holes being what the windows show through.
        assert_eq!(
            steps(&[1, 2], &[]),
            vec![Step::Window(0), Step::Window(1), Step::Chrome(vec![ALL])],
        );
    }

    #[test]
    fn a_band_below_a_window_is_drawn_before_that_window() {
        // The case a single draw cannot express. The band sits between the two
        // windows, so it has to land after the lower one and before the upper.
        let band = Band {
            z: 2,
            rect: [0.25, 0.25, 0.5, 0.5],
        };
        let drawn = steps(&[1, 3], std::slice::from_ref(&band));
        let chrome_first = drawn
            .iter()
            .position(|step| matches!(step, Step::Chrome(rects) if rects.contains(&band.rect)))
            .expect("the band is drawn");
        let upper = drawn
            .iter()
            .position(|step| *step == Step::Window(1))
            .expect("the upper window is drawn");
        let lower = drawn
            .iter()
            .position(|step| *step == Step::Window(0))
            .expect("the lower window is drawn");
        assert!(
            lower < chrome_first && chrome_first < upper,
            "the band should sit between the windows, got {drawn:?}",
        );
    }

    #[test]
    fn a_band_drawn_early_is_not_drawn_over_again_at_the_end() {
        // The half that makes the one above worth anything. A final draw of
        // the whole quad puts the band back on top of the window it was just
        // placed under, which is the very bug being fixed — so the last draw
        // has to leave the band's own region alone.
        let band = Band {
            z: 2,
            rect: [0.25, 0.25, 0.5, 0.5],
        };
        let drawn = steps(&[1, 3], std::slice::from_ref(&band));
        let after: Vec<_> = drawn
            .iter()
            .skip_while(|step| *step != &Step::Window(1))
            .collect();
        for step in after {
            if let Step::Chrome(rects) = step {
                for rect in rects {
                    assert!(
                        !covers(*rect, centre(band.rect)),
                        "the last chrome draw {rect:?} covers the band again",
                    );
                }
            }
        }
    }

    #[test]
    fn every_pixel_of_the_chrome_is_drawn_exactly_once() {
        // What the four-corner version of this test could not see. Losing the
        // strips to the left and right of a band leaves the corners covered —
        // the strips above and below it are full width — so a complement that
        // dropped two of its four pieces passed. A sweep is the question this
        // is actually asking: no gap anywhere, and nothing drawn twice.
        //
        // Twice matters as much as none. The chrome is one raster, so a texel
        // drawn again blends its own alpha over itself; where the two draws
        // are at different depths it also lands on both sides of a window.
        for bands in [
            vec![],
            vec![band(2, [0.25, 0.25, 0.5, 0.5])],
            // Overlapping, at different depths and at the same one.
            vec![
                band(2, [0.0, 0.0, 0.5, 0.5]),
                band(4, [0.25, 0.25, 0.5, 0.5]),
            ],
            vec![
                band(3, [0.0, 0.0, 0.5, 0.5]),
                band(3, [0.25, 0.25, 0.5, 0.5]),
            ],
            // One swallowing another, either way round.
            vec![band(2, [0.1, 0.1, 0.8, 0.8]), band(5, [0.0, 0.0, 1.0, 1.0])],
            vec![band(5, [0.1, 0.1, 0.8, 0.8]), band(2, [0.0, 0.0, 1.0, 1.0])],
            // Edge to edge, and reaching past the quad on every side.
            vec![band(2, [0.0, 0.0, 1.0, 0.5]), band(3, [0.0, 0.5, 1.0, 0.5])],
            vec![band(2, [-0.5, -0.5, 2.0, 2.0])],
            vec![band(2, [0.5, 0.5, 5.0, 5.0])],
        ] {
            let drawn = steps(&[1, 3], &bands);
            for (x, y) in sweep() {
                let covered = drawn
                    .iter()
                    .filter_map(|step| match step {
                        Step::Chrome(rects) => {
                            Some(rects.iter().filter(|r| covers(**r, (x, y))).count())
                        }
                        Step::Window(_) => None,
                    })
                    .sum::<usize>();
                assert_eq!(
                    covered, 1,
                    "({x}, {y}) is drawn {covered} times with {bands:?}",
                );
            }
        }
    }

    #[test]
    fn a_band_that_is_not_a_rectangle_takes_nothing_with_it() {
        // A NaN compares false against everything, so it slips past the
        // overlap check and the piece filter drops every complement piece
        // with it — half the desktop black from one bad number, and the
        // number comes from another process.
        let drawn = steps(&[1], &[band(2, [f32::NAN, 0.0, 0.5, 0.5])]);
        for (x, y) in sweep() {
            assert!(
                drawn.iter().any(|step| matches!(
                    step,
                    Step::Chrome(rects) if rects.iter().any(|r| covers(*r, (x, y)))
                )),
                "nothing draws the chrome at ({x}, {y})",
            );
        }
    }

    /// A band at `z` covering `rect`.
    fn band(z: i32, rect: Rect) -> Band {
        Band { z, rect }
    }

    /// Points across the whole quad, off the edges of any band used above.
    fn sweep() -> impl Iterator<Item = (f32, f32)> {
        (0..40)
            .flat_map(|i| (0..40).map(move |j| ((i as f32 + 0.5) / 40.0, (j as f32 + 0.5) / 40.0)))
    }

    #[test]
    fn a_band_at_a_windows_own_depth_stays_above_it() {
        // A band means "this belongs *under* something", so it only moves for
        // a window strictly above it. At equal depth the page has already
        // resolved the tie in its own raster — it painted that chrome element
        // over the `<app>` element's hole, or did not — and the compositor
        // drawing the chrome last is what honours the answer it gave. Moving
        // an equal-depth band under the window would overrule it.
        let band = Band {
            z: 2,
            rect: [0.0, 0.0, 0.5, 0.5],
        };
        let drawn = steps(&[2], std::slice::from_ref(&band));
        let window = drawn.iter().position(|s| *s == Step::Window(0)).unwrap();
        let drawing_it = drawn
            .iter()
            .position(|step| matches!(step, Step::Chrome(rects) if rects.contains(&band.rect)))
            .expect("the band is drawn");
        assert!(
            drawing_it > window,
            "an equal-depth band should stay above the window, got {drawn:?}",
        );
    }

    /// The middle of `rect`, which is a point no complement of it may cover.
    fn centre(rect: Rect) -> (f32, f32) {
        (rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0)
    }

    /// Whether `rect` covers `(x, y)`.
    fn covers(rect: Rect, (x, y): (f32, f32)) -> bool {
        x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]
    }
}
