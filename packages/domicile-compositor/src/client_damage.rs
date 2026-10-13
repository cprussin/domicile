//! The bounds of a client's damage, in buffer pixels.

use smithay::wayland::compositor::Damage;

/// A rectangle of a client's buffer, in buffer pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Region {
    fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Region {
            x,
            y,
            width,
            height,
        }
    }
}

/// The bounds of a client's damage since the last commit, clearing it.
///
/// Must take, not borrow: Smithay accumulates damage in the current state until
/// cleared, so reading it would return every rectangle ever reported and the
/// box would grow to the whole window. `pending_damage` tracks damage owed
/// across dropped frames.
pub fn take_damage(damage: &mut Vec<Damage>, buffer_scale: i32) -> Option<Region> {
    damage_bounds(&std::mem::take(damage), buffer_scale)
}

/// The bounding box of a client's damage.
///
/// A box is enough to avoid redrawing a whole window for a cursor blink.
///
/// `Surface` damage is logical and is scaled; `Buffer` damage is already in
/// buffer pixels. Mixing them up leaves stale bands on a HiDPI window.
fn damage_bounds(damage: &[Damage], buffer_scale: i32) -> Option<Region> {
    let scale = buffer_scale.max(1);
    damage
        .iter()
        .map(|reported| match reported {
            // Saturate: clients often send `(0, 0, i32::MAX, i32::MAX)` for
            // "everything". Overflow would panic the Wayland thread in debug
            // builds, or wrap negative and be dropped in release. The result is
            // clamped to the buffer later.
            Damage::Surface(rect) => (
                rect.loc.x.saturating_mul(scale),
                rect.loc.y.saturating_mul(scale),
                rect.size.w.saturating_mul(scale),
                rect.size.h.saturating_mul(scale),
            ),
            Damage::Buffer(rect) => (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h),
        })
        .filter(|(_, _, w, h)| *w > 0 && *h > 0)
        .map(|(x, y, w, h)| (x, y, x.saturating_add(w), y.saturating_add(h)))
        .reduce(|(ax, ay, ar, ab), (bx, by, br, bb)| {
            (ax.min(bx), ay.min(by), ar.max(br), ab.max(bb))
        })
        .map(|(x, y, right, bottom)| {
            // Clip negative offsets; that part is off the buffer.
            let (x, y) = (x.max(0), y.max(0));
            Region::new(
                x as u32,
                y as u32,
                (right - x).max(0) as u32,
                (bottom - y).max(0) as u32,
            )
        })
}

#[cfg(test)]
mod tests {
    use smithay::utils::{Buffer as BufferCoords, Physical, Point, Rectangle, Size};

    use super::{damage_bounds, take_damage, Damage, Region};

    fn buffer(x: i32, y: i32, w: i32, h: i32) -> Damage {
        Damage::Buffer(Rectangle::new(
            Point::<i32, BufferCoords>::from((x, y)),
            Size::<i32, BufferCoords>::from((w, h)),
        ))
    }

    fn surface(x: i32, y: i32, w: i32, h: i32) -> Damage {
        Damage::Surface(Rectangle::new(
            Point::<i32, Physical>::from((x, y)).to_logical(1),
            Size::<i32, Physical>::from((w, h)).to_logical(1),
        ))
    }

    #[test]
    fn taking_the_damage_leaves_none_for_the_next_commit() {
        // Smithay accumulates damage until cleared. Without taking it, the box
        // only grows to the whole window.
        let mut damage = vec![surface(1, 1, 2, 2)];

        let first = take_damage(&mut damage, 1);
        let second = take_damage(&mut damage, 1);

        assert_eq!(first, Some(Region::new(1, 1, 2, 2)));
        assert_eq!(second, None, "the next commit starts from nothing");
    }

    #[test]
    fn nothing_reported_is_no_bounds() {
        assert_eq!(damage_bounds(&[], 1), None);
    }

    #[test]
    fn two_rectangles_become_the_box_around_both() {
        assert_eq!(
            damage_bounds(&[surface(1, 1, 2, 2), surface(10, 5, 1, 1)], 1),
            Some(Region::new(1, 1, 10, 5))
        );
    }

    #[test]
    fn surface_damage_scales_to_buffer_pixels() {
        // Surface damage is logical; unscaled, a HiDPI window keeps a stale
        // band at the right and bottom.
        assert_eq!(
            damage_bounds(&[surface(3, 4, 5, 6)], 2),
            Some(Region::new(6, 8, 10, 12))
        );
    }

    #[test]
    fn a_client_claiming_everything_is_not_multiplied_into_nothing() {
        // `(0, 0, i32::MAX, i32::MAX)` means "everything changed". Scaling it
        // must not overflow: debug builds would panic, release builds would
        // wrap negative and drop it.
        let bounds = damage_bounds(&[surface(0, 0, i32::MAX, i32::MAX)], 2);

        // Saturates at `i32::MAX`. The exact value does not matter; it is
        // clamped to the buffer later.
        assert_eq!(
            bounds,
            Some(Region::new(0, 0, i32::MAX as u32, i32::MAX as u32))
        );
    }

    #[test]
    fn damage_starting_near_the_end_of_the_axis_does_not_wrap() {
        let bounds = damage_bounds(&[surface(i32::MAX - 1, 0, 8, 8)], 1);

        assert_eq!(
            bounds,
            Some(Region::new((i32::MAX - 1) as u32, 0, 1, 8)),
            "the far edge saturates rather than wrapping behind the near one"
        );
    }

    #[test]
    fn a_damage_offset_past_the_scale_saturates_rather_than_folding_back() {
        // Covers the scaled location, which the two tests above do not (one is
        // at scale 1, the other at the origin).
        //
        // Wrapping would put the far rectangle behind the near one, so the box
        // would stop short and leave stale pixels.
        let bounds = damage_bounds(&[surface(0, 0, 4, 4), surface(2_000_000_000, 0, 8, 8)], 2);

        assert_eq!(bounds, Some(Region::new(0, 0, i32::MAX as u32, 16)));
    }

    #[test]
    fn buffer_damage_is_already_in_buffer_pixels() {
        // Most clients use `damage_buffer` (preferred since `wl_compositor`
        // v4). Scaling it would over-damage HiDPI windows.
        assert_eq!(
            damage_bounds(&[buffer(3, 4, 5, 6)], 2),
            Some(Region::new(3, 4, 5, 6))
        );
    }

    #[test]
    fn damage_reaching_off_the_top_left_starts_at_the_corner() {
        assert_eq!(
            damage_bounds(&[surface(-4, -2, 8, 6)], 1),
            Some(Region::new(0, 0, 4, 4))
        );
    }
}
