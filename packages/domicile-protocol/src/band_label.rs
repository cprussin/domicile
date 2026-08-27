//! Which band a chrome frame answers, written in the frame's own pixels.
//!
//! The compositor asks the chrome for one band at a time and has to know which
//! band the commit that follows is. It cannot ask the page: the Wayland
//! connection belongs to Chromium rather than to the page, so the page has no
//! handle on the stream its commit rides on — and a label sent back over the
//! chrome socket crosses a different transport, which nothing orders against
//! the commit it describes.
//!
//! But the page can label a frame with the one thing it does control: what the
//! frame *looks like*. So while it answers, it paints one pixel of a known
//! colour into the frame's top-left corner, with the band written into the
//! green channel. The label rides in the picture, so nothing can reorder it
//! against the picture, and a repaint the page did for its own reasons — a
//! clock, a caret, a hover — carries no label and is not mistaken for an
//! answer.
//!
//! Both halves of that live here, in the crate both sides of the protocol
//! agree through: `wire/band-labels.jsonl` pins the colours, and the chrome
//! SDK's `render-bands` asserts against the same file.

/// The channels that say a pixel is a label at all.
///
/// A colour no chrome would paint in the very corner of the desktop: strongly
/// red, with almost no blue. A neutral — which is what a rail, a bar or a
/// backdrop is — has its three channels close together, so it cannot be
/// mistaken for this however dark or light it is.
const RED: u8 = 0xD0;
const BLUE: u8 = 0x0D;

/// How far a channel may drift and still be read as what was painted.
///
/// Nothing should move it: the pixel is painted opaque, at the origin, over
/// nothing. The slack is for what a colour transform between the page and the
/// buffer might do rather than for anything this can predict, and it is small
/// enough that the sentinel still means something.
///
/// Strictly less than [`HALF`], which is the invariant that keeps a band that
/// drifted from reading as the band next to it. That would be worse than not
/// reading it at all: a frame reported as the wrong band is a layer of the
/// desktop at the wrong depth, and a frame that could not be read is asked for
/// again.
const SLACK: u8 = 7;

/// How far apart two bands are in the channel that carries them.
///
/// Wide enough that {@link SLACK} cannot turn one band into its neighbour, and
/// no wider — the width is what bounds how many bands fit.
const STEP: u16 = 16;

/// Half a step, so a band sits in the middle of its own range.
const HALF: u16 = STEP / 2;

const _: () = assert!(
    (SLACK as u16) < HALF,
    "a band that drifted by the slack would read as the band next to it",
);

/// The most bands a chrome can declare, which is what the green channel holds.
///
/// Sixteen depths is a shell with sixteen layers of chrome interleaved with
/// its windows. A chrome that wants more has outgrown one pixel, and should be
/// told so rather than having its bands silently wrap onto each other.
pub const MOST_BANDS: usize = 256 / STEP as usize;

/// The colour a chrome paints to say the frame it is committing is `band`.
///
/// Panics above [`MOST_BANDS`]: a band that does not fit is one the chrome
/// cannot label, and a wrapped label is the silent mis-stacking this whole
/// mechanism exists to stop.
pub fn colour_of(band: usize) -> [u8; 3] {
    assert!(
        band < MOST_BANDS,
        "band {band} does not fit a label; at most {MOST_BANDS} bands can be \
         told apart in one pixel",
    );
    let carried = STEP * band as u16 + HALF;
    [RED, carried as u8, BLUE]
}

/// The same colour as CSS, which is what the chrome sets.
pub fn css_of(band: usize) -> String {
    let [red, green, blue] = colour_of(band);
    format!("rgb({red}, {green}, {blue})")
}

/// The band this pixel says its frame is, or `None` for a frame with no label.
///
/// `pixel` is RGBA, as the compositor reads it out of the chrome's buffer. The
/// alpha is not looked at: a label is painted opaque and an alpha that says
/// otherwise is a frame this cannot vouch for either way, which is the same
/// answer as no label.
pub fn band_in(pixel: [u8; 4]) -> Option<usize> {
    let [red, green, blue, _] = pixel;
    // Every value of the channel decodes to some band, because the label is
    // what a band *is* here. What says this is a label at all is the pair of
    // channels above; what says it is the *right* band is the caller, which
    // compares it against the band it asked for.
    (near(red, RED) && near(blue, BLUE)).then_some((green as u16 / STEP) as usize)
}

fn near(read: u8, painted: u8) -> bool {
    read.abs_diff(painted) <= SLACK
}

#[cfg(test)]
mod tests {
    use super::{band_in, colour_of, css_of, MOST_BANDS, SLACK};

    /// A label, as it comes off a buffer: the colour plus an opaque alpha.
    fn painted(band: usize) -> [u8; 4] {
        let [red, green, blue] = colour_of(band);
        [red, green, blue, 255]
    }

    #[test]
    fn every_band_reads_back_as_itself() {
        for band in 0..MOST_BANDS {
            assert_eq!(band_in(painted(band)), Some(band), "band {band}");
        }
    }

    #[test]
    fn a_pixel_the_chrome_did_not_paint_is_no_label() {
        // What is actually in the corner of a desktop: a rail, a bar, a
        // backdrop. All neutral, which is exactly what the sentinel cannot be.
        for grey in [0x00, 0x11, 0x80, 0xD0, 0xFF] {
            assert_eq!(band_in([grey, grey, grey, 255]), None, "{grey:#x}");
        }
    }

    #[test]
    fn a_colour_that_drifted_is_still_the_band_it_was() {
        // A colour transform between the page and the buffer is the one thing
        // that could move these, and it moves them by a little.
        for band in 0..MOST_BANDS {
            let [red, green, blue] = colour_of(band);
            let drifted = [red - SLACK, green, blue + SLACK, 255];
            assert_eq!(band_in(drifted), Some(band), "band {band}");
        }
    }

    #[test]
    fn a_colour_that_drifted_too_far_is_no_label() {
        // The sentinel has to still mean something, or every red pixel in the
        // corner of the desktop is an answer to a question nobody asked.
        let [red, green, blue] = colour_of(0);
        assert_eq!(band_in([red - SLACK - 1, green, blue, 255]), None);
        assert_eq!(band_in([red, green, blue + SLACK + 1, 255]), None);
    }

    #[test]
    fn the_bands_are_spaced_further_apart_than_a_channel_can_drift() {
        // Otherwise a band that drifted reads as the one next to it, which is
        // the mis-stacking this exists to stop — reported as an answer rather
        // than as a frame that could not be read.
        for band in 0..MOST_BANDS {
            // Every way the channel can move and still be this band. The
            // constant is asserted against `HALF` where it is defined; this is
            // the same invariant read off the answers.
            for drift in [SLACK, 0, 0_u8.wrapping_sub(SLACK)] {
                let [red, green, blue] = colour_of(band);
                let moved = [red, green.wrapping_add(drift), blue, 255];
                assert_eq!(band_in(moved), Some(band), "band {band} by {drift}");
            }
        }
    }

    #[test]
    fn the_css_is_the_colour() {
        assert_eq!(css_of(0), "rgb(208, 8, 13)");
        assert_eq!(css_of(1), "rgb(208, 24, 13)");
    }

    #[test]
    #[should_panic(expected = "does not fit a label")]
    fn a_band_that_does_not_fit_is_refused_rather_than_wrapped() {
        colour_of(MOST_BANDS);
    }
}
