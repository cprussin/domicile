//! Scene geometry and keyboard focus for the host.
//!
//! - [`Transform`] and [`Bounds`] place app windows and displays in screen
//!   space.
//! - [`Scene`] tracks which app has the keyboard.
//!
//! The page hit-tests pointer input in the DOM, so pointer routing is not here.

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

    /// Applies `self` first, then `next` (`next ∘ self`).
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

/// An axis-aligned screen rectangle, as its min and max corners.
///
/// For a rotated window the box encloses the transformed corners, so it is
/// larger than the window. Deciding which outputs a window is on errs toward
/// "on": an extra redraw is cheaper than a client drawing at the wrong scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min: Point,
    pub max: Point,
}

impl Bounds {
    /// Whether this box and `other` share any area.
    ///
    /// Touching edges do not count. Adjacent displays share an edge, so a
    /// window ending on that edge is on one display, not both.
    pub fn overlaps(&self, other: &Bounds) -> bool {
        self.min.x < other.max.x
            && other.min.x < self.max.x
            && self.min.y < other.max.y
            && other.min.y < self.max.y
    }

    /// Whether the box has no area: the page's report of a window it does not
    /// draw.
    pub fn is_empty(&self) -> bool {
        self.max.x <= self.min.x || self.max.y <= self.min.y
    }
}

/// Where keyboard input should be delivered.
#[derive(Clone, Debug, PartialEq)]
pub enum KeyboardTarget {
    App(String),
    Chrome,
}

/// Which app has the keyboard.
#[derive(Debug, Default)]
pub struct Scene {
    focus: Option<String>,
}

impl Scene {
    pub fn new() -> Self {
        Scene::default()
    }

    /// Gives the keyboard to `app_id`.
    ///
    /// Does not check that the window exists. The caller (`Host`) owns that
    /// fact and checks before calling.
    pub fn focus_app(&mut self, app_id: &str) {
        self.focus = Some(app_id.to_string());
    }

    /// Returns keyboard focus to the chrome.
    pub fn focus_chrome(&mut self) {
        self.focus = None;
    }

    /// Records that a window closed. Returns focus to the chrome if the window
    /// had it, so focus never names a missing window.
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
