//! Which monitors are plugged in, and where the config says to put them.
//!
//! [`Desktop`](crate::Desktop) is the other way of describing a desktop and
//! the two differ in where the numbers come from. A described desktop states
//! its own sizes: it is a nested compositor's arithmetic, there is no hardware
//! to ask, and the answer is the same every time it is read. A *profile*
//! states a placement — a scale, a turn, a corner to put it at — and the
//! monitor states its mode, so the same config makes a different desktop as
//! monitors come and go.
//!
//! A profile may also state the mode it was written for, and that is an
//! assertion about the monitor rather than a request to it: nothing here
//! modesets, so a monitor at some other mode makes the profile inapplicable
//! and says so, instead of being placed by arithmetic that no longer holds.
//! [`DisplayPlacement::mode`] argues it.
//!
//! That is what the mechanism is for. Matching is a function of what is
//! connected rather than a decision taken once at startup, so plugging in the
//! desk is a different profile applying, with nothing reloaded and nothing
//! restarted.
//!
//! Modeled on kanshi, which is what a sway desktop uses for this, without
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
    /// Resolved rather than counted, because a display answers to two names.
    /// An entry may name a monitor by its output (`drm-3`) or by its panel
    /// (`DEL DELL U3219Q G3MS413`), so two entries of one profile can resolve
    /// to the *same* monitor — and then the profile has as many entries as
    /// there are monitors, every entry finds one, and a whole monitor is
    /// unaccounted for. Counting says that matches. It is the two-monitor
    /// layout applied with one screen left dark.
    ///
    /// So the resolution is checked for being a pairing: every entry finds a
    /// monitor, no two entries find the same one, and nothing is left over.
    /// The last of those is what the count was standing in for and is now
    /// implied — distinct resolutions of the same length as `connected` cover
    /// it.
    fn resolve<'a>(&self, connected: &'a [Connected]) -> Option<Vec<&'a Connected>> {
        if self.displays.len() != connected.len() {
            return None;
        }
        let mut resolved: Vec<&Connected> = Vec::with_capacity(self.displays.len());
        for placement in &self.displays {
            let display = placement.connected_in(connected)?;
            // By name rather than by value: two monitors of the same model
            // with no serial between them are equal as far as their
            // description goes, and the question here is whether this is the
            // same *entry* of the connected list.
            if resolved.iter().any(|taken| taken.name == display.name) {
                return None;
            }
            resolved.push(display);
        }
        Some(resolved)
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
    /// The mode the rest of this entry was written for, in physical pixels,
    /// or absent for whatever the monitor comes up at.
    ///
    /// AN ASSERTION ABOUT THE MONITOR RATHER THAN A REQUEST TO IT, and the
    /// difference is the whole of what this field is. Nothing on this side
    /// modesets: the engine holds DRM master and `ModesetParamsFromSnapshots`
    /// configures every CRTC from the connector's own `native_mode()`, so a
    /// profile that asked for a mode would be asking nobody. What it can do
    /// is name the mode its arithmetic assumed — the positions of a profile
    /// are sums of the sizes it places, so a monitor that comes up at another
    /// mode moves every display placed after it — and a monitor that is at
    /// some other mode makes the profile inapplicable rather than merely
    /// approximate. [`Layout::of`] is where that is refused.
    ///
    /// Absent is the behavior that existed before this field: the mode
    /// arrives with the monitor and nothing is checked, which is right for
    /// the profile whose displays are placed at the origin or in one row
    /// left to right, where no position depends on a size.
    ///
    /// A SIZE AND NOT A RATE, which kanshi's `mode = "3840x2160@60Hz"` is.
    /// The rate is the half of a mode that changes no arithmetic here — a
    /// logical size is a mode turned and divided by a scale, and no hertz
    /// enters it — and it is also the half that cannot be chosen, for the
    /// reason above. A monitor legitimately reports no rate at all, which the
    /// compositor advertises as `wl_output`'s zero, so a profile that
    /// asserted one would refuse desks that are working. A rate belongs here
    /// on the day a connector can be asked for a mode, and not before.
    #[serde(default)]
    pub mode: Option<(u32, u32)>,
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
    ///
    /// Any name it answers to, which is kanshi's rule and for kanshi's reason:
    /// the output name is always there and is no use to a person, and the
    /// panel's name is what a person can write down and is not always there.
    /// Matching every one of them means a desk can be named a monitor at a
    /// time, as each one's name is read off a running desktop — and that the
    /// vendor may be written the way an EDID spells it or the way hwdata
    /// does, which is [`Connected::spelled_out`].
    ///
    /// An empty name matches nothing, and that is load-bearing rather than
    /// incidental: every monitor whose EDID names it nothing shares the same
    /// empty description, so treating that as identity would let one entry
    /// match any of them. `validate` refuses an empty `display` from the other
    /// side.
    fn connected_in<'a>(&self, connected: &'a [Connected]) -> Option<&'a Connected> {
        connected.iter().find(|display| {
            [&display.name, &display.description, &display.spelled_out]
                .into_iter()
                .any(|name| !name.is_empty() && name == &self.display)
        })
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
        // A mode with no pixels on an axis is not a mode any connector scans
        // out, and it is the one thing about a stated mode that can be known
        // without the monitor. Whether *this* monitor is at it cannot be, and
        // is [`Layout::of`]'s to refuse.
        if let Some((width, height)) = self.mode {
            if width == 0 || height == 0 {
                return Err(ConfigError::Validation(format!(
                    "{at} states {} at {width}x{height}, and no connector \
                     scans out a mode with no pixels on an axis",
                    self.display
                )));
            }
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
    /// Content turned a quarter counterclockwise.
    #[serde(rename = "rotate-90")]
    Rotate90,
    #[serde(rename = "rotate-180")]
    Rotate180,
    /// Content turned a quarter clockwise, for a panel standing on its left side,
    /// which is how a monitor on a desk usually ends up.
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
    /// What the compositor advertises this display as: `drm-<id>` on a tty,
    /// where the id is ozone's, off the EDID. Always present, and no use to
    /// anybody writing a config.
    pub name: String,
    /// The panel's own name — `"<MAKE> <MODEL> <SERIAL>"` off its EDID — or
    /// empty for a monitor that states none of the three.
    ///
    /// The other name a profile may match, and the one a person can actually
    /// write: see [`DisplayPlacement::connected_in`].
    pub description: String,
    /// The same name with the three-letter maker spelled out the way hwdata's
    /// `pnp.ids` spells it — `Dell Inc. DELL U3219Q 2ZLS413` for the
    /// `DEL DELL U3219Q 2ZLS413` above — or empty on a machine with no such
    /// table, and for a monitor whose id is not in the one it has.
    ///
    /// The third name a profile may match, and the one sway and kanshi print,
    /// because they read that table and an EDID does not carry it. Both
    /// spellings match rather than the fuller one replacing the other: every
    /// config that names a monitor today names it in three letters, and one
    /// that came up right yesterday comes up right today.
    pub spelled_out: String,
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
    scanout: Vec<Scanout>,
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

    /// Every display the profile named, as the *connectors* behind them, in
    /// the order the profile wrote them.
    ///
    /// The other half of a profile, and the half [`Layout::placed`] cannot
    /// carry. That one is the desktop this compositor advertises: logical,
    /// turned, and with the displays the profile disabled already dropped.
    /// This one is what a connector does with its glass — which of them to
    /// light at all, and where each one's mode goes — and a display that is
    /// dropped from a desktop still has to be *turned off*.
    pub fn scanout(&self) -> &[Scanout] {
        &self.scanout
    }

    /// Apply `profile` to the monitors it matched.
    ///
    /// Only ever called with a `connected` list [`Profile::matches`] accepted,
    /// which is what makes the lookup below an assertion rather than a branch:
    /// every entry of the profile named a display in that list.
    ///
    /// The `Err` arm is the failures a profile has that parsing cannot catch,
    /// and every one of them is the same shape: the positions are the
    /// config's and the sizes are the hardware's, so how far apart two
    /// displays end up is not known until a monitor is plugged in. An error
    /// rather than a panic because the caller is a compositor holding a
    /// working desktop and a config the user can edit again.
    ///
    /// A mode the profile states and the monitor is not at is the first of
    /// them, and it is checked before anything is placed. Everything below
    /// this line is arithmetic over modes, so a profile wrong about one is a
    /// desktop whose every other number is wrong too — and the complaint
    /// worth printing names the mode, not the far corner it ended up moving.
    pub(crate) fn of(profile: &Profile, connected: &[Connected]) -> Result<Layout, ConfigError> {
        if let Some((placement, display)) = misstated(profile, connected) {
            return Err(unavailable(profile, placement, display));
        }
        let placed = profile
            .displays
            .iter()
            .filter(|placement| placement.enabled)
            .map(|placement| placed(profile, placement, connected))
            .collect::<Result<Vec<_>, _>>()?;
        // Unreachable: a profile that enables no display is refused at parse
        // time, so there is always something here to take a corner from.
        assert!(!placed.is_empty(), "a profile enables at least one display");
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
        let placed: Vec<Placed> = placed
            .into_iter()
            .map(|display| Placed {
                // Non-negative because `near` is the smallest of them, and it
                // fits an `i32` because `extent` has already refused a layout
                // whose span between those two corners does not.
                position: (
                    normalized(display.position.0, near.0),
                    normalized(display.position.1, near.1),
                ),
                ..display
            })
            .collect();
        let scanout = scanout(profile, &placed, connected)?;
        Ok(Layout {
            profile: profile.name.clone(),
            placed,
            size,
            scanout,
        })
    }
}

