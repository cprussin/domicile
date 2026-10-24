//! The pointer in a stream: drawn into each frame, sent beside it, or left out.
//!
//! The engine draws the desktop's pointer, so the compositor has no pointer
//! image of its own. Streams draw the one the engine reports
//! (`desk_cursor`), and a built-in arrow until it has.

/// How a stream shows the pointer, as the ScreenCast portal names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CursorMode {
    /// Not shown.
    Hidden,
    /// Drawn into the frame.
    Embedded,
    /// Sent as `SPA_META_Cursor`, for the consumer to draw.
    Metadata,
}

/// What a frame carries for the pointer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    /// Nothing.
    Nothing,
    /// The arrow drawn with its hotspot at `at`, in frame pixels.
    Embed { at: (i32, i32) },
    /// Cursor metadata. `None` says the pointer is off the source.
    Metadata { at: Option<(i32, i32)> },
}

/// What a frame carries for `mode`, with the pointer at `pointer` in frame
/// pixels, or `None` when it is off the source.
pub fn plan(mode: CursorMode, pointer: Option<(f64, f64)>) -> Plan {
    let at = pointer.map(|(x, y)| (x.round() as i32, y.round() as i32));
    match (mode, at) {
        (CursorMode::Hidden, _) | (CursorMode::Embedded, None) => Plan::Nothing,
        (CursorMode::Embedded, Some(at)) => Plan::Embed { at },
        (CursorMode::Metadata, at) => Plan::Metadata { at },
    }
}

/// A premultiplied `Bgra` image with a hotspot. Empty while the pointer is
/// hidden.
#[derive(Clone, Debug, PartialEq)]
pub struct Sprite {
    pub size: (u32, u32),
    pub hotspot: (i32, i32),
    /// Pixels per logical pixel.
    pub scale: f64,
    pub pixels: Vec<u8>,
}

impl Sprite {
    /// The engine's pointer: `bgra` holds `size` premultiplied `Bgra` pixels,
    /// rows top to bottom. `None` when it holds some other number.
    pub fn from_bgra(
        size: (u32, u32),
        hotspot: (i32, i32),
        scale: f64,
        bgra: Vec<u8>,
    ) -> Option<Sprite> {
        let fits = bgra.len() == size.0 as usize * size.1 as usize * 4;
        (fits && scale > 0.0).then_some(Sprite {
            size,
            hotspot,
            scale,
            pixels: bgra,
        })
    }

    /// A hidden pointer, which no stream draws.
    pub fn hidden() -> Sprite {
        Sprite {
            size: (0, 0),
            hotspot: (0, 0),
            scale: 1.0,
            pixels: Vec::new(),
        }
    }

    pub fn is_hidden(&self) -> bool {
        self.size.0 == 0 || self.size.1 == 0
    }
}

/// The built-in arrow: white with a black outline, hotspot at the tip.
pub fn arrow() -> Sprite {
    let rows = ARROW.map(str::as_bytes);
    let pixels = rows
        .iter()
        .flat_map(|row| row.iter())
        .flat_map(|cell| match cell {
            b'B' => [0, 0, 0, 255],
            b'W' => [255, 255, 255, 255],
            _ => [0, 0, 0, 0],
        })
        .collect();
    Sprite {
        size: (rows[0].len() as u32, rows.len() as u32),
        hotspot: (0, 0),
        scale: 1.0,
        pixels,
    }
}

/// `sprite` for a source of `density` frame pixels per logical pixel, so it is
/// the size it is on screen. Never below one frame pixel a logical pixel: a
/// call that scales the stream down would make it a speck.
pub fn at_density(sprite: &Sprite, density: f64) -> Sprite {
    let density = density.max(1.0);
    let mut scaled = resampled(sprite, density / sprite.scale);
    scaled.scale = density;
    scaled
}

/// `sprite` shrunk to at most `most` pixels, for cursor metadata of a fixed
/// size. As it is when it fits.
pub fn within(sprite: &Sprite, most: usize) -> Sprite {
    let mut factor = 1.0;
    loop {
        let fitted = resampled(sprite, factor);
        if fitted.pixels.len() / 4 <= most || fitted.size == (1, 1) {
            return fitted;
        }
        let area = f64::from(fitted.size.0) * f64::from(fitted.size.1);
        // Shrinks at least a little each time round, whatever the rounding.
        factor *= (most as f64 / area).sqrt().min(0.95);
    }
}

