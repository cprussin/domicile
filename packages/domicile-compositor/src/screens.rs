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
use domicile_protocol::DisplayInfo;
use domicile_scene::{Bounds, Point};

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

    /// The rectangle this output occupies on the desktop.
    ///
    /// Logical units, like everything the desktop is laid out in, so this is
    /// directly comparable with a portal's own box — a `wl_output`'s mode is
    /// physical and is not what a window is placed against.
    pub fn bounds(&self) -> Bounds {
        // `checked_add` for the reason [`mode`](Advertised::mode) gives:
        // `Advertised` is publicly constructible and nothing validates one, so
        // a far edge past `i32::MAX` is a display no coordinate can describe.
        // A wrap here is worse than a panic — it puts `max` below `min`, which
        // overlaps nothing, which is indistinguishable from a window in a gap
        // and so silently lands every window on every screen.
        let far = |at: i32, size: i32| {
            f64::from(
                at.checked_add(size)
                    .expect("a display's far edge fits a coordinate"),
            )
        };
        Bounds {
            min: Point::new(f64::from(self.position.0), f64::from(self.position.1)),
            max: Point::new(
                far(self.position.0, self.logical.0),
                far(self.position.1, self.logical.1),
            ),
        }
    }

    /// This output in the shape the chrome is told about it.
    ///
    /// The same four facts, retyped for the wire — the compositor speaks
    /// tuples and signed coordinates, the protocol speaks arrays and unsigned
    /// measures, and neither is worth changing to match the other.
    ///
    /// A size or a scale that is negative is asserted rather than folded to
    /// its magnitude: no output has one, `as_coordinate` is what refuses to
    /// build one, and turning a negative into a plausible positive here is the
    /// silent wrong answer that check exists to prevent.
    pub fn described(&self) -> DisplayInfo {
        DisplayInfo {
            name: self.name.clone(),
            position: [self.position.0, self.position.1],
            scale: as_measure(self.scale),
            size: [as_measure(self.logical.0), as_measure(self.logical.1)],
        }
    }
}

/// Where one output of a rearranged desktop comes from.
///
/// One per display of the *new* desktop, in its order, so applying a
/// [`Rearrangement`] is a walk down the new list with an answer for each entry
/// rather than a search per display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// The `wl_output` at this index of the old list, restated in place.
    ///
    /// Restated rather than replaced even when its size or scale changed:
    /// destroying the global and making another takes the output away from
    /// every client on that display and hands back a different one, which a
    /// toolkit reads as the monitor being unplugged rather than resized.
    Kept(usize),
    /// No old output is this display, so one has to be created.
    New,
}

