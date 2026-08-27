//! What a chrome commit *is*, decided apart from the state it lands in.
//!
//! The compositor asks the chrome for one band at a time and takes its next
//! Wayland commit as that band, because the page cannot label its own frames.
//! So every commit has to be sorted into one of a few kinds, and getting that
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
    /// Nobody asked for it, and this chrome has bands. It is the page
    /// repainting of its own accord, which makes every band a picture of the
    /// page before it: keep it as the flattened chrome, drop the bands, and
    /// start the round trip again.
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
/// `asked` is the band a request is outstanding for, `buffer` what came off
/// the commit, and `declared` whether this chrome has bands at all.
pub fn what_arrived(asked: Option<usize>, buffer: Buffer, declared: bool) -> Arrival {
    match (asked, buffer, declared) {
        (Some(band), Buffer::Textured, _) => Arrival::Banded(band),
        // Unreadable or untextured, it is still the answer to a question that
        // now has nothing to answer it. Asked again rather than counted, and
        // rather than returned on: a question left standing routes every later
        // commit away from the chrome's own texture, and the chrome stops
        // updating for the rest of the run.
        (Some(band), _, _) => Arrival::AskAgain(band),
        (None, Buffer::Unreadable, _) => Arrival::Nothing,
        (None, _, true) => Arrival::StaleBands,
        (None, _, false) => Arrival::Chrome,
    }
}

#[cfg(test)]
mod tests {
    use super::{what_arrived, Arrival, Buffer};

    #[test]
    fn a_frame_that_answers_is_that_band() {
        assert_eq!(
            what_arrived(Some(1), Buffer::Textured, true),
            Arrival::Banded(1),
        );
    }

    #[test]
    fn a_band_whose_frame_could_not_be_used_is_asked_for_again() {
        // Both ways it can fail, because both leave the question with nothing
        // to answer it. Counted answered, the set reports itself complete with
        // nothing cached for that depth and the desktop is drawn a layer
        // short; returned on, the question stands for ever and — because a
        // standing question routes every later commit away from the chrome's
        // own texture — the chrome never updates again.
        for buffer in [Buffer::Readable, Buffer::Unreadable] {
            assert_eq!(
                what_arrived(Some(0), buffer, true),
                Arrival::AskAgain(0),
                "{buffer:?}",
            );
        }
    }

    #[test]
    fn a_frame_nobody_asked_for_makes_the_bands_stale() {
        // The chrome repaints of its own accord all the time — a clock, a
        // caret, a hover — and every band held is then a picture of the page
        // before it.
        assert_eq!(
            what_arrived(None, Buffer::Textured, true),
            Arrival::StaleBands,
        );
    }

    #[test]
    fn a_frame_that_made_no_texture_still_replaces_what_is_drawn() {
        // The page painted something this cannot upload. What is held is a
        // picture of a page that has moved on, so it goes — which is what the
        // compositor has always done with a frame it could read and could not
        // upload.
        assert_eq!(what_arrived(None, Buffer::Readable, false), Arrival::Chrome);
        assert_eq!(
            what_arrived(None, Buffer::Readable, true),
            Arrival::StaleBands,
        );
    }

    #[test]
    fn an_unreadable_frame_nobody_asked_for_leaves_the_chrome_alone() {
        // Nothing was read, so nothing is known about what the page looks like
        // now — and `present` draws no chrome at all when it has no texture,
        // so replacing the last good frame with nothing blanks the whole
        // desktop until the next readable commit.
        for declared in [true, false] {
            assert_eq!(
                what_arrived(None, Buffer::Unreadable, declared),
                Arrival::Nothing,
                "declared: {declared}",
            );
        }
    }

    #[test]
    fn a_chrome_with_no_bands_just_has_frames() {
        // Every chrome today, and every chrome before bands existed.
        assert_eq!(what_arrived(None, Buffer::Textured, false), Arrival::Chrome);
    }
}