/// `sprite` grown or shrunk by `factor`. Each new pixel is the mean of the old
/// pixels under it, which for a whole factor above one is a block of one.
fn resampled(sprite: &Sprite, factor: f64) -> Sprite {
    if sprite.is_hidden() || (factor - 1.0).abs() < 1e-9 {
        return sprite.clone();
    }
    let scale = |length: u32| ((f64::from(length) * factor).round() as u32).max(1);
    let (width, height) = (scale(sprite.size.0), scale(sprite.size.1));
    // The old pixels under new pixel `at` along one axis of `length`.
    let under = |at: u32, length: u32| {
        let from = ((f64::from(at) / factor).floor() as u32).min(length - 1);
        let to = ((f64::from(at + 1) / factor).ceil() as u32).clamp(from + 1, length);
        from..to
    };
    let mut pixels = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let rows = under(y, sprite.size.1);
        for x in 0..width {
            let columns = under(x, sprite.size.0);
            let mut sum = [0u32; 4];
            let mut count = 0;
            for row in rows.clone() {
                for column in columns.clone() {
                    let from = ((row * sprite.size.0 + column) * 4) as usize;
                    for (total, &byte) in sum.iter_mut().zip(&sprite.pixels[from..from + 4]) {
                        *total += u32::from(byte);
                    }
                    count += 1;
                }
            }
            pixels.extend(sum.map(|total| ((total + count / 2) / count) as u8));
        }
    }
    Sprite {
        size: (width, height),
        hotspot: (
            (f64::from(sprite.hotspot.0) * factor).round() as i32,
            (f64::from(sprite.hotspot.1) * factor).round() as i32,
        ),
        scale: sprite.scale * factor,
        pixels,
    }
}

/// [`arrow`], drawn: `B` black, `W` white, `.` clear.
const ARROW: [&str; 19] = [
    "B...........",
    "BB..........",
    "BWB.........",
    "BWWB........",
    "BWWWB.......",
    "BWWWWB......",
    "BWWWWWB.....",
    "BWWWWWWB....",
    "BWWWWWWWB...",
    "BWWWWWWWWB..",
    "BWWWWWWWWWB.",
    "BWWWWWWBBBBB",
    "BWWWBWWB....",
    "BWWB.BWWB...",
    "BWB..BWWB...",
    "BB....BWWB..",
    "B.....BWWB..",
    ".......BWB..",
    "........B...",
];

