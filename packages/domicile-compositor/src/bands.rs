//! Which band the compositor is asking the chrome for, and which frame answered.
//!
//! A band is one depth of the chrome, rendered on its own: the page draws that
//! depth and hides the rest, so what arrives is a full-size raster that is
//! transparent wherever that depth paints nothing. Nothing is pre-flattened,
//! which is the whole reason for the round trip — a band clipped out of one
//! raster carries whatever the page had already blended into those pixels, and
//! `stacking`'s regions can only move that texel, not unmake it.
//!
//! **The page cannot label its own frames.** The chrome is a page in Electron
//! and the Wayland connection is Chromium's, so the page has no handle on the
//! stream its commit rides on. A label sent over the chrome socket instead
//! crosses a different transport, and nothing orders a socket write against a
//! Wayland commit — the compositor would match frames to labels by arrival and
//! would eventually get it wrong, silently, looking exactly like a stacking
//! bug. See `docs/architecture/WINDOW-COMPOSITING.md`.
//!
//! So the compositor asks, one band at a time, and takes the chrome's next
//! commit as the answer. That is only unambiguous if the chrome commits
//! *nothing else* while a band is outstanding, which is an obligation on the
//! chrome rather than something this can enforce: a repaint of its own — a
//! clock, a caret, a hover — is a commit indistinguishable from the answer,
//! and taking it as one files every later band under the wrong depth. The
//! obligation is stated where a chrome meets it, on `BridgeClient.declareBands`,
//! and is the price of the page having no way to label its own frames.
//!
//! What this module *does* guarantee is the half it can: at most one question
//! outstanding, so there is never a second band a commit might have been for.
//! It holds no textures and speaks no protocol, so what it decides can be
//! tested without either.

use std::collections::HashSet;

/// The depths the chrome says it has, and how far round the asking has got.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Bands {
    /// In the order the chrome gave them, which is the order they are asked
    /// for. Their *depths* order the drawing; this is only the asking.
    depths: Vec<i32>,
    /// The band a request is outstanding for, as an index into `depths`.
    ///
    /// The invariant the whole module exists for: at most one, so the next
    /// commit is unambiguous.
    asked: Option<usize>,
    /// Which bands have answered since the last time they went stale.
    answered: HashSet<usize>,
}

/// One thing to draw, in the order it is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layered {
    /// The window at this index of the depths handed to
    /// [`drawn_with`](Bands::drawn_with).
    Window(usize),
    /// The band at this index of the declared depths, drawn whole.
    Band(usize),
}

/// What the compositor should do next about the chrome's bands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Next {
    /// Ask the chrome to render this band, and wait for its next commit.
    Ask(usize),
    /// A request is outstanding; nothing to do until a commit answers it.
    Waiting,
    /// Every band has answered. The frame can be drawn from what is cached.
    Complete,
}

impl Bands {
    /// The chrome has declared what depths it has.
    ///
    /// Everything cached is dropped: the depths describe a page that has just
    /// laid out, and a texture from the previous set is a picture of a
    /// different desktop. Declaring the *same* depths is still a change, since
    /// what is at a depth can move without the depth doing so.
    pub fn declared(&mut self, depths: Vec<i32>) {
        self.depths = depths;
        self.asked = None;
        self.answered.clear();
    }

    /// The chrome repainted, so every band is a picture of the page before it.
    ///
    /// Separate from [`declared`](Self::declared) because the depths have not
    /// changed and re-declaring them would be the chrome's message to send.
    pub fn went_stale(&mut self) {
        self.asked = None;
        self.answered.clear();
    }

    /// What to do next: ask for a band, wait, or draw.
    pub fn next(&self) -> Next {
        if self.asked.is_some() {
            return Next::Waiting;
        }
        match (0..self.depths.len()).find(|band| !self.answered.contains(band)) {
            Some(band) => Next::Ask(band),
            None => Next::Complete,
        }
    }

    /// Record that the compositor has asked for `band`.
    ///
    /// Panics if one is already outstanding: two in flight is the ambiguity
    /// this module exists to make impossible, and coping with it quietly would
    /// leave the compositor attributing a frame to whichever request it
    /// happened to remember.
    pub fn asked(&mut self, band: usize) {
        assert!(
            self.asked.is_none(),
            "a second band asked for while one is outstanding: the next commit \
             would answer either",
        );
        assert!(band < self.depths.len(), "no band {band} was declared");
        self.asked = Some(band);
    }

    /// A chrome frame arrived. Says which band it is, if it answers anything.
    ///
    /// `None` when nothing was asked for, which covers both the chrome
    /// repainting of its own accord — a clock, a caret, a hover — and a frame
    /// for a question that stopped standing while it was in flight. Anything
    /// that makes the set stale clears the request first, so a late frame
    /// finds nothing outstanding and answers nothing: the one take is the
    /// whole guarantee, and a generation counter beside it was a second
    /// spelling of the same thing that no test could tell from a no-op.
    pub fn answered(&mut self) -> Option<usize> {
        let band = self.asked.take()?;
        self.answered.insert(band);
        Some(band)
    }

