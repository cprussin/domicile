//! Where a monitor or region stream's pixels come from.
//!
//! A stream shows a rectangle of the desktop. Each monitor it touches is a
//! piece, drawn from that monitor's captured frames. A stream has one scale,
//! so it takes the highest density it touches, and lower-density monitors are
//! scaled up. See `docs/PORTALS.md`.

use crate::casting::pacing::Rect;

/// A monitor, as a stream source sees it.
#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    /// Its `wl_output` name, which a monitor source names.
    pub name: String,
    /// The engine's display id, which names its capture.
    pub display: i64,
    /// Where it is on the desktop, in logical pixels.
    pub desk: Rect,
    /// Device pixels per logical pixel.
    pub scale: f64,
    /// Whether it is unrotated. A rotated monitor's frames are turned, which
    /// streams do not undo.
    pub upright: bool,
}

/// A stream's size and pieces.
#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    /// In stream pixels.
    pub size: (u32, u32),
    pub pieces: Vec<Piece>,
}

/// The part of a stream one monitor fills.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Piece {
    pub display: i64,
    /// The part of the monitor, in logical pixels from its corner.
    pub from: Rect,
    /// Where it goes, in stream pixels.
    pub to: Rect,
}

/// Why a rectangle cannot be streamed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum LayoutError {
    #[error("the rectangle is on no monitor")]
    Offscreen,
    #[error("the rectangle is on a rotated monitor, which is not cast yet")]
    Rotated,
}

/// The stream of `target`, a rectangle of the desktop in logical pixels.
pub fn layout(target: Rect, screens: &[Screen]) -> Result<Layout, LayoutError> {
    let touched: Vec<(&Screen, Rect)> = screens
        .iter()
        .filter_map(|screen| Some((screen, intersection(target, screen.desk)?)))
        .collect();
    if touched.iter().any(|(screen, _)| !screen.upright) {
        return Err(LayoutError::Rotated);
    }
    let scale = touched
        .iter()
        .map(|(screen, _)| screen.scale)
        .reduce(f64::max)
        .ok_or(LayoutError::Offscreen)?;
    let pixels = |logical: i32| (f64::from(logical) * scale).round() as i32;
    let pieces = touched
        .iter()
        .map(|(screen, part)| {
            let (left, top) = (part.0 - target.0, part.1 - target.1);
            Piece {
                display: screen.display,
                from: (
                    part.0 - screen.desk.0,
                    part.1 - screen.desk.1,
                    part.2,
                    part.3,
                ),
                to: (
                    pixels(left),
                    pixels(top),
                    pixels(left + part.2) - pixels(left),
                    pixels(top + part.3) - pixels(top),
                ),
            }
        })
        .collect();
    Ok(Layout {
        size: (pixels(target.2) as u32, pixels(target.3) as u32),
        pieces,
    })
}

/// `from`, logical pixels of a monitor `logical` big, in a frame whose
/// `content` shows that monitor.
pub fn in_frame(from: Rect, logical: (i32, i32), content: Rect) -> Rect {
    let (x_scale, y_scale) = frame_scale(logical, content);
    let left = content.0 + (f64::from(from.0) * x_scale).round() as i32;
    let top = content.1 + (f64::from(from.1) * y_scale).round() as i32;
    let right = content.0 + (f64::from(from.0 + from.2) * x_scale).round() as i32;
    let bottom = content.1 + (f64::from(from.1 + from.3) * y_scale).round() as i32;
    (left, top, right - left, bottom - top)
}

/// The part of `piece` that `damage`, in frame pixels, touches, in stream
/// pixels. `None` when it misses the piece.
pub fn damage_in_stream(
    piece: &Piece,
    logical: (i32, i32),
    content: Rect,
    damage: Rect,
) -> Option<Rect> {
    let (x_scale, y_scale) = frame_scale(logical, content);
    // Out to whole logical pixels, so a partly damaged pixel is redrawn.
    let left = (f64::from(damage.0 - content.0) / x_scale).floor() as i32;
    let top = (f64::from(damage.1 - content.1) / y_scale).floor() as i32;
    let right = (f64::from(damage.0 + damage.2 - content.0) / x_scale).ceil() as i32;
    let bottom = (f64::from(damage.1 + damage.3 - content.1) / y_scale).ceil() as i32;
    let hit = intersection((left, top, right - left, bottom - top), piece.from)?;
    let x_out = f64::from(piece.to.2) / f64::from(piece.from.2);
    let y_out = f64::from(piece.to.3) / f64::from(piece.from.3);
    let out_left = piece.to.0 + (f64::from(hit.0 - piece.from.0) * x_out).floor() as i32;
    let out_top = piece.to.1 + (f64::from(hit.1 - piece.from.1) * y_out).floor() as i32;
    let out_right = piece.to.0 + (f64::from(hit.0 + hit.2 - piece.from.0) * x_out).ceil() as i32;
    let out_bottom = piece.to.1 + (f64::from(hit.1 + hit.3 - piece.from.1) * y_out).ceil() as i32;
    Some((
        out_left,
        out_top,
        out_right - out_left,
        out_bottom - out_top,
    ))
}