/// Draws `sprite` over a `Bgra` or `Bgrx` frame with its hotspot at `at`,
/// clipped to the frame.
pub fn embed(frame: &mut [u8], stride: usize, size: (u32, u32), sprite: &Sprite, at: (i32, i32)) {
    let left = at.0 - sprite.hotspot.0;
    let top = at.1 - sprite.hotspot.1;
    for row in 0..sprite.size.1 as i32 {
        for column in 0..sprite.size.0 as i32 {
            let (x, y) = (left + column, top + row);
            if x < 0 || y < 0 || x >= size.0 as i32 || y >= size.1 as i32 {
                continue;
            }
            let from = ((row * sprite.size.0 as i32 + column) * 4) as usize;
            let source = &sprite.pixels[from..from + 4];
            let to = y as usize * stride + x as usize * 4;
            let alpha = u32::from(source[3]);
            for (target, &over) in frame[to..to + 4].iter_mut().zip(source) {
                *target = (u32::from(over) + u32::from(*target) * (255 - alpha) / 255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{arrow, at_density, embed, plan, within, CursorMode, Plan, Sprite};

    const OPAQUE_RED: [u8; 4] = [0, 0, 255, 255];
    const CLEAR: [u8; 4] = [0, 0, 0, 0];
    const HALF_WHITE: [u8; 4] = [128, 128, 128, 128];

    /// A 2x2 sprite: opaque red, clear, half white, opaque red. Hotspot at its
    /// second column.
    fn sprite() -> Sprite {
        Sprite {
            size: (2, 2),
            hotspot: (1, 0),
            scale: 1.0,
            pixels: [OPAQUE_RED, CLEAR, HALF_WHITE, OPAQUE_RED].concat(),
        }
    }

    /// A 3x3 frame of one gray, four bytes a pixel and no padding.
    fn frame() -> Vec<u8> {
        [[100, 100, 100, 255]; 9].concat()
    }

    fn pixel(frame: &[u8], x: usize, y: usize) -> [u8; 4] {
        let at = (y * 3 + x) * 4;
        frame[at..at + 4].try_into().expect("four bytes")
    }

    #[test]
    fn a_hidden_pointer_is_never_shown() {
        assert_eq!(plan(CursorMode::Hidden, Some((5.0, 5.0))), Plan::Nothing);
    }

    #[test]
    fn an_embedded_pointer_is_drawn_only_over_the_source() {
        assert_eq!(
            plan(CursorMode::Embedded, Some((5.4, 6.6))),
            Plan::Embed { at: (5, 7) }
        );
        assert_eq!(plan(CursorMode::Embedded, None), Plan::Nothing);
    }

    #[test]
    fn metadata_says_where_the_pointer_is_and_when_it_left() {
        assert_eq!(
            plan(CursorMode::Metadata, Some((5.0, 6.0))),
            Plan::Metadata { at: Some((5, 6)) }
        );
        assert_eq!(
            plan(CursorMode::Metadata, None),
            Plan::Metadata { at: None }
        );
    }

    #[test]
    fn the_sprite_is_blended_at_its_hotspot() {
        let mut frame = frame();

        embed(&mut frame, 12, (3, 3), &sprite(), (2, 1));

        // The hotspot is the sprite's (1, 0), so its top left lands at (1, 1).
        assert_eq!(pixel(&frame, 1, 1), OPAQUE_RED);
        assert_eq!(pixel(&frame, 2, 1), [100, 100, 100, 255]);
        // Half white over gray: 128 + 100 * (255 - 128) / 255.
        assert_eq!(pixel(&frame, 1, 2), [177, 177, 177, 255]);
        assert_eq!(pixel(&frame, 2, 2), OPAQUE_RED);
        assert_eq!(pixel(&frame, 0, 0), [100, 100, 100, 255]);
    }

    #[test]
    fn a_sprite_past_the_edge_is_clipped() {
        let mut frame = frame();

        embed(&mut frame, 12, (3, 3), &sprite(), (0, -1));

        // Only the sprite's bottom right lands, at (0, 0).
        assert_eq!(pixel(&frame, 0, 0), OPAQUE_RED);
        assert_eq!(frame[4..], self::frame()[4..]);
    }

    #[test]
    fn the_arrow_is_hot_at_its_opaque_tip() {
        let arrow = arrow();
        let (width, height) = arrow.size;

        assert_eq!(arrow.hotspot, (0, 0));
        assert_eq!(arrow.pixels.len(), (width * height * 4) as usize);
        assert_eq!(arrow.pixels[3], 255);
    }

    #[test]
    fn the_sprite_is_as_dense_as_its_source() {
        let dense = at_density(&sprite(), 2.0);

        // Each pixel becomes a 2x2 block.
        assert_eq!(dense.size, (4, 4));
        assert_eq!(dense.hotspot, (2, 0));
        assert_eq!(dense.scale, 2.0);
        let pixel = |x: usize, y: usize| -> [u8; 4] {
            let at = (y * 4 + x) * 4;
            dense.pixels[at..at + 4].try_into().expect("four bytes")
        };
        assert_eq!(pixel(1, 1), OPAQUE_RED);
        assert_eq!(pixel(2, 0), CLEAR);
        assert_eq!(pixel(1, 2), HALF_WHITE);
        assert_eq!(pixel(3, 3), OPAQUE_RED);
    }

    /// A pointer the engine drew for a 2x screen is half as many pixels in a
    /// 1x stream, and the same in a 2x one.
    #[test]
    fn a_dense_pointer_is_its_size_on_screen_in_any_stream() {
        let dense = Sprite {
            scale: 2.0,
            ..at_density(&sprite(), 2.0)
        };

        let sparse = at_density(&dense, 1.0);
        assert_eq!(sparse.size, (2, 2));
        assert_eq!(sparse.hotspot, (1, 0));
        assert_eq!(sparse.pixels, sprite().pixels);
        assert_eq!(at_density(&dense, 2.0), dense);

        let between = at_density(&dense, 1.5);
        assert_eq!(between.size, (3, 3));
        assert_eq!(between.hotspot, (2, 0));
    }

    #[test]
    fn a_sparse_source_keeps_the_sprite_as_drawn() {
        assert_eq!(at_density(&sprite(), 1.0), sprite());
        assert_eq!(at_density(&sprite(), 0.5), sprite());
    }

    /// Cursor metadata has the room its consumer asked for, as WebRTC asks
    /// for 64x64.
    #[test]
    fn a_pointer_too_big_for_the_metadata_is_shrunk_into_it() {
        let big = at_density(&sprite(), 40.0);
        assert_eq!(big.size, (80, 80));

        let fitted = within(&big, 64 * 64);

        assert!(
            fitted.size.0 * fitted.size.1 <= 64 * 64,
            "{:?}",
            fitted.size
        );
        assert!(fitted.size.0 >= 60, "{:?}", fitted.size);
        assert_eq!(within(&sprite(), 64 * 64), sprite());
    }

    #[test]
    fn the_engines_pointer_is_whole_pixels() {
        assert_eq!(
            Sprite::from_bgra((2, 2), (1, 0), 1.0, sprite().pixels),
            Some(sprite())
        );
        assert_eq!(Sprite::from_bgra((2, 2), (1, 0), 1.0, vec![0; 12]), None);
        assert!(Sprite::hidden().is_hidden());
        assert!(!sprite().is_hidden());
    }
}
