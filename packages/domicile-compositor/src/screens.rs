//! The `wl_output`s the compositor advertises, and which source defines the
//! desktop.
//!
//! - **Described:** `output.displays` defines the desktop outright.
//! - **Placed:** a matching `output.profiles` entry places the monitors DRM
//!   reports. Re-matched on every hotplug and reload.
//! - **The engine's reading:** monitors no profile matches, as ozone laid them
//!   out, unscaled and unrotated.
//! - **The window:** a nested run with nothing described. The window is the
//!   desktop.
//!
//! [`Screens::reloaded_into`] and [`Screens::replugged_into`] pick the source.
//! See `docs/DISPLAYS.md`. Kept free of Smithay so it can be unit tested.

use domicile_config::{ConfigError, Connected, Desktop, Layout, OutputConfig, Transform};
use domicile_protocol::{DisplayInfo, DisplayTransform};
use domicile_scene::{Bounds, Point};

use crate::engine::{Connector, Display};
use crate::pnp_ids::Vendors;

/// The `wl_output` physical size for an output with no known size.
///
/// Zero is the protocol's value for "doesn't make sense for this output", which
/// clients check instead of dividing by it.
pub const UNKNOWN_PHYSICAL_MM: (i32, i32) = (0, 0);

/// The `wl_output` refresh rate, in mHz, for an output with no known rate.
///
/// Zero per the protocol. Clients are paced by `wl_surface.frame` anyway.
pub const UNKNOWN_REFRESH_MHZ: i32 = 0;

/// The placeholder desktop size, in logical units, before a real one is known.
///
/// Every run needs an output from startup, before DRM reports a monitor or the
/// nested window reports its size. Both replace this almost immediately, so it
/// is not configurable. Scale 1 avoids guessing a density.
const UNDESCRIBED_DESKTOP: (i32, i32) = (1280, 800);

/// One `wl_output` as the compositor advertises it.
#[derive(Debug, Clone, PartialEq)]
pub struct Advertised {
    /// The `wl_output` name, which is also what the chrome addresses.
    pub name: String,
    /// Its top-left corner in desktop coordinates.
    pub position: (i32, i32),
    /// Its size in logical units: the mode, turned by `transform`, over
    /// `scale`.
    pub logical: (i32, i32),
    /// The mode in physical pixels. Not rotated by `transform`, since the
    /// hardware scans out the same way either way.
    ///
    /// Stored rather than derived from the logical size, because multiplying a
    /// rounded logical size back up can miss the CRTC's mode by a pixel or two.
    pub mode: (i32, i32),
    /// Device pixels per logical pixel. Fractional.
    ///
    /// `wl_output.scale` sends it rounded up (see
    /// [`wl_output_scale`](Advertised::wl_output_scale)); `xdg_output` carries
    /// the resulting logical size.
    pub scale: f64,
    /// Which way up the monitor is, as `wl_output.geometry` states it.
    pub transform: Transform,
    /// The panel's `"<MAKE> <MODEL> <SERIAL>"` from its EDID, with the maker
    /// spelled out from hwdata's `pnp.ids` when known, or empty.
    ///
    /// Sent as `wl_output.description`. Profiles match either maker spelling.
    /// The output name stays `drm-<id>` so clients keep their output. Only the
    /// engine's displays have one. See "Monitor names" in `docs/DISPLAYS.md`.
    pub description: String,
    /// The panel's size in millimeters, or [`UNKNOWN_PHYSICAL_MM`]. Only the
    /// engine's displays report one.
    pub physical_mm: (i32, i32),
    /// The refresh rate in mHz, or [`UNKNOWN_REFRESH_MHZ`]. Only the engine's
    /// displays report one.
    pub refresh_mhz: i32,
}

impl Advertised {
    /// The integer `wl_output.scale` for this display's density.
    ///
    /// Rounded up: a client drawing more pixels than needed is downscaled and
    /// stays sharp, while one drawing fewer is stretched and blurry.
    ///
    /// Panics on a non-positive or non-finite density. Densities are validated
    /// upstream, so that is a bug.
    pub fn wl_output_scale(&self) -> i32 {
        let ceiled = self.scale.ceil();
        if (1.0..=f64::from(i32::MAX)).contains(&ceiled) {
            ceiled as i32
        } else {
            // `panic!` rather than `assert!` so the payload is a `String`, like
            // every other panic here.
            panic!(
                "a display's density is a positive number a coordinate can hold, not {}",
                self.scale
            )
        }
    }