/// One display of an applied profile, as the engine has to light it.
///
/// A monitor is in two arrangements at once and they are not the same
/// arrangement. The compositor's is [`Placed`]: logical, so a mode divided by
/// a scale, and turned, so a monitor on its side is as tall as its mode is
/// wide. The engine's is this one: physical pixels, untuned and unturned,
/// because that is what a CRTC scans out however the desktop above chooses to
/// read it.
///
/// Except that it carries the turn and the scale too: those are how the
/// engine draws this connector's window, which is what makes the page in it
/// logical and upright without a shell doing anything.
#[derive(Debug, Clone, PartialEq)]
pub struct Scanout {
    /// The display's output name — `drm-<id>` on a tty — which is how the
    /// engine that reported the monitor knows it.
    ///
    /// Not necessarily what the profile wrote: an entry may have named this
    /// monitor by its panel, and this is the name it was found to be.
    pub name: String,
    /// Whether to light this connector at all.
    pub enabled: bool,
    /// Where this connector's mode goes on the engine's own desktop, in
    /// physical pixels.
    ///
    /// STATED FOR A DARK DISPLAY TOO, which is not a contradiction: the
    /// engine's own display list carries a connector whether or not it is
    /// lit, and a dark one left where the card stacked it lands on top of a
    /// lit one that was placed. Two displays claiming one rectangle is worse
    /// than one that is merely off — the first of them wins every lookup,
    /// including the one that sizes the window the desktop is drawn in.
    pub origin: (i32, i32),
    /// Which way up the monitor is. The engine turns this connector's window
    /// by it, so a page lays out upright and never hears about it.
    pub transform: Transform,
    /// Device pixels per logical pixel, which the engine draws this
    /// connector's window at -- so a page lays out in the logical pixels the
    /// desktop is described in rather than in the mode's.
    pub scale: f64,
}

