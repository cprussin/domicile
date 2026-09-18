//! What the compositor advertises as `wl_output`s, and who decides the desktop.
//!
//! Four answers, and which one applies is the whole of it.
//!
//! - **Described.** `output.displays` states a desktop outright, and Domicile's
//!   own window only shows it. Nothing overrules a user who said what their
//!   screens are.
//! - **Placed.** `output.profiles` states where the *real* monitors go — how
//!   dense, which way up, in what order — and the engine's reading of DRM says
//!   which of them are plugged in. The one answer that is a function of the
//!   hardware, so it is re-matched on every hotplug and on every reload.
//! - **The engine's reading, untouched.** A desk no profile names: the monitors
//!   stay wherever ozone laid them out, unscaled and unturned.
//! - **The window.** Nothing described and no monitors read, which is a nested
//!   run: the window *is* the desktop, the original behavior, and all a nested
//!   compositor can manage without being told otherwise.
//!
//! [`Screens::reloaded_into`] and [`Screens::replugged_into`] are the two ways
//! in, and they ask one question between them: this config, these monitors,
//! which desktop.
//!
//! Kept apart from the Smithay wiring so it can be tested: everything here is
//! arithmetic and naming, and none of it needs a `wl_display`.

use domicile_config::{ConfigError, Connected, Desktop, Layout, OutputConfig, Transform};
use domicile_protocol::DisplayInfo;
use domicile_scene::{Bounds, Point};

use crate::engine::{Connector, Display};

/// What `wl_output` states for a screen whose physical size is not a number
/// anybody has.
///
/// The protocol's own word rather than a placeholder: "the physical size can
/// be set to zero if it doesn't make sense for this output (e.g. for
/// projectors or virtual outputs)". A client checks it rather than dividing by
/// it, which is the difference between one that knows it does not know and one
/// that is confidently wrong -- and this used to be `(300, 200)` on every
/// display, which made a 3840x2160 screen 325 DPI and a 1280x800 one 108.
pub const UNKNOWN_PHYSICAL_MM: (i32, i32) = (0, 0);

/// What `wl_output` states for a screen with no refresh rate to report, in
/// mHz.
///
/// The same sentence of the protocol, for the other field: "the vertical
/// refresh rate can be set to zero if it doesn't make sense for this output
/// (e.g. for virtual outputs)". Nothing is lost by saying so -- a client is
/// paced by `wl_surface.frame`, which comes off a real composite.
pub const UNKNOWN_REFRESH_MHZ: i32 = 0;

/// One `wl_output`, in the form the compositor advertises it.
#[derive(Debug, Clone, PartialEq)]
pub struct Advertised {
    /// The `wl_output` name, which is also what the chrome addresses.
    pub name: String,
    /// Its top-left corner in desktop coordinates.
    pub position: (i32, i32),
    /// Its size in logical units: the mode, turned by `transform`, over
    /// `scale`.
    pub logical: (i32, i32),
    /// The mode in physical pixels, as `wl_output.mode` states one — which is
    /// the hardware's own and so is *not* turned by `transform`. A monitor on
    /// its side scans out exactly as it did lying down.
    ///
    /// Carried rather than derived from the logical size. For the two desktops
    /// that are arithmetic it is that multiplication; for a real monitor it is
    /// the mode the connector is running, and multiplying a rounded logical
    /// size back up would land a pixel or two off the CRTC's own rectangle.
    pub mode: (i32, i32),
    /// Device pixels per logical pixel on this display.
    ///
    /// Fractional, because the scales a desk is used at are. `wl_output.scale`
    /// is an integer and is this rounded *up* —
    /// [`wl_output_scale`](Advertised::wl_output_scale) — so a client on a 1.2
    /// display draws at 2 and is downscaled, which is sharp, rather than at 1
    /// and stretched, which is the blurriness scaling exists to remove.
    /// `xdg_output` carries the logical size this made.
    pub scale: f64,
    /// Which way up the monitor is, as `wl_output.geometry` states it.
    pub transform: Transform,
    /// The panel's own name — `"<MAKE> <MODEL> <SERIAL>"` off its EDID — or
    /// empty for a display that has none.
    ///
    /// `wl_output.description`, and the other name an `output.profiles` entry
    /// may match. The *name* beside it stays `drm-<id>`: short, always there,
    /// and what clients are already on, so renaming outputs after their panels
    /// would move every client on every desktop for a string that is sometimes
    /// empty. Only the engine's displays have one — a config's arithmetic and
    /// a host's window are not panels.
    pub description: String,
    /// The panel's own size in millimetres, or [`UNKNOWN_PHYSICAL_MM`] where
    /// this output is not a panel at all.
    ///
    /// Only one of the three desktops has one. A described desktop is a
    /// config's arithmetic and a window-following one is a window, and neither
    /// is millimetres of glass; the engine's displays are monitors, and the
    /// engine is the process that read them.
    pub physical_mm: (i32, i32),
    /// The rate the panel is running at in mHz, or [`UNKNOWN_REFRESH_MHZ`]
    /// where nothing here has a mode to report. The same three desktops, the
    /// same one of them that answers.
    pub refresh_mhz: i32,
}

