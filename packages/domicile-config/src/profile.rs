//! Which monitors are plugged in, and where the config says to put them.
//!
//! [`Desktop`](crate::Desktop) is the other way of describing a desktop and
//! the two differ in where the numbers come from. A described desktop states
//! its own sizes: it is a nested compositor's arithmetic, there is no hardware
//! to ask, and the answer is the same every time it is read. A *profile*
//! states only a placement — a scale, a turn, a corner to put it at — and the
//! monitor states its mode, so the same config makes a different desktop as
//! monitors come and go.
//!
//! That is what the mechanism is for. Matching is a function of what is
//! connected rather than a decision taken once at startup, so plugging in the
//! desk is a different profile applying, with nothing reloaded and nothing
//! restarted.
//!
//! Modelled on kanshi, which is what a sway desktop uses for this, without
//! borrowing its file format: a list of profiles, each naming exactly the
//! displays it is for, and the first one whose set is plugged in wins.

use serde::Deserialize;

use crate::ConfigError;

/// One arrangement of monitors, and where each of them goes.
///
/// A profile applies when the displays it names are *exactly* the ones
/// connected — see [`Profile::matches`], where both halves of that are argued.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    /// What this arrangement is called. Unique across the config, and only
    /// ever read by a person: it is what the log line naming the profile that
    /// applied prints, which is the one way to tell a profile that never
    /// matched from one that matched and placed things oddly.
    pub name: String,
    /// Every display this arrangement is for, including the ones it turns off.
    pub displays: Vec<DisplayPlacement>,
}

impl Profile {
    /// Whether these are the monitors this profile is for.
    ///
    /// Exactly, in both directions, and each half rules out a different wrong
    /// desktop. A profile that applied when the displays it names are merely
    /// *present* would put the two-monitor arrangement up with a third monitor
    /// plugged in and leave that monitor dark. One that applied when the sets
    /// merely overlap would put the three-monitor arrangement up on two and
    /// place windows on a screen that is not there.
    ///
    /// Counting and then looking each one up is set equality because neither
    /// list repeats a name: [`validate`] refuses a profile that names a
    /// display twice, and the connected list is one entry per display the
    /// engine reported, which it identifies by an id derived from the EDID.
    fn matches(&self, connected: &[Connected]) -> bool {
        self.displays.len() == connected.len()
            && self
                .displays
                .iter()
                .all(|placement| placement.connected_in(connected).is_some())
    }

    fn validate(&self, index: usize, earlier: &[Profile]) -> Result<(), ConfigError> {
        let at = format!("output.profiles[{index}]");
        if self.name.trim().is_empty() {
            return Err(ConfigError::Validation(format!(
                "{at} must have a name; it is what names the profile that applied"
            )));
        }
        if earlier.iter().any(|profile| profile.name == self.name) {
            return Err(ConfigError::Validation(format!(
                "two output.profiles are both named {}",
                self.name
            )));
        }
        if self.displays.is_empty() {
            return Err(ConfigError::Validation(format!(
                "{at} ({}) names no displays, so it matches only a machine \
                 with no monitors at all",
                self.name
            )));
        }
        // Not the same as naming no displays: this one names them and turns
        // every one of them off, which is not a smaller desktop but no
        // desktop — every window lands off it, and nothing says why. Caught
        // here rather than where the layout is built, because the user is
        // still looking at the config now.
        if !self.displays.iter().any(|placement| placement.enabled) {
            return Err(ConfigError::Validation(format!(
                "{at} ({}) disables every display it names, which leaves no \
                 desktop to put a window on",
                self.name
            )));
        }
        for (index, placement) in self.displays.iter().enumerate() {
            placement.validate(&at, &self.name, index, &self.displays[..index])?;
        }
        Ok(())
    }
}

