//! Which pixel of the chrome's frame lies over a window.
//!
//! A `<domicile-app>` element is a *hole* in the page: the compositor draws the
//! client's own buffer there and composites the chrome over the top, so the
//! window is only ever visible because the page painted nothing where it is. A
//! background on any element behind that hole fills it in, and the window is
//! gone — every window, if the element spans the desktop, with nothing on
//! screen to say why. It has happened: a full-page backdrop added while the
//! bands were being written would have hidden every window on the desktop, and
//! every check in the tree passed on it.
//!
//! So the compositor looks. This is the arithmetic that says where — a page
//! coordinate to a texel of the frame the page committed — kept apart from the
//! looking because it is the part that can be wrong quietly. The same
//! conversion read the wrong row of a texture once already; see
//! `band_label`.

/// The texel of a chrome frame that covers `at`.
///
/// `at` and `page` are in the chrome's own logical (CSS) units — the space the
/// scene is described in. `frame` is the size of what the page actually
/// committed, in device pixels, which is the page rendered at its own device
/// pixel ratio: the scale between the two is the ratio, whatever it happens to
/// be, and reading it off the two sizes means never being told it.
///
/// `None` for a point outside the page, and for a page or a frame with no
/// area — a window scrolled off the desktop has no pixel of the chrome over
/// it, and neither answer is a reading.
pub fn texel_over(
    at: (f64, f64),
    page: (f64, f64),
    frame: (u32, u32),
    y_inverted: bool,
) -> Option<(i32, i32)> {
    let (width, height) = frame;
    if page.0 <= 0.0 || page.1 <= 0.0 || width == 0 || height == 0 {
        return None;
    }
    if at.0 < 0.0 || at.1 < 0.0 || at.0 > page.0 || at.1 > page.1 {
        return None;
    }
    // The last texel rather than one past it, for a point on the far edge:
    // `page.0` maps to `width`, which is outside a frame numbered 0..width.
    let last = |along: f64, of: u32| {
        let scaled = (along * f64::from(of)) as i64;
        scaled.clamp(0, i64::from(of) - 1)
    };
    let x = last(at.0 / page.0, width);
    let row = last(at.1 / page.1, height);
    // `copy_texture` reads in GL's own coordinates, whose origin is the first
    // row of the texture — and a page rendered with GL hands its frame over
    // bottom row first, which is what `y_inverted` says. So the picture's row
    // `row` is the texture's last one minus it, exactly when it is inverted.
    let y = if y_inverted {
        i64::from(height) - 1 - row
    } else {
        row
    };
    Some((i32::try_from(x).ok()?, i32::try_from(y).ok()?))
}

/// How many whole-page frames a window is looked through before an opaque
/// answer is believed.
///
/// A window's placement reaches the compositor when the page has *laid it
/// out*, which is before the page has painted the hole and committed a frame
/// with it in. So the first frames after a window appears can legitimately
/// have the chrome still opaque where it is going, and a verdict taken from
/// one of those is a verdict about a page that had not drawn the window yet.
///
/// Transparent needs no patience — a hole is a hole, and nothing that appears
/// later fills it in. Opaque is the answer that has to wait.
const PATIENCE: u32 = 60;

/// What a reading of the chrome over a window means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// There is a hole here; the client's own pixels reach the screen.
    ShowsThrough,
    /// The chrome is painting over this window and has had every chance to
    /// stop. The window is not on screen.
    Hidden,
    /// Opaque, but the page may not have painted the window's hole yet.
    LookAgain,
}

/// What `alpha` says, given how many times this window has been looked at.
///
/// `looks` counts the readings already taken of *this* window, so the first
/// call passes 0.
pub fn what_the_chrome_shows(alpha: u8, looks: u32) -> Verdict {
    match (alpha, looks) {
        (u8::MAX, looks) if looks + 1 < PATIENCE => Verdict::LookAgain,
        (u8::MAX, _) => Verdict::Hidden,
        _ => Verdict::ShowsThrough,
    }
}

#[cfg(test)]
mod tests {
    use super::{texel_over, what_the_chrome_shows, Verdict, PATIENCE};

