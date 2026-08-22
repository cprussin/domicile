//! What the compositor advertises as `wl_output`s, and who decides the desktop.
//!
//! Two answers, and which one applies is the whole of it. With displays
//! described in the config, the desktop is what the config says and Domicile's
//! own window only shows it. With none, the window *is* the desktop — the
//! original behaviour, and all a nested compositor can manage without being
//! told otherwise.
//!
//! Kept apart from the Smithay wiring so it can be tested: everything here is
//! arithmetic and naming, and none of it needs a `wl_display`.

use domicile_config::Desktop;

/// One `wl_output`, in the form the compositor advertises it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Advertised {
    /// The `wl_output` name, which is also what the chrome addresses.
    pub name: String,
    /// Its top-left corner in desktop coordinates.
    pub position: (i32, i32),
    /// Its size in logical units. The mode is this multiplied by `scale`.
    pub logical: (i32, i32),
    /// What clients on it draw at. The `wl_output` scale, and the reason the
    /// mode is bigger than the logical size rather than equal to it.
    pub scale: i32,
}

impl Advertised {
    /// The `wl_output` mode: the logical size in physical pixels.
    ///
    /// Checked rather than multiplied, for the reason `Desktop::of` gives one
    /// layer down: a plain `*` would wrap in release into a mode that is a
    /// plausible screen of the wrong size.
    ///
    /// No production caller can reach the panic, on either path.
    /// `DisplayConfig::validate` bounds a described display's size times its
    /// own scale; `Screens::nested` uses scale 1 on a size `Config::validate`
    /// bounds; and `adopt_window_scale` divides the window's physical size by
    /// the scale before multiplying it back, so the product is at most the
    /// window's own size. What the assertion is for is that `Advertised` is
    /// publicly constructible and nothing validates one — the check is here so
    /// that a future caller building its own gets a panic rather than a
    /// negative screen.
    pub fn mode(&self) -> (i32, i32) {
        (
            self.logical
                .0
                .checked_mul(self.scale)
                .expect("a display's mode fits a coordinate"),
            self.logical
                .1
                .checked_mul(self.scale)
                .expect("a display's mode fits a coordinate"),
        )
    }
}

/// Every output the compositor advertises, and the desktop they make up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Screens {
    outputs: Vec<Advertised>,
    size: (i32, i32),
    follows_the_window: bool,
}

impl Screens {
    /// The outputs a configured desktop describes, one per display.
    ///
    /// Sizes and scales are the config's; positions are already normalised
    /// about the desktop's own corner, which is what `Desktop` is for.
    pub fn described(desktop: &Desktop) -> Screens {
        Screens {
            follows_the_window: false,
            outputs: desktop
                .displays()
                .map(|display| Advertised {
                    logical: (as_coordinate(display.size.0), as_coordinate(display.size.1)),
                    name: display.name.clone(),
                    position: display.position,
                    scale: as_coordinate(display.scale),
                })
                .collect(),
            size: (
                as_coordinate(desktop.size().0),
                as_coordinate(desktop.size().1),
            ),
        }
    }

    /// The one output a run with no described desktop starts on.
    ///
    /// `compositor.nested_size` is in *logical* units: a `wl_output` mode is
    /// physical, so the mode is this times the scale. Advertising a fixed mode
    /// instead would shrink the desktop every time the density went up, which
    /// a client feels as a smaller screen. The window then redefines it, as it
    /// always has, because nothing described one.
    ///
    /// `Config::validate` requires both non-zero and bounds their product
    /// against `output.max_scale`, so a size past `i32::MAX` is a config
    /// asking for a desktop no coordinate can describe — asserted rather than
    /// cast, since a silent wrap is a negative screen.
    pub fn nested(size: (u32, u32)) -> Screens {
        Screens::following_the_window(
            (
                i32::try_from(size.0).expect("compositor.nested_size fits a coordinate"),
                i32::try_from(size.1).expect("compositor.nested_size fits a coordinate"),
            ),
            1,
        )
    }

    /// The single output that follows Domicile's own window.
    ///
    /// Named `domicile-0` because a client that has only ever seen one output
    /// has seen this one, and renaming it would move every such client to a
    /// screen it thinks is new.
    pub fn following_the_window(logical: (i32, i32), scale: i32) -> Screens {
        Screens {
            follows_the_window: true,
            outputs: vec![Advertised {
                logical,
                name: "domicile-0".to_string(),
                position: (0, 0),
                scale,
            }],
            size: logical,
        }
    }

    /// The outputs, in the order the config wrote them.
    pub fn outputs(&self) -> impl Iterator<Item = &Advertised> {
        self.outputs.iter()
    }

    /// The desktop's size in logical units — the bounding box of the outputs.
    pub fn size(&self) -> (i32, i32) {
        self.size
    }