/// One display of a profile: which monitor, and what to do with it.
///
/// Every field but `display` defaults to the monitor left alone, so an entry
/// that only names one is how a profile says "this is plugged in, and it is
/// where it already is".
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplayPlacement {
    /// Which connected display this places, matched against its name exactly.
    ///
    /// The name the compositor advertises the display under, which on a tty is
    /// `drm-<id>` — the id ozone derives from the EDID, so it survives a
    /// monitor being unplugged and plugged back in.
    pub display: String,
    /// Whether the display is part of the desktop.
    ///
    /// A disabled display still has to be *connected* for the profile to
    /// match, and that those two pull in opposite directions is the point of
    /// it: a laptop on a full desk is named so that the desk's profile is the
    /// one that applies, and disabled so that no window lands on a panel
    /// behind a closed lid.
    #[serde(default = "enabled")]
    pub enabled: bool,
    /// The top-left corner, in the profile's own coordinate space.
    ///
    /// Wherever the user finds it natural — negative included, since "above
    /// and to the left of that one" is how a second monitor gets described.
    /// [`Layout`] normalizes these about the desktop's own corner, and these
    /// numbers do not leave this crate.
    #[serde(default)]
    pub position: (i32, i32),
    /// Device pixels per logical pixel: the ratio between the mode the
    /// connector scans out and the size the desktop is laid out at.
    ///
    /// Fractional, because the scales a desk is actually used at are — 1.5 on
    /// a 2880x1920 laptop panel is the 1920x1280 desktop that panel is
    /// readable at, and rounding it to an integer would halve the usable
    /// desktop. `wl_output.scale` is an integer and is a *different* number;
    /// the compositor's `Screens` advertises that one and lets `xdg_output`
    /// carry the logical size this makes.
    #[serde(default = "unscaled")]
    pub scale: f64,
    /// Which way up the monitor is.
    #[serde(default)]
    pub transform: Transform,
}

impl DisplayPlacement {
    /// The connected display this entry places, or `None` where it is not
    /// plugged in.
    fn connected_in<'a>(&self, connected: &'a [Connected]) -> Option<&'a Connected> {
        connected
            .iter()
            .find(|display| display.name == self.display)
    }

    fn validate(
        &self,
        profile_at: &str,
        profile: &str,
        index: usize,
        earlier: &[DisplayPlacement],
    ) -> Result<(), ConfigError> {
        let at = format!("{profile_at}.displays[{index}]");
        if self.display.trim().is_empty() {
            return Err(ConfigError::Validation(format!(
                "{at} must name a display; an entry naming none matches nothing, \
                 so {profile} would never apply"
            )));
        }
        if earlier
            .iter()
            .any(|placement| placement.display == self.display)
        {
            return Err(ConfigError::Validation(format!(
                "{profile} places {} twice, and only one of the two can be where it goes",
                self.display
            )));
        }
        // Finite and positive is what makes it a density at all: zero divides
        // the mode into a desktop of no size, a negative one turns it inside
        // out, and a NaN compares false against every bound anything later
        // would check it with. What is too large *for this monitor* cannot be
        // known here — the mode arrives with the monitor — and is
        // [`Layout::of`]'s to refuse.
        if !self.scale.is_finite() || self.scale <= 0.0 {
            return Err(ConfigError::Validation(format!(
                "{at} scale for {} is {}, which is not a number of device \
                 pixels per logical one",
                self.display, self.scale
            )));
        }
        Ok(())
    }
}

/// Which way up a monitor is, named for the `wl_output.transform` each one is.
///
/// Rotations only. A flip is the other half of what `wl_output.transform` can
/// say and nothing has needed one yet: a monitor gets stood on its side, not
/// held up to a mirror.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
pub enum Transform {
    /// The way the connector scans out, which is the way most monitors sit.
    #[default]
    #[serde(rename = "normal")]
    Normal,
    /// A quarter turn clockwise.
    #[serde(rename = "rotate-90")]
    Rotate90,
    #[serde(rename = "rotate-180")]
    Rotate180,
    /// A quarter turn anticlockwise, which is how a monitor on a desk usually
    /// ends up standing on its side.
    #[serde(rename = "rotate-270")]
    Rotate270,
}

impl Transform {
    /// Whether the display ends up as tall as its mode is wide.
    ///
    /// The mode does not turn with the monitor — it is what the connector
    /// scans out — so this is the one thing a transform changes about the
    /// arithmetic. Everything else it changes is pixels.
    pub fn swaps_axes(self) -> bool {
        match self {
            Transform::Normal | Transform::Rotate180 => false,
            Transform::Rotate90 | Transform::Rotate270 => true,
        }
    }
}

/// One monitor as the compositor found it, in the terms a profile matches on.
///
/// Deliberately not the compositor's own display type: this crate is pure
/// logic and knows nothing about the engine that read the hardware. What
/// matching and placing need is a name and a mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connected {
    /// What the compositor advertises this display as, which is what a
    /// profile's `display` is matched against.
    pub name: String,
    /// The mode the connector is scanning out, in physical pixels.
    pub mode: (u32, u32),
}

