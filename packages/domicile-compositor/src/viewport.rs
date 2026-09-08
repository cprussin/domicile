//! What a `wp_viewport` says about the surface it is set on.
//!
//! A client with a viewport states its surface's size and which part of its
//! buffer fills it, instead of both being the buffer's own. Chromium takes the
//! global as permission to do exactly that: with `wp_viewporter` advertised it
//! stops calling `wl_surface.set_buffer_scale` and puts the logical size in
//! `wp_viewport.set_destination`. A compositor that advertises the global and
//! reads only the buffer therefore draws every such surface at the wrong size —
//! which is what happened here, and why this exists before the global goes back.
//!
//! Both halves or neither. A destination without a source crop is still a
//! promise half kept: a client that sends `set_source` to show one tile of an
//! atlas would have the whole atlas drawn, stretched. The arithmetic for both
//! is here because it is arithmetic, and testable away from a GPU.

/// What a surface's `wp_viewport` says, or nothing where it has none.
///
/// Read from the surface at commit rather than carried down from the client's
/// requests, because a viewport is double-buffered like everything else on a
/// surface: what it says takes effect with the buffer it was committed beside,
/// and reading it anywhere but there answers for the wrong frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Viewport {
    /// The size the surface says it is, whatever its buffer measures.
    pub destination: Option<(i32, i32)>,
    /// The part of the buffer that fills it, as `(x, y, width, height)` in the
    /// buffer's own logical units.
    pub source: Option<(f64, f64, f64, f64)>,
}

/// The logical size of a surface whose buffer is `buffer` pixels at
/// `buffer_scale`, and whose viewport states `destination` if it set one.
///
/// A destination is *already* the logical size — the whole point of it is to
/// say what the buffer's pixels should be scaled to — so it replaces the
/// division rather than being divided in turn. Halving it as well is the same
/// class of mistake as reading the buffer alone, one step further on.
///
/// A destination arrives from a client, so it is not trusted. The protocol
/// requires both sides positive and a client is not required to keep the
/// protocol; one that does not is treated as having set none, which is the
/// answer that cannot divide by zero further down.
pub fn surface_size(
    buffer: (u32, u32),
    buffer_scale: i32,
    destination: Option<(i32, i32)>,
) -> (u32, u32) {
    if let Some((width, height)) = destination {
        if let (Ok(width), Ok(height)) = (u32::try_from(width), u32::try_from(height)) {
            if width > 0 && height > 0 {
                return (width, height);
            }
        }
    }
    crate::scale::logical_size(buffer, buffer_scale)
}

#[cfg(test)]
mod tests {
    use super::surface_size;

    #[test]
    fn a_surface_with_no_viewport_is_its_buffer_over_its_scale() {
        // The ordinary case, unchanged: this is `scale::logical_size`'s answer
        // and it has to stay that answer, because most clients set no viewport
        // at all.
        assert_eq!(surface_size((2560, 1600), 2, None), (1280, 800));
        assert_eq!(surface_size((800, 600), 1, None), (800, 600));
    }

    #[test]
    fn a_destination_is_the_surfaces_size_whatever_the_buffer_is() {
        // The fault this was written for. Chromium commits 2560x1600 at buffer
        // scale 1 and says 1280x800 through the viewport; reading the buffer
        // alone makes every surface twice its true size, and with it every
        // portal and pointer coordinate.
        assert_eq!(
            surface_size((2560, 1600), 1, Some((1280, 800))),
            (1280, 800)
        );
        // And it wins over the scale as well, rather than being divided by it
        // again: a destination is already the logical size.
        assert_eq!(
            surface_size((2560, 1600), 2, Some((1280, 800))),
            (1280, 800)
        );
    }

    #[test]
    fn a_destination_of_nothing_is_refused_rather_than_believed() {
        // A zero would divide by zero in every mapping that takes a surface's
        // size as its denominator. The protocol forbids it; a client is not
        // required to keep the protocol.
        assert_eq!(surface_size((800, 600), 1, Some((0, 0))), (800, 600));
        assert_eq!(surface_size((800, 600), 1, Some((-4, 300))), (800, 600));
    }
}
