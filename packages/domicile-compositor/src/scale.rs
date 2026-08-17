//! Turning a display's pixel ratio into what Wayland can say, and back.
//!
//! Three coordinate systems meet at an `<app>` element and only two of them
//! agree. The chrome lays out in CSS pixels; the display has some number of
//! real pixels per CSS pixel; and Wayland describes a surface in *logical*
//! units with an integer scale saying how many buffer pixels each one holds.
//! Getting a client to draw at the display's real resolution means moving
//! between them, which is arithmetic, which is testable — so it lives here
//! rather than inside the commit path.

/// The `wl_output` scale to advertise for a chrome reporting `ratio` device
/// pixels per CSS pixel, never above `max`.
///
/// `wl_output.scale` is an integer, so a fractional ratio rounds *up*: a client
/// drawing more pixels than the display has is downscaled by the canvas and
/// stays sharp, while one drawing fewer is stretched and is exactly the
/// blurriness this exists to remove. (Matching a fractional ratio properly is
/// `wp_fractional_scale_v1`, which is a separate protocol.)
///
/// `max` is the escape hatch: every pixel here costs the readback, the socket
/// and the IPC hop *squared*, so a display can ask for more than the copy path
/// can afford.
pub fn output_scale(ratio: f64, max: u32) -> i32 {
    // A ratio below 1 is a display with fewer pixels than CSS ones, which
    // Wayland cannot express and which needs no help staying sharp.
    let wanted = if ratio.is_finite() && ratio > 1.0 {
        ratio.ceil() as u32
    } else {
        1
    };
    wanted.clamp(1, max.max(1)) as i32
}

/// The logical size of a surface whose buffer is `buffer` pixels at
/// `buffer_scale`.
///
/// Layout and pointer coordinates are both in logical units — the chrome sizes
/// an element in CSS pixels and `wl_pointer` reports surface-local logical
/// positions — while the pixels themselves are only ever the buffer's own.
///
/// `buffer_scale` arrives from a client, so it is not trusted: the protocol
/// requires a positive integer dividing both dimensions, and a client that
/// says otherwise gets treated as unscaled rather than crashing the compositor.
pub fn logical_size(buffer: (u32, u32), buffer_scale: i32) -> (u32, u32) {
    let scale = u32::try_from(buffer_scale).unwrap_or(1).max(1);
    ((buffer.0 / scale).max(1), (buffer.1 / scale).max(1))
}

#[cfg(test)]
mod tests {
    use super::{logical_size, output_scale};

    #[test]
    fn an_ordinary_display_asks_for_no_scaling() {
        assert_eq!(output_scale(1.0, 3), 1);
    }

    #[test]
    fn a_retina_display_asks_for_its_whole_ratio() {
        assert_eq!(output_scale(2.0, 3), 2);
    }

    #[test]
    fn a_fractional_ratio_rounds_up_rather_than_down() {
        // Down would mean the client draws fewer pixels than the display has
        // and the canvas stretches them — the blurriness this exists to
        // remove. Up is downscaled by the canvas, which stays sharp.
        assert_eq!(output_scale(1.5, 3), 2);
        assert_eq!(output_scale(2.25, 3), 3);
    }

    #[test]
    fn the_cap_wins_over_what_the_display_wants() {
        // Every pixel costs the copy path squared, so a 4x display may be more
        // than the frame path can afford to carry.
        assert_eq!(output_scale(4.0, 2), 2);
    }

    #[test]
    fn a_ratio_below_one_is_not_expressible_and_needs_no_help() {
        assert_eq!(output_scale(0.5, 3), 1);
        assert_eq!(output_scale(0.0, 3), 1);
    }

    #[test]
    fn a_nonsense_ratio_falls_back_to_unscaled() {
        // `devicePixelRatio` crosses the wire as JSON, so it can be anything.
        assert_eq!(output_scale(f64::NAN, 3), 1);
        assert_eq!(output_scale(f64::INFINITY, 3), 1);
        assert_eq!(output_scale(-2.0, 3), 1);
    }

    #[test]
    fn a_cap_of_zero_still_leaves_a_usable_scale() {
        assert_eq!(output_scale(2.0, 0), 1);
    }

    #[test]
    fn a_scaled_buffer_is_logically_smaller_than_its_pixels() {
        assert_eq!(logical_size((1600, 1200), 2), (800, 600));
    }

    #[test]
    fn an_unscaled_buffer_is_its_own_logical_size() {
        assert_eq!(logical_size((800, 600), 1), (800, 600));
    }

    #[test]
    fn a_client_claiming_a_nonsense_scale_is_treated_as_unscaled() {
        // The scale comes off the wire from a client; a compositor that
        // divided by it unchecked would panic on zero.
        assert_eq!(logical_size((800, 600), 0), (800, 600));
        assert_eq!(logical_size((800, 600), -2), (800, 600));
    }

    #[test]
    fn a_surface_never_goes_logically_empty() {
        // A buffer smaller than its own scale violates the protocol, but a zero
        // here would divide by zero in the chrome's pointer mapping.
        assert_eq!(logical_size((1, 1), 4), (1, 1));
    }
}