/// A profile applied to the monitors that were plugged in when it matched.
///
/// The desktop in the coordinate space everything downstream wants: placed
/// about its own top-left corner, disabled displays already dropped, and each
/// remaining display carrying both the mode its connector scans out and the
/// logical size the desktop is laid out in.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    profile: String,
    placed: Vec<Placed>,
    size: (u32, u32),
}

impl Layout {
    /// Which profile this is, for the log line that says one applied.
    pub fn profile(&self) -> &str {
        &self.profile
    }

    /// The displays the desktop is made of, in the order the profile wrote
    /// them, disabled ones already dropped.
    pub fn placed(&self) -> impl Iterator<Item = &Placed> {
        self.placed.iter()
    }

    /// The bounding box of every placed display, gaps between them included.
    ///
    /// Gaps are legal and the chrome's page spans them, so this is what the
    /// displays reach rather than what they cover — the same rule
    /// [`Desktop::size`](crate::Desktop::size) states for a described desktop.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }

    /// Apply `profile` to the monitors it matched.
    ///
    /// Only ever called with a `connected` list [`Profile::matches`] accepted,
    /// which is what makes the lookup below an assertion rather than a branch:
    /// every entry of the profile named a display in that list.
    ///
    /// The `Err` arm is the one failure a profile has that parsing cannot
    /// catch. The positions are the config's and the sizes are the hardware's,
    /// so how far apart two displays end up is not known until a monitor is
    /// plugged in. An error rather than a panic because the caller is a
    /// compositor holding a working desktop and a config the user can edit
    /// again.
    pub(crate) fn of(profile: &Profile, connected: &[Connected]) -> Result<Layout, ConfigError> {
        let placed = profile
            .displays
            .iter()
            .filter(|placement| placement.enabled)
            .map(|placement| placed(profile, placement, connected))
            .collect::<Result<Vec<_>, _>>()?;
        let near = (
            nearest(&placed, |display| display.position.0),
            nearest(&placed, |display| display.position.1),
        );
        let size = (
            extent(profile, &placed, near.0, |display| {
                (display.position.0, display.logical.0)
            })?,
            extent(profile, &placed, near.1, |display| {
                (display.position.1, display.logical.1)
            })?,
        );
        Ok(Layout {
            profile: profile.name.clone(),
            placed: placed
                .into_iter()
                .map(|display| Placed {
                    // Non-negative because `near` is the smallest of them, and
                    // it fits an `i32` because `extent` has already refused a
                    // layout whose span between those two corners does not.
                    position: (
                        normalized(display.position.0, near.0),
                        normalized(display.position.1, near.1),
                    ),
                    ..display
                })
                .collect(),
            size,
        })
    }
}

/// One display of an applied profile, placed in the desktop's own coordinates.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    /// The display's name: what the profile matched on, and what the chrome
    /// addresses the screen by.
    pub name: String,
    /// Top-left corner, logical, relative to the desktop's own top-left.
    pub position: (i32, i32),
    /// The mode the connector scans out, in physical pixels. Not turned by
    /// `transform`: a monitor on its side scans out exactly as it did lying
    /// down, and is merely bolted to the desk sideways.
    pub mode: (u32, u32),
    /// The size the desktop is laid out in: the mode, turned, over the scale.
    pub logical: (u32, u32),
    /// Device pixels per logical pixel, as the profile stated it.
    pub scale: f64,
    /// Which way up the monitor is.
    pub transform: Transform,
}

/// One display of the profile, at the mode the monitor it matched reports.
///
/// Positions are still the profile's own here; [`Layout::of`] normalizes them
/// once it knows which corner is the desktop's.
fn placed(
    profile: &Profile,
    placement: &DisplayPlacement,
    connected: &[Connected],
) -> Result<Placed, ConfigError> {
    let mode = placement
        .connected_in(connected)
        .expect("a profile is only applied to the displays it matched")
        .mode;
    Ok(Placed {
        name: placement.display.clone(),
        position: placement.position,
        mode,
        logical: logical(mode, placement.transform, placement.scale)
            .ok_or_else(|| vanished(profile, placement, mode))?,
        scale: placement.scale,
        transform: placement.transform,
    })
}

