//! What a chrome commit *is*, decided apart from the state it lands in.
//!
//! The compositor asks the chrome for one band at a time, and the frame that
//! answers says so in its own pixels — see `domicile_protocol::band_label`. So
//! every commit has to be sorted into one of a few kinds, and getting that
//! wrong is not a small error: a frame filed as the wrong band puts a layer of
//! the desktop at the wrong depth, and a question left standing stops the
//! chrome updating for the rest of the run.
//!
//! This is that sorting, as a function of what is known rather than a match
//! inside the method that mutates. Three of the four ways the desktop could be
//! left with no chrome at all — a frame that made no texture counted as
//! answered, a buffer the compositor could not read returning before the
//! attribution ran, a dead page's question answered by the next page's first
//! commit — were branches in that method, and a method on `DomicileCompositor`
//! cannot be tested: it is built in exactly one place, `main`, out of a Wayland
//! display, a GPU and live sockets.

/// What came off the buffer a commit carried.
///
/// Three states rather than two booleans, because `Textured` implies
/// `Readable` and a pair of flags can spell the combination that cannot
/// happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Buffer {
    /// Nothing could be read from it — a format `shm_buffer_to_rgba` refuses,
    /// which is anything but ARGB/XRGB8888.
    Unreadable,
    /// Read, but no texture came of it: an upload that failed, or no renderer
    /// to upload to.
    Readable,
    /// A texture, ready to draw.
    Textured,
}

/// What the compositor should do with the frame that just arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arrival {
    /// It is this band. Cache it, and ask for the next one.
    Banded(usize),
    /// It was meant to be this band and cannot be used — no readable buffer,
    /// or no texture made from it. Ask again rather than counting it answered:
    /// a band answered with nothing to draw leaves the set reporting itself
    /// complete while a layer of the desktop is missing.
    AskAgain(usize),
    /// The page repainted of its own accord, and this chrome has bands. Every
    /// band held is now a picture of the page before it: keep this as the
    /// flattened chrome and drop them.
    ///
    /// It does not clear the question. A frame that is not the answer does not
    /// stop the answer coming — the chrome was asked for a band and is going
    /// to render it — and taking the question back would leave the compositor
    /// with an answer in flight it no longer expects.
    StaleBands,
    /// Nobody asked for it and there are no bands. The ordinary frame every
    /// chrome has always sent, and the whole of the desktop.
    Chrome,
    /// Nothing to do with it at all.
    ///
    /// A commit nobody asked for, carrying a buffer nothing can be read from.
    /// Keeping the chrome's last good frame rather than replacing it with
    /// nothing: `present` draws no chrome at all when it has no texture, so
    /// taking this one would blank the desktop until the next readable commit
    /// — a whole desktop lost to one frame in a format we do not read.
    Nothing,
}

/// Sort the frame that just arrived.
///
/// `asked` is the band a request is outstanding for, `said` the band the
/// frame's own label claims to be, `buffer` what came off the commit, and
/// `declared` whether this chrome has bands at all.
///
/// `said` is only read while a question is outstanding, which is what lets the
/// chrome leave its label up between cycles: the pixel goes on saying which
/// band was rendered last, and nobody is asking.
pub fn what_arrived(
    asked: Option<usize>,
    said: Option<usize>,
    buffer: Buffer,
    declared: bool,
) -> Arrival {
    match (asked, said, buffer, declared) {
        (Some(band), Some(label), Buffer::Textured, _) if label == band => Arrival::Banded(band),
        // A frame with no label to read, while a question stands. The label is
        // a pixel of the picture, so a frame that made no texture has none —
        // and it might have been the answer. Asked again, which is right
        // either way: if it was the answer, a question left standing is one
        // the chrome has already answered and will never answer again, and the
        // chrome stops updating for the rest of the run; if it was not, the
        // band is asked for a second time and the answer already in flight
        // says which band it is when it lands.
        (Some(band), _, Buffer::Readable | Buffer::Unreadable, _) => Arrival::AskAgain(band),
        // Textured, and it does not say it is the band asked for: the page
        // repainting of its own accord. It answers nothing and the question
        // stands — the chrome is still going to render the band it was asked
        // for — but every band already held is a picture of a page that has
        // moved on.
        (Some(_), _, Buffer::Textured, _) => Arrival::StaleBands,
        (None, _, Buffer::Unreadable, _) => Arrival::Nothing,
        (None, _, _, true) => Arrival::StaleBands,
        (None, _, _, false) => Arrival::Chrome,
    }
}

