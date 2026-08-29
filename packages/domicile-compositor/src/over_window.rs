//! What the chrome painted where a window is.
//!
//! A background on any element *behind* a `<domicile-app>` composites under
//! the window and hides it — every window, if that element spans the desktop,
//! with nothing on screen to say why. It has happened: a full-page backdrop
//! added while the bands were being written would have hidden every window on
//! the desktop, and every check in the tree passed on it.
//!
//! So the compositor looks. Two parts, and both can be wrong quietly.
//!
//! [`texel_over`] is the arithmetic: a page coordinate to a texel of the frame
//! the page committed, which is a scale it is never told and a row counted
//! from the other end when the buffer is inverted. The same conversion read
//! the wrong row of a texture once already; see `band_label`.
//!
//! [`what_the_chrome_shows`] is what the texel means, and it is *not* "clear
//! or nothing". The element is a hole only where the compositor draws the
//! client's buffer itself, which `disposition` does for a **dmabuf** on a
//! presenting desktop. A `wl_shm` client is never a dmabuf, whatever else is
//! true, so `e2e-window-shows-through.sh`'s window is on the **copy path**
//! even if that check were given `--present`; the headless compositor it does
//! use is the smaller half of the reason. On that path the compositor reads
//! the client's frame back, sends it, and the shell draws it into a `<canvas>`
//! inside the element — so what is over the window *is* the window, and what
//! this is looking for is what would be behind it.
//!
//! Which is why that check runs its client `--translucent`. Half-opaque is
//! then the only thing the page is entitled to paint over the window and a
//! hole is clear, so fully opaque means one thing: a background behind the
//! element, composited under it. Read against an opaque `Xrgb8888` client
//! instead, this said `alpha=255 opaque=true` for a window that was on screen,
//! and the check passed or failed on whether the chrome frame it caught
//! predated the shell drawing the canvas.
//!
//! And *when* the texel is read is the other half. A reading is taken only
//! once the chrome has that window's pixels, and an opaque one waits
//! [`PATIENCE`] frames before it is believed, because the page goes on
//! committing frames it rendered before it had the window — the empty stage,
//! whose card sits in the middle of exactly where the window is going.
//!
//! What that leaves is why the check asserts the colour and not only the
//! alpha. A reading can settle on a frame with a background painted and the
//! window not yet — nothing here can tell a page that has not drawn the window
//! from a page with something in front of it — and a background at exactly the
//! client's alpha then reads as the window. Measured: `rgb(18 52 86 / 50%)`
//! behind the stage reads `alpha=128 rgb="#091a2b"`, which doubles to
//! `#123456`, where the window reads `#101828`, which doubles to `#203050`.
//! See the falsification table in `e2e-window-shows-through.sh`.

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

/// How many whole-page frames an answer waits before it is taken as final.
///
/// The chrome having a window's pixels does not mean the page has painted
/// them: the compositor sends the frame and goes on reading what the page
/// commits, and the next few commits can still be the page as it was before
/// the window existed — an empty stage, which draws a card in the middle of
/// exactly where the window is going. Those frames are opaque over the window
/// and say nothing about it.
///
/// A window that is on screen shows a *changed* reading as soon as the page
/// has caught up and drawn two of the client's frames, so the wait is only
/// ever paid where the answer is not that. It is a bound as much as a wait:
/// reading a texel back is a pipeline stall, and a page that never paints the
/// window would otherwise be read on every frame for the life of the session.
const PATIENCE: u32 = 120;

/// What a reading of the chrome over a window means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// What the chrome shows over this window is the window. It is on screen.
    OnScreen,
    /// What the chrome shows over this window never changed, and has had
    /// every chance to. The client redraws in a different colour every frame,
    /// so a page following it cannot hold still — this one is painting
    /// something of its own over the window instead. It is not on screen.
    Hidden,
    /// Not an answer yet. Look again on the next whole-page frame.
    LookAgain,
    /// The page has this window's pixels and has painted nothing where it is,
    /// for [`PATIENCE`] frames. Stop reading it — this is the absence of a
    /// verdict rather than one.
    NothingToRead,
}

