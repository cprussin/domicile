//! The desktop a configured layout makes up, in one coordinate space.
//!
//! The config places each display wherever the user finds it natural to —
//! negative coordinates included, since "to the left of that one" is the
//! obvious way to describe a second monitor. Everything downstream wants the
//! opposite: the nested window's transform is a pure scale, the chrome layer
//! is pinned at the origin, and `getBoundingClientRect` is relative to a page
//! that starts at zero. [`Desktop`] is where the two meet.

use crate::DisplayConfig;

/// One display, placed in the desktop's own coordinate space.
///
/// The same fields [`DisplayConfig`] carries, except that `position` has been
/// normalised — so this is what the compositor advertises and what the chrome
/// is told, and the config's own numbers never leave this crate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    pub name: String,
    /// Top-left corner, relative to the desktop's own top-left.
    pub position: (i32, i32),
    pub size: (u32, u32),
    pub scale: u32,
}

/// Every configured display, and the box they occupy together.
///
/// Only ever built from a non-empty list: a desktop of no displays is not an
/// empty desktop but the *absence* of a described one, which is the case where
/// the single output follows Domicile's own window. See
/// [`OutputConfig::desktop`](crate::OutputConfig::desktop).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Desktop {
    displays: Vec<Display>,
    size: (u32, u32),
}

impl Desktop {
    /// The displays, in the order the config wrote them.
    pub fn displays(&self) -> impl Iterator<Item = &Display> {
        self.displays.iter()
    }

    /// The bounding box of every display, gaps between them included.
    ///
    /// Gaps are legal, and the chrome's page spans them — so the box is what
    /// the displays reach, not what they cover.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }

    /// Place `configured` about its own top-left corner.
    ///
    /// Returns `None` for an empty list, which is the absence of a described
    /// desktop rather than one with nothing on it. The non-empty case is taken
    /// once, by `split_first`, so everything below has a first display to
    /// reduce from and nothing needs a fallback for a list that cannot be here.
    ///
    /// # Panics
    ///
    /// If `configured` describes a layout whose normalised extent does not fit
    /// an `i32`, or a display whose own size does not — not merely if it
    /// skipped [`Config::parse`](crate::Config::parse), since most unvalidated
    /// layouts are perfectly representable.
    ///
    /// `OutputConfig::validate_extent` and `DisplayConfig::validate` are what
    /// make the subtraction and the addition below fit, and this type is
    /// reachable without either: `desktop()`, `OutputConfig`'s fields and
    /// `Deserialize` are all public. So both are asserted rather than
    /// assumed — an unvalidated layout is a caller error, and a named panic is
    /// a better answer than arithmetic that wraps, in release, into a
    /// plausible desktop of the wrong size.
    pub(crate) fn of(configured: &[DisplayConfig]) -> Option<Desktop> {
        let (first, rest) = configured.split_first()?;
        let left = rest
            .iter()
            .map(|d| d.position.0)
            .fold(first.position.0, i32::min);
        let top = rest
            .iter()
            .map(|d| d.position.1)
            .fold(first.position.1, i32::min);
        let displays: Vec<_> = configured
            .iter()
            .map(|display| Display {
                name: display.name.clone(),
                position: (
                    normalised(display.position.0, left),
                    normalised(display.position.1, top),
                ),
                scale: display.scale,
                size: display.size,
            })
            .collect();
        let size = (
            reach(&displays, |display| (display.position.0, display.size.0)),
            reach(&displays, |display| (display.position.1, display.size.1)),
        );
        Some(Desktop { displays, size })
    }
}

/// One coordinate, measured from the desktop's own corner rather than the
/// config's origin.
///
/// `near` is the smallest of these, so the difference is non-negative; that it
/// also *fits* is `OutputConfig::validate_extent`'s guarantee, and this is
/// where that guarantee is checked rather than trusted.
fn normalised(coordinate: i32, near: i32) -> i32 {
    coordinate
        .checked_sub(near)
        .expect("the layout's extent is validated before a desktop is built")
}

/// How far the furthest display's far edge reaches along one axis.
///
/// The desktop's near edge is zero, so the furthest reach *is* the extent.
/// Each display's own near edge is not — it is wherever normalising put it —
/// which is why the length is added to the position rather than taken alone.
fn reach(displays: &[Display], edge: impl Fn(&Display) -> (i32, u32)) -> u32 {
    displays
        .iter()
        .map(|display| {
            let (start, length) = edge(display);
            // Not `unsigned_abs`: that would turn a negative position — which
            // `normalised` has already ruled out — into a plausible positive
            // one, and hand back a desktop of the wrong size with no signal.
            let start = u32::try_from(start).expect("normalised positions are non-negative");
            // Checked for the same reason the subtraction is, and not because
            // it is reachable: `checked_*` is what makes the invariant hold in
            // release, where a plain `+` wraps silently into a desktop of
            // plausible but wrong geometry.
            start
                .checked_add(length)
                .expect("a display's own size is validated before a desktop is built")
        })
        .max()
        .expect("`of` returns before this for an empty list")
}
