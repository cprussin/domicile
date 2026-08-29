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

/// The logical size of a desktop that covers a window `physical` device pixels
/// across on a display of `scale_factor` device pixels per CSS pixel.
///
/// The companion to [`output_scale`], and the reason the two are separate:
/// they answer the same display with different numbers on purpose.
/// `wl_output.scale` has to be a whole number and rounds 1.5 *up* to 2, so
/// that clients draw more pixels than the display has and are downscaled
/// rather than stretched. The desktop's size is not free to round with it —
/// it is how much room there is, which the display settles and no protocol
/// constrains. Dividing the window by the rounded scale instead makes a
/// 1.5x display a desktop two thirds the size of the screen it covers, with
/// every CSS pixel in it drawn a third too large; at 1.25 it is 1.6 times too
/// large. The mode that goes out is this size times the integer scale, which
/// is larger than the window and is exactly the overdraw that keeps it sharp.
///
/// `scale_factor` comes from a window system rather than from a client, and is
/// still not trusted: a NaN would make the desktop's size NaN, and the cast
/// that follows turns that into a number nobody chose. Anything not usable as
/// a divisor leaves the desktop the size of its window, which is what a
/// display of 1 would give and what [`output_scale`] independently decides for
/// the same input.
pub fn desktop_size(physical: (i32, i32), scale_factor: f64) -> (i32, i32) {
    let ratio = if scale_factor.is_finite() && scale_factor > 1.0 {
        scale_factor
    } else {
        1.0
    };
    let along = |pixels: i32| ((f64::from(pixels) / ratio).round() as i32).max(1);
    (along(physical.0), along(physical.1))
}

#[cfg(test)]
mod tests {
    use super::{desktop_size, logical_size, output_scale};

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

    #[test]
    fn a_desktop_is_as_wide_as_its_display_not_as_its_rounded_scale() {
        // The failure this exists for. `output_scale` rounds 1.5 up to 2 so
        // that buffers stay sharp, and dividing the window by *that* makes the
        // desktop a third smaller than the display it covers — every CSS pixel
        // in it drawn 1.33 times too large. At 1.25 the same slip is 1.6.
        assert_eq!(desktop_size((1920, 1200), 1.5), (1280, 800));
        assert_eq!(desktop_size((1920, 1200), 1.25), (1536, 960));
    }

    #[test]
    fn a_whole_ratio_divides_exactly() {
        assert_eq!(desktop_size((2560, 1600), 2.0), (1280, 800));
        assert_eq!(desktop_size((1280, 800), 1.0), (1280, 800));
    }

    #[test]
    fn a_desktop_below_one_device_pixel_per_css_pixel_is_its_own_size() {
        // Wayland cannot advertise a scale under 1 and `output_scale` reports
        // 1 for one, so the desktop is the window: enlarging it here would
        // disagree with the scale the same display was advertised at.
        assert_eq!(desktop_size((1280, 800), 0.5), (1280, 800));
    }

    #[test]
    fn a_nonsense_ratio_leaves_the_desktop_the_size_of_its_window() {
        // `scale_factor` is a float from a window system and reaches this
        // unchecked; a NaN divisor would make the desktop's size NaN and the
        // cast that follows is UB-adjacent nonsense rather than a number.
        assert_eq!(desktop_size((1280, 800), f64::NAN), (1280, 800));
        assert_eq!(desktop_size((1280, 800), f64::INFINITY), (1280, 800));
        assert_eq!(desktop_size((1280, 800), -2.0), (1280, 800));
        assert_eq!(desktop_size((1280, 800), 0.0), (1280, 800));
    }

    #[test]
    fn a_desktop_never_goes_empty() {
        // A window can be dragged to nothing, and a zero here divides by zero
        // in every mapping that takes the desktop's size as its denominator.
        assert_eq!(desktop_size((0, 0), 2.0), (1, 1));
        assert_eq!(desktop_size((1, 1), 4.0), (1, 1));
    }

    #[test]
    fn a_fraction_of_a_pixel_rounds_to_the_nearest_one() {
        // 1365.33 rather than 1365 or 1366 exactly; either neighbour is half a
        // pixel out and the nearest is the one that stays centred.
        assert_eq!(desktop_size((4096, 2160), 3.0), (1365, 720));
    }
}