/// What has to happen to the advertised outputs to become another desktop.
///
/// Matched by name, which is identity in both directions: it is what the
/// chrome addresses a `<Screen>` by and what the compositor matches back. A
/// display that changed name is one the shell can no longer name, so it is a
/// different display however much of its shape it kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rearrangement {
    /// One per display of the new desktop, in its order.
    pub slots: Vec<Slot>,
    /// Indices into the *old* list whose globals have to be destroyed,
    /// ascending.
    ///
    /// Everything no slot kept. Separate from `slots` because it is indexed
    /// into the other list: the two cannot be one walk, and a caller that
    /// tried would destroy an output it was about to reuse.
    pub retired: Vec<usize>,
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

    /// The desktop a reloaded config makes, or `None` to leave this one be.
    ///
    /// The config is not always the authority, and that is the whole of this.
    /// With displays described it is: the user said what their screens are, and
    /// a reload is them saying it again. With none described the *window* is —
    /// its size and density come from the host through `adopt_window_scale`,
    /// and the config knows neither. Rebuilding from the config anyway hands
    /// back `nested_size` at scale 1, so a desktop that had come up to scale 2
    /// drops to 1 and every client redraws for the wrong screen, with nothing
    /// to say why: the file was read correctly, it just does not describe this.
    ///
    /// Not a rare path. The watcher watches the config's *directory*, because
    /// that is how a save by atomic rename is caught, so an unrelated file
    /// written beside it is a reload too — and on an undescribed desktop every
    /// one of those was undoing the window's own density.
    ///
    /// A desktop that *stopped* being described is the other direction and does
    /// change: it was the config's, the config no longer claims it, and
    /// `nested_size` is where the window takes over again.
    pub fn reloaded_into(
        &self,
        described: Option<&Desktop>,
        nested: (u32, u32),
    ) -> Option<Screens> {
        match described {
            Some(desktop) => Some(Screens::described(desktop)),
            None if self.follows_the_window() => None,
            None => Some(Screens::nested(nested)),
        }
    }

    /// How to become `next` without disturbing the displays that stayed.
    ///
    /// The whole point is what it does *not* do: a display whose name is in
    /// both desktops keeps its `wl_output`, whatever else about it changed.
    /// Rebuilding the list wholesale would be far simpler and would unplug
    /// every monitor on every config reload — every client on one is told it
    /// left, then told it entered a different output with the same geometry,
    /// and a toolkit that reloads its scale on that will do so for a desktop
    /// that did not change.
    pub fn rearranged_into(&self, next: &Screens) -> Rearrangement {
        let slots: Vec<Slot> = next
            .outputs
            .iter()
            .map(|wanted| {
                self.outputs
                    .iter()
                    .position(|had| had.name == wanted.name)
                    .map_or(Slot::New, Slot::Kept)
            })
            .collect();
        let retired = (0..self.outputs.len())
            .filter(|index| !slots.contains(&Slot::Kept(*index)))
            .collect();
        Rearrangement { slots, retired }
    }

    /// Which outputs a window with these bounds is on, in [`outputs`] order.
    ///
    /// [`outputs`]: Screens::outputs
    ///
    /// Two fallbacks, both to *every* output, and they are the load-bearing
    /// half rather than the tidy edge cases:
    ///
    /// - `None` is a surface with no portal — a window never mounted, one
    ///   backgrounded, or a popup, which never has one at all. A backgrounded
    ///   tab is *placed invisibly* rather than removed — the shell keeps every
    ///   window mounted and toggles `hidden`, which arrives as a placement
    ///   with `visible: false` and drops the portal from the scene. So the
    ///   fallback has to key on having a portal now, not on having been told
    ///   one went away: keyed on the removal, every hidden-but-mounted window
    ///   would stay pinned to the display it was last on.
    /// - An empty intersection is a portal in a gap between displays or off
    ///   the desktop's edge. Both are legal — the page spans a hole — and
    ///   "no output" is not an answer a client can use: a toolkit that scales
    ///   its content asks which output it is on and blocks until told, so a
    ///   window told none maps blank and stays that way.
    ///
    /// A `Vec` in the outputs' own order rather than a set of names, because
    /// the caller has one `wl_output` per entry in the same order and has to
    /// enter *and leave* each of them — the answer is a decision per output,
    /// not a list of the interesting ones.
    pub fn entered_by(&self, bounds: Option<Bounds>) -> Vec<bool> {
        let everywhere = || vec![true; self.outputs.len()];
        match bounds {
            None => everywhere(),
            Some(bounds) => {
                let touched: Vec<bool> = self
                    .outputs
                    .iter()
                    .map(|output| output.bounds().overlaps(&bounds))
                    .collect();
                if touched.contains(&true) {
                    touched
                } else {
                    everywhere()
                }
            }
        }
    }

    /// The window to ask a host for, showing this desktop inside `within`.
    ///
    /// The desktop itself where it fits, so a single 1920x1080 display opens a
    /// window that shows it pixel for pixel. Scaled down to fit where it does
    /// not: four 4K displays side by side are a 15360-wide desktop, and asking
    /// a host for a window that wide gets one mostly off the screen, or past
    /// what the GL implementation will allocate a renderbuffer for. Which is
    /// worse than the fixed 1280x800 this replaced, since that at least showed
    /// the whole desktop.
    ///
    /// Never enlarged: a desktop smaller than `within` is shown at its own
    /// size rather than blown up, because a window bigger than the desktop is
    /// letterboxing that nothing draws.
    ///
    /// Both axes by the same factor, so the shape survives. `logical_to_window`
    /// scales them independently and will stretch the desktop into whatever
    /// window it is actually given — asking for the right shape is what keeps
    /// it from having to.
    pub fn window_showing_it(&self, within: (u32, u32)) -> (u32, u32) {
        let (width, height) = (as_measure(self.size.0), as_measure(self.size.1));
        // Rationals rather than a float ratio: this is a size in pixels, and
        // `width * within.1` against `height * within.0` is the same comparison
        // without asking which way a rounded division went.
        let by_width = u64::from(width) * u64::from(within.1);
        let by_height = u64::from(height) * u64::from(within.0);
        let shrink = |measure: u32, numerator: u32, denominator: u32| {
            // At most `measure`, so the "never enlarged" half needs no branch
            // of its own: a `within` larger than the desktop is not applied.
            u32::try_from(u64::from(measure) * u64::from(numerator) / u64::from(denominator))
                .unwrap_or(u32::MAX)
                .max(1)
        };
        if width <= within.0 && height <= within.1 {
            (width, height)
        } else if by_width > by_height {
            // Wider than the box in proportion, so the width is what binds.
            (within.0, shrink(height, within.0, width))
        } else {
            (shrink(width, within.1, height), within.1)
        }
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

/// A coordinate back as the `u32` the protocol measures sizes and scales in.
///
/// The inverse of [`as_coordinate`], and asserted for the same reason: a size
/// or a scale is a count, so a negative one is not a big number but a bug one
/// layer up, and `unsigned_abs` would hand the chrome a plausible screen built
/// out of it.
fn as_measure(coordinate: i32) -> u32 {
    u32::try_from(coordinate).expect("a size or a scale is never negative")
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_config::Config;
    use domicile_scene::{Portal, Transform};

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
            r#"{
  "output": {
    "displays": [
      {
        "name": "left",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "right",
        "position": [
          1920,
          0
        ],
        "size": [
          2560,
          1440
        ],
        "scale": 2
      }
    ]
  }
}"#,
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
            r#"{
  "output": {
    "displays": [
      {
        "name": "retina",
        "size": [
          2560,
          1440
        ],
        "scale": 2
      }
    ]
  }
}"#,
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
    fn an_output_is_described_to_the_chrome_field_for_field() {
        // Every field is one the shell lays out against: the name is what a
        // `<Screen>` matches, the position is where it goes on the page, the
        // size is how big that region is, and the scale is what clients on it
        // draw at. A pair swapped here is a shell that puts the dock on the
        // wrong screen with nothing to say so.
        // Two, because a lone display normalises to the origin, and `[0, 0]` is
        // what a `described` that dropped the position would produce anyway.
        let screens = Screens::described(&desktop(
            r#"{
  "output": {
    "displays": [
      {
        "name": "left",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "right",
        "position": [
          1920,
          120
        ],
        "size": [
          2560,
          1440
        ],
        "scale": 2
      }
    ]
  }
}"#,
        ));
        assert_eq!(
            screens
                .outputs()
                .nth(1)
                .expect("the second display")
                .described(),
            DisplayInfo {
                name: "right".into(),
                position: [1920, 120],
                scale: 2,
                size: [2560, 1440],
            }
        );
    }

    #[test]
    fn a_negative_measure_says_so_rather_than_becoming_a_big_one() {
        // `Advertised` is constructible without a validated config, and the
        // protocol measures sizes and scales unsigned. Folding a negative to
        // its magnitude would describe a plausible screen to the chrome — the
        // silent wrong answer, which is what `as_coordinate` refuses one layer
        // up and what this refuses on the way out.
        let bogus = Advertised {
            logical: (-1920, 1080),
            name: "impossible".into(),
            position: (0, 0),
            scale: 1,
        };
        let panicked = std::panic::catch_unwind({
            let bogus = bogus.clone();
            move || bogus.described()
        })
        .expect_err("a negative size must not be described to the chrome");
        // `starts_with`, because `expect` on a `Result` appends the error it
        // unwrapped. The invariant is the part being asserted.
        assert!(
            panicked
                .downcast_ref::<String>()
                .is_some_and(|said| said.starts_with("a size or a scale is never negative")),
            "the panic should name the invariant rather than be an incidental \
             conversion, and it said {:?}",
            panicked.downcast_ref::<String>()
        );

        // The height. Not the same fixture with both axes negative: the width
        // is converted first and panics there, so the height's call site would
        // never be reached.
        let squashed = Advertised {
            logical: (1920, -1080),
            name: "impossible".into(),
            position: (0, 0),
            scale: 1,
        };
        let panicked = std::panic::catch_unwind(move || squashed.described())
            .expect_err("a negative height must not be described to the chrome");
        assert!(
            panicked
                .downcast_ref::<String>()
                .is_some_and(|said| said.starts_with("a size or a scale is never negative")),
            "the height half asserts the same invariant, and it said {:?}",
            panicked.downcast_ref::<String>()
        );

        // And the scale. `described` reaches `as_measure` three times and a
        // mutation at any one of them is its own wrong answer — a negative
        // scale folded to its magnitude is a display the chrome draws at some
        // enormous density.
        let inverted = Advertised {
            logical: (1920, 1080),
            name: "impossible".into(),
            position: (0, 0),
            scale: -2,
        };
        let panicked = std::panic::catch_unwind(move || inverted.described())
            .expect_err("a negative scale must not be described to the chrome");
        assert!(
            panicked
                .downcast_ref::<String>()
                .is_some_and(|said| said.starts_with("a size or a scale is never negative")),
            "the scale half asserts the same invariant, and it said {:?}",
            panicked.downcast_ref::<String>()
        );
    }

    /// The two-display desktop the entered-output cases are argued against.
    fn side_by_side() -> Screens {
        Screens::described(&desktop(
            r#"{
  "output": {
    "displays": [
      {
        "name": "left",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "right",
        "position": [
          1920,
          0
        ],
        "size": [
          1280,
          1024
        ]
      }
    ]
  }
}"#,
        ))
    }

    /// A window of `size` at `at`, as the chrome would have placed it.
    fn window_at(at: (f64, f64), size: (f64, f64)) -> Bounds {
        Portal::new("app", size, Transform::translate(at.0, at.1), 0).bounds()
    }

    #[test]
    fn a_window_is_on_the_display_it_is_over() {
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((100.0, 100.0), (800.0, 600.0)))),
            vec![true, false]
        );
        assert_eq!(
            screens.entered_by(Some(window_at((2000.0, 100.0), (800.0, 600.0)))),
            vec![false, true]
        );
    }

    #[test]
    fn a_window_straddling_two_displays_is_on_both() {
        // What the whole per-output rule is for: a window dragged across the
        // seam is being shown by both screens, and a client told only one of
        // them draws at one density for a window visible at two.
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((1800.0, 0.0), (400.0, 400.0)))),
            vec![true, true]
        );
    }

    #[test]
    fn a_window_ending_on_the_seam_is_on_one_of_them() {
        // Displays abut exactly, so a window whose right edge is the boundary
        // touches the second without being on it. Counted as an overlap, every
        // maximised window on the left-hand screen would be on both.
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((1120.0, 0.0), (800.0, 600.0)))),
            vec![true, false]
        );
    }

    #[test]
    fn a_window_with_no_portal_is_on_every_display() {
        // Never mounted, backgrounded, or a popup. A backgrounded tab is
        // placed *invisibly* rather than removed, which drops its portal from
        // the scene, so keying this on having a portal would take every
        // backgrounded window off every screen.
        let screens = side_by_side();

        assert_eq!(screens.entered_by(None), vec![true, true]);
    }

    #[test]
    fn a_window_over_no_display_at_all_is_on_every_display() {
        // A portal in a gap between displays, or off the desktop's edge. Both
        // are legal — the page spans a hole — and "no output" is not an answer
        // a client can use: a toolkit that scales asks which output it is on
        // and blocks until told, so a window told none maps blank.
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((-4000.0, -4000.0), (100.0, 100.0)))),
            vec![true, true]
        );
    }

    #[test]
    fn a_display_whose_far_edge_does_not_fit_says_so_rather_than_wrapping() {
        // The same invariant `a_mode_too_big_to_describe_says_so_rather_than_wrapping`
        // asserts one field over, and the failure is worse here: a wrapped far
        // edge puts `max` below `min`, which overlaps nothing, which is
        // indistinguishable from a window in a gap — so every window would
        // land on every screen with nothing to show why.
        let past_the_end = Advertised {
            logical: (1920, 1080),
            name: "impossible".into(),
            position: (i32::MAX - 1, 0),
            scale: 1,
        };

        let panicked = std::panic::catch_unwind(move || past_the_end.bounds())
            .expect_err("a far edge past i32::MAX must not wrap");

        assert!(
            panicked
                .downcast_ref::<String>()
                .is_some_and(|said| said.starts_with("a display's far edge")),
            "it said {:?}",
            panicked.downcast_ref::<String>()
        );
    }

    #[test]
    fn a_desktop_that_fits_is_shown_at_its_own_size() {
        // The point of asking for it at all: one 1920x1080 display opens a
        // window showing it pixel for pixel, rather than winit's default with
        // the desktop scaled into it.
        let screens = Screens::described(&desktop(
            r#"{
  "output": {
    "displays": [
      {
        "name": "only",
        "size": [
          1920,
          1080
        ]
      }
    ]
  }
}"#,
        ));

        assert_eq!(screens.window_showing_it((2560, 1440)), (1920, 1080));
    }

    #[test]
    fn a_desktop_too_wide_for_the_box_is_scaled_to_its_width() {
        // Four 4K displays side by side. Asked for at its own size this is a
        // window mostly off the screen, or past what the GL implementation
        // will allocate — worse than the fixed size it replaced, which at
        // least showed the whole desktop.
        let screens = Screens::described(&desktop(
            r#"{
  "output": {
    "displays": [
      {
        "name": "a",
        "size": [
          3840,
          2160
        ]
      },
      {
        "name": "b",
        "position": [
          3840,
          0
        ],
        "size": [
          3840,
          2160
        ]
      }
    ]
  }
}"#,
        ));

        // 7680x2160 into 1280 wide: the height follows by the same factor, so
        // the shape survives rather than the desktop being squashed.
        assert_eq!(screens.window_showing_it((1280, 800)), (1280, 360));
    }

    #[test]
    fn a_desktop_too_tall_for_the_box_is_scaled_to_its_height() {
        // Stacked rather than side by side, which is the axis the width case
        // cannot tell you anything about.
        let screens = Screens::described(&desktop(
            r#"{
  "output": {
    "displays": [
      {
        "name": "a",
        "size": [
          1600,
          1200
        ]
      },
      {
        "name": "b",
        "position": [
          0,
          1200
        ],
        "size": [
          1600,
          1200
        ]
      }
    ]
  }
}"#,
        ));

        assert_eq!(screens.window_showing_it((1280, 800)), (533, 800));
    }

    #[test]
    fn a_desktop_smaller_than_the_box_is_not_blown_up_to_fill_it() {
        // A window bigger than the desktop is letterboxing nothing draws.
        let screens = Screens::described(&desktop(
            r#"{
  "output": {
    "displays": [
      {
        "name": "only",
        "size": [
          640,
          480
        ]
      }
    ]
  }
}"#,
        ));

        assert_eq!(screens.window_showing_it((1280, 800)), (640, 480));
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
            r#"{
  "output": {
    "displays": [
      {
        "name": "only",
        "size": [
          800,
          600
        ]
      }
    ]
  }
}"#,
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

    /// The screens a desktop made of `entries` describes.
    ///
    /// `entries` is the display list rather than a whole config: these tests
    /// build desktops by naming which displays are in them, and in what order.
    fn described(entries: &str) -> Screens {
        Screens::described(&desktop(&format!(
            r#"{{ "output": {{ "displays": [{entries}] }} }}"#
        )))
    }

    const LEFT: &str = r#"{ "name": "left", "size": [1920, 1080] }"#;
    const RIGHT: &str = r#"{ "name": "right", "position": [1920, 0], "size": [2560, 1440] }"#;

    #[test]
    fn a_desktop_that_did_not_change_rearranges_into_nothing() {
        let before = described(&format!("{LEFT}, {RIGHT}"));
        let after = described(&format!("{LEFT}, {RIGHT}"));
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::Kept(0), Slot::Kept(1)],
                retired: vec![],
            }
        );
    }

    #[test]
    fn a_display_that_was_added_is_a_new_slot() {
        let before = described(LEFT);
        let after = described(&format!("{LEFT}, {RIGHT}"));
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::Kept(0), Slot::New],
                retired: vec![],
            }
        );
    }

    #[test]
    fn a_display_that_went_away_is_retired() {
        let before = described(&format!("{LEFT}, {RIGHT}"));
        let after = described(LEFT);
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::Kept(0)],
                retired: vec![1],
            }
        );
    }

    #[test]
    fn a_display_that_only_changed_shape_keeps_its_output() {
        // The one that matters. Destroying the global and making another
        // would take the `wl_output` away from every client on that display
        // and hand back a different one — which a toolkit reads as the monitor
        // being unplugged, not resized. It keeps its slot and is restated.
        let before = described(LEFT);
        let after = described(r#"{ "name": "left", "size": [3840, 2160], "scale": 2 }"#);
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::Kept(0)],
                retired: vec![],
            }
        );
    }

    #[test]
    fn a_renamed_display_is_a_different_display() {
        // Name is identity, in both directions: it is what the chrome
        // addresses a `<Screen>` by and what the compositor matches it back
        // to. A display that changed name is one the shell can no longer name,
        // so pretending it is the same one would leave a `<Screen name>`
        // pointing at nothing while its window stayed put.
        let before = described(LEFT);
        let after = described(r#"{ "name": "main", "size": [1920, 1080] }"#);
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::New],
                retired: vec![0],
            }
        );
    }

    #[test]
    fn displays_that_swapped_places_keep_the_outputs_they_had() {
        // Matched by name rather than by position, so writing the same two
        // displays in the other order moves each client's `wl_output` with the
        // display it named — not onto whichever display now sits at its index.
        let before = described(&format!("{LEFT}, {RIGHT}"));
        let after = described(&format!("{RIGHT}, {LEFT}"));
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::Kept(1), Slot::Kept(0)],
                retired: vec![],
            }
        );
    }

    #[test]
    fn a_desktop_that_stopped_being_described_retires_every_display() {
        // Removing the last `output.displays` is not an empty desktop but
        // the absence of a described one, and the single window-following
        // output is a different output with a different name.
        let before = described(&format!("{LEFT}, {RIGHT}"));
        let after = Screens::nested((1280, 800));
        assert_eq!(
            before.rearranged_into(&after),
            Rearrangement {
                slots: vec![Slot::New],
                retired: vec![0, 1],
            }
        );
    }

    #[test]
    fn a_reload_that_describes_displays_replaces_the_window_desktop() {
        let now = Screens::following_the_window((1280, 800), 2);
        let described = desktop(&format!(r#"{{ "output": {{ "displays": [{LEFT}] }} }}"#));
        assert_eq!(
            now.reloaded_into(Some(&described), (1280, 800)),
            Some(Screens::described(&described))
        );
    }

    #[test]
    fn a_reload_that_describes_no_displays_leaves_the_window_desktop_alone() {
        // The regression. With no `output.displays` the window is the
        // desktop, and its size and density are what `adopt_window_scale`
        // negotiated with the host — facts the config does not know. Rebuilding
        // from the config anyway hands back `nested_size` at scale 1, so a
        // desktop that had come up to scale 2 silently dropped to 1 and every
        // client redrew for the wrong screen. Nothing said so, because the
        // config was read correctly; it simply is not the authority here.
        //
        // Reached by editing any unrelated field, and by a save of a file that
        // merely lives beside the config: the watcher watches the directory,
        // because that is how an atomic rename is caught.
        let now = Screens::following_the_window((1920, 1200), 2);
        assert_eq!(now.reloaded_into(None, (1280, 800)), None);
    }

    #[test]
    fn a_reload_that_stopped_describing_displays_hands_the_desktop_back() {
        // The other direction, and not the same as the case above: this
        // desktop was the config's, the config has stopped claiming it, and
        // there is nothing to keep. `nested_size` is where the window takes
        // over — its next resize or density change corrects it, which is
        // exactly what an undescribed desktop is.
        let now = described(&format!("{LEFT}, {RIGHT}"));
        assert_eq!(
            now.reloaded_into(None, (1280, 800)),
            Some(Screens::nested((1280, 800)))
        );
    }
}