/// One display of an applied profile, placed in the desktop's own coordinates.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    /// The display's output name — `drm-<id>` on a tty — which is what the
    /// `wl_output` is called and what the chrome addresses the screen by.
    ///
    /// Not necessarily what the profile wrote: an entry may have named this
    /// monitor by its panel instead, and this is the name it was found to be.
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
    let display = placement
        .connected_in(connected)
        .expect("a profile is only applied to the displays it matched");
    let mode = display.mode;
    Ok(Placed {
        // The OUTPUT's name, not what the config wrote. A profile may have
        // named this monitor by its panel, and what comes out of here keys a
        // `wl_output` that clients are already on -- so it has to be the name
        // the compositor knows it by however the config found it.
        name: display.name.clone(),
        position: placement.position,
        mode,
        logical: logical(mode, placement.transform, placement.scale)
            .ok_or_else(|| vanished(profile, placement, mode))?,
        scale: placement.scale,
        transform: placement.transform,
    })
}

/// Where each of the profile's connectors goes, in the pixels it scans out.
///
/// STEPPED ACROSS IN THE ORDER THE DISPLAYS ARE PLACED, each starting where
/// the last one's mode ended. The engine lays its own desktop out in the order
/// the card enumerated the connectors, which is the card's business and says
/// nothing about which monitor is on which side of a desk — so a pointer
/// leaving one screen arrives on whichever connector happened to be numbered
/// next. The profile is the only thing that knows, and this is it saying so.
///
/// The mode rather than the logical size, because this is the engine's
/// desktop: a connector occupies what it scans out there, whatever the scale
/// divides it into on ours.
///
/// ALL ON ONE ROW, whatever the desktop above does with the second axis.
/// Nothing is ever drawn across two connectors, so the only thing this
/// arrangement decides is which screen a pointer leaving one arrives on — and
/// a row answers that for every desk anyone puts monitors side by side on.
/// Two monitors stacked vertically is the one thing a profile can say that
/// this does not carry.
///
/// THE DARK ONES ARE IN THE ROW TOO, past the end of the lit ones. They have
/// no place on the desktop to be ordered by — the profile turned them off —
/// but they are still connectors the engine has to put somewhere, and the one
/// place they must not be is on top of a monitor that is on.
///
/// Returned in the order the profile WROTE its entries, which is
/// [`Layout::placed`]'s own order with the dropped ones back in their places.
/// What is ordered by position is where the lit ones land, not the list.
fn scanout(
    profile: &Profile,
    placed: &[Placed],
    connected: &[Connected],
) -> Result<Vec<Scanout>, ConfigError> {
    let mut across = placed.iter().collect::<Vec<_>>();
    across.sort_by_key(|display| (display.position.0, display.position.1));
    let lit = across
        .into_iter()
        .map(|display| (display.name.as_str(), display.mode.0));
    let dark = profile
        .displays
        .iter()
        .filter(|placement| !placement.enabled)
        .map(|placement| {
            let display = found(placement, connected);
            (display.name.as_str(), display.mode.0)
        });

    let mut origins: Vec<(&str, (i32, i32))> = Vec::with_capacity(profile.displays.len());
    let mut edge: i64 = 0;
    for (name, width) in lit.chain(dark) {
        // `i64` for the reason `extent` widens: each mode fits a `u32` and a
        // row of them need not fit the `i32` a corner is. Refused rather than
        // saturated, which would put two connectors on top of each other.
        if edge > i64::from(i32::MAX) {
            return Err(unlightable(profile, name));
        }
        let start = i32::try_from(edge).expect("the row is bounded above just here");
        origins.push((name, (start, 0)));
        edge += i64::from(width);
    }

    Ok(profile
        .displays
        .iter()
        .map(|placement| {
            let display = found(placement, connected);
            Scanout {
                name: display.name.clone(),
                enabled: placement.enabled,
                origin: origins
                    .iter()
                    .find(|(name, _)| *name == display.name)
                    .map(|(_, origin)| *origin)
                    .expect("every display the profile names is in the row"),
                transform: placement.transform,
                scale: placement.scale,
            }
        })
        .collect())
}