    /// The rectangle this output occupies on the desktop, in logical units,
    /// which is what windows are placed against.
    pub fn bounds(&self) -> Bounds {
        // `Advertised` is unvalidated, so check for overflow. A wrapped edge
        // would put `max` below `min`, which overlaps nothing and silently puts
        // every window on every output.
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

    /// This output as sent to the chrome.
    ///
    /// Panics on a negative size or scale instead of folding it to a plausible
    /// positive value.
    pub fn described(&self) -> DisplayInfo {
        DisplayInfo {
            name: self.name.clone(),
            position: [self.position.0, self.position.1],
            scale: as_measure(self.wl_output_scale()),
            size: [as_measure(self.logical.0), as_measure(self.logical.1)],
            mode: [as_measure(self.mode.0), as_measure(self.mode.1)],
            transform: as_wire_transform(self.transform),
        }
    }
}

/// A configured transform as the protocol spells it.
///
/// `domicile-config` and `domicile-protocol` do not depend on each other, so
/// each has its own transform type.
fn as_wire_transform(transform: Transform) -> DisplayTransform {
    match transform {
        Transform::Normal => DisplayTransform::Normal,
        Transform::Rotate90 => DisplayTransform::Rotate90,
        Transform::Rotate180 => DisplayTransform::Rotate180,
        Transform::Rotate270 => DisplayTransform::Rotate270,
    }
}

/// Where one output of a rearranged desktop comes from, one per output of the
/// new desktop, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// The `wl_output` at this index of the old list, updated in place.
    ///
    /// Kept even when size or scale changed: replacing the global looks to
    /// clients like an unplug.
    Kept(usize),
    /// No old output has this name, so one is created.
    New,
}

/// How to turn the advertised outputs into another desktop.
///
/// Outputs are matched by name, which is how the shell addresses a `<Screen>`.
/// A renamed display is a different display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rearrangement {
    /// One per display of the new desktop, in its order.
    pub slots: Vec<Slot>,
    /// Indices into the old list whose globals must be destroyed, ascending.
    ///
    /// Separate from `slots` because it indexes the old list.
    pub retired: Vec<usize>,
}

/// Every output the compositor advertises, and the desktop they make up.
#[derive(Debug, Clone, PartialEq)]
pub struct Screens {
    outputs: Vec<Advertised>,
    size: (i32, i32),
    follows_the_window: bool,
    /// Connector settings from a profile. Empty for every other desktop; see
    /// [`Screens::scanout`].
    scanout: Vec<Connector>,
}

impl Screens {
    /// The outputs a configured desktop describes, one per display, with
    /// positions already normalized by `Desktop`.
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
                        // A described display states its logical size, so there
                        // is no rotation to apply.
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

