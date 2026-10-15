//! Surface size and buffer crop from a `wp_viewport`.
//!
//! With `wp_viewporter` advertised, Chromium stops setting a buffer scale and
//! sends its logical size through `set_destination`. Both destination and
//! source must be honored: ignoring `set_source` would draw a whole atlas
//! where the client asked for one tile.
//!
//! Without a destination the surface is the source's size, so a source alone
//! crops without scaling.

use smithay::wayland::viewporter::ViewportCachedState;

/// A surface's `wp_viewport` state, or the default where it has none.
///
/// Read at commit: viewport state is double-buffered and applies to the buffer
/// committed with it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Viewport {
    /// The surface's logical size, overriding the buffer's: the destination,
    /// or else the source's size.
    pub size: Option<(i32, i32)>,
    /// The part of the buffer shown, as `(x, y, width, height)` in buffer
    /// logical units.
    pub source: Option<(f64, f64, f64, f64)>,
}

impl From<&ViewportCachedState> for Viewport {
    fn from(state: &ViewportCachedState) -> Self {
        Viewport {
            size: state.size().map(|size| (size.w, size.h)),
            source: state
                .src
                .map(|rect| (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h)),
        }
    }
}

/// The logical size of a surface with a `buffer`-pixel buffer at
/// `buffer_scale` and an optional viewport `size` (see [`Viewport::size`]).
///
/// A viewport size is already logical, so it is not divided by the scale. A
/// non-positive one is ignored, since later code divides by it.
pub fn surface_size(buffer: (u32, u32), buffer_scale: i32, size: Option<(i32, i32)>) -> (u32, u32) {
    if let Some((width, height)) = size {
        if let (Ok(width), Ok(height)) = (u32::try_from(width), u32::try_from(height)) {
            if width > 0 && height > 0 {
                return (width, height);
            }
        }
    }
    crate::scale::logical_size(buffer, buffer_scale)
}

/// The viewport `source` in buffer pixels, or `None` where there is none.
///
/// Chromium uses it mid-resize to mark the valid part of an oversized buffer.
/// An empty source or one past the buffer edge is a protocol error and is
/// ignored.
pub fn source_pixels(
    buffer: (u32, u32),
    buffer_scale: i32,
    source: Option<(f64, f64, f64, f64)>,
) -> Option<(f64, f64, f64, f64)> {
    let scale = f64::from(buffer_scale.max(1));
    let (x, y, width, height) = source?;
    let (x, y, width, height) = (x * scale, y * scale, width * scale, height * scale);
    let fits = |start: f64, length: f64, pixels: u32| {
        start >= 0.0 && length > 0.0 && start + length <= f64::from(pixels)
    };
    (fits(x, width, buffer.0) && fits(y, height, buffer.1)).then_some((x, y, width, height))
}

#[cfg(test)]
mod tests {
    use smithay::utils::Rectangle;
    use smithay::wayland::viewporter::ViewportCachedState;

    use super::{source_pixels, surface_size, Viewport};

    #[test]
    fn a_source_without_a_destination_sizes_the_surface() {
        // The protocol makes a source-only surface the source's size. A
        // 1536-pixel buffer cropped to 636 must not be squeezed into 636.
        let viewport = Viewport::from(&ViewportCachedState {
            src: Some(Rectangle::new((0.0, 0.0).into(), (636.0, 754.0).into())),
            dst: None,
        });

        assert_eq!(surface_size((1536, 754), 1, viewport.size), (636, 754));
    }

    #[test]
    fn a_destination_sizes_the_surface_over_its_source() {
        let viewport = Viewport::from(&ViewportCachedState {
            src: Some(Rectangle::new((16.0, 8.0).into(), (800.0, 600.0).into())),
            dst: Some((400, 300).into()),
        });

        assert_eq!(surface_size((1536, 1024), 2, viewport.size), (400, 300));
    }

    #[test]
    fn a_surface_with_no_viewport_is_its_buffer_over_its_scale() {
        // Most clients set no viewport; this must match
        // `scale::logical_size`.
        assert_eq!(surface_size((2560, 1600), 2, None), (1280, 800));
        assert_eq!(surface_size((800, 600), 1, None), (800, 600));
    }

    #[test]
    fn a_destination_is_the_surfaces_size_whatever_the_buffer_is() {
        // Chromium commits 2560x1600 at buffer scale 1 with a 1280x800
        // destination.
        assert_eq!(
            surface_size((2560, 1600), 1, Some((1280, 800))),
            (1280, 800)
        );
        // A destination is already logical, so the scale does not apply.
        assert_eq!(
            surface_size((2560, 1600), 2, Some((1280, 800))),
            (1280, 800)
        );
    }

    #[test]
    fn a_destination_of_nothing_is_refused_rather_than_believed() {
        // The protocol forbids these, and a zero would divide by zero later.
        assert_eq!(surface_size((800, 600), 1, Some((0, 0))), (800, 600));
        assert_eq!(surface_size((800, 600), 1, Some((-4, 300))), (800, 600));
    }

    #[test]
    fn a_source_is_in_the_buffers_pixels_once_scaled() {
        // Source is in buffer logical units, so scale 2 doubles it.
        assert_eq!(
            source_pixels((1000, 800), 2, Some((10.0, 20.0, 400.0, 300.0))),
            Some((20.0, 40.0, 800.0, 600.0))
        );
        assert_eq!(source_pixels((1000, 800), 1, None), None);
    }

    #[test]
    fn a_source_the_buffer_cannot_supply_is_refused_rather_than_believed() {
        // Empty, or past the buffer: both are protocol errors.
        assert_eq!(
            source_pixels((1000, 800), 1, Some((0.0, 0.0, 0.0, 300.0))),
            None
        );
        assert_eq!(
            source_pixels((1000, 800), 1, Some((600.0, 0.0, 500.0, 300.0))),
            None
        );
        assert_eq!(
            source_pixels((1000, 800), 1, Some((-1.0, 0.0, 500.0, 300.0))),
            None
        );
    }
}