    /// Take back an answer: the frame arrived and was not usable.
    ///
    /// The band goes back to unanswered and can be asked for again. Marking it
    /// answered with nothing to draw would leave the set reporting itself
    /// complete while a layer is missing, which is the state waiting for the
    /// whole set exists to avoid.
    pub fn unanswered(&mut self, band: usize) {
        self.answered.remove(&band);
    }

    /// The order to draw one frame's windows and bands in.
    ///
    /// `windows` is each drawn window's depth, in the order the scene draws
    /// them. The result is every window once and every band once, interleaved
    /// — the whole of what putting a window between two layers of chrome
    /// means, and the reason it is here rather than inline in `present`: the
    /// method that draws cannot be tested, and this can.
    ///
    /// A band moves only for a window strictly above it, matching `stacking`:
    /// at equal depth the page has already decided, in its own raster, whether
    /// that chrome covers the `<app>` element's hole.
    ///
    /// Bands are drawn *whole*, unlike `stacking`'s: each raster holds only
    /// its own depth, so there is nothing of another depth in it to confine
    /// away. That is what closes the case ordering cannot — a translucent
    /// panel over a window with a wallpaper behind it.
    pub fn drawn_with(&self, windows: &[i32]) -> Vec<Layered> {
        let mut ordered: Vec<(i32, usize)> = self
            .depths
            .iter()
            .enumerate()
            .map(|(band, depth)| (*depth, band))
            .collect();
        ordered.sort_unstable();

        let mut order = Vec::with_capacity(windows.len() + ordered.len());
        let mut next = 0;
        for (index, depth) in windows.iter().enumerate() {
            let below = ordered[next..].partition_point(|(at, _)| at < depth);
            order.extend(
                ordered[next..next + below]
                    .iter()
                    .map(|(_, b)| Layered::Band(*b)),
            );
            next += below;
            order.push(Layered::Window(index));
        }
        order.extend(ordered[next..].iter().map(|(_, b)| Layered::Band(*b)));
        order
    }

    /// The depth of each band, in the order they were declared.
    pub fn depths(&self) -> &[i32] {
        &self.depths
    }
}

#[cfg(test)]
mod tests {
    use super::{Bands, Layered, Next};

    #[test]
    fn a_chrome_that_declared_nothing_is_already_complete() {
        // The desktop as it is today: no bands, so there is nothing to ask for
        // and the chrome's one frame is the whole of it.
        assert_eq!(Bands::default().next(), Next::Complete);
    }

    #[test]
    fn each_band_is_asked_for_in_turn() {
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);

        assert_eq!(bands.next(), Next::Ask(0));
        bands.asked(0);
        // Nothing else may be asked while one is outstanding, because the next
        // commit would answer either.
        assert_eq!(bands.next(), Next::Waiting);