#[cfg(test)]
mod tests {
    use super::{what_arrived, Arrival, Buffer};

    #[test]
    fn a_frame_that_says_it_is_the_band_asked_for_is_that_band() {
        assert_eq!(
            what_arrived(Some(1), Some(1), Buffer::Textured, true),
            Arrival::Banded(1),
        );
    }

    #[test]
    fn a_frame_with_no_label_to_read_is_asked_for_again() {
        // The label is a pixel of the picture, so a frame that made no texture
        // has none — and it might have been the answer. Counted answered, the
        // set reports itself complete with nothing cached for that depth and
        // the desktop is drawn a layer short. Left standing, the question is
        // one the chrome has already answered and will never answer again:
        // nothing asks, nothing repaints, and the chrome freezes for the rest
        // of the run. Asking again is the only arm that is right whichever it
        // was.
        for buffer in [Buffer::Readable, Buffer::Unreadable] {
            assert_eq!(
                what_arrived(Some(0), None, buffer, true),
                Arrival::AskAgain(0),
                "{buffer:?}",
            );
        }
    }

    #[test]
    fn a_frame_that_says_nothing_does_not_answer_the_question() {
        // The whole of what the label buys. The chrome repaints of its own
        // accord all the time — a clock, a caret, a hover — and before there
        // was a label every one of those was filed as whatever band happened
        // to be outstanding, which is a layer of the desktop at the wrong
        // depth.
        assert_eq!(
            what_arrived(Some(1), None, Buffer::Textured, true),
            Arrival::StaleBands,
        );
    }

    #[test]
    fn a_frame_that_says_it_is_a_different_band_does_not_answer_either() {
        // What a repaint looks like mid-cycle: the label is still the one the
        // chrome painted last, because it has no way to know its own commit
        // happened and nothing clears it. Saying the wrong band is exactly as
        // good as saying nothing.
        assert_eq!(
            what_arrived(Some(2), Some(1), Buffer::Textured, true),
            Arrival::StaleBands,
        );
    }

    #[test]
    fn a_frame_nobody_asked_for_makes_the_bands_stale() {
        // Its label is not looked at: the chrome leaves the last one up, so
        // between cycles every frame carries a band nobody asked for.
        for said in [None, Some(0), Some(3)] {
            assert_eq!(
                what_arrived(None, said, Buffer::Textured, true),
                Arrival::StaleBands,
                "{said:?}",
            );
        }
    }

    #[test]
    fn a_frame_that_made_no_texture_still_replaces_what_is_drawn() {
        // The page painted something this cannot upload. What is held is a
        // picture of a page that has moved on, so it goes — which is what the
        // compositor has always done with a frame it could read and could not
        // upload.
        assert_eq!(
            what_arrived(None, None, Buffer::Readable, false),
            Arrival::Chrome,
        );
        assert_eq!(
            what_arrived(None, None, Buffer::Readable, true),
            Arrival::StaleBands,
        );
    }

    #[test]
    fn an_unreadable_frame_nobody_asked_for_leaves_the_chrome_alone() {
        // Nothing was read, so nothing is known about what the page looks like
        // now — and `present` draws no chrome at all when it has no texture,
        // so replacing the last good frame with nothing blanks the whole
        // desktop until the next readable commit.
        for declared in [false, true] {
            assert_eq!(
                what_arrived(None, None, Buffer::Unreadable, declared),
                Arrival::Nothing,
                "{declared}",
            );
        }
    }

    #[test]
    fn a_chrome_with_no_bands_is_drawn_whole() {
        assert_eq!(
            what_arrived(None, None, Buffer::Textured, false),
            Arrival::Chrome,
        );
    }
}
