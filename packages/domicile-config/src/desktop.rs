//! The desktop a configured layout makes up, with its top-left at the origin.
//!
//! The config may place displays at negative coordinates. Everything
//! downstream expects the desktop to start at zero: the nested window's
//! transform is a pure scale, the chrome layer sits at the origin, and
//! `getBoundingClientRect` is relative to the page. [`Desktop`] normalizes the
//! layout.

use crate::DisplayConfig;

/// One display, placed in the desktop's own coordinate space.
///
/// [`DisplayConfig`] with `position` normalized. The compositor advertises
/// these values and sends them to the chrome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    pub name: String,
    /// Top-left corner, relative to the desktop's own top-left.
    pub position: (i32, i32),
    pub size: (u32, u32),
    pub scale: u32,
}

/// Every configured display, and their bounding box.
///
/// Never empty. With no displays configured, the single output follows
/// Domicile's own window instead; see
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

    /// The bounding box of every display, including gaps between them.
    ///
    /// Gaps are allowed, and the chrome's page spans them.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }

    /// `configured`, shifted so its top-left corner is the origin, or `None`
    /// if it is empty.
    ///
    /// # Panics
    ///
    /// If the layout's normalized extent, or a display's own size, does not
    /// fit an `i32`. [`Config::parse`](crate::Config::parse) rejects such
    /// layouts, but callers can build an `OutputConfig` without it. A panic is
    /// better than arithmetic that wraps in release into a desktop of the
    /// wrong size.
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
                    normalized(display.position.0, left),
                    normalized(display.position.1, top),
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

/// One coordinate, measured from the desktop's top-left corner.
///
/// `near` is the smallest coordinate, so the result is non-negative.
/// `OutputConfig::validate_extent` ensures it fits; this checks it.
fn normalized(coordinate: i32, near: i32) -> i32 {
    coordinate
        .checked_sub(near)
        .expect("the layout's extent is validated before a desktop is built")
}

/// The furthest far edge of any display along one axis, which is the
/// desktop's extent since its near edge is zero.
fn reach(displays: &[Display], edge: impl Fn(&Display) -> (i32, u32)) -> u32 {
    displays
        .iter()
        .map(|display| {
            let (start, length) = edge(display);
            // Not `unsigned_abs`, which would turn a negative position into a
            // wrong size silently.
            let start = u32::try_from(start).expect("normalized positions are non-negative");
            // Checked so an invalid layout panics in release instead of
            // wrapping.
            start
                .checked_add(length)
                .expect("a display's own size is validated before a desktop is built")
        })
        .max()
        .expect("`of` returns before this for an empty list")
}
