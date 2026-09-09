//! Domicile scene model: where app windows live on screen and how input is routed.
//!
//! An app window (`<app>`) is a full CSS element, so its placement is an affine
//! [`Transform`] from the app's local pixel space to screen space, plus a
//! stacking order. The host keeps a [`Scene`] of [`Portal`]s and uses it to:
//!
//! - **hit-test** a screen point to the topmost app under it, recovering the
//!   app-local coordinate (via the inverse transform) to forward to the client;
//! - **route** pointer/keyboard input between the chrome and the apps.
//!
//! This is pure geometry/logic with no engine or GPU dependency, and is the
//! host-side counterpart to the web engine's own hit-testing (which additionally
//! accounts for chrome elements layered over apps, alpha, and rounded corners —
//! refinements layered on top of this rectangular model later).

/// A 2D point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }
}

/// A 2D affine transform, stored as the six values of a CSS `matrix(a,b,c,d,e,f)`.
///
/// Maps a local point to screen space:
/// `screen.x = a*x + c*y + e`, `screen.y = b*x + d*y + f`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Transform {
    pub fn identity() -> Self {
        Transform {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }

    pub fn translate(tx: f64, ty: f64) -> Self {
        Transform {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: tx,
            f: ty,
        }
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Transform {
            a: sx,
            b: 0.0,
            c: 0.0,
            d: sy,
            e: 0.0,
            f: 0.0,
        }
    }

    /// Counter-clockwise rotation by `radians`.
    pub fn rotate(radians: f64) -> Self {
        let (s, c) = radians.sin_cos();
        Transform {
            a: c,
            b: s,
            c: -s,
            d: c,
            e: 0.0,
            f: 0.0,
        }
    }

    /// Apply `self` first, then `next` — i.e. `next ∘ self`.
    pub fn then(self, next: Transform) -> Transform {
        Transform {
            a: next.a * self.a + next.c * self.b,
            b: next.b * self.a + next.d * self.b,
            c: next.a * self.c + next.c * self.d,
            d: next.b * self.c + next.d * self.d,
            e: next.a * self.e + next.c * self.f + next.e,
            f: next.b * self.e + next.d * self.f + next.f,
        }
    }

    /// Map a local point to screen space.
    pub fn apply(&self, p: Point) -> Point {
        Point::new(
            self.a * p.x + self.c * p.y + self.e,
            self.b * p.x + self.d * p.y + self.f,
        )
    }

    /// The inverse transform, or `None` if the linear part is singular.
    pub fn inverse(&self) -> Option<Transform> {
        let det = self.a * self.d - self.c * self.b;
        if det.abs() < 1e-12 {
            return None;
        }
        let inv_det = 1.0 / det;
        let ia = self.d * inv_det;
        let ib = -self.b * inv_det;
        let ic = -self.c * inv_det;
        let id = self.a * inv_det;
        Some(Transform {
            a: ia,
            b: ib,
            c: ic,
            d: id,
            e: -(ia * self.e + ic * self.f),
            f: -(ib * self.e + id * self.f),
        })
    }
}

/// A placed app window: an app's local surface positioned on screen.
#[derive(Clone, Debug)]
pub struct Portal {
    pub app_id: String,
    /// Local content size `(width, height)` in app pixels.
    pub size: (f64, f64),
    /// Local-to-screen transform.
    pub transform: Transform,
    /// Stacking order; higher is closer to the viewer.
    pub z_index: i32,
    /// How the window is drawn, as opposed to where.
    pub style: Style,
    /// Whether a pointer over this window belongs to it.
    ///
    /// False for an element the chrome gave `pointer-events: none`. That is
    /// the page's own way of saying an element does not take the pointer, and
    /// it is the only way the compositor can know: hit-testing here is a test
    /// against a rectangle, and a rectangle cannot see that the engine painted
    /// a menu, a dialog or a browser tab over the window. Such a window would
    /// swallow every click meant for what covers it — and because the click
    /// that hands the keyboard back to the chrome is one the chrome has to
    /// *receive*, it would swallow the way out as well.
    pub takes_pointer: bool,
}

/// The parts of an element's computed style the compositor applies itself.
///
/// It draws the window rather than handing its pixels to the engine, so a
/// `border-radius` or an `opacity` on the element is no longer something the
/// engine puts on a picture — the compositor has to be told, and does it in its
/// own shader.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Style {
    /// `border-radius`, in the same logical units as `size`.
    pub corner_radius: f64,
    /// `opacity`, 0 to 1.
    pub opacity: f64,
    /// The shadow the window casts, if any.
    pub shadow: Option<Shadow>,
}

/// A shadow, in the same logical units as a portal's size.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadow {
    pub dx: f64,
    pub dy: f64,
    pub blur: f64,
    pub spread: f64,
    /// Straight RGBA: channels 0-255, alpha 0-1.
    pub color: [f64; 4],
}

impl Default for Style {
    /// A square, opaque window: what an element that styled nothing gets.
    fn default() -> Self {
        Style {
            corner_radius: 0.0,
            opacity: 1.0,
            shadow: None,
        }
    }
}

impl Portal {
    /// A portal with nothing styled — square and opaque. `styled` adds to it,
    /// which keeps every existing caller and test saying what it meant.
    pub fn new(
        app_id: impl Into<String>,
        size: (f64, f64),
        transform: Transform,
        z_index: i32,
    ) -> Self {
        Portal {
            style: Style::default(),
            // A window is there to be used. A chrome with no opinion is one
            // from before there was anything to paint over a window.
            takes_pointer: true,
            app_id: app_id.into(),
            size,
            transform,
            z_index,
        }
    }

