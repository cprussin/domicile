//! The pointer in a stream: drawn into each frame, sent beside it, or left out.
//!
//! The engine draws the desktop's pointer from its own theme, so the
//! compositor has no pointer image. Streams use a built-in arrow.

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

/// A premultiplied `Bgra` image with a hotspot.
#[derive(Debug, PartialEq, Eq)]
pub struct Sprite {
    pub size: (u32, u32),
    pub hotspot: (i32, i32),
    pub pixels: Vec<u8>,
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
    use super::{arrow, embed, plan, CursorMode, Plan, Sprite};

    const OPAQUE_RED: [u8; 4] = [0, 0, 255, 255];
    const CLEAR: [u8; 4] = [0, 0, 0, 0];
    const HALF_WHITE: [u8; 4] = [128, 128, 128, 128];

    /// A 2x2 sprite: opaque red, clear, half white, opaque red. Hotspot at its
    /// second column.
    fn sprite() -> Sprite {
        Sprite {
            size: (2, 2),
            hotspot: (1, 0),
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
}
