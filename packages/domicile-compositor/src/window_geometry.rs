//! What `xdg_surface.set_window_geometry` says about the surface it is set on.
//!
//! A client that draws its own shadows — Electron, GTK, anything with
//! client-side decorations — commits a buffer larger than its window and says
//! which part of it is the window. The `<app>` element's box is that part, so
//! the rest is not shown and a pointer over the box is over the window, not
//! over the shadow's top-left corner. Ignoring it draws the shadow as dead
//! space inside the box and lands every click off by the shadow's width.

/// The part of a `buffer`-pixel buffer, on a surface `surface` logical units
/// across, that `geometry` names — as `(x, y, width, height)` in the buffer's
/// pixels, which is what the engine crops by.
///
/// No larger than `configured`, the logical size the client was last told its
/// box is. The engine stretches whatever it is given over the whole box, so a
/// window that will not go that small — a minimum size, or a frame drawn
/// before it caught up with a shrink — is cut off at the box's edge rather
/// than squeezed into it. A window smaller than its box is still stretched:
/// a crop cannot add pixels.
///
/// The surface is `source` of the buffer, in its pixels, where a viewport
/// names one — see `viewport::source_pixels` — and the whole buffer where not.
///
/// An empty rectangle is the whole buffer, the engine's own convention and
/// what a surface with no geometry is. A geometry reaching past the surface is
/// clipped to it, as xdg-shell says; one that misses it entirely is not a
/// window at all, and the surface is shown whole rather than as nothing.
pub fn crop(
    geometry: Option<(i32, i32, i32, i32)>,
    configured: Option<(i32, i32)>,
    surface: (u32, u32),
    buffer: (u32, u32),
    source: Option<(f64, f64, f64, f64)>,
) -> (i32, i32, i32, i32) {
    let (surface_width, surface_height) = (surface.0 as i32, surface.1 as i32);
    let (x, y, width, height) = geometry.unwrap_or((0, 0, surface_width, surface_height));
    let (width, height) = configured.map_or((width, height), |(most_across, most_down)| {
        (width.min(most_across), height.min(most_down))
    });
    let (left, top) = (x.max(0), y.max(0));
    let right = x.saturating_add(width).min(surface_width);
    let bottom = y.saturating_add(height).min(surface_height);
    let (source_x, source_y, source_width, source_height) =
        source.unwrap_or((0.0, 0.0, f64::from(buffer.0), f64::from(buffer.1)));
    let (left, top, right, bottom) = if right <= left || bottom <= top {
        (0, 0, surface_width, surface_height)
    } else {
        (left, top, right, bottom)
    };
    // Per axis, because a viewport can scale the two differently.
    let across = |logical: i32, origin: f64, pixels: f64, units: i32| {
        (origin + f64::from(logical) * pixels / f64::from(units)).round() as i32
    };
    let (x0, y0) = (
        across(left, source_x, source_width, surface_width),
        across(top, source_y, source_height, surface_height),
    );
    let (x1, y1) = (
        across(right, source_x, source_width, surface_width),
        across(bottom, source_y, source_height, surface_height),
    );
    let whole = (x0, y0, x1, y1) == (0, 0, buffer.0 as i32, buffer.1 as i32);
    if whole {
        (0, 0, 0, 0)
    } else {
        (x0, y0, x1 - x0, y1 - y0)
    }
}

/// Where a point `(x, y)` in the `<app>` element's box is on the surface: the
/// box is the window geometry, so its origin is the geometry's.
pub fn surface_point(geometry: Option<(i32, i32, i32, i32)>, point: (f64, f64)) -> (f64, f64) {
    let (x, y, _, _) = geometry.unwrap_or_default();
    (point.0 + f64::from(x), point.1 + f64::from(y))
}

#[cfg(test)]
mod tests {
    use super::{crop, surface_point};

    #[test]
    fn a_surface_with_no_geometry_is_shown_whole() {
        assert_eq!(crop(None, None, (800, 600), (800, 600), None), (0, 0, 0, 0));
    }

    #[test]
    fn a_shadow_outside_the_geometry_is_cropped_away() {
        // Bitwarden's shape: a 25-unit shadow on every side of the window.
        assert_eq!(
            crop(Some((25, 25, 800, 600)), None, (850, 650), (850, 650), None),
            (25, 25, 800, 600)
        );
    }

    #[test]
    fn the_crop_is_in_buffer_pixels_whatever_the_scale() {
        // A scale-2 buffer, or one a viewport scales: the geometry is logical
        // and the crop is not.
        assert_eq!(
            crop(
                Some((25, 25, 800, 600)),
                None,
                (850, 650),
                (1700, 1300),
                None
            ),
            (50, 50, 1600, 1200)
        );
    }

    #[test]
    fn a_geometry_past_the_surface_is_clipped_to_it() {
        // xdg-shell: "the geometry is clipped to the extents of the surface".
        assert_eq!(
            crop(
                Some((-10, 20, 900, 600)),
                None,
                (800, 600),
                (800, 600),
                None
            ),
            (0, 20, 800, 580)
        );
        // And one that misses it is no window: shown whole, not as nothing.
        assert_eq!(
            crop(Some((900, 0, 100, 100)), None, (800, 600), (800, 600), None),
            (0, 0, 0, 0)
        );
    }

    #[test]
    fn a_window_larger_than_its_box_is_cropped_to_the_box_not_squeezed_into_it() {
        // Bitwarden's shape: it will not go below 680x500, so a 640x420 box
        // gets a 680x500 frame. Squeezed, the window warps; cropped, it is
        // cut off at the box's edge, as on any other desktop.
        assert_eq!(
            crop(None, Some((640, 420)), (680, 500), (680, 500), None),
            (0, 0, 640, 420)
        );
        // From the geometry's origin, in the buffer's pixels.
        assert_eq!(
            crop(
                Some((25, 25, 680, 500)),
                Some((640, 420)),
                (730, 550),
                (1460, 1100),
                None
            ),
            (50, 50, 1280, 840)
        );
        // A box the window fits in crops nothing.
        assert_eq!(
            crop(None, Some((1000, 1000)), (800, 600), (800, 600), None),
            (0, 0, 0, 0)
        );
    }

    #[test]
    fn a_viewport_source_is_the_part_of_the_buffer_the_surface_is() {
        // Chromium mid-resize: it keeps drawing into the buffer it had,
        // oversized, and names the valid part with `set_source`. The rest is
        // stale, so it is not shown, and the surface maps onto the part.
        assert_eq!(
            crop(
                None,
                Some((1008, 709)),
                (1008, 709),
                (2304, 1536),
                Some((0.0, 0.0, 2016.0, 1418.0))
            ),
            (0, 0, 2016, 1418)
        );
        // A geometry inside it is from the source's origin, at its scale.
        assert_eq!(
            crop(
                Some((10, 10, 400, 300)),
                None,
                (420, 320),
                (1000, 1000),
                Some((100.0, 50.0, 840.0, 640.0))
            ),
            (120, 70, 800, 600)
        );
        // A source that is the whole buffer crops nothing.
        assert_eq!(
            crop(
                None,
                None,
                (400, 300),
                (800, 600),
                Some((0.0, 0.0, 800.0, 600.0))
            ),
            (0, 0, 0, 0)
        );
    }

    #[test]
    fn a_point_in_the_box_is_offset_by_the_geometrys_origin() {
        assert_eq!(
            surface_point(Some((25, 25, 800, 600)), (10.0, 5.5)),
            (35.0, 30.5)
        );
        assert_eq!(surface_point(None, (10.0, 5.5)), (10.0, 5.5));
    }
}