/// Frame pixels per logical pixel, across and down.
fn frame_scale(logical: (i32, i32), content: Rect) -> (f64, f64) {
    (
        f64::from(content.2) / f64::from(logical.0),
        f64::from(content.3) / f64::from(logical.1),
    )
}

/// The overlap of `a` and `b`, or `None` if they do not overlap.
pub fn intersection(a: Rect, b: Rect) -> Option<Rect> {
    let left = a.0.max(b.0);
    let top = a.1.max(b.1);
    let right = (a.0 + a.2).min(b.0 + b.2);
    let bottom = (a.1 + a.3).min(b.1 + b.3);
    (right > left && bottom > top).then_some((left, top, right - left, bottom - top))
}

#[cfg(test)]
mod tests {
    use super::{damage_in_stream, in_frame, layout, Layout, LayoutError, Piece, Screen};

    /// A 1920x1080 monitor at 1x, and a 2560x1600 one at 2x to its right.
    fn desk() -> [Screen; 2] {
        [
            Screen {
                name: "drm-1".into(),
                display: 1,
                desk: (0, 0, 1920, 1080),
                scale: 1.0,
                upright: true,
            },
            Screen {
                name: "drm-2".into(),
                display: 2,
                desk: (1920, 0, 1280, 800),
                scale: 2.0,
                upright: true,
            },
        ]
    }

    #[test]
    fn a_monitor_is_one_piece_at_its_own_density() {
        assert_eq!(
            layout((1920, 0, 1280, 800), &desk()),
            Ok(Layout {
                size: (2560, 1600),
                pieces: vec![Piece {
                    display: 2,
                    from: (0, 0, 1280, 800),
                    to: (0, 0, 2560, 1600),
                }],
            })
        );
    }

    #[test]
    fn a_region_across_monitors_takes_the_highest_density() {
        assert_eq!(
            layout((1800, 100, 240, 100), &desk()),
            Ok(Layout {
                size: (480, 200),
                pieces: vec![
                    Piece {
                        display: 1,
                        from: (1800, 100, 120, 100),
                        to: (0, 0, 240, 200),
                    },
                    Piece {
                        display: 2,
                        from: (0, 100, 120, 100),
                        to: (240, 0, 240, 200),
                    },
                ],
            })
        );
    }

    #[test]
    fn a_region_on_no_monitor_is_refused() {
        assert_eq!(
            layout((0, 2000, 100, 100), &desk()),
            Err(LayoutError::Offscreen)
        );
    }

    #[test]
    fn a_region_on_a_rotated_monitor_is_refused() {
        let mut desk = desk();
        desk[1].upright = false;

        assert_eq!(
            layout((1800, 100, 240, 100), &desk),
            Err(LayoutError::Rotated)
        );
        assert!(layout((0, 0, 100, 100), &desk).is_ok());
    }

    #[test]
    fn a_monitors_part_is_found_inside_the_letterbox() {
        // A 1280x800 monitor captured into 1000x1000, letterboxed to 1000x625.
        assert_eq!(
            in_frame((640, 400, 640, 400), (1280, 800), (0, 187, 1000, 625)),
            (500, 500, 500, 312)
        );
    }

    #[test]
    fn frame_damage_lands_where_its_piece_is_drawn() {
        let piece = Piece {
            display: 2,
            from: (0, 100, 120, 100),
            to: (240, 0, 240, 200),
        };

        // Frame pixels (10, 220) to (30, 240) are logical (5, 110) to (15, 120).
        assert_eq!(
            damage_in_stream(&piece, (1280, 800), (0, 0, 2560, 1600), (10, 220, 20, 20)),
            Some((250, 20, 20, 20))
        );
        assert_eq!(
            damage_in_stream(&piece, (1280, 800), (0, 0, 2560, 1600), (0, 1000, 20, 20)),
            None
        );
    }
}