/// The logical size of `mode`, turned and then divided by `scale`.
///
/// `None` where that leaves less than a whole logical pixel on either axis,
/// which is a scale too large for *this* monitor — not something
/// [`DisplayPlacement::validate`] can see, because the mode arrives with the
/// monitor. Refused rather than floored at one: a display one pixel across is
/// not a display, and a zero-sized one is a screen every window misses.
///
/// Turned first, so a 3840x2160 monitor on its side at 1.2 is 1800x3200 rather
/// than 3200x1800 relabelled.
fn logical(mode: (u32, u32), transform: Transform, scale: f64) -> Option<(u32, u32)> {
    let turned = if transform.swaps_axes() {
        (mode.1, mode.0)
    } else {
        mode
    };
    let divide = |pixels: u32| {
        let logical = (f64::from(pixels) / scale).round();
        // Bounded before the cast rather than after: `as` saturates rather
        // than wrapping, so a scale far below 1 would land exactly on
        // `u32::MAX` and read as a plausible, enormous display.
        (1.0..=f64::from(u32::MAX))
            .contains(&logical)
            .then_some(logical as u32)
    };
    Some((divide(turned.0)?, divide(turned.1)?))
}

/// The smallest of the placed displays' near edges along one axis.
fn nearest(placed: &[Placed], edge: impl Fn(&Placed) -> i32) -> i32 {
    placed
        .iter()
        .map(edge)
        .min()
        .expect("a profile enables at least one display")
}

/// How far the displays span along one axis, measured from `near`.
///
/// Widened to `i64` throughout for the reason `OutputConfig::validate_extent`
/// gives for the described desktop: the positions each fit an `i32` and the
/// distance between two of them need not, and the desktop is placed about its
/// own corner — so a normalized position *is* that distance, and `i32` is what
/// a position is.
fn extent(
    profile: &Profile,
    placed: &[Placed],
    near: i32,
    edge: impl Fn(&Placed) -> (i32, u32),
) -> Result<u32, ConfigError> {
    let reach = |display: &Placed| {
        let (start, length) = edge(display);
        i64::from(start) + i64::from(length)
    };
    let furthest = placed
        .iter()
        .max_by_key(|display| reach(display))
        .expect("a profile enables at least one display");
    let span = reach(furthest) - i64::from(near);
    if span > i64::from(i32::MAX) {
        Err(unreachable(profile, furthest))
    } else {
        Ok(u32::try_from(span).expect("a span measured from the nearest edge is non-negative"))
    }
}

/// One coordinate, measured from the desktop's own corner rather than the
/// profile's origin.
fn normalized(coordinate: i32, near: i32) -> i32 {
    coordinate
        .checked_sub(near)
        .expect("a layout's span is checked before its displays are placed")
}

/// The complaint for a layout that spans further than a desktop can.
fn unreachable(profile: &Profile, furthest: &Placed) -> ConfigError {
    ConfigError::Validation(format!(
        "output profile {} reaches {} at ({}, {}), which puts the desktop's far \
         corner beyond what a position on one desktop can describe",
        profile.name, furthest.name, furthest.position.0, furthest.position.1
    ))
}

/// The complaint for a scale that leaves a monitor with no logical pixels.
fn vanished(profile: &Profile, placement: &DisplayPlacement, mode: (u32, u32)) -> ConfigError {
    ConfigError::Validation(format!(
        "output profile {} scales {} by {}, which leaves less than one logical \
         pixel of its {}x{} mode",
        profile.name, placement.display, placement.scale, mode.0, mode.1
    ))
}

/// The first profile these monitors are the set for, applied to them.
///
/// `Ok(None)` is no profile matching, which is not an empty desktop: it is a
/// config that says nothing about this arrangement, and leaves the displays
/// wherever the engine put them.
pub(crate) fn layout(
    profiles: &[Profile],
    connected: &[Connected],
) -> Result<Option<Layout>, ConfigError> {
    match profiles.iter().find(|profile| profile.matches(connected)) {
        None => Ok(None),
        Some(profile) => Layout::of(profile, connected).map(Some),
    }
}

/// Every profile's own validation, in config order.
pub(crate) fn validate(profiles: &[Profile]) -> Result<(), ConfigError> {
    for (index, profile) in profiles.iter().enumerate() {
        profile.validate(index, &profiles[..index])?;
    }
    Ok(())
}

/// A display an entry says nothing about is one that is on.
fn enabled() -> bool {
    true
}

/// A display an entry says nothing about draws at its mode.
fn unscaled() -> f64 {
    1.0
}