/// What the readings of the chrome over a window say about it.
///
/// **Only for a window the chrome is holding the pixels of** — `held`, the
/// compositor's own record of what it has sent. That is what makes a texel
/// mean anything, and a window it does not hold is one the caller must not
/// read at all: there is nothing of that window in the page, so clear cannot
/// be told from a frame arriving too early, and the read-back would be a
/// pipeline stall bought for nothing. Taking that decision before the read
/// rather than inside this is what keeps a window the compositor draws itself
/// — never in `held` — from costing one every frame for ever.
///
/// The question is whether the chrome over the window *keeps* moving, and
/// `domicile-test-client` is built to make that answerable: it alternates
/// between two colours every frame, and says why — "so that 'is it still
/// drawing' can be answered by looking at the window rather than by trusting a
/// counter this process prints".
///
/// - Clear: the page has those pixels and has not painted them yet.
/// - Moved *twice*: the page is following the client's frames, which is the
///   whole claim.
/// - Fewer than twice, for [`PATIENCE`] frames: whatever is there is the
///   page's own and not the window's.
///
/// Twice rather than once, and that is the load-bearing number. One change is
/// what *any* page does — it is the page catching up, the reading going from
/// whatever was there before the window existed to whatever is there now. The
/// empty stage this doc's [`PATIENCE`] note describes drew a card in the
/// middle of exactly where the window was going, and a card appearing is one
/// change. Only a page drawing the client's frames changes again after that,
/// because only the client keeps changing.
///
/// This used to ask what a single `alpha` meant — partly opaque was the
/// window, fully opaque was a background over it. That reading cannot survive
/// a desktop with a colour: a translucent window composited over an opaque
/// desktop *is* opaque, and `settle`'s own note records a run that read
/// `rgb="#193253"` for a window over a deliberate `#123456` — "the half-opaque
/// window composited over it to the byte". The alpha could not tell that from
/// a window that was hidden. Movement can, and it does not care what is
/// behind, what the theme is, or which two colours the client picked.
///
/// The cost, since it is a change in kind: this is a verdict about a sequence
/// rather than about a sample, so a chrome committing in perfect step with the
/// client's alternation would read as still. Over [`PATIENCE`] frames that is
/// remote, and what it produces is the plain "never changed" failure rather
/// than a confusing one.
///
/// `changes` counts how many times the reading of *this* window has differed
/// from the one before it, and `looks` how many readings have been taken, so
/// the first call passes 0 for both.
pub fn what_the_chrome_shows(changes: u32, alpha: u8, looks: u32) -> Verdict {
    // What an answer that has to wait says once the waiting is over.
    let waited = |answer| {
        if looks + 1 < PATIENCE {
            Verdict::LookAgain
        } else {
            answer
        }
    };
    // Before the count, and not folded into it: a page that has painted
    // nothing has answered nothing, and reporting that as a page holding still
    // over the window would name the wrong fault.
    if alpha == 0 {
        return waited(Verdict::NothingToRead);
    }
    if changes >= KEEPS_MOVING {
        return Verdict::OnScreen;
    }
    waited(Verdict::Hidden)
}

/// How many times the reading has to move before it is the window.
///
/// See [`what_the_chrome_shows`]: one change is the page catching up, which
/// every page does; the second is the page following a client that does not
/// stop changing, which only a page drawing its frames can do.
const KEEPS_MOVING: u32 = 2;

#[cfg(test)]
mod tests {
    use super::{texel_over, what_the_chrome_shows, Verdict, KEEPS_MOVING, PATIENCE};

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
    fn a_page_that_has_not_painted_the_window_yet_is_waited_for() {
        // Clear is the page holding this window's pixels and not having drawn
        // them: an answer that has not arrived rather than a bad one.
        assert_eq!(what_the_chrome_shows(0, 0, 0), Verdict::LookAgain);
        // And clear stays that answer however much the reading has moved —
        // a window fading out is not a window painted over.
        assert_eq!(what_the_chrome_shows(9, 0, 0), Verdict::LookAgain);
    }

    #[test]
    fn a_page_that_never_paints_the_window_is_given_up_on() {
        // The bound, not just the wait. Every look is a `copy_texture` and a
        // `map_texture` — a pipeline stall — so an answer that never comes has
        // to stop being asked for.
        assert_eq!(
            what_the_chrome_shows(0, 0, PATIENCE - 1),
            Verdict::NothingToRead
        );
    }

    #[test]
    fn a_reading_that_keeps_moving_is_the_window() {
        // The client redraws in a different colour every frame, so a page
        // following it cannot hold still. Answered on the reading it moved on,
        // whenever that is: the patience is for the answers that have to wait.
        for alpha in [1, 128, u8::MAX] {
            assert_eq!(
                what_the_chrome_shows(KEEPS_MOVING, alpha, 0),
                Verdict::OnScreen,
                "alpha={alpha}",
            );
            assert_eq!(
                what_the_chrome_shows(KEEPS_MOVING, alpha, PATIENCE),
                Verdict::OnScreen,
                "alpha={alpha}, out of patience",
            );
        }
    }

    #[test]
    fn a_window_over_a_desktop_with_a_colour_is_still_the_window() {
        // The case the old alpha reading could not survive, and the reason
        // this asks about movement instead: a half-opaque window composited
        // over an opaque desktop is opaque, and used to read as hidden.
        assert_eq!(
            what_the_chrome_shows(KEEPS_MOVING, u8::MAX, 0),
            Verdict::OnScreen,
        );
    }

    #[test]
    fn one_change_is_the_page_catching_up_rather_than_the_window() {
        // The number this hinges on. A page going from what it showed before
        // the window existed to anything at all has changed once — the empty
        // stage drew a card in the middle of exactly where the window was
        // going, and a card appearing is one change and then stillness.
        assert_eq!(what_the_chrome_shows(1, u8::MAX, 0), Verdict::LookAgain);
        assert_eq!(
            what_the_chrome_shows(1, u8::MAX, PATIENCE - 1),
            Verdict::Hidden
        );
    }

    #[test]
    fn a_reading_that_has_not_moved_yet_is_waited_for() {
        // One reading says nothing about a sequence, and the page can still be
        // showing what it was before the window existed.
        assert_eq!(what_the_chrome_shows(0, u8::MAX, 0), Verdict::LookAgain);
        assert_eq!(
            what_the_chrome_shows(0, 128, PATIENCE - 2),
            Verdict::LookAgain
        );
    }

    #[test]
    fn a_chrome_that_never_kept_moving_when_the_patience_runs_out_is_believed() {
        // The page held still over a window that does not. What is there is
        // the page's own painting, not the window.
        assert_eq!(
            what_the_chrome_shows(0, u8::MAX, PATIENCE - 1),
            Verdict::Hidden
        );
        assert_eq!(what_the_chrome_shows(0, 128, PATIENCE), Verdict::Hidden);
    }
}
