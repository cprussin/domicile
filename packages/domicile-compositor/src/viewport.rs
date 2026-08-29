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

use cgmath::Matrix3;

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

/// The whole texture, the right way up or not: what a surface with no source
/// rectangle samples, and what one this cannot read a rectangle out of falls
/// back to.
fn sampling_of_the_whole(y_inverted: bool) -> Matrix3<f32> {
    let flip = if y_inverted { -1.0 } else { 1.0 };
    let start = if y_inverted { 1.0 } else { 0.0 };
    Matrix3::new(1.0, 0.0, 0.0, 0.0, flip, 0.0, 0.0, start, 1.0)
}

/// How the quad samples the texture: the y-flip and the viewport's source
/// rectangle in one matrix.
///
/// `logical` is the surface's buffer in the units `source` is stated in, and
/// `source` is `(x, y, width, height)`. The result maps the quad's `(u, v)`,
/// each running 0..1, onto the texture coordinates to read.
///
/// The flip goes *inside* the crop, which is the half of this that is easy to
/// get wrong. Flipping the whole texture and then cropping reads the mirror of
/// the rectangle the client asked for — the right shape from the wrong part of
/// the buffer, which looks like a plausible picture and is not the one.
///
/// A source against a buffer with no area is ignored rather than divided by:
/// the alternative is a NaN in a matrix, and a quad that draws nothing for a
/// reason nobody can read off the screen.
pub fn sampling(
    y_inverted: bool,
    logical: (f64, f64),
    source: Option<(f64, f64, f64, f64)>,
) -> Matrix3<f32> {
    let (across, down) = logical;
    // Nothing to crop *out of*, so nothing to say: every ratio below has this
    // as its denominator, and a surface with no area would make each of them a
    // NaN rather than a number.
    if across <= 0.0 || down <= 0.0 {
        return sampling_of_the_whole(y_inverted);
    }
    let crop = source;
    // The whole texture when there is no source, which makes the no-crop case
    // fall out of the same arithmetic rather than needing a branch of its own.
    let (left, top, wide, tall) = crop.unwrap_or((0.0, 0.0, across, down));
    let u_scale = (wide / across) as f32;
    let u_start = (left / across) as f32;
    let v_scale = (tall / down) as f32;
    let v_start = (top / down) as f32;
    // Bottom-up: `v = 0` is the *bottom* edge of the source rectangle, and the
    // quad reads back towards its top.
    let (v_scale, v_start) = if y_inverted {
        (-v_scale, 1.0 - v_start)
    } else {
        (v_scale, v_start)
    };
    // Column-major, so this reads down the columns: `u' = u_scale * u +
    // u_start` and `v' = v_scale * v + v_start`.
    Matrix3::new(
        u_scale, 0.0, 0.0, //
        0.0, v_scale, 0.0, //
        u_start, v_start, 1.0,
    )
}

#[cfg(test)]
mod tests {
    use super::{sampling, surface_size};

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

    #[test]
    fn the_whole_buffer_the_right_way_up_samples_as_itself() {
        assert_eq!(sampling(false, (800.0, 600.0), None), IDENTITY);
    }

    #[test]
    fn the_whole_buffer_inverted_is_sampled_from_the_other_end() {
        // What `texture_matrix` did before there was a source to crop, and it
        // has to keep doing: a client that renders with GL hands its buffer
        // over bottom row first.
        assert_eq!(sampling(true, (800.0, 600.0), None), FLIPPED);
    }

    #[test]
    fn a_source_crops_to_its_own_corner_of_the_buffer() {
        // The right half of the buffer, top to bottom: `u` runs 0.5..1 and `v`
        // still 0..1.
        let matrix = sampling(false, (800.0, 600.0), Some((400.0, 0.0, 400.0, 600.0)));
        assert_eq!(at(matrix, (0.0, 0.0)), (0.5, 0.0));
        assert_eq!(at(matrix, (1.0, 1.0)), (1.0, 1.0));
    }

    #[test]
    fn an_inverted_source_flips_inside_its_own_crop_rather_than_the_buffer() {
        // The half this is easy to get wrong. Flipping the whole texture and
        // then cropping samples the *other* half; the flip belongs inside the
        // crop, so the top of the quad is the top of the source rectangle.
        let matrix = sampling(true, (800.0, 600.0), Some((0.0, 150.0, 800.0, 300.0)));
        // v = 0 is the top of the quad, which in a bottom-up buffer is the
        // bottom edge of the source: 1 - 150/600 = 0.75.
        assert_eq!(at(matrix, (0.0, 0.0)), (0.0, 0.75));
        // and v = 1 is 1 - 450/600.
        assert_eq!(at(matrix, (0.0, 1.0)), (0.0, 0.25));
    }

    #[test]
    fn a_source_the_size_of_its_buffer_is_the_whole_buffer() {
        // No special case in the code, so it is worth a test: a client that
        // sets a source covering everything gets what a client that set none
        // gets.
        assert_eq!(
            sampling(false, (800.0, 600.0), Some((0.0, 0.0, 800.0, 600.0))),
            IDENTITY
        );
        assert_eq!(
            sampling(true, (800.0, 600.0), Some((0.0, 0.0, 800.0, 600.0))),
            FLIPPED
        );
    }

    #[test]
    fn a_source_against_a_buffer_of_nothing_is_ignored() {
        // A surface with no area cannot be cropped and dividing by its size is
        // a NaN in a matrix, which draws nothing anybody can diagnose.
        assert_eq!(
            sampling(false, (0.0, 0.0), Some((0.0, 0.0, 10.0, 10.0))),
            IDENTITY
        );
    }

    const IDENTITY: Matrix3<f32> = Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
    const FLIPPED: Matrix3<f32> = Matrix3::new(1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 1.0);

    use cgmath::Matrix3;

    /// Where a corner of the quad lands in the texture.
    fn at(matrix: Matrix3<f32>, (u, v): (f32, f32)) -> (f32, f32) {
        let point = matrix * cgmath::Vector3::new(u, v, 1.0);
        ((point.x * 1e6).round() / 1e6, (point.y * 1e6).round() / 1e6)
    }
}
