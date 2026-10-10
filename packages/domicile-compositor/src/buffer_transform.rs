//! Sizes and crops for a buffer drawn with `wl_surface.set_buffer_transform`.
//!
//! A client may draw its buffer turned to match a rotated monitor. The engine
//! turns it upright (`domicile_surface_submit_transformed`); the compositor
//! sizes the surface by the upright buffer and crops in the buffer's own
//! pixels.

use smithay::utils::Transform;

/// The part of a buffer a frame shows, and the turn that makes it upright.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Sampled {
    /// In the buffer's own pixels. `(0, 0, 0, 0)` means the whole buffer.
    pub crop: (i32, i32, i32, i32),
    pub transform: Transform,
}

/// The size of `buffer` once turned upright: a quarter turn swaps its sides.
pub fn upright_size(buffer: (u32, u32), transform: Transform) -> (u32, u32) {
    if quarter_turned(transform) {
        (buffer.1, buffer.0)
    } else {
        buffer
    }
}

/// Maps `crop`, in the pixels of the upright buffer `upright` big, to the
/// buffer's own pixels.
///
/// `(0, 0, 0, 0)`, the whole buffer, stays whole.
pub fn crop_in_buffer(
    crop: (i32, i32, i32, i32),
    upright: (u32, u32),
    transform: Transform,
) -> (i32, i32, i32, i32) {
    if crop == (0, 0, 0, 0) {
        return crop;
    }
    let (x, y, width, height) = crop;
    let (x0, y0) = buffer_point((x, y), upright, transform);
    let (x1, y1) = buffer_point((x + width, y + height), upright, transform);
    (x0.min(x1), y0.min(y1), (x1 - x0).abs(), (y1 - y0).abs())
}

/// Whether `transform` turns the buffer onto its side.
fn quarter_turned(transform: Transform) -> bool {
    matches!(
        transform,
        Transform::_90 | Transform::_270 | Transform::Flipped90 | Transform::Flipped270
    )
}

/// Maps a point of the upright buffer, `upright` big, into the buffer, as
/// Weston's `weston_transformed_coord` does.
fn buffer_point(point: (i32, i32), upright: (u32, u32), transform: Transform) -> (i32, i32) {
    let (x, y) = point;
    let (width, height) = (upright.0 as i32, upright.1 as i32);
    match transform {
        Transform::Normal => (x, y),
        Transform::_90 => (height - y, x),
        Transform::_180 => (width - x, height - y),
        Transform::_270 => (y, width - x),
        Transform::Flipped => (width - x, y),
        Transform::Flipped90 => (height - y, width - x),
        Transform::Flipped180 => (x, height - y),
        Transform::Flipped270 => (y, x),
    }
}

#[cfg(test)]
mod tests {
    use super::{crop_in_buffer, upright_size};
    use smithay::utils::Transform;

    #[test]
    fn a_quarter_turn_swaps_the_buffers_sides_and_a_half_turn_does_not() {
        assert_eq!(upright_size((300, 400), Transform::_90), (400, 300));
        assert_eq!(upright_size((300, 400), Transform::Flipped270), (400, 300));
        assert_eq!(upright_size((300, 400), Transform::_180), (300, 400));
        assert_eq!(upright_size((300, 400), Transform::Flipped), (300, 400));
    }

    #[test]
    fn a_crop_lands_where_wayland_maps_a_surface_point_into_the_buffer() {
        // Weston's `weston_transformed_coord`: for a quarter turn, surface
        // point (x, y) is buffer point (height - y, x).
        assert_eq!(
            crop_in_buffer((10, 20, 100, 50), (400, 300), Transform::_90),
            (230, 10, 50, 100)
        );
        // Flipped: (x, y) is (width - x, y).
        assert_eq!(
            crop_in_buffer((10, 20, 100, 50), (400, 300), Transform::Flipped),
            (290, 20, 100, 50)
        );
        assert_eq!(
            crop_in_buffer((10, 20, 100, 50), (400, 300), Transform::Normal),
            (10, 20, 100, 50)
        );
    }

    #[test]
    fn the_whole_buffer_stays_whole_whatever_the_turn() {
        assert_eq!(
            crop_in_buffer((0, 0, 0, 0), (400, 300), Transform::_270),
            (0, 0, 0, 0)
        );
    }
}