impl Advertised {
    /// The integer `wl_output.scale` for this display's density.
    ///
    /// Rounded *up*: a client asked for a scale draws that many pixels per
    /// logical one, and one drawing more than the display has is downscaled by
    /// the compositor and stays sharp, while one drawing fewer is stretched.
    /// The fractional value is not lost — `xdg_output` carries the logical
    /// size it produced, which is what a toolkit lays out against.
    ///
    /// Asserted rather than cast, for the same reason everything else here is:
    /// a density is validated positive and finite before it reaches an
    /// `Advertised`, so a scale that is not a positive integer is a bug one
    /// layer up rather than a display to advertise.
    pub fn wl_output_scale(&self) -> i32 {
        let ceiled = self.scale.ceil();
        if (1.0..=f64::from(i32::MAX)).contains(&ceiled) {
            ceiled as i32
        } else {
            // Carries the density, and not only because it is useful: a bare
            // `assert!` panics with a `&str` rather than a `String`, and every
            // other assertion here is an `expect` — so the message a caller
            // catching one has to reach for would depend on which one it was.
            panic!(
                "a display's density is a positive number a coordinate can hold, not {}",
                self.scale
            )
        }
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
            scale: as_measure(self.wl_output_scale()),
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
#[derive(Debug, Clone, PartialEq)]
pub struct Screens {
    outputs: Vec<Advertised>,
    size: (i32, i32),
    follows_the_window: bool,
    /// What the connectors behind these outputs have to be doing, where a
    /// profile said. Empty for every other desktop -- see
    /// [`Screens::scanout`].
    scanout: Vec<Connector>,
}

impl Screens {
    /// The outputs a configured desktop describes, one per display.
    ///
    /// Sizes and scales are the config's; positions are already normalized
    /// about the desktop's own corner, which is what `Desktop` is for.
    pub fn described(desktop: &Desktop) -> Screens {
        Screens {
            follows_the_window: false,
            scanout: Vec::new(),
            outputs: desktop
                .displays()
                .map(|display| {
                    let logical = (as_coordinate(display.size.0), as_coordinate(display.size.1));
                    let scale = as_coordinate(display.scale);
                    Advertised {
                        logical,
                        mode: multiplied(logical, scale),
                        name: display.name.clone(),
                        position: display.position,
                        scale: f64::from(scale),
                        // A config describes a desktop rather than a monitor,
                        // and nothing in one is bolted to a desk sideways: a
                        // described display states the size it *is*, so there
                        // is no mode to turn into it.
                        transform: Transform::Normal,
                        description: String::new(),
                        physical_mm: UNKNOWN_PHYSICAL_MM,
                        refresh_mhz: UNKNOWN_REFRESH_MHZ,
                    }
                })
                .collect(),
            size: (
                as_coordinate(desktop.size().0),
                as_coordinate(desktop.size().1),
            ),
        }
    }

    /// The outputs the engine reports, one per display DRM has.
    ///
    /// The third source of a display list, beside the config and Domicile's
    /// own window: on a tty the engine holds DRM master, so the screens are
    /// its reading and nobody else's. Not window-following for the same reason
    /// `described` is not -- these are the user's actual monitors, and there
    /// is no Domicile window on a tty to resize them with.
    ///
    /// Scale 1 because the engine reports none: see [`Display`]. The
    /// millimetres and the rate it *does* report are carried straight through,
    /// zeros included -- a connector with no physical size or no mode is an
    /// ordinary reading, and [`UNKNOWN_PHYSICAL_MM`] is what the engine sends
    /// for one.
    ///
    /// Positions are the engine's, unshifted. Ozone lays its displays out from
    /// the origin rightwards, so the desktop's corner is already (0, 0) and
    /// normalizing would be arithmetic over a fact rather than a fix.
    pub fn from_the_engine(displays: &[Display]) -> Screens {
        let outputs: Vec<Advertised> = displays
            .iter()
            .map(|display| {
                let logical = (as_coordinate(display.size.0), as_coordinate(display.size.1));
                Advertised {
                    logical,
                    // Unscaled and unturned, so the mode is the logical size:
                    // this is the engine's reading with nothing applied to it,
                    // which is what a desk no profile describes gets.
                    mode: logical,
                    name: name_of(display),
                    position: display.position,
                    scale: 1.0,
                    transform: Transform::Normal,
                    description: display.description.clone(),
                    physical_mm: display.physical_mm,
                    refresh_mhz: display.refresh_mhz,
                }
            })
            .collect();
        // `checked_add` for the reason `Advertised::bounds` gives one layer
        // down, and for one more: these coordinates are the engine's rather
        // than a validated config's, so nothing upstream has bounded them.
        let far = |at: i32, size: i32| {
            at.checked_add(size)
                .expect("a display's far edge fits a coordinate")
        };
        let size = outputs
            .iter()
            .map(|output| {
                (
                    far(output.position.0, output.logical.0),
                    far(output.position.1, output.logical.1),
                )
            })
            .reduce(|desktop, output| (desktop.0.max(output.0), desktop.1.max(output.1)))
            .expect("the engine reports at least one display");
        Screens {
            follows_the_window: false,
            scanout: Vec::new(),
            outputs,
            size,
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
            scanout: Vec::new(),
            outputs: vec![Advertised {
                logical,
                mode: multiplied(logical, scale),
                name: "domicile-0".to_string(),
                position: (0, 0),
                scale: f64::from(scale),
                transform: Transform::Normal,
                description: String::new(),
                physical_mm: UNKNOWN_PHYSICAL_MM,
                refresh_mhz: UNKNOWN_REFRESH_MHZ,
            }],
            size: logical,
        }
    }

    /// The outputs a matched profile makes of the monitors it matched.
    ///
    /// The fourth source of a display list, and the only one built from two:
    /// the *placement* is the config's — where each monitor goes, how dense it
    /// is, which way up — and everything about the panel itself is the
    /// engine's reading, carried through untouched. A profile says where a
    /// monitor is, not what it is.
    ///
    /// Not window-following, for the reason `described` and `from_the_engine`
    /// are not: these are the user's actual monitors, placed the way the user
    /// asked.
    pub fn from_the_layout(layout: &Layout, displays: &[Display]) -> Screens {
        Screens {
            follows_the_window: false,
            // By the engine's own id rather than the output's name. The
            // name is this compositor's -- `drm-<id>`, which it made up out
            // of the id to have something to call a `wl_output` -- and
            // handing it back would be asking the engine to parse its way
            // home through a format only this side knows.
            scanout: layout
                .scanout()
                .iter()
                .map(|display| Connector {
                    id: id_of(&display.name, displays),
                    enabled: display.enabled,
                    origin: display.origin,
                })
                .collect(),
            outputs: layout
                .placed()
                .map(|placed| {
                    // Present because the layout was built from these very
                    // displays, one entry per name that matched.
                    let display = displays
                        .iter()
                        .find(|display| name_of(display) == placed.name)
                        .expect("a layout only places displays the engine reported");
                    Advertised {
                        logical: (
                            as_coordinate(placed.logical.0),
                            as_coordinate(placed.logical.1),
                        ),
                        mode: (as_coordinate(placed.mode.0), as_coordinate(placed.mode.1)),
                        name: placed.name.clone(),
                        position: placed.position,
                        scale: placed.scale,
                        transform: placed.transform,
                        description: display.description.clone(),
                        physical_mm: display.physical_mm,
                        refresh_mhz: display.refresh_mhz,
                    }
                })
                .collect(),
            size: (
                as_coordinate(layout.size().0),
                as_coordinate(layout.size().1),
            ),
        }
    }

    /// The outputs, in the order the config wrote them.
    pub fn outputs(&self) -> impl Iterator<Item = &Advertised> {
        self.outputs.iter()
    }

    /// What the connectors behind these outputs have to be doing: which of
    /// them to light, and where each one's mode goes on the engine's own
    /// desktop.
    ///
    /// EMPTY IS NOT "LIGHT NOTHING". It is this compositor having no opinion,
    /// which is the case for every desktop but a profile's -- a described one
    /// is arithmetic, a nested one is a window, and the engine's own reading
    /// is already what the connectors are doing. The engine reads it as "the
    /// hardware decides", and that is load-bearing rather than tidy: a
    /// profile that turned a panel off stops matching the moment a monitor is
    /// unplugged, and something has to say the panel comes back on.
    pub fn scanout(&self) -> &[Connector] {
        &self.scanout
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
    ///
    /// `displays` is the engine's last reading of the monitors, empty on every
    /// nested run and on a tty before the first display event. It is here
    /// because the profiles are matched against it and an edit to them has to
    /// take effect now: the way a profile gets written is by saving it against
    /// the desk it is being written for, and one that waited for a monitor to
    /// be unplugged would be unusable. With no monitors read there is nothing
    /// to match, and the two rules above are the whole answer, as they were
    /// before profiles existed.
    pub fn reloaded_into(
        &self,
        output: &OutputConfig,
        nested: (u32, u32),
        displays: &[Display],
    ) -> Result<Option<Screens>, ConfigError> {
        match output.desktop() {
            Some(desktop) => Ok(Some(Screens::described(&desktop))),
            // Straight to the hotplug path, which is the same question from
            // the other side: these monitors, this config, which profile. That
            // it has already established the desktop is not described is why
            // this arm cannot come back `None`.
            None if !displays.is_empty() => self.replugged_into(displays, output),
            None if self.follows_the_window() => Ok(None),
            None => Ok(Some(Screens::nested(nested))),
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

    /// The desktop the engine's displays make, or `None` to leave this one be.
    ///
    /// [`reloaded_into`](Screens::reloaded_into)'s rule from the other side,
    /// and for the same reason: two sources both claim to know what the
    /// screens are, and only one of them can be the authority at a time. A
    /// *described* desktop is the user stating their monitors, so a reading
    /// off DRM does not overrule it -- a machine whose config describes a
    /// desktop wants that desktop whether or not the hardware agrees. With
    /// nothing described the engine is the authority, because on a tty it is
    /// the only one there is: it holds DRM master and the compositor has no
    /// card node of its own to read.
    ///
    /// A nested run never reaches the `Some` arm, because a nested engine does
    /// not report displays at all -- the browser only watches them on the
    /// platform that owns them. That is deliberate and not a coincidence to
    /// lean on: a Wayland engine's screen is the *host's* monitors, which are
    /// not this desktop's displays, and adopting them would take the desktop
    /// away from the window that defines it.
    ///
    /// **Asked of the config and not of this desktop, and that is the fix
    /// rather than a tidy-up.** This used to ask whether the desktop still
    /// followed Domicile's own window, which the *first* reading off DRM makes
    /// false -- so every hotplug after that one was read, matched and thrown
    /// away, and the desktop went on describing a monitor that had been
    /// unplugged. Whether a desktop is the config's to define is a fact about
    /// the config, which does not change when a monitor does.
    ///
    /// Three answers rather than two, because a profile brings a third:
    ///
    /// - `Err` is a profile that matched these monitors and cannot be applied
    ///   to them -- a scale that leaves one with no logical pixels, a
    ///   placement that spans further than a desktop can. Neither is reachable
    ///   at parse time, since both need a mode that arrives with the monitor.
    ///   The caller keeps the desktop that is up and surfaces the complaint,
    ///   which is the bargain `ConfigStore` already makes for an edit that
    ///   does not parse.
    /// - `Ok(None)` is a desktop the config describes outright, which DRM does
    ///   not overrule.
    /// - `Ok(Some(_))` is the desktop these monitors make: placed by the first
    ///   profile they are the set for, or left where the engine put them when
    ///   no profile names them.
    pub fn replugged_into(
        &self,
        displays: &[Display],
        output: &OutputConfig,
    ) -> Result<Option<Screens>, ConfigError> {
        if output.desktop().is_some() {
            Ok(None)
        } else {
            let connected: Vec<Connected> = displays
                .iter()
                .map(|display| Connected {
                    name: name_of(display),
                    description: display.description.clone(),
                    mode: display.size,
                })
                .collect();
            Ok(Some(match output.layout(&connected)? {
                Some(layout) => Screens::from_the_layout(&layout, displays),
                None => Screens::from_the_engine(displays),
            }))
        }
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

/// What the `wl_output` for one of the engine's displays is called.
///
/// The id ozone derives from the EDID, so it survives a hotplug: a monitor
/// unplugged and plugged back in keeps the output its clients are on, and a
/// profile that names it goes on naming it.
fn name_of(display: &Display) -> String {
    format!("drm-{}", display.id)
}

/// The engine's own id for the display this compositor calls `name`.
///
/// The inverse of [`name_of`], and looked up rather than parsed back out of
/// the name: the format is this side's invention, so the list the names were
/// built from is the authority on which id made which.
fn id_of(name: &str, displays: &[Display]) -> i64 {
    displays
        .iter()
        .find(|display| name_of(display) == name)
        .expect("a layout only places displays the engine reported")
        .id
}

/// A logical size in physical pixels, for the two desktops whose mode is that
/// multiplication rather than a monitor's own.
///
/// Checked rather than multiplied, for the reason `Desktop::of` gives one
/// layer down: a plain `*` would wrap in release into a mode that is a
/// plausible screen of the wrong size.
///
/// No production caller can reach the panic. `DisplayConfig::validate` bounds
/// a described display's size times its own scale; `Screens::nested` uses
/// scale 1 on a size `Config::validate` bounds; and `adopt_window_scale`
/// divides the window's physical size by the scale before multiplying it back,
/// so the product is at most the window's own size.
fn multiplied(logical: (i32, i32), scale: i32) -> (i32, i32) {
    let times = |measure: i32| {
        measure
            .checked_mul(scale)
            .expect("a display's mode fits a coordinate")
    };
    (times(logical.0), times(logical.1))
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
            r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[[output.displays]]
name = "right"
position = [1920, 0]
size = [2560, 1440]
scale = 2
"#,
        ));
        assert_eq!(
            screens.outputs().cloned().collect::<Vec<_>>(),
            vec![
                Advertised {
                    logical: (1920, 1080),
                    mode: (1920, 1080),
                    name: "left".into(),
                    position: (0, 0),
                    scale: 1.0,
                    transform: Transform::Normal,
                    description: String::new(),
                    // A described display is a config's arithmetic rather
                    // than millimetres of glass, and no config states a rate.
                    // Both stay the protocol's own word for "no such number",
                    // however much the engine has to say about a real panel.
                    physical_mm: UNKNOWN_PHYSICAL_MM,
                    refresh_mhz: UNKNOWN_REFRESH_MHZ,
                },
                Advertised {
                    logical: (2560, 1440),
                    mode: (5120, 2880),
                    name: "right".into(),
                    position: (1920, 0),
                    scale: 2.0,
                    transform: Transform::Normal,
                    description: String::new(),
                    physical_mm: UNKNOWN_PHYSICAL_MM,
                    refresh_mhz: UNKNOWN_REFRESH_MHZ,
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
            r#"
[[output.displays]]
name = "retina"
size = [2560, 1440]
scale = 2
"#,
        ));
        let retina = screens.outputs().next().expect("the one display");
        assert_eq!(retina.mode, (5120, 2880));
    }

    #[test]
    fn a_mode_too_big_to_describe_says_so_rather_than_wrapping() {
        // `Advertised` is constructible without a validated config — the
        // window-following path takes whatever size the window is — so the
        // multiplication asserts rather than assumes. Wrapping would advertise
        // a negative screen, in release, with nothing to say so.
        let panicked =
            std::panic::catch_unwind(|| Screens::following_the_window((2_000_000_000, 1080), 2))
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
        // Two, because a lone display normalizes to the origin, and `[0, 0]` is
        // what a `described` that dropped the position would produce anyway.
        let screens = Screens::described(&desktop(
            r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[[output.displays]]
name = "right"
position = [1920, 120]
size = [2560, 1440]
scale = 2
"#,
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
            mode: (-1920, 1080),
            name: "impossible".into(),
            position: (0, 0),
            scale: 1.0,
            transform: Transform::Normal,
            description: String::new(),
            physical_mm: UNKNOWN_PHYSICAL_MM,
            refresh_mhz: UNKNOWN_REFRESH_MHZ,
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
            mode: (1920, -1080),
            name: "impossible".into(),
            position: (0, 0),
            scale: 1.0,
            transform: Transform::Normal,
            description: String::new(),
            physical_mm: UNKNOWN_PHYSICAL_MM,
            refresh_mhz: UNKNOWN_REFRESH_MHZ,
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

        // And the density, which `described` rounds up into the scale it
        // sends. It is caught one step earlier than the two sizes are —
        // `wl_output_scale` refuses it before `as_measure` ever sees it — and
        // the wrong answer it refuses is the worse of the two: a negative
        // density folded to its magnitude is a display the chrome draws every
        // client on at some enormous scale.
        let inverted = Advertised {
            logical: (1920, 1080),
            mode: (1920, 1080),
            name: "impossible".into(),
            position: (0, 0),
            scale: -2.0,
            transform: Transform::Normal,
            description: String::new(),
            physical_mm: UNKNOWN_PHYSICAL_MM,
            refresh_mhz: UNKNOWN_REFRESH_MHZ,
        };
        let panicked = std::panic::catch_unwind(move || inverted.described())
            .expect_err("a negative density must not be described to the chrome");
        assert!(
            panicked.downcast_ref::<String>().is_some_and(|said| said
                .starts_with("a display's density is a positive number a coordinate can hold")),
            "the density asserts before the sizes do, and it said {:?}",
            panicked.downcast_ref::<String>()
        );
    }

    /// The two-display desktop the entered-output cases are argued against.
    fn side_by_side() -> Screens {
        Screens::described(&desktop(
            r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[[output.displays]]
name = "right"
position = [1920, 0]
size = [1280, 1024]
"#,
        ))
    }

    /// A window of `size` with its top-left corner at `at`.
    ///
    /// Built here rather than from a placement the chrome sent: the chrome no
    /// longer reports where its boxes are, and what this file asks of a box is
    /// only which displays it overlaps.
    fn window_at(at: (f64, f64), size: (f64, f64)) -> Bounds {
        Bounds {
            min: Point::new(at.0, at.1),
            max: Point::new(at.0 + size.0, at.1 + size.1),
        }
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
        // maximized window on the left-hand screen would be on both.
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
            mode: (1920, 1080),
            name: "impossible".into(),
            position: (i32::MAX - 1, 0),
            scale: 1.0,
            transform: Transform::Normal,
            description: String::new(),
            physical_mm: UNKNOWN_PHYSICAL_MM,
            refresh_mhz: UNKNOWN_REFRESH_MHZ,
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
    fn the_nested_size_is_the_desktop_when_nothing_described_one() {
        let screens = Screens::nested((1280, 800));
        assert_eq!(screens.size(), (1280, 800));
        assert!(screens.follows_the_window());
        let only = screens.outputs().next().expect("the one output");
        // Scale 1, so the mode is the size: the window has not said otherwise
        // yet, and inventing a density here would make every fresh run sharp
        // or blurry by default.
        assert_eq!(only.scale, 1.0);
        assert_eq!(only.mode, (1280, 800));
    }

    #[test]
    fn a_described_desktop_is_not_the_window() {
        // The point of describing one: a window dragged smaller shows less of
        // the desktop rather than making the desktop smaller.
        let screens = Screens::described(&desktop(
            r#"
[[output.displays]]
name = "only"
size = [800, 600]
"#,
        ));
        assert!(!screens.follows_the_window());
    }

    #[test]
    fn a_tty_desktop_is_the_displays_the_engine_reported() {
        // The engine holds DRM, so on a tty it is the only thing that knows
        // what the screens are. Before this the compositor had no third
        // source and fell back to the window it did not have, advertising a
        // 1050x1900 desktop at a CRTC running 2880x1920.
        let screens = Screens::from_the_engine(&[
            Display {
                id: 1,
                description: "BOE NE135A1M-NY1".into(),
                position: (0, 0),
                size: (2880, 1920),
                physical_mm: (597, 336),
                refresh_mhz: 59_997,
            },
            Display {
                id: 2,
                description: String::new(),
                position: (2880, 0),
                size: (1920, 1080),
                physical_mm: (0, 0),
                refresh_mhz: 0,
            },
        ]);
        assert_eq!(
            screens.outputs().cloned().collect::<Vec<_>>(),
            vec![
                Advertised {
                    logical: (2880, 1920),
                    mode: (2880, 1920),
                    name: "drm-1".into(),
                    position: (0, 0),
                    scale: 1.0,
                    transform: Transform::Normal,
                    // The panel names itself and the second display does not,
                    // which is the ordinary pair: a laptop panel carries an
                    // EDID name and a projector carries none.
                    description: "BOE NE135A1M-NY1".into(),
                    // The panel's own, carried rather than invented -- and the
                    // second display's zeros carried just as faithfully,
                    // because a connector that reports no millimetres and no
                    // mode is ordinary and `wl_output` has a word for it.
                    physical_mm: (597, 336),
                    refresh_mhz: 59_997,
                },
                Advertised {
                    logical: (1920, 1080),
                    mode: (1920, 1080),
                    name: "drm-2".into(),
                    position: (2880, 0),
                    scale: 1.0,
                    transform: Transform::Normal,
                    description: String::new(),
                    physical_mm: UNKNOWN_PHYSICAL_MM,
                    refresh_mhz: UNKNOWN_REFRESH_MHZ,
                },
            ]
        );
        assert_eq!(screens.size(), (4800, 1920));
        // The engine's displays are as much a fact about the user's screens as
        // a described desktop is, so Domicile's own window does not redefine
        // them -- there is no window on a tty to redefine them with.
        assert!(!screens.follows_the_window());
    }

    /// The laptop on its own, naming itself the way its EDID does.
    ///
    /// A function rather than a `const`, which is what carrying a panel's name
    /// costs: a `String` that is not empty cannot be built in a constant.
    fn plugged_in() -> Vec<Display> {
        vec![Display {
            id: 1,
            description: LAPTOP_PANEL.into(),
            position: (0, 0),
            size: (2880, 1920),
            physical_mm: (597, 336),
            refresh_mhz: 59_997,
        }]
    }

    /// What the laptop's EDID calls it, which is what a profile can name.
    const LAPTOP_PANEL: &str = "BOE NE135A1M-NY1";

    /// The output settings `text` configures.
    fn output(text: &str) -> OutputConfig {
        Config::parse(text).expect("the config should parse").output
    }

    /// A config that describes no desktop and names no profiles — the one the
    /// engine's own reading of DRM is the whole answer under.
    fn unconfigured() -> OutputConfig {
        output("")
    }

    #[test]
    fn a_described_desktop_is_not_overruled_by_what_the_engine_sees() {
        // The user said what their screens are. A reading off DRM is the same
        // kind of claim `reloaded_into` refuses to let the config make about a
        // window-following desktop, from the other side.
        let described_in_the_config = output(LEFT);
        assert_eq!(
            described(LEFT)
                .replugged_into(&plugged_in(), &described_in_the_config)
                .expect("a described desktop is not a layout that failed"),
            None
        );
    }

    #[test]
    fn a_desktop_nothing_described_is_the_engines_to_define() {
        let taken = Screens::nested((1280, 800))
            .replugged_into(&plugged_in(), &unconfigured())
            .expect("nothing here can fail to be applied")
            .expect("an undescribed desktop takes the engine's displays");
        assert_eq!(taken.size(), (2880, 1920));
        assert!(!taken.follows_the_window());
    }

    #[test]
    fn every_hotplug_is_applied_and_not_only_the_first() {
        // The requirement the whole mechanism rests on, and the one thing that
        // was wrong before it: this asked whether the desktop still followed
        // Domicile's own window, which the *first* reading off DRM makes false
        // — so a monitor unplugged after that was read, matched and thrown
        // away, and the desktop kept describing a screen that was no longer
        // plugged in.
        let one_monitor = Screens::nested((1280, 800))
            .replugged_into(&plugged_in(), &unconfigured())
            .expect("nothing here can fail to be applied")
            .expect("an undescribed desktop takes the engine's displays");
        let both = one_monitor
            .replugged_into(&two_plugged_in(), &unconfigured())
            .expect("nothing here can fail to be applied")
            .expect("a desktop the engine defined is still the engine's");
        assert_eq!(both.size(), (4800, 1920));
    }

    #[test]
    fn a_profile_places_the_monitors_it_matched() {
        // The panel at 1.5 and the monitor at 1.2, the monitor stood on its
        // side, and the panel centered underneath it — the arrangement this
        // exists for. Everything the engine read that the config says nothing
        // about is carried through: the mode, the millimetres and the rate are
        // the panel's own and no profile invents them.
        let placed = Screens::nested((1280, 800))
            .replugged_into(&two_plugged_in(), &output(HOME_OFFICE))
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(
            placed.outputs().cloned().collect::<Vec<_>>(),
            vec![
                Advertised {
                    // The mode stood on its side and divided by 1.2: 1080 and
                    // 1920 become 900 and 1600. The mode itself does not turn,
                    // because the connector scans out exactly as it did before
                    // the monitor was bolted to the desk sideways.
                    logical: (900, 1600),
                    mode: (1920, 1080),
                    name: "drm-2".into(),
                    position: (0, 0),
                    // The density, not `wl_output.scale`, which is an integer
                    // and is what this is rounded up to: a client drawing at 2
                    // on a 1.2 display is downscaled and stays sharp, and
                    // `xdg_output` carries the 1.2 the logical size came from.
                    scale: 1.2,
                    transform: Transform::Rotate270,
                    // Carried through from the engine's reading. A profile
                    // placed this monitor; it did not rename it.
                    description: DESK_MONITOR.into(),
                    physical_mm: UNKNOWN_PHYSICAL_MM,
                    refresh_mhz: UNKNOWN_REFRESH_MHZ,
                },
                Advertised {
                    logical: (1920, 1280),
                    mode: (2880, 1920),
                    name: "drm-1".into(),
                    position: (0, 1920),
                    scale: 1.5,
                    transform: Transform::Normal,
                    description: LAPTOP_PANEL.into(),
                    physical_mm: (597, 336),
                    refresh_mhz: 59_997,
                },
            ]
        );
        assert_eq!(placed.size(), (1920, 3200));
        assert!(!placed.follows_the_window());
    }

    #[test]
    fn a_profile_says_which_connectors_to_light_and_where() {
        // The half of a profile the desktop above cannot carry. `outputs` is
        // logical and turned and has the disabled displays already dropped;
        // this is what a CRTC has to be set to for that desktop to exist at
        // all, and it is the engine that owns the CRTCs.
        let placed = Screens::nested((1280, 800))
            .replugged_into(&two_plugged_in(), &output(HOME_OFFICE))
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(
            placed.scanout(),
            vec![
                Connector {
                    id: 2,
                    enabled: true,
                    origin: (0, 0),
                },
                Connector {
                    id: 1,
                    enabled: true,
                    // Where the monitor's own mode ends. The profile stacks
                    // these two vertically and the connectors are stepped
                    // across: what is laid out on a desktop and what is
                    // scanned out of a card are two arrangements.
                    origin: (1920, 0),
                },
            ]
        );
    }

    #[test]
    fn a_desktop_no_profile_placed_leaves_the_connectors_to_the_engine() {
        // An empty scanout is not "light nothing": it is the compositor
        // saying it has no opinion, which is what every desktop but a
        // profile's has. It matters because it has to UNDO one -- a profile
        // that turned a panel off stops matching the moment a monitor is
        // unplugged, and the panel has to come back on.
        let unplanned = Screens::nested((1280, 800))
            .replugged_into(&plugged_in(), &output(HOME_OFFICE))
            .expect("a profile that does not match cannot fail to apply")
            .expect("an undescribed desktop is still the engine's to define");
        assert!(unplanned.scanout().is_empty());
    }

    #[test]
    fn a_profile_can_name_a_monitor_by_its_panel() {
        // The whole point of carrying a description up to here. The profile
        // below names neither monitor `drm-1` or `drm-2` -- it names them the
        // way their EDIDs do, which is the way a person can.
        let placed = Screens::nested((1280, 800))
            .replugged_into(
                &two_plugged_in(),
                &output(&format!(
                    r#"
[[output.profiles]]
name = "by-panel"

[[output.profiles.displays]]
display = "{DESK_MONITOR}"
position = [0, 0]
scale = 1.2

[[output.profiles.displays]]
display = "{LAPTOP_PANEL}"
position = [0, 1080]
scale = 1.5
"#
                )),
            )
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");

        // The outputs keep the names their clients are on, however the config
        // found them.
        assert_eq!(
            placed
                .outputs()
                .map(|o| o.name.as_str())
                .collect::<Vec<_>>(),
            vec!["drm-2", "drm-1"]
        );
        assert_eq!(
            placed.outputs().map(|o| o.logical).collect::<Vec<_>>(),
            vec![(1600, 900), (1920, 1280)]
        );
    }

    #[test]
    fn monitors_no_profile_names_are_left_where_the_engine_put_them() {
        // A config with profiles in it is not a config that has a profile for
        // *this* desk. The answer is the engine's own reading rather than an
        // error or an empty desktop: a monitor plugged into a laptop on a
        // train is a desktop, it is just not one anybody wrote down.
        let unplanned = Screens::nested((1280, 800))
            .replugged_into(&plugged_in(), &output(HOME_OFFICE))
            .expect("a profile that does not match cannot fail to apply")
            .expect("an undescribed desktop is still the engine's to define");
        assert_eq!(unplanned, Screens::from_the_engine(&plugged_in()));
    }

    #[test]
    fn a_profile_that_cannot_be_applied_leaves_the_desktop_alone() {
        // The positions are the config's and the modes are the hardware's, so
        // a profile can only be found unapplicable once a monitor is plugged
        // in. The desktop that is up keeps working and the complaint names
        // what is wrong with the config, which is the same bargain
        // `ConfigStore` makes for an edit that does not parse.
        let err = Screens::nested((1280, 800))
            .replugged_into(
                &plugged_in(),
                &output(
                    r#"
[[output.profiles]]
name = "too-small"
[[output.profiles.displays]]
display = "drm-1"
scale = 4000
"#,
                ),
            )
            .expect_err("a profile that cannot be applied says so");
        assert!(
            err.to_string().contains("too-small"),
            "the complaint should name the profile: {err}"
        );
    }

    /// The laptop and one monitor, both naming themselves.
    fn two_plugged_in() -> Vec<Display> {
        vec![
            Display {
                id: 1,
                description: LAPTOP_PANEL.into(),
                position: (0, 0),
                size: (2880, 1920),
                physical_mm: (597, 336),
                refresh_mhz: 59_997,
            },
            Display {
                id: 2,
                description: DESK_MONITOR.into(),
                position: (2880, 0),
                size: (1920, 1080),
                physical_mm: (0, 0),
                refresh_mhz: 0,
            },
        ]
    }

    /// And what the monitor's does.
    const DESK_MONITOR: &str = "DEL DELL U3219Q G3MS413";

    /// The desk `two_plugged_in` reports, arranged: the monitor
    /// on its side above, the laptop panel centered below it.
    ///
    /// Written with the monitor first, so that the order the outputs come back
    /// in is the profile's rather than the engine's.
    const HOME_OFFICE: &str = r#"
[[output.profiles]]
name = "desk"
[[output.profiles.displays]]
display = "drm-2"
position = [0, 0]
scale = 1.2
transform = "rotate-270"

[[output.profiles.displays]]
display = "drm-1"
position = [0, 1920]
scale = 1.5
"#;

    #[test]
    #[should_panic(expected = "the engine reports at least one display")]
    fn a_desktop_of_no_displays_is_refused_rather_than_sized_zero() {
        // DrmScreen answers with kDisplaylessBounds rather than an empty list,
        // so this is an engine that broke its own contract. A zero-sized
        // desktop is not a smaller desktop: every window lands off it.
        let _ = Screens::from_the_engine(&[]);
    }

    #[test]
    fn an_undescribed_desktop_is_whatever_window_domicile_got() {
        // The original behavior, and all a nested compositor can manage
        // without being told: one output, sized and scaled by the window.
        let screens = Screens::following_the_window((1280, 800), 2);
        assert_eq!(
            screens.outputs().cloned().collect::<Vec<_>>(),
            vec![Advertised {
                logical: (1280, 800),
                mode: (2560, 1600),
                // The name every client that has only ever seen one output has
                // already seen.
                name: "domicile-0".into(),
                position: (0, 0),
                scale: 2.0,
                transform: Transform::Normal,
                description: String::new(),
                // A window is not a panel: the desktop this output describes is
                // whatever box the host gave Domicile, which has no millimetres
                // and no mode of its own to report.
                physical_mm: UNKNOWN_PHYSICAL_MM,
                refresh_mhz: UNKNOWN_REFRESH_MHZ,
            }]
        );
        assert_eq!(screens.size(), (1280, 800));
        assert!(screens.follows_the_window());
    }

    /// The screens a desktop made of `entries` describes.
    ///
    /// `entries` is the display list rather than a whole config: these tests
    /// build desktops by naming which displays are in them, and in what order.
    /// Each entry is a whole `[[output.displays]]` block, so they are
    /// concatenated rather than joined -- an array of tables in TOML is the
    /// blocks one after another, and the order they appear in is the order the
    /// desktop is in, which is what these tests are about.
    fn described(entries: &str) -> Screens {
        Screens::described(&desktop(entries))
    }

    const LEFT: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;
    const RIGHT: &str = r#"
[[output.displays]]
name = "right"
position = [1920, 0]
size = [2560, 1440]
"#;

    #[test]
    fn a_desktop_that_did_not_change_rearranges_into_nothing() {
        let before = described(&format!("{LEFT}{RIGHT}"));
        let after = described(&format!("{LEFT}{RIGHT}"));
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
        let after = described(&format!("{LEFT}{RIGHT}"));
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
        let before = described(&format!("{LEFT}{RIGHT}"));
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
        let after = described(
            r#"
[[output.displays]]
name = "left"
size = [3840, 2160]
scale = 2
"#,
        );
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
        let after = described(
            r#"
[[output.displays]]
name = "main"
size = [1920, 1080]
"#,
        );
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
        let before = described(&format!("{LEFT}{RIGHT}"));
        let after = described(&format!("{RIGHT}{LEFT}"));
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
        let before = described(&format!("{LEFT}{RIGHT}"));
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
        let config = output(LEFT);
        let described = desktop(LEFT);
        assert_eq!(
            now.reloaded_into(&config, (1280, 800), NOTHING_PLUGGED_IN)
                .expect("a described desktop cannot fail to be applied"),
            Some(Screens::described(&described))
        );
    }

    #[test]
    fn a_reload_re_matches_the_monitors_the_engine_last_read() {
        // Editing the profiles is the other way the layout changes, and
        // waiting for a monitor to be unplugged before it takes effect would
        // make the file unusable: the way a profile gets written is by
        // reloading it against the desk it is being written for.
        //
        // The monitors are the engine's last reading rather than anything the
        // config knows, which is why this needs them passed in at all. With
        // none -- a nested run, or a tty before the first display event -- the
        // rules below are the ones that were here before profiles existed.
        let placed = Screens::from_the_engine(&two_plugged_in())
            .reloaded_into(&output(HOME_OFFICE), (1280, 800), &two_plugged_in())
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(placed.size(), (1920, 3200));
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
        assert_eq!(
            now.reloaded_into(&unconfigured(), (1280, 800), NOTHING_PLUGGED_IN)
                .expect("an undescribed config cannot fail to be applied"),
            None
        );
    }

    #[test]
    fn a_reload_that_stopped_describing_displays_hands_the_desktop_back() {
        // The other direction, and not the same as the case above: this
        // desktop was the config's, the config has stopped claiming it, and
        // there is nothing to keep. `nested_size` is where the window takes
        // over — its next resize or density change corrects it, which is
        // exactly what an undescribed desktop is.
        let now = described(&format!("{LEFT}{RIGHT}"));
        assert_eq!(
            now.reloaded_into(&unconfigured(), (1280, 800), NOTHING_PLUGGED_IN)
                .expect("an undescribed config cannot fail to be applied"),
            Some(Screens::nested((1280, 800)))
        );
    }

    /// A run the engine has never reported displays for: every nested one, and
    /// a tty before the first display event arrives.
    const NOTHING_PLUGGED_IN: &[Display] = &[];
}
