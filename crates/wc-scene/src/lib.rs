//! Loom scene model: where app windows live on screen and how input is routed.
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
        Transform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 }
    }

    pub fn translate(tx: f64, ty: f64) -> Self {
        Transform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: tx, f: ty }
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Transform { a: sx, b: 0.0, c: 0.0, d: sy, e: 0.0, f: 0.0 }
    }

    /// Counter-clockwise rotation by `radians`.
    pub fn rotate(radians: f64) -> Self {
        let (s, c) = radians.sin_cos();
        Transform { a: c, b: s, c: -s, d: c, e: 0.0, f: 0.0 }
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
        Point::new(self.a * p.x + self.c * p.y + self.e, self.b * p.x + self.d * p.y + self.f)
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
}

impl Portal {
    pub fn new(app_id: impl Into<String>, size: (f64, f64), transform: Transform, z_index: i32) -> Self {
        Portal { app_id: app_id.into(), size, transform, z_index }
    }

    /// If `screen` falls within this portal, return the app-local coordinate.
    fn local_hit(&self, screen: Point) -> Option<Point> {
        let local = self.transform.inverse()?.apply(screen);
        let (w, h) = self.size;
        if local.x >= 0.0 && local.x <= w && local.y >= 0.0 && local.y <= h {
            Some(local)
        } else {
            None
        }
    }
}

/// The result of a successful hit-test.
#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub app_id: String,
    pub local: Point,
}

/// Where a pointer event should be delivered.
#[derive(Clone, Debug, PartialEq)]
pub enum PointerTarget {
    /// Deliver to an app at the given app-local coordinate.
    App { app_id: String, local: Point },
    /// Deliver to the chrome (the web page) at the given screen coordinate.
    Chrome { screen: Point },
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
    /// A replacement keeps the newest as most-recently-inserted (top of ties).
    pub fn upsert(&mut self, portal: Portal) {
        self.remove_portal(&portal.app_id);
        self.portals.push(portal);
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

    /// Find the topmost app portal under `screen`.
    pub fn hit_test(&self, screen: Point) -> Option<Hit> {
        let mut best: Option<(i32, usize, Hit)> = None;
        for (index, portal) in self.portals.iter().enumerate() {
            if let Some(local) = portal.local_hit(screen) {
                let candidate = (portal.z_index, index);
                let better = match &best {
                    Some((z, i, _)) => candidate > (*z, *i),
                    None => true,
                };
                if better {
                    best = Some((portal.z_index, index, Hit { app_id: portal.app_id.clone(), local }));
                }
            }
        }
        best.map(|(_, _, hit)| hit)
    }

    /// Route a pointer at `screen` to an app (with local coords) or the chrome.
    pub fn route_pointer(&self, screen: Point) -> PointerTarget {
        match self.hit_test(screen) {
            Some(hit) => PointerTarget::App { app_id: hit.app_id, local: hit.local },
            None => PointerTarget::Chrome { screen },
        }
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
