//! Which band the compositor is asking the chrome for, and which frame answered.
//!
//! A band is one depth of the chrome, rendered on its own: the page draws that
//! depth and hides the rest, so what arrives is a full-size raster that is
//! transparent wherever that depth paints nothing. Nothing is pre-flattened,
//! which is the whole reason for the round trip — a band clipped out of one
//! raster carries whatever the page had already blended into those pixels, and
//! `stacking`'s regions can only move that texel, not unmake it.
//!
//! **The page has no handle on its own Wayland stream.** The chrome is a page
//! in Electron and the connection is Chromium's, so the page cannot label a
//! commit — and a label sent over the chrome socket instead crosses a
//! different transport, which nothing orders against the commit it describes.
//!
//! What the page *can* label is what the frame looks like, and that is what it
//! does: while it answers, it paints the band into one pixel of the picture.
//! See `domicile_protocol::band_label`. So a repaint the page made for its own
//! reasons — a clock, a caret, a hover — carries the wrong band or none, and
//! is not mistaken for an answer. It only makes the bands already held stale,
//! because they are pictures of a page that has moved on.
//!
//! This module keeps the other half: at most one question outstanding, so
//! there is never a second band a labelled commit might have been for, and the
//! question survives a repaint — the chrome was asked for a band and is still
//! going to render it. It holds no textures and speaks no protocol, so what it
//! decides can be tested without either.

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
    ///
    /// The question outstanding is *kept*. A repaint is not an answer and does
    /// not stop one coming: the chrome was asked for a band and is going to
    /// render it, so taking the question back would leave an answer in flight
    /// that nothing expects — and asking again would put two of them there.
    /// What that answer lands beside is a set with nothing in it, so the round
    /// trip starts over from the band after it.
    pub fn went_stale(&mut self) {
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

    /// The band a request is outstanding for, without taking it.
    ///
    /// Asked before a frame is sorted rather than after, because a frame is
    /// only the answer if it says so: a repaint that arrives mid-cycle must
    /// leave the question standing, and a `take` here would have consumed it
    /// before anything had looked at the label.
    pub fn outstanding(&self) -> Option<usize> {
        self.asked
    }

    /// The frame that answered the outstanding question has been taken.
    ///
    /// `None` when nothing was asked for, which is a caller sorting a frame
    /// as an answer when there was no question — a bug rather than a state,
    /// and one the caller's own match makes unreachable.
    pub fn answered(&mut self) -> Option<usize> {
        let band = self.asked.take()?;
        self.answered.insert(band);
        Some(band)
    }

    /// The frame that answered cannot be used, so the band is still unanswered.
    ///
    /// The question is taken — it has been answered, just not usefully — and
    /// the band can be asked for again. Marking it answered with nothing to
    /// draw would leave the set reporting itself complete while a layer is
    /// missing, which is the state waiting for the whole set exists to avoid.
    pub fn unusable(&mut self) {
        self.asked = None;
    }

    /// The depth of each band, in the order they were declared.
    pub fn depths(&self) -> &[i32] {
        &self.depths
    }
}

#[cfg(test)]
mod tests {
    use super::{Bands, Next};

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
    fn a_repaint_while_a_band_is_outstanding_keeps_the_question() {
        // A repaint is not an answer and does not stop one coming: the chrome
        // was asked for a band and is going to render it. Taking the question
        // back would leave that answer in flight with nothing expecting it,
        // and asking again would put two of them there — which is the
        // ambiguity this module exists to make impossible.
        let mut bands = Bands::default();
        bands.declared(vec![0, 5]);
        bands.asked(0);
        bands.answered();
        bands.asked(1);

        bands.went_stale();
        assert_eq!(bands.next(), Next::Waiting);

        // And when it does answer, the round trip starts again from the band
        // the repaint took away.
        assert_eq!(bands.answered(), Some(1));
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

        bands.unusable();
        assert_eq!(bands.next(), Next::Ask(0));
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
