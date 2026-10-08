//! Crop and pointer offset from `xdg_surface.set_window_geometry`.
//!
//! Clients with client-side decorations (Electron, GTK) draw shadows outside
//! the window geometry. The `<app>` element's box is the geometry, so the
//! shadow is cropped away and pointer coordinates are offset by its origin.

/// The engine's crop for a surface, as `(x, y, width, height)` in buffer
/// pixels. `(0, 0, 0, 0)` means the whole buffer.
///
/// - The crop is at most `configured`, the size of the configure the commit
///   answers. The engine stretches the crop over that configure's box, so a
///   window larger than its box is cut off, not squeezed.
/// - `source` is the viewport's source in buffer pixels (see
///   `viewport::source_pixels`); without one the surface maps to the whole
///   buffer.
/// - A geometry past the surface is clipped, per xdg-shell. One entirely
///   outside it is ignored, so the surface shows whole.
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

/// Maps a point in the `<app>` element's box to surface coordinates.
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
        // Bitwarden: a 25-unit shadow on every side.
        assert_eq!(
            crop(Some((25, 25, 800, 600)), None, (850, 650), (850, 650), None),
            (25, 25, 800, 600)
        );
    }

    #[test]
    fn the_crop_is_in_buffer_pixels_whatever_the_scale() {
        // The geometry is logical; the crop is in buffer pixels.
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
        // A geometry entirely outside the surface shows it whole.
        assert_eq!(
            crop(Some((900, 0, 100, 100)), None, (800, 600), (800, 600), None),
            (0, 0, 0, 0)
        );
    }

    #[test]
    fn a_window_larger_than_its_box_is_cropped_to_the_box_not_squeezed_into_it() {
        // Bitwarden's minimum is 680x500, so a 640x420 box gets a 680x500
        // frame. Cropping cuts it off at the box edge instead of warping it.
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
        // Chromium mid-resize: an oversized buffer whose valid part is named
        // by `set_source`.
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
        // A geometry is relative to the source's origin, at its scale.
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