/// The first entry of `profile` whose monitor is not at the mode it states,
/// or `None` where every stated mode is the one that arrived.
///
/// EVERY ENTRY, including the ones the profile turns off. A stated mode says
/// what this monitor is rather than what to do with it, and a monitor behind
/// a shut lid is still the one the rest of the profile was written beside —
/// its own mode is what the row of connectors steps across in [`scanout`], so
/// a profile wrong about a dark monitor is wrong about where the dark ones
/// land.
fn misstated<'a>(
    profile: &'a Profile,
    connected: &'a [Connected],
) -> Option<(&'a DisplayPlacement, &'a Connected)> {
    profile
        .displays
        .iter()
        .map(|placement| (placement, found(placement, connected)))
        .find(|(placement, display)| placement.mode.is_some_and(|stated| stated != display.mode))
}

/// The connected display an entry of an applied profile names.
///
/// An assertion rather than a branch, for the reason [`placed`] gives: a
/// layout is only ever built from a `connected` list [`Profile::matches`]
/// accepted, so every entry named one of them.
fn found<'a>(placement: &DisplayPlacement, connected: &'a [Connected]) -> &'a Connected {
    placement
        .connected_in(connected)
        .expect("a profile is only applied to the displays it matched")
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
/// than 3200x1800 relabeled.
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

/// The complaint for a row of connectors longer than a corner can describe.
fn unlightable(profile: &Profile, display: &str) -> ConfigError {
    ConfigError::Validation(format!(
        "output profile {} spans so many pixels across that {} starts beyond \
         what a corner of one desktop can describe",
        profile.name, display
    ))
}

/// The complaint for a monitor that is not at the mode its profile states.
///
/// Names both modes, because either one of them may be the thing that is
/// wrong: the config was written for a monitor that has since been replaced,
/// or the monitor negotiated something other than the mode it used to take.
/// It also says what this compositor will not do about it, which is the part
/// nobody guesses — a desktop that could pick a mode would simply pick this
/// one.
fn unavailable(
    profile: &Profile,
    placement: &DisplayPlacement,
    display: &Connected,
) -> ConfigError {
    let (width, height) = placement
        .mode
        .expect("only an entry that states a mode is misstated");
    ConfigError::Validation(format!(
        "output profile {} is written for {} at {}x{} and it is scanning out \
         {}x{}; this desktop places a monitor at the mode it reports and does \
         not set one, so the profile cannot be applied as written",
        profile.name, placement.display, width, height, display.mode.0, display.mode.1
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
    match profiles
        .iter()
        .find(|profile| profile.resolve(connected).is_some())
    {
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