    /// The same portal, with a style.
    pub fn styled(self, style: Style) -> Self {
        Portal { style, ..self }
    }

    /// The same portal, drawn but not clickable — `pointer-events: none`.
    pub fn inert(self) -> Self {
        Portal {
            takes_pointer: false,
            ..self
        }
    }

    /// The transform a renderer draws this portal's surface with: the unit
    /// square onto the output, in output pixels.
    ///
    /// Renderers draw a textured quad from the unit square rather than from
    /// the surface's own pixel dimensions, so the surface's size belongs in
    /// the matrix. Output pixels rather than clip space because the projection
    /// is the renderer's to apply and it already knows the output — baking it
    /// in here would make this depend on a size it has no reason to know.
    ///
    /// This is the drawing half of [`Scene::hit_test`]: the same transform,
    /// applied forwards. A compositor that draws a window through one and
    /// routes clicks through the other has to keep them in step, which is why
    /// they live together.
    pub fn surface_to_output(&self) -> Transform {
        Transform::scale(self.size.0, self.size.1).then(self.transform)
    }

    /// The screen-space box this window reaches.
    ///
    /// Every corner is transformed rather than just the origin and the far
    /// corner: a rotation or a flip moves which corner is which, so a box
    /// built from two of them can come out inside-out — `min` above `max` —
    /// and overlap nothing at all.
    pub fn bounds(&self) -> Bounds {
        let (w, h) = self.size;
        let corners = [
            self.transform.apply(Point::new(0.0, 0.0)),
            self.transform.apply(Point::new(w, 0.0)),
            self.transform.apply(Point::new(0.0, h)),
            self.transform.apply(Point::new(w, h)),
        ];
        // `f64::min`/`max` rather than a comparison chain, so a `NaN` from a
        // degenerate transform folds to the other corner instead of ordering
        // arbitrarily.
        let mut min = corners[0];
        let mut max = corners[0];
        for corner in &corners[1..] {
            min = Point::new(min.x.min(corner.x), min.y.min(corner.y));
            max = Point::new(max.x.max(corner.x), max.y.max(corner.y));
        }
        Bounds { min, max }
    }
}

/// The rectangle a portal reaches on screen, as its two extreme corners.
///
/// Axis-aligned, which for a rotated window is larger than the window: the
/// corners are transformed and the box is drawn around them. That is the
/// deliberate answer where this is used to decide which outputs a window is
/// on — a window said to be on a screen it only reaches the corner of costs
/// that screen a redraw it did not need, and one *not* said to be on a screen
/// it covers costs the client the scale it should have drawn at.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min: Point,
    pub max: Point,
}

impl Bounds {
    /// Whether this box and `other` share any area.
    ///
    /// Touching edges do not count. Two displays laid out side by side abut
    /// exactly, so a window ending on the seam is on the screen it is *in*
    /// rather than on both — and a zero-width overlap is not somewhere a
    /// window can be seen.
    pub fn overlaps(&self, other: &Bounds) -> bool {
        self.min.x < other.max.x
            && other.min.x < self.max.x
            && self.min.y < other.max.y
            && other.min.y < self.max.y
    }
}

/// Where keyboard input should be delivered.
#[derive(Clone, Debug, PartialEq)]
pub enum KeyboardTarget {
    App(String),
    Chrome,
}

/// The set of placed app portals plus current keyboard focus.
#[derive(Debug, Default)]
pub struct Scene {
    /// Insertion-ordered; later entries win z-index ties.
    portals: Vec<Portal>,
    /// `None` means the chrome holds keyboard focus.
    focus: Option<String>,
}

impl Scene {
    pub fn new() -> Self {
        Scene::default()
    }

    /// Insert a portal, or replace the existing one with the same `app_id`.
    ///
    /// A replacement keeps its place in the stack: the chrome re-places an app
    /// every time its element moves or resizes, and that must not reorder apps
    /// that share a z-index. Use [`raise`](Scene::raise) to change the order.
    pub fn upsert(&mut self, portal: Portal) {
        match self.portals.iter_mut().find(|p| p.app_id == portal.app_id) {
            Some(existing) => *existing = portal,
            None => self.portals.push(portal),
        }
    }

    /// Remove a portal by app id, returning whether one was removed.
    pub fn remove(&mut self, app_id: &str) -> bool {
        let removed = self.remove_portal(app_id);
        if removed && self.focus.as_deref() == Some(app_id) {
            self.focus = None;
        }
        removed
    }

    fn remove_portal(&mut self, app_id: &str) -> bool {
        let before = self.portals.len();
        self.portals.retain(|p| p.app_id != app_id);
        self.portals.len() != before
    }

    pub fn get(&self, app_id: &str) -> Option<&Portal> {
        self.portals.iter().find(|p| p.app_id == app_id)
    }

    pub fn len(&self) -> usize {
        self.portals.len()
    }

    pub fn is_empty(&self) -> bool {
        self.portals.is_empty()
    }

    /// Give keyboard focus to an app. Returns `false` (a no-op) if no such
    /// portal exists.
    pub fn focus_app(&mut self, app_id: &str) -> bool {
        if self.get(app_id).is_some() {
            self.focus = Some(app_id.to_string());
            true
        } else {
            false
        }
    }

    /// Return keyboard focus to the chrome.
    pub fn focus_chrome(&mut self) {
        self.focus = None;
    }

    /// The current keyboard delivery target.
    pub fn keyboard_target(&self) -> KeyboardTarget {
        match &self.focus {
            Some(id) if self.get(id).is_some() => KeyboardTarget::App(id.clone()),
            _ => KeyboardTarget::Chrome,
        }
    }
}
