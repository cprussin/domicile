//! Premultiplied alpha, undone.
//!
//! A Wayland surface buffer carries **premultiplied** alpha — `wl_buffer` says
//! so, so it binds `wl_shm` and `zwp_linux_dmabuf_v1` alike. The page draws
//! what the copy path sends with `putImageData`, and `ImageData` is defined as
//! **straight** alpha: the browser multiplies by alpha again on the way in. A
//! pixel at half alpha therefore contributes half its colour, and every
//! translucent pixel of every window composites too dark.
//!
//! Fully opaque and fully transparent pixels are unaffected, which is why this
//! is easy to miss: a transparent window is the right *shape*, and what is
//! wrong is its anti-aliased edges and any real translucency — a corner the
//! client rounded, a frosted panel, a client-drawn shadow.
//!
//! # Why here and not in the page
//!
//! The page could keep the bytes premultiplied by drawing them through WebGL,
//! whose upload can be told to leave them alone. Measured, that bought
//! nothing: 1.3ms a frame against 1.4ms for `putImageData` at 1920x1080. What
//! it cost was a hard dependency on a GPU context per window — a resource the
//! engine rations (Chromium keeps sixteen and evicts the *oldest*), can revoke
//! at any time, and does not have at all where there is no GPU. Measured
//! there: every window blank, silently.
//!
//! So the conversion happens on this side, where it is a lookup per channel on
//! a thread that is not the renderer's only one.
//!
//! # What it costs, honestly
//!
//! **Through a composite, nothing.** The round trip is a fixed point — the
//! byte the page hands its blender is the byte the client committed, which
//! `the_round_trip_through_the_engine_is_a_fixed_point` walks in full. A page
//! that draws these pixels and lets the browser composite them sees no
//! difference from a path that never un-premultiplied.
//!
//! **Precision, anywhere else.** The intermediate straight value is out by up
//! to `127 / a`, so at `a = 1` a channel resolves to one of two values. That
//! error cannot reach a composite — the quantisation step in straight space
//! scales as the inverse of the weight the value is about to be given, which
//! caps its contribution at half a count — but it reaches anything that reads
//! the straight numbers for their own sake: `getImageData` or `toDataURL` on
//! the app's canvas, a CSS filter that works in straight space, a chrome that
//! samples a window's colour for its own UI. Below `a ≈ 17` such a reading is
//! out by eight counts or more.
//!
//! **Time: about 0.8ms to scan a 1080p frame**, and 2.0ms to convert one whose
//! every pixel is translucent (release, measured). The `alpha == 255` skip is
//! what buys the first number — an opaque pixel is one comparison — and after
//! damage tracking most frames are a patch rather than a window: a 256x256
//! region is 23µs opaque, 65µs translucent. A debug build is fifty times
//! slower, which is what every `scripts/e2e-*.sh` runs.

/// `round(c * 255 / a)` for every alpha and channel value, so the inner loop
/// is two indexed loads rather than a divide.
///
/// 64KB, built at compile time. Row zero stays zero: a fully transparent pixel
/// has no colour to recover, and premultiplied it cannot have carried one.
static STRAIGHT: [[u8; 256]; 256] = straight_table();

const fn straight_table() -> [[u8; 256]; 256] {
    let mut table = [[0u8; 256]; 256];
    let mut alpha = 1;
    while alpha < 256 {
        let mut channel = 0;
        while channel < 256 {
            // `+ alpha / 2` rounds to nearest, which is what the engine's own
            // premultiply does — so a value that made the round trip comes
            // back as itself rather than one short.
            let straight = (channel * 255 + alpha / 2) / alpha;
            table[alpha][channel] = if straight > 255 { 255 } else { straight as u8 };
            channel += 1;
        }
        alpha += 1;
    }
    table
}

/// Turn premultiplied RGBA into straight RGBA, in place.
///
/// Whole pixels only: a slice whose length is not a multiple of four has a
/// trailing partial pixel, and there is no channel to convert it against.
/// `chunks_exact_mut` leaves it alone, which is the right answer — the callers
/// pass whole frames.
pub fn to_straight(rgba: &mut [u8]) {
    for pixel in rgba.chunks_exact_mut(4) {
        let alpha = pixel[3];
        // The overwhelmingly common case, and already straight. Skipping it is
        // what keeps an opaque window's cost to a scan.
        if alpha == 255 {
            continue;
        }
        let row = &STRAIGHT[alpha as usize];
        pixel[0] = row[pixel[0] as usize];
        pixel[1] = row[pixel[1] as usize];
        pixel[2] = row[pixel[2] as usize];
    }
}

#[cfg(test)]
mod tests {
    use super::to_straight;

    #[test]
    fn a_channel_brighter_than_its_alpha_is_clamped() {
        // Not reachable from a well-behaved client — premultiplied means
        // `c <= a` — but the arithmetic runs on whatever arrives, and 255 * 255
        // over 1 does not fit in the byte it is written back into.
        let mut rgba = vec![255, 255, 255, 1];

        to_straight(&mut rgba);

        assert_eq!(rgba, vec![255, 255, 255, 1]);
    }

    #[test]
    fn every_pixel_is_converted_not_just_the_first() {
        // The first pixel is the case the whole module exists for:
        // premultiplied, a full red at half alpha is stored as 128, and read
        // as straight alpha by the page it is a half-bright red — over a white
        // backdrop, (191, 127, 127) where it should be (255, 127, 127).
        //
        // Three of them, because a loop that converted one pixel and returned
        // would pass with only the first, and a body that wrote one channel
        // would pass with only red.
        let mut rgba = vec![128, 0, 0, 128, 0, 64, 0, 128, 0, 0, 32, 64];

        to_straight(&mut rgba);

        assert_eq!(rgba, vec![255, 0, 0, 128, 0, 128, 0, 128, 0, 0, 128, 64]);
    }

    #[test]
    fn the_round_trip_through_the_engine_is_a_fixed_point() {
        // The page premultiplies what it is given, rounding to nearest. If
        // this rounded differently the two would disagree by one across the
        // whole picture — a colour cast rather than a visible fault.
        for alpha in 1..=255u32 {
            for channel in 0..=255u32 {
                let premultiplied = (channel * alpha + 127) / 255;
                let mut pixel = vec![premultiplied as u8, 0, 0, alpha as u8];
                to_straight(&mut pixel);
                let back = (u32::from(pixel[0]) * alpha + 127) / 255;
                assert_eq!(
                    back, premultiplied,
                    "alpha {alpha}, channel {channel} did not survive"
                );
            }
        }
    }
}