        assert_eq!(bands.answered(), Some(0));
        assert_eq!(bands.next(), Next::Ask(1));
        bands.asked(1);
        assert_eq!(bands.answered(), Some(1));
        assert_eq!(bands.next(), Next::Complete);
    }

    #[test]
    fn a_frame_nobody_asked_for_answers_nothing() {
        // The chrome repaints of its own accord all the time — a clock, a
        // caret, a hover. Taking one of those as the answer to a question
        // would cache a band the page never rendered on its own.
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);

        assert_eq!(bands.answered(), None);
        assert_eq!(bands.next(), Next::Ask(0), "and the question still stands");
    }

    #[test]
    fn a_frame_from_before_the_page_changed_is_not_an_answer() {
        // The race: the compositor asks for band 0, the page relays out and
        // the chrome re-declares, and *then* the frame for the old band 0
        // arrives. It is a picture of a page that has since changed, and
        // filing it against the new set would put a stale band on screen with
        // nothing left to correct it. Re-declaring drops the request, so the
        // late frame finds nothing outstanding and answers nothing.
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);
        bands.asked(0);

        bands.declared(vec![0, 5, 9]);
        assert_eq!(bands.answered(), None);
        assert_eq!(
            bands.next(),
            Next::Ask(0),
            "the new set is asked for from the start",
        );
    }

    #[test]
    fn a_repaint_asks_for_every_band_again() {
        // A band is a picture of the page at a moment. When the page repaints,
        // every one of them is a picture of the page before it — including
        // the ones already answered, which is why this is not just the
        // outstanding one being dropped.
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);
        bands.asked(0);
        bands.answered();
        assert_eq!(bands.next(), Next::Ask(1));

        bands.went_stale();
        assert_eq!(bands.next(), Next::Ask(0));
    }

    #[test]
    fn redeclaring_the_same_depths_still_starts_over() {
        // What is *at* a depth can move without the depth doing so, so the
        // depths matching is not the set being unchanged.
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);
        bands.asked(0);
        bands.answered();

        bands.declared(vec![0, 5]);
        assert_eq!(bands.next(), Next::Ask(0));
    }

    #[test]
    fn a_band_whose_frame_was_unusable_is_asked_for_again() {
        // The frame arrived and could not be made into a texture. Counting it
        // answered would leave the set reporting itself complete with nothing
        // cached for that depth — the desktop drawn with a layer missing, and
        // silently, which is the state waiting for the whole set exists to
        // avoid.
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);
        bands.asked(0);
        assert_eq!(bands.answered(), Some(0));

        bands.unanswered(0);
        assert_eq!(bands.next(), Next::Ask(0));
    }

    #[test]
    fn a_chrome_with_no_bands_is_just_its_windows() {
        // Every desktop today. The chrome's own single texture is drawn over
        // the lot by `present`, as it always was.
        let bands = Bands::default();
        assert_eq!(
            bands.drawn_with(&[1, 2]),
            vec![Layered::Window(0), Layered::Window(1)],
        );
    }

    #[test]
    fn a_band_below_a_window_is_drawn_before_it() {
        // The whole point: a window between two layers of chrome.
        let mut bands = Bands::default();
        bands.declared(vec![0, 9]);
        assert_eq!(
            bands.drawn_with(&[5]),
            vec![Layered::Band(0), Layered::Window(0), Layered::Band(1)],
        );
    }

    #[test]
    fn a_band_at_a_windows_own_depth_stays_above_it() {
        // Strictly below, matching `stacking`: at equal depth the page has
        // already decided, in its own raster, whether that chrome covers the
        // `<app>` element's hole.
        let mut bands = Bands::default();
        bands.declared(vec![5]);
        assert_eq!(
            bands.drawn_with(&[5]),
            vec![Layered::Window(0), Layered::Band(0)],
        );
    }

    #[test]
    fn bands_are_drawn_by_depth_rather_than_by_the_order_declared() {
        // A shell names its layers in whatever order suits it; what orders the
        // drawing is the `z-index` each one carries.
        let mut bands = Bands::default();
        bands.declared(vec![9, 0]);
        assert_eq!(
            bands.drawn_with(&[5]),
            vec![Layered::Band(1), Layered::Window(0), Layered::Band(0)],
        );
    }

    #[test]
    fn bands_under_one_window_keep_their_own_order() {
        // Two bands falling either side of nothing — both below the same
        // window, so both land in one group. A group emitted in the wrong
        // order is a wallpaper over the panel that belongs above it, and the
        // membership test below cannot see it: it sorts before comparing.
        let mut bands = Bands::default();
        bands.declared(vec![0, -1]);

        assert_eq!(
            bands.drawn_with(&[5]),
            vec![Layered::Band(1), Layered::Band(0), Layered::Window(0)],
        );
    }

    #[test]
    fn every_window_and_every_band_is_drawn_exactly_once() {
        // The loop this replaced walked two sorted lists with an index into
        // each, and indexed `layers` by the window's position — correct only
        // while nothing else had rewritten that list. Losing or repeating one
        // is a window that vanished or a layer drawn twice.
        let mut bands = Bands::default();
        bands.declared(vec![3, 3, 8, -1]);
        let order = bands.drawn_with(&[0, 3, 7, 7]);

        let mut windows: Vec<usize> = order
            .iter()
            .filter_map(|drawn| match drawn {
                Layered::Window(at) => Some(*at),
                Layered::Band(_) => None,
            })
            .collect();
        let mut drawn: Vec<usize> = order
            .iter()
            .filter_map(|item| match item {
                Layered::Band(band) => Some(*band),
                Layered::Window(_) => None,
            })
            .collect();
        windows.sort_unstable();
        drawn.sort_unstable();

        assert_eq!(windows, vec![0, 1, 2, 3], "every window, once");
        assert_eq!(drawn, vec![0, 1, 2, 3], "every band, once");
    }

    #[test]
    fn windows_keep_the_order_the_scene_drew_them_in() {
        // `draw_order` has already sorted them by `(z_index, index)`, so their
        // relative order is the scene's answer and not this function's to
        // revisit.
        let mut bands = Bands::default();
        bands.declared(vec![4]);
        let order = bands.drawn_with(&[1, 2, 9]);
        let windows: Vec<_> = order
            .iter()
            .filter(|drawn| matches!(drawn, Layered::Window(_)))
            .collect();

        assert_eq!(
            windows,
            vec![
                &Layered::Window(0),
                &Layered::Window(1),
                &Layered::Window(2)
            ],
        );
    }

    #[test]
    #[should_panic(expected = "a second band asked for while one is outstanding")]
    fn two_bands_in_flight_at_once_is_the_bug_this_prevents() {
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);
        bands.asked(0);
        bands.asked(1);
    }
}