    const PAGE: (f64, f64) = (800.0, 600.0);

    #[test]
    fn the_middle_of_a_page_is_the_middle_of_its_frame() {
        assert_eq!(
            texel_over((400.0, 300.0), PAGE, (800, 600), false),
            Some((400, 300)),
        );
    }

    #[test]
    fn a_frame_drawn_at_twice_the_density_is_read_at_twice_the_coordinate() {
        // The chrome paints one frame pixel per CSS pixel per `devicePixelRatio`
        // and never says so here; the two sizes are what says it.
        assert_eq!(
            texel_over((400.0, 300.0), PAGE, (1600, 1200), false),
            Some((800, 600)),
        );
    }

    #[test]
    fn an_inverted_frame_is_read_from_the_other_end() {
        // A client that rendered with GL hands its buffer over bottom row
        // first, so the picture's row `y` is the texture's `height - 1 - y`.
        // Getting this backwards reads the chrome from the wrong end of the
        // page — which is a reading, just not of the window.
        assert_eq!(
            texel_over((400.0, 100.0), PAGE, (800, 600), true),
            Some((400, 499)),
        );
    }

    #[test]
    fn the_top_left_and_the_bottom_right_both_land_inside_the_frame() {
        assert_eq!(
            texel_over((0.0, 0.0), PAGE, (800, 600), false),
            Some((0, 0))
        );
        // The far corner is the last texel rather than one past it.
        assert_eq!(
            texel_over((800.0, 600.0), PAGE, (800, 600), false),
            Some((799, 599)),
        );
    }

    #[test]
    fn the_same_corner_inverted_is_the_first_row() {
        assert_eq!(
            texel_over((800.0, 600.0), PAGE, (800, 600), true),
            Some((799, 0)),
        );
    }

    #[test]
    fn a_window_off_the_page_has_no_pixel_of_the_chrome_over_it() {
        for at in [(-1.0, 300.0), (400.0, -1.0), (801.0, 300.0), (400.0, 601.0)] {
            assert_eq!(texel_over(at, PAGE, (800, 600), false), None, "{at:?}");
        }
    }

    #[test]
    fn a_page_or_a_frame_with_no_area_is_not_a_reading() {
        assert_eq!(
            texel_over((0.0, 0.0), (0.0, 600.0), (800, 600), false),
            None
        );
        assert_eq!(
            texel_over((0.0, 0.0), (800.0, 0.0), (800, 600), false),
            None
        );
        assert_eq!(texel_over((0.0, 0.0), PAGE, (0, 600), false), None);
        assert_eq!(texel_over((0.0, 0.0), PAGE, (800, 0), false), None);
    }

    #[test]
    fn a_hole_is_a_hole_the_first_time_it_is_seen() {
        // Transparent needs no patience: nothing that paints later fills in a
        // hole that is already there.
        assert_eq!(what_the_chrome_shows(0, 0), Verdict::ShowsThrough);
        assert_eq!(what_the_chrome_shows(254, 0), Verdict::ShowsThrough);
    }

    #[test]
    fn an_opaque_first_look_is_not_a_verdict() {
        // A window's placement reaches the compositor when the page has laid
        // it out, which is before the page has painted its hole and committed
        // a frame with it in. Believing the first opaque reading is a verdict
        // about a page that had not drawn the window yet — and it is flaky
        // rather than wrong, which is worse: the window is hidden or not
        // depending on which frame the compositor happened to be holding.
        assert_eq!(what_the_chrome_shows(u8::MAX, 0), Verdict::LookAgain);
    }

    #[test]
    fn an_opaque_chrome_is_believed_in_the_end() {
        assert_eq!(
            what_the_chrome_shows(u8::MAX, PATIENCE - 1),
            Verdict::Hidden
        );
        assert_eq!(what_the_chrome_shows(u8::MAX, PATIENCE), Verdict::Hidden);
    }

    #[test]
    fn a_window_that_shows_through_late_still_shows_through() {
        // The page painted its hole on the last frame anyone was going to
        // look at. That is a window on screen, not a window hidden.
        assert_eq!(what_the_chrome_shows(0, PATIENCE), Verdict::ShowsThrough);
    }
}
