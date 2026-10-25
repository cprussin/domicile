//! The color a monitor draws white as, for a night light.
//!
//! Each channel's gain is the color of a black body at that temperature,
//! from Tanner Helland's fit, divided by the color at 6500 K so that 6500 K
//! draws colors as they are.

/// The lowest temperature the shell may set.
pub const WARMEST: u32 = 1000;

/// The temperature that draws colors as they are, and the highest the shell
/// may set.
pub const NEUTRAL: u32 = 6500;

/// What each channel is multiplied by: 0 turns it off, 1 leaves it as it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WhitePoint {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

/// The white point of a light of `kelvin`, from [`WARMEST`] to
/// [`NEUTRAL`].
pub fn white_point(kelvin: u32) -> WhitePoint {
    let (red, green, blue) = black_body(kelvin);
    let (red_at_neutral, green_at_neutral, blue_at_neutral) = black_body(NEUTRAL);
    WhitePoint {
        red: red / red_at_neutral,
        green: green / green_at_neutral,
        blue: blue / blue_at_neutral,
    }
}

/// Tanner Helland's fit, 0 to 255 per channel, for temperatures up to 6600 K.
fn black_body(kelvin: u32) -> (f64, f64, f64) {
    let hundreds = f64::from(kelvin) / 100.0;
    let green = 99.470_802_586_1 * hundreds.ln() - 161.119_568_166_1;
    let blue = match hundreds <= 19.0 {
        true => 0.0,
        false => 138.517_731_223_1 * (hundreds - 10.0).ln() - 305.044_792_730_7,
    };
    (255.0, green.clamp(0.0, 255.0), blue.clamp(0.0, 255.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_draws_colors_as_they_are() {
        assert_eq!(
            white_point(NEUTRAL),
            WhitePoint {
                red: 1.0,
                green: 1.0,
                blue: 1.0,
            }
        );
    }

    #[test]
    fn a_warm_light_keeps_red_and_takes_more_blue_than_green() {
        let warm = white_point(3400);
        assert_eq!(warm.red, 1.0);
        assert!(warm.green < 1.0, "{warm:?}");
        assert!(warm.blue < warm.green, "{warm:?}");
    }

    #[test]
    fn warmer_takes_more() {
        let (warmer, warm) = (white_point(2700), white_point(3400));
        assert!(warmer.green < warm.green);
        assert!(warmer.blue < warm.blue);
    }

    /// Below 1900 K a black body gives off no blue to speak of.
    #[test]
    fn the_warmest_light_has_no_blue_and_some_green() {
        let warmest = white_point(WARMEST);
        assert_eq!(warmest.blue, 0.0);
        assert!(warmest.green > 0.0, "{warmest:?}");
    }
}