    /// Whether resizing Domicile's window redefines the desktop.
    ///
    /// True only where nothing described one. A configured desktop is a fact
    /// about the user's screens, so a window dragged smaller shows less of it
    /// rather than making it smaller.
    pub fn follows_the_window(&self) -> bool {
        self.follows_the_window
    }
}

/// A `u32` from the config as the `i32` every coordinate here is.
///
/// Three kinds of measure go through it — the desktop's extent, a display's
/// size, and its scale — and `domicile_config` bounds all three with two
/// checks: `validate_extent` for the extent, and the mode bound, `size × scale
/// <= i32::MAX`, for the other two at once. Neither a size nor a scale has a
/// bound of its own any more; each is at least 1, so bounding the product
/// bounds both. So this cannot fail for a `Desktop`, and asserting that is
/// better than a cast that would silently produce a negative screen or an
/// inverted density.
fn as_coordinate(measure: u32) -> i32 {
    i32::try_from(measure).expect("a validated desktop measures within an i32")
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_config::Config;

    fn desktop(text: &str) -> Desktop {
        Config::parse(text)
            .expect("the config should parse")
            .output
            .desktop()
            .expect("the config should describe a desktop")
    }

    #[test]
    fn a_described_desktop_advertises_one_output_per_display() {
        let screens = Screens::described(&desktop(
            "[[output.displays]]\nname = \"left\"\nsize = [1920, 1080]\n\
             [[output.displays]]\nname = \"right\"\nposition = [1920, 0]\nsize = [2560, 1440]\nscale = 2\n",
        ));
        assert_eq!(
            screens.outputs().cloned().collect::<Vec<_>>(),
            vec![
                Advertised {
                    logical: (1920, 1080),
                    name: "left".into(),
                    position: (0, 0),
                    scale: 1,
                },
                Advertised {
                    logical: (2560, 1440),
                    name: "right".into(),
                    position: (1920, 0),
                    scale: 2,
                },
            ]
        );
        assert_eq!(screens.size(), (4480, 1440));
    }

    #[test]
    fn a_mode_is_the_logical_size_in_physical_pixels() {
        // Not the logical size, and not the scale applied to one axis: a mode
        // is what the client actually draws, and a display that reports its
        // logical size as its mode is a blurry one.
        let screens = Screens::described(&desktop(
            "[[output.displays]]\nname = \"retina\"\nsize = [2560, 1440]\nscale = 2\n",
        ));
        let retina = screens.outputs().next().expect("the one display");
        assert_eq!(retina.mode(), (5120, 2880));
    }

    #[test]
    fn a_mode_too_big_to_describe_says_so_rather_than_wrapping() {
        // `Advertised` is constructible without a validated config — the
        // window-following path takes whatever size the window is — so the
        // multiplication asserts rather than assumes. Wrapping would advertise
        // a negative screen, in release, with nothing to say so.
        let huge = Screens::following_the_window((2_000_000_000, 1080), 2);
        let output = huge.outputs().next().expect("the one output").clone();
        let panicked = std::panic::catch_unwind(move || output.mode())
            .expect_err("a mode past a coordinate must not be advertised");
        assert_eq!(
            panicked.downcast_ref::<String>().map(String::as_str),
            Some("a display's mode fits a coordinate"),
            "the panic should name the invariant rather than be an incidental overflow"
        );
    }

    #[test]
    fn the_nested_size_is_the_desktop_when_nothing_described_one() {
        let screens = Screens::nested((1280, 800));
        assert_eq!(screens.size(), (1280, 800));
        assert!(screens.follows_the_window());
        let only = screens.outputs().next().expect("the one output");
        // Scale 1, so the mode is the size: the window has not said otherwise
        // yet, and inventing a density here would make every fresh run sharp
        // or blurry by default.
        assert_eq!(only.scale, 1);
        assert_eq!(only.mode(), (1280, 800));
    }

    #[test]
    fn a_described_desktop_is_not_the_window() {
        // The point of describing one: a window dragged smaller shows less of
        // the desktop rather than making the desktop smaller.
        let screens = Screens::described(&desktop(
            "[[output.displays]]\nname = \"only\"\nsize = [800, 600]\n",
        ));
        assert!(!screens.follows_the_window());
    }

    #[test]
    fn an_undescribed_desktop_is_whatever_window_domicile_got() {
        // The original behaviour, and all a nested compositor can manage
        // without being told: one output, sized and scaled by the window.
        let screens = Screens::following_the_window((1280, 800), 2);
        assert_eq!(
            screens.outputs().cloned().collect::<Vec<_>>(),
            vec![Advertised {
                logical: (1280, 800),
                // The name every client that has only ever seen one output has
                // already seen.
                name: "domicile-0".into(),
                position: (0, 0),
                scale: 2,
            }]
        );
        assert_eq!(screens.size(), (1280, 800));
        assert!(screens.follows_the_window());
    }
}
