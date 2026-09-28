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
/// An empty rectangle is the whole buffer, the engine's own convention and
/// what a surface with no geometry is. A geometry reaching past the surface is
/// clipped to it, as xdg-shell says; one that misses it entirely is not a
/// window at all, and the surface is shown whole rather than as nothing.
pub fn crop(
    geometry: Option<(i32, i32, i32, i32)>,
    surface: (u32, u32),
    buffer: (u32, u32),
) -> (i32, i32, i32, i32) {
    let Some((x, y, width, height)) = geometry else {
        return (0, 0, 0, 0);
    };
    let (surface_width, surface_height) = (surface.0 as i32, surface.1 as i32);
    let (left, top) = (x.max(0), y.max(0));
    let right = x.saturating_add(width).min(surface_width);
    let bottom = y.saturating_add(height).min(surface_height);
    if right <= left || bottom <= top {
        return (0, 0, 0, 0);
    }
    // Per axis, because a viewport can scale the two differently.
    let across = |logical: i32, pixels: u32, units: i32| {
        (f64::from(logical) * f64::from(pixels) / f64::from(units)).round() as i32
    };
    let (x0, y0) = (
        across(left, buffer.0, surface_width),
        across(top, buffer.1, surface_height),
    );
    let (x1, y1) = (
        across(right, buffer.0, surface_width),
        across(bottom, buffer.1, surface_height),
    );
    (x0, y0, x1 - x0, y1 - y0)
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
        assert_eq!(crop(None, (800, 600), (800, 600)), (0, 0, 0, 0));
    }

    #[test]
    fn a_shadow_outside_the_geometry_is_cropped_away() {
        // Bitwarden's shape: a 25-unit shadow on every side of the window.
        assert_eq!(
            crop(Some((25, 25, 800, 600)), (850, 650), (850, 650)),
            (25, 25, 800, 600)
        );
    }

    #[test]
    fn the_crop_is_in_buffer_pixels_whatever_the_scale() {
        // A scale-2 buffer, or one a viewport scales: the geometry is logical
        // and the crop is not.
        assert_eq!(
            crop(Some((25, 25, 800, 600)), (850, 650), (1700, 1300)),
            (50, 50, 1600, 1200)
        );
    }

    #[test]
    fn a_geometry_past_the_surface_is_clipped_to_it() {
        // xdg-shell: "the geometry is clipped to the extents of the surface".
        assert_eq!(
            crop(Some((-10, 20, 900, 600)), (800, 600), (800, 600)),
            (0, 20, 800, 580)
        );
        // And one that misses it is no window: shown whole, not as nothing.
        assert_eq!(
            crop(Some((900, 0, 100, 100)), (800, 600), (800, 600)),
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
