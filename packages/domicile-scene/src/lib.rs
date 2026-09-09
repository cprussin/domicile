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

/// Which app has the keyboard.
///
/// It held the placed portals too, until the fork made an `<app>` a
/// `cc::SurfaceLayer`: CSS positions the layer, the page hit-tests in the DOM,
/// and nothing on this side needed to know where a window was any more. What
/// is left is the one fact the seat cannot answer for itself.
#[derive(Debug, Default)]
pub struct Scene {
    focus: Option<String>,
}

impl Scene {
    pub fn new() -> Self {
        Scene::default()
    }

    /// Give the keyboard to `app_id`.
    ///
    /// Ungated here on purpose. It used to refuse an app with no portal, which
    /// was arbitrating between two sources of truth — the seat saw a surface,
    /// the scene saw a placement, and a window that had mapped but not yet
    /// been placed had the first and not the second. The page then drew that
    /// window inactive while every key went into it. There is no second source
    /// now: whether the window exists is the caller's to know, and `Host` asks
    /// its own map before calling.
    pub fn focus_app(&mut self, app_id: &str) {
        self.focus = Some(app_id.to_string());
    }

    /// Return keyboard focus to the chrome.
    pub fn focus_chrome(&mut self) {
        self.focus = None;
    }

    /// A window went away. The keyboard goes back to the chrome if it was
    /// there — nothing else will say so, and a focus naming a window that has
    /// gone is a keyboard pointed at nothing.
    pub fn window_gone(&mut self, app_id: &str) {
        if self.focus.as_deref() == Some(app_id) {
            self.focus = None;
        }
    }

    /// The current keyboard delivery target.
    pub fn keyboard_target(&self) -> KeyboardTarget {
        match &self.focus {
            Some(id) => KeyboardTarget::App(id.clone()),
            None => KeyboardTarget::Chrome,
        }
    }
}