    /// The outputs the engine reports, one per DRM display, unplaced by any
    /// profile.
    ///
    /// - Scale 1, because the engine reports none (see [`Display`]).
    /// - Millimeters and refresh rate pass through, zeros included.
    /// - Positions are the engine's. Ozone lays displays out from the origin,
    ///   so there is nothing to normalize.
    pub fn from_the_engine(displays: &[Display], vendors: &Vendors) -> Screens {
        let outputs: Vec<Advertised> = displays
            .iter()
            .map(|display| {
                let logical = (as_coordinate(display.size.0), as_coordinate(display.size.1));
                Advertised {
                    logical,
                    // Unscaled and unrotated, so the mode is the logical size.
                    mode: logical,
                    name: name_of(display),
                    position: display.position,
                    scale: 1.0,
                    transform: Transform::Normal,
                    description: advertised_description(display, vendors),
                    physical_mm: display.physical_mm,
                    refresh_mhz: display.refresh_mhz,
                }
            })
            .collect();
        // Engine coordinates are not validated upstream, so check for overflow.
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

    /// The single output a run with no described desktop starts on.
    ///
    /// [`UNDESCRIBED_DESKTOP`] is logical, so the mode scales with density
    /// instead of the desktop shrinking. The window resizes it later.
    pub fn nested() -> Screens {
        Screens::following_the_window(UNDESCRIBED_DESKTOP, 1)
    }

    /// The single output that follows Domicile's own window.
    ///
    /// Always named `domicile-0`, so clients stay on it across resizes.
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

    /// The outputs a matched profile makes of the engine's displays.
    ///
    /// The profile sets position, scale and rotation. The panel's own
    /// properties come from the engine's reading.
    pub fn from_the_layout(layout: &Layout, displays: &[Display], vendors: &Vendors) -> Screens {
        Screens {
            follows_the_window: false,
            // By the engine's id: `drm-<id>` is this compositor's naming, which
            // the engine does not know.
            scanout: layout
                .scanout()
                .iter()
                .map(|display| Connector {
                    id: id_of(&display.name, displays),
                    enabled: display.enabled,
                    origin: display.origin,
                    transform: display.transform,
                    scale: display.scale,
                    desk: display.desk,
                })
                .collect(),
            outputs: layout
                .placed()
                .map(|placed| {
                    // The layout was built from these displays.
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
                        description: advertised_description(display, vendors),
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

    /// The monitors as screen casts see them.
    ///
    /// On a tty each engine display is captured on its own. A nested desktop
    /// is one capture of Domicile's window, which the engine names zero, and
    /// one screen named after the first output.
    pub fn cast_screens(&self) -> Vec<crate::casting::Screen> {
        let engine: Vec<_> = self
            .outputs
            .iter()
            .filter_map(|output| {
                Some(crate::casting::Screen {
                    name: output.name.clone(),
                    display: display_id_of(&output.name)?,
                    desk: (
                        output.position.0,
                        output.position.1,
                        output.logical.0,
                        output.logical.1,
                    ),
                    scale: output.scale,
                    upright: output.transform == Transform::Normal,
                })
            })
            .collect();
        if !engine.is_empty() {
            return engine;
        }
        let first = self
            .outputs
            .first()
            .expect("every desktop advertises an output");
        vec![crate::casting::Screen {
            name: first.name.clone(),
            display: 0,
            desk: (0, 0, self.size.0, self.size.1),
            scale: self
                .outputs
                .iter()
                .map(|output| output.scale)
                .fold(f64::MIN, f64::max),
            upright: true,
        }]
    }

    /// The monitors a screen cast may pick, each named by its panel.
    pub fn cast_monitors(&self) -> Vec<crate::casting::Candidate> {
        self.cast_screens()
            .into_iter()
            .map(|screen| crate::casting::Candidate {
                title: self
                    .outputs
                    .iter()
                    .find(|output| output.name == screen.name)
                    .expect("every cast screen is an output")
                    .description
                    .clone(),
                app_id: String::new(),
                bounds: Some(crate::casting::Region {
                    position: (screen.desk.0, screen.desk.1),
                    size: (screen.desk.2, screen.desk.3),
                }),
                source: crate::casting::Source::Monitor(screen.name),
            })
            .collect()
    }

    /// Connector settings for the engine: which to light and where each mode
    /// goes.
    ///
    /// Empty means the hardware decides, not "light nothing". Only a profile's
    /// desktop has connector settings. When a profile that turned a panel off
    /// stops matching (e.g. after an unplug), the empty list relights the
    /// panel. See "Which connectors light" in `docs/DISPLAYS.md`.
    pub fn scanout(&self) -> &[Connector] {
        &self.scanout
    }

    /// The desktop a reloaded config makes, or `None` to keep this one.
    ///
    /// - With `output.displays`, the config defines the desktop.
    /// - With none and monitors read, the profiles are re-matched against
    ///   `displays`, so an edited profile applies on save. `displays` is the
    ///   engine's last reading, empty when nested or before the first display
    ///   event.
    /// - With none and no monitors read, the window defines it, through
    ///   `adopt_window_scale`. Rebuilding from the config would reset it to the
    ///   scale-1 placeholder. This matters because the watcher watches the
    ///   config's directory, so unrelated files trigger reloads.
    /// - A desktop that stops being described falls back to
    ///   [`UNDESCRIBED_DESKTOP`].
    pub fn reloaded_into(
        &self,
        output: &OutputConfig,
        displays: &[Display],
        vendors: &Vendors,
    ) -> Result<Option<Screens>, ConfigError> {
        match output.desktop() {
            Some(desktop) => Ok(Some(Screens::described(&desktop))),
            // Not described, so the profile match decides; this never returns
            // `None`.
            None if !displays.is_empty() => self.replugged_into(displays, output, vendors),
            None if self.follows_the_window() => Ok(None),
            None => Ok(Some(Screens::nested())),
        }
    }

    /// How to become `next` while keeping each display's `wl_output`.
    ///
    /// A display whose name is in both desktops keeps its global, whatever else
    /// changed. Recreating it would tell clients their monitor was unplugged.
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

    /// The desktop the engine's displays make, or `None` to keep this one.
    ///
    /// `output.displays` wins over DRM. Otherwise the engine decides, because
    /// on a tty it holds DRM master and the compositor has no card node. A
    /// nested engine reports no displays, since its screens are the host's
    /// monitors.
    ///
    /// The check is on the config, not on whether the desktop follows the
    /// window: the first DRM reading stops it following, and later hotplugs
    /// must still apply.
    ///
    /// - `Err`: a profile matched but cannot apply, for example the monitor's
    ///   mode differs from the profile's. The caller keeps the current desktop
    ///   and reports the error, as `ConfigStore` does for a config that fails
    ///   to parse.
    /// - `Ok(None)`: the config describes the desktop.
    /// - `Ok(Some(_))`: the first matching profile's layout, or the engine's
    ///   reading when none matches.
    pub fn replugged_into(
        &self,
        displays: &[Display],
        output: &OutputConfig,
        vendors: &Vendors,
    ) -> Result<Option<Screens>, ConfigError> {
        if output.desktop().is_some() {
            Ok(None)
        } else {
            let connected: Vec<Connected> = displays
                .iter()
                .map(|display| Connected {
                    name: name_of(display),
                    description: display.description.clone(),
                    spelled_out: vendors
                        .spelled_out(&display.description)
                        .unwrap_or_default(),
                    mode: display.size,
                })
                .collect();
            Ok(Some(match output.layout(&connected)? {
                Some(layout) => Screens::from_the_layout(&layout, displays, vendors),
                None => Screens::from_the_engine(displays, vendors),
            }))
        }
    }

    /// Which outputs a window with these bounds is on, in [`outputs`] order.
    ///
    /// [`outputs`]: Screens::outputs
    ///
    /// Two cases report every output:
    ///
    /// - `None`: a surface with no portal (unmounted, hidden or a popup). The
    ///   shell hides windows instead of unmounting them, so this keys on having
    ///   no portal now.
    /// - No overlap: a portal in a gap between displays or off the edge. A
    ///   toolkit that scales blocks until it is told an output, so "none" would
    ///   leave the window blank.
    ///
    /// One entry per output, because the caller sends enter or leave for each.
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

    /// The scale a window in `bounds` should draw at, for
    /// `wp_fractional_scale_v1`.
    ///
    /// The scale of the display holding the most of the window, as sway picks
    /// it. With no bounds or no overlap the window is on every display
    /// ([`entered_by`](Screens::entered_by)), so it draws for the densest.
    pub fn scale_for(&self, bounds: Option<Bounds>) -> f64 {
        let densest = || {
            self.outputs
                .iter()
                .map(|output| output.scale)
                .reduce(f64::max)
                // A desktop of no displays has no density to match.
                .unwrap_or(1.0)
        };
        let most_of = bounds.and_then(|bounds| {
            self.outputs
                .iter()
                .map(|output| (overlap_area(&output.bounds(), &bounds), output.scale))
                .filter(|(area, _)| *area > 0.0)
                .max_by(|(a, _), (b, _)| a.total_cmp(b))
        });
        most_of.map_or_else(densest, |(_, scale)| scale)
    }

    /// The desktop's size in logical units — the bounding box of the outputs.
    pub fn size(&self) -> (i32, i32) {
        self.size
    }

    /// Whether resizing Domicile's window redefines the desktop. True only when
    /// nothing describes it.
    pub fn follows_the_window(&self) -> bool {
        self.follows_the_window
    }
}

/// The `wl_output` description for a display: the maker spelled out where
/// `pnp.ids` names it, otherwise the EDID's three-letter code.
///
/// This matches what sway prints. `Connected` carries both spellings so
/// profiles written with either still match.
fn advertised_description(display: &Display, vendors: &Vendors) -> String {
    vendors
        .spelled_out(&display.description)
        .unwrap_or_else(|| display.description.clone())
}

/// The area two boxes share, or zero when they do not overlap.
fn overlap_area(a: &Bounds, b: &Bounds) -> f64 {
    let width = a.max.x.min(b.max.x) - a.min.x.max(b.min.x);
    let height = a.max.y.min(b.max.y) - a.min.y.max(b.min.y);
    width.max(0.0) * height.max(0.0)
}

/// The `wl_output` name for an engine display.
///
/// Ozone derives the id from the EDID, so it survives a replug.
fn name_of(display: &Display) -> String {
    format!("drm-{}", display.id)
}

/// The engine display a `wl_output` named by [`name_of`] is, or `None` for
/// another name.
fn display_id_of(name: &str) -> Option<i64> {
    name.strip_prefix("drm-")?.parse().ok()
}

/// The engine's id for the display named `name`. The inverse of [`name_of`],
/// looked up in `displays` rather than parsed.
fn id_of(name: &str, displays: &[Display]) -> i64 {
    displays
        .iter()
        .find(|display| name_of(display) == name)
        .expect("a layout only places displays the engine reported")
        .id
}

/// A logical size times an integer scale, in physical pixels.
///
/// Panics on overflow instead of wrapping to a wrong mode. Callers keep it in
/// range: `DisplayConfig::validate` bounds described displays,
/// [`UNDESCRIBED_DESKTOP`] is at scale 1, and `adopt_window_scale` divides the
/// window size by the scale first.
fn multiplied(logical: (i32, i32), scale: i32) -> (i32, i32) {
    let times = |measure: i32| {
        measure
            .checked_mul(scale)
            .expect("a display's mode fits a coordinate")
    };
    (times(logical.0), times(logical.1))
}

/// A config `u32` as an `i32` coordinate.
///
/// `domicile_config` bounds the desktop extent and `size × scale <= i32::MAX`,
/// so this never fails for a `Desktop`. Asserting beats a cast that would
/// silently go negative.
fn as_coordinate(measure: u32) -> i32 {
    i32::try_from(measure).expect("a validated desktop measures within an i32")
}

/// A coordinate as the protocol's `u32` size or scale. The inverse of
/// [`as_coordinate`]; a negative value is a bug.
fn as_measure(coordinate: i32) -> u32 {
    u32::try_from(coordinate).expect("a size or a scale is never negative")
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_config::{Config, Desk};

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
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      {
        "name": "right",
        "position": [1920, 0],
        "size": [2560, 1440],
        "scale": 2
      }
    ]
  }
}
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
                    // A described display is not a panel, so neither value is
                    // known.
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
        // The mode is what the client draws, so it is the logical size times
        // the scale on both axes.
        let screens = Screens::described(&desktop(
            r#"
{
  "output": {
    "displays": [{ "name": "retina", "size": [2560, 1440], "scale": 2 }]
  }
}
"#,
        ));
        let retina = screens.outputs().next().expect("the one display");
        assert_eq!(retina.mode, (5120, 2880));
    }

    #[test]
    fn a_mode_too_big_to_describe_says_so_rather_than_wrapping() {
        // The window-following path is unvalidated, so overflow must panic
        // instead of wrapping to a negative size.
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
        // Each field is something the shell lays out against. Two displays,
        // because a lone display's position normalizes to `[0, 0]`.
        let screens = Screens::described(&desktop(
            r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      {
        "name": "right",
        "position": [1920, 120],
        "size": [2560, 1440],
        "scale": 2
      }
    ]
  }
}
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
                // The advertised mode: 2560x1440 at density 2 is 5120x2880,
                // though no panel scans it out.
                mode: [5120, 2880],
                transform: DisplayTransform::Normal,
            }
        );
    }

    #[test]
    fn a_negative_measure_says_so_rather_than_becoming_a_big_one() {
        // Folding a negative to its magnitude would send the chrome a plausible
        // but wrong screen.
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
        // `starts_with`, because `expect` on a `Result` appends the error.
        assert!(
            panicked
                .downcast_ref::<String>()
                .is_some_and(|said| said.starts_with("a size or a scale is never negative")),
            "the panic should name the invariant rather than be an incidental \
             conversion, and it said {:?}",
            panicked.downcast_ref::<String>()
        );

        // A separate fixture for the height: with both negative, the width
        // panics first.
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

        // The density panics in `wl_output_scale`, before `as_measure`.
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

    /// The two-display desktop the entered-output tests use.
    fn side_by_side() -> Screens {
        Screens::described(&desktop(
            r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [1280, 1024] }
    ]
  }
}
"#,
        ))
    }

    /// A window of `size` with its top-left corner at `at`.
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
        // A window across the seam is shown on both outputs, so its client must
        // know both densities.
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((1800.0, 0.0), (400.0, 400.0)))),
            vec![true, true]
        );
    }

    #[test]
    fn a_window_ending_on_the_seam_is_on_one_of_them() {
        // Displays abut, so an edge on the boundary must not count as an
        // overlap, or every maximized window would be on both.
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((1120.0, 0.0), (800.0, 600.0)))),
            vec![true, false]
        );
    }

    #[test]
    fn a_window_with_no_portal_is_on_every_display() {
        // Unmounted, hidden or a popup: no portal, so every output.
        let screens = side_by_side();

        assert_eq!(screens.entered_by(None), vec![true, true]);
    }

    #[test]
    fn a_window_over_no_display_at_all_is_on_every_display() {
        // A portal in a gap or off the edge. A toolkit that scales blocks until
        // told an output, so "none" would leave the window blank.
        let screens = side_by_side();

        assert_eq!(
            screens.entered_by(Some(window_at((-4000.0, -4000.0), (100.0, 100.0)))),
            vec![true, true]
        );
    }

    /// `HOME_OFFICE`: a 1.2x monitor (900x1600 at the origin) above a 1.5x
    /// laptop (1920x1280 at `0,1920`).
    fn monitor_over_laptop() -> Screens {
        Screens::nested()
            .replugged_into(&two_plugged_in(), &output(HOME_OFFICE), &unspelled())
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop")
    }

    #[test]
    fn a_window_draws_at_the_scale_of_the_display_it_is_on() {
        let screens = monitor_over_laptop();

        assert_eq!(
            screens.scale_for(Some(window_at((100.0, 100.0), (600.0, 800.0)))),
            1.2
        );
        assert_eq!(
            screens.scale_for(Some(window_at((100.0, 2000.0), (800.0, 600.0)))),
            1.5
        );
    }

    #[test]
    fn a_window_across_two_displays_draws_for_the_one_holding_more_of_it() {
        // As sway: one buffer cannot match both densities, so the larger
        // overlap wins.
        let screens = monitor_over_laptop();

        assert_eq!(
            screens.scale_for(Some(window_at((0.0, 1000.0), (800.0, 980.0)))),
            1.2,
            "600 rows on the monitor, 60 on the laptop"
        );
        assert_eq!(
            screens.scale_for(Some(window_at((0.0, 1500.0), (800.0, 600.0)))),
            1.5,
            "100 rows on the monitor, 180 on the laptop"
        );
    }

    #[test]
    fn a_window_on_no_known_display_draws_for_the_densest() {
        // It enters every display (`entered_by`), and a client on several
        // draws for the densest.
        let screens = monitor_over_laptop();

        assert_eq!(screens.scale_for(None), 1.5);
        assert_eq!(
            screens.scale_for(Some(window_at((-4000.0, -4000.0), (100.0, 100.0)))),
            1.5
        );
    }

    #[test]
    fn a_display_whose_far_edge_does_not_fit_says_so_rather_than_wrapping() {
        // A wrapped far edge would put `max` below `min` and overlap nothing,
        // putting every window on every output.
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
    fn the_placeholder_is_the_desktop_when_nothing_described_one() {
        let screens = Screens::nested();
        assert_eq!(screens.size(), (1280, 800));
        assert!(screens.follows_the_window());
        let only = screens.outputs().next().expect("the one output");
        // Scale 1, so the mode is the size, until the window reports a density.
        assert_eq!(only.scale, 1.0);
        assert_eq!(only.mode, (1280, 800));
    }

    #[test]
    fn a_described_desktop_is_not_the_window() {
        // A described desktop does not follow the window.
        let screens = Screens::described(&desktop(
            r#"
{ "output": { "displays": [{ "name": "only", "size": [800, 600] }] } }
"#,
        ));
        assert!(!screens.follows_the_window());
    }

    #[test]
    fn a_tty_casts_each_monitor_from_its_own_capture() {
        let mut screens = Screens::from_the_engine(&two_plugged_in(), &unspelled());
        screens.outputs[1].transform = Transform::Rotate90;

        let cast = screens.cast_screens();

        assert_eq!(cast.len(), 2);
        assert_eq!(cast[0].name, screens.outputs[0].name);
        assert_eq!(cast[0].display, two_plugged_in()[0].id);
        assert_eq!(
            cast[0].desk,
            (
                screens.outputs[0].position.0,
                screens.outputs[0].position.1,
                screens.outputs[0].logical.0,
                screens.outputs[0].logical.1
            )
        );
        assert!(cast[0].upright);
        assert!(!cast[1].upright);
    }

    #[test]
    fn each_cast_screen_is_offered_by_name_and_panel() {
        let screens = Screens::from_the_engine(&two_plugged_in(), &unspelled());
        let desk = screens.outputs[1].position;

        let offered = screens.cast_monitors();

        assert_eq!(offered.len(), 2);
        assert_eq!(
            offered[1],
            crate::casting::Candidate {
                source: crate::casting::Source::Monitor("drm-2".into()),
                title: DESK_MONITOR.into(),
                app_id: String::new(),
                bounds: Some(crate::casting::Region {
                    position: desk,
                    size: screens.outputs[1].logical,
                }),
            }
        );
    }

    #[test]
    fn a_nested_desktop_casts_from_the_window() {
        let cast = Screens::following_the_window((1280, 800), 2).cast_screens();

        assert_eq!(
            cast,
            [crate::casting::Screen {
                name: "domicile-0".into(),
                display: 0,
                desk: (0, 0, 1280, 800),
                scale: 2.0,
                upright: true,
            }]
        );
    }

    #[test]
    fn a_tty_desktop_is_the_displays_the_engine_reported() {
        // On a tty the engine holds DRM, so its reading defines the desktop.
        let screens = Screens::from_the_engine(
            &[
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
            ],
            &unspelled(),
        );
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
                    // A laptop panel has an EDID name; a projector has none.
                    description: "BOE NE135A1M-NY1".into(),
                    // The panel's values pass through, and so do the second
                    // display's zeros.
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
        // There is no window on a tty, so these do not follow it.
        assert!(!screens.follows_the_window());
    }

    /// The laptop on its own, named from its EDID.
    ///
    /// A function because a non-empty `String` cannot be a `const`.
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

    /// The laptop's EDID description, which a profile can match.
    const LAPTOP_PANEL: &str = "BOE NE135A1M-NY1";

    /// The output settings `text` configures.
    fn output(text: &str) -> OutputConfig {
        Config::parse(text).expect("the config should parse").output
    }

    /// A config with no described desktop and no profiles, so the engine's
    /// reading decides.
    fn unconfigured() -> OutputConfig {
        output("{}")
    }

    #[test]
    fn a_described_desktop_is_not_overruled_by_what_the_engine_sees() {
        // `output.displays` wins over DRM.
        let described_in_the_config = output(&displays(&[LEFT]));
        assert_eq!(
            described(&[LEFT])
                .replugged_into(&plugged_in(), &described_in_the_config, &unspelled())
                .expect("a described desktop is not a layout that failed"),
            None
        );
    }

    #[test]
    fn a_desktop_nothing_described_is_the_engines_to_define() {
        let taken = Screens::nested()
            .replugged_into(&plugged_in(), &unconfigured(), &unspelled())
            .expect("nothing here can fail to be applied")
            .expect("an undescribed desktop takes the engine's displays");
        assert_eq!(taken.size(), (2880, 1920));
        assert!(!taken.follows_the_window());
    }

    #[test]
    fn every_hotplug_is_applied_and_not_only_the_first() {
        // Hotplugs after the first DRM reading still apply, even though the
        // desktop no longer follows the window.
        let one_monitor = Screens::nested()
            .replugged_into(&plugged_in(), &unconfigured(), &unspelled())
            .expect("nothing here can fail to be applied")
            .expect("an undescribed desktop takes the engine's displays");
        let both = one_monitor
            .replugged_into(&two_plugged_in(), &unconfigured(), &unspelled())
            .expect("nothing here can fail to be applied")
            .expect("a desktop the engine defined is still the engine's");
        assert_eq!(both.size(), (4800, 1920));
    }

    #[test]
    fn a_profile_places_the_monitors_it_matched() {
        // The panel at 1.5, the monitor at 1.2 rotated, the panel centered
        // below it. The mode, millimeters and refresh rate come from the
        // engine.
        let placed = Screens::nested()
            .replugged_into(&two_plugged_in(), &output(HOME_OFFICE), &unspelled())
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(
            placed.outputs().cloned().collect::<Vec<_>>(),
            vec![
                Advertised {
                    // 1920x1080 rotated is 1080x1920; divided by 1.2 it is
                    // 900x1600. The mode itself does not rotate.
                    logical: (900, 1600),
                    mode: (1920, 1080),
                    name: "drm-2".into(),
                    position: (0, 0),
                    // The fractional density. `wl_output.scale` rounds it up to
                    // 2.
                    scale: 1.2,
                    transform: Transform::Rotate270,
                    // From the engine's reading; a profile does not rename a
                    // display.
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
        // The connector settings the engine needs. Unlike `outputs`, these
        // include disabled displays and the CRTC positions.
        let placed = Screens::nested()
            .replugged_into(&two_plugged_in(), &output(HOME_OFFICE), &unspelled())
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(
            placed.scanout(),
            vec![
                Connector {
                    id: 2,
                    enabled: true,
                    origin: (0, 0),
                    // The engine draws with the rotation and scale, so the page
                    // lays out logical and upright.
                    transform: Transform::Rotate270,
                    scale: 1.2,
                    // The profile position, which the engine uses to move the
                    // pointer between monitors.
                    desk: Some(Desk {
                        position: (0, 0),
                        size: (900, 1600),
                    }),
                },
                Connector {
                    id: 1,
                    enabled: true,
                    // Where the monitor's mode ends. The desktop stacks the
                    // displays vertically but the connectors are side by side.
                    origin: (1920, 0),
                    transform: Transform::Normal,
                    scale: 1.5,
                    desk: Some(Desk {
                        position: (0, 1920),
                        size: (1920, 1280),
                    }),
                },
            ]
        );
    }

    #[test]
    fn a_desktop_no_profile_placed_leaves_the_connectors_to_the_engine() {
        // Empty means the hardware decides. When a profile that turned a panel
        // off stops matching, the empty list relights the panel.
        let unplanned = Screens::nested()
            .replugged_into(&plugged_in(), &output(HOME_OFFICE), &unspelled())
            .expect("a profile that does not match cannot fail to apply")
            .expect("an undescribed desktop is still the engine's to define");
        assert!(unplanned.scanout().is_empty());
    }

    #[test]
    fn a_profile_can_name_a_monitor_by_its_panel() {
        // The profile names the monitors by EDID description, not `drm-<id>`.
        let placed = Screens::nested()
            .replugged_into(
                &two_plugged_in(),
                &output(&format!(
                    r#"
{{
  "output": {{
    "profiles": [
      {{
        "name": "by-panel",
        "displays": [
          {{ "display": "{DESK_MONITOR}", "position": [0, 0], "scale": 1.2 }},
          {{ "display": "{LAPTOP_PANEL}", "position": [0, 1080], "scale": 1.5 }}
        ]
      }}
    ]
  }}
}}
"#
                )),
                &unspelled(),
            )
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");

        // The outputs keep their `drm-<id>` names.
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
    fn a_monitors_maker_is_spelled_out_where_this_machine_has_a_table() {
        // `DEL` is in the table and `BOE` is not. An unknown code keeps its
        // three letters. This matches sway.
        let spelled = Screens::from_the_engine(&two_plugged_in(), &desk_vendors());
        assert_eq!(
            spelled
                .outputs()
                .map(|output| output.description.as_str())
                .collect::<Vec<_>>(),
            vec![LAPTOP_PANEL, "Dell Inc. DELL U3219Q G3MS413"]
        );
    }

    #[test]
    fn a_profile_can_name_a_monitor_by_the_vendor_spelled_out() {
        // A profile copied from sway's output names `Dell Inc.`. The
        // three-letter spelling also matches; `domicile-config` tries both.
        let placed = Screens::nested()
            .replugged_into(
                &two_plugged_in(),
                &output(
                    r#"
{
  "output": {
    "profiles": [
      {
        "name": "by-vendor",
        "displays": [
          {
            "display": "Dell Inc. DELL U3219Q G3MS413",
            "position": [0, 0]
          },
          { "display": "BOE NE135A1M-NY1", "position": [0, 1080] }
        ]
      }
    ]
  }
}
"#,
                ),
                &desk_vendors(),
            )
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(
            placed
                .outputs()
                .map(|output| output.name.as_str())
                .collect::<Vec<_>>(),
            vec!["drm-2", "drm-1"]
        );
    }

    /// A table that names the desk monitor's maker but not the laptop panel's.
    fn desk_vendors() -> Vendors {
        Vendors::listed_in("DEL\tDell Inc.\n")
    }

    /// No `pnp.ids` table, as in every test except the two above.
    fn unspelled() -> Vendors {
        Vendors::none()
    }

    #[test]
    fn monitors_no_profile_names_are_left_where_the_engine_put_them() {
        // No profile matches this desk, so the engine's reading is used.
        let unplanned = Screens::nested()
            .replugged_into(&plugged_in(), &output(HOME_OFFICE), &unspelled())
            .expect("a profile that does not match cannot fail to apply")
            .expect("an undescribed desktop is still the engine's to define");
        assert_eq!(
            unplanned,
            Screens::from_the_engine(&plugged_in(), &unspelled())
        );
    }

    #[test]
    fn a_profile_that_cannot_be_applied_leaves_the_desktop_alone() {
        // Modes come from the hardware, so a profile can only fail once a
        // monitor is plugged in. The caller keeps the current desktop and
        // reports the error.
        let err = Screens::nested()
            .replugged_into(
                &plugged_in(),
                &output(
                    r#"
{
  "output": {
    "profiles": [
      {
        "name": "too-small",
        "displays": [{ "display": "drm-1", "scale": 4000 }]
      }
    ]
  }
}
"#,
                ),
                &unspelled(),
            )
            .expect_err("a profile that cannot be applied says so");
        assert!(
            err.to_string().contains("too-small"),
            "the complaint should name the profile: {err}"
        );
    }

    /// The laptop and one monitor, both with EDID descriptions.
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

    /// The monitor's EDID description.
    const DESK_MONITOR: &str = "DEL DELL U3219Q G3MS413";

    /// A profile for `two_plugged_in`: the monitor rotated above, the laptop
    /// panel centered below.
    ///
    /// Lists the monitor first, so the output order is the profile's, not the
    /// engine's.
    const HOME_OFFICE: &str = r#"
{
  "output": {
    "profiles": [
      {
        "name": "desk",
        "displays": [
          {
            "display": "drm-2",
            "position": [0, 0],
            "scale": 1.2,
            "transform": "rotate-270"
          },
          { "display": "drm-1", "position": [0, 1920], "scale": 1.5 }
        ]
      }
    ]
  }
}
"#;

    #[test]
    #[should_panic(expected = "the engine reports at least one display")]
    fn a_desktop_of_no_displays_is_refused_rather_than_sized_zero() {
        // `DrmScreen` reports `kDisplaylessBounds` rather than an empty list,
        // so an empty list is an engine bug.
        let _ = Screens::from_the_engine(&[], &unspelled());
    }

    #[test]
    fn an_undescribed_desktop_is_whatever_window_domicile_got() {
        // A nested run: one output, sized and scaled by the window.
        let screens = Screens::following_the_window((1280, 800), 2);
        assert_eq!(
            screens.outputs().cloned().collect::<Vec<_>>(),
            vec![Advertised {
                logical: (1280, 800),
                mode: (2560, 1600),
                // The name clients already use.
                name: "domicile-0".into(),
                position: (0, 0),
                scale: 2.0,
                transform: Transform::Normal,
                description: String::new(),
                // A window has no physical size or refresh rate.
                physical_mm: UNKNOWN_PHYSICAL_MM,
                refresh_mhz: UNKNOWN_REFRESH_MHZ,
            }]
        );
        assert_eq!(screens.size(), (1280, 800));
        assert!(screens.follows_the_window());
    }

    /// The screens a desktop made of `entries` describes, in that order.
    fn described(entries: &[&str]) -> Screens {
        Screens::described(&desktop(&displays(entries)))
    }

    /// A config whose `output.displays` is `entries`, in that order.
    fn displays(entries: &[&str]) -> String {
        format!(
            r#"{{ "output": {{ "displays": [{}] }} }}"#,
            entries.join(", ")
        )
    }

    const LEFT: &str = r#"{ "name": "left", "size": [1920, 1080] }"#;
    const RIGHT: &str = r#"{ "name": "right", "position": [1920, 0], "size": [2560, 1440] }"#;

    #[test]
    fn a_desktop_that_did_not_change_rearranges_into_nothing() {
        let before = described(&[LEFT, RIGHT]);
        let after = described(&[LEFT, RIGHT]);
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
        let before = described(&[LEFT]);
        let after = described(&[LEFT, RIGHT]);
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
        let before = described(&[LEFT, RIGHT]);
        let after = described(&[LEFT]);
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
        // A display that stays keeps its `wl_output`. Replacing it looks to
        // clients like an unplug.
        let before = described(&[LEFT]);
        let after = described(&[r#"{ "name": "left", "size": [3840, 2160], "scale": 2 }"#]);
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
        // A renamed display is a different display: the shell addresses
        // `<Screen>` by name.
        let before = described(&[LEFT]);
        let after = described(&[r#"{ "name": "main", "size": [1920, 1080] }"#]);
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
        // Matched by name, not index, so reordering moves each `wl_output` with
        // its display.
        let before = described(&[LEFT, RIGHT]);
        let after = described(&[RIGHT, LEFT]);
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
        // With no `output.displays`, the desktop follows the window, under a
        // different output name.
        let before = described(&[LEFT, RIGHT]);
        let after = Screens::nested();
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
        let config = output(&displays(&[LEFT]));
        let described = desktop(&displays(&[LEFT]));
        assert_eq!(
            now.reloaded_into(&config, NOTHING_PLUGGED_IN, &unspelled())
                .expect("a described desktop cannot fail to be applied"),
            Some(Screens::described(&described))
        );
    }

    #[test]
    fn a_reload_re_matches_the_monitors_the_engine_last_read() {
        // Saving a profile applies it at once, matched against the engine's
        // last reading.
        let placed = Screens::from_the_engine(&two_plugged_in(), &unspelled())
            .reloaded_into(&output(HOME_OFFICE), &two_plugged_in(), &unspelled())
            .expect("the profile should be applicable")
            .expect("a matched profile defines the desktop");
        assert_eq!(placed.size(), (1920, 3200));
    }

    #[test]
    fn a_reload_that_describes_no_displays_leaves_the_window_desktop_alone() {
        // With no `output.displays` the window defines the desktop, with a size
        // and density the config does not know. Rebuilding from the config
        // would drop it to the scale-1 placeholder. Any save in the config's
        // directory triggers a reload, so this happens often.
        let now = Screens::following_the_window((1920, 1200), 2);
        assert_eq!(
            now.reloaded_into(&unconfigured(), NOTHING_PLUGGED_IN, &unspelled())
                .expect("an undescribed config cannot fail to be applied"),
            None
        );
    }

    #[test]
    fn a_reload_that_stopped_describing_displays_hands_the_desktop_back() {
        // A desktop the config stops describing falls back to the placeholder,
        // which the window then corrects.
        let now = described(&[LEFT, RIGHT]);
        assert_eq!(
            now.reloaded_into(&unconfigured(), NOTHING_PLUGGED_IN, &unspelled())
                .expect("an undescribed config cannot fail to be applied"),
            Some(Screens::nested())
        );
    }

    /// No display reading yet: a nested run, or a tty before the first display
    /// event.
    const NOTHING_PLUGGED_IN: &[Display] = &[];
}
