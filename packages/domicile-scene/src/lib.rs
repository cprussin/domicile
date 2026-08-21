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
    /// Whether the compositor draws this window's own buffer.
    ///
    /// False for a window the chrome styled in a way the compositor's shaders
    /// have no answer for — a `filter`, a `clip-path`, a second shadow. Those
    /// go back down the copy path: the compositor reads the client's frame off
    /// the GPU and sends the pixels for the engine to draw, which is slow and
    /// correct, rather than fast and wrong.
    ///
    /// Per window, not per compositor. A desktop where one window wears a blur
    /// pays for that window and nothing else.
    pub draws_natively: bool,
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
            // Natively unless the chrome says otherwise: the fast path is the
            // one to be on, and a chrome too old to have an opinion is a
            // chrome whose windows the shaders can draw.
            draws_natively: true,
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

    /// The same portal, drawn by the engine rather than by the compositor.
    pub fn copied(self) -> Self {
        Portal {
            draws_natively: false,
            ..self
        }
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

    /// Move a portal to the top of its z-index tier, returning whether one was
    /// found. This is how a click raises an app above the others it ties with.
    pub fn raise(&mut self, app_id: &str) -> bool {
        match self.portals.iter().position(|p| p.app_id == app_id) {
            Some(index) => {
                let portal = self.portals.remove(index);
                self.portals.push(portal);
                true
            }
            None => false,
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

    /// The portals bottom-to-top, which is the order to paint them in.
    ///
    /// Sorted by the same key [`hit_test`](Scene::hit_test) picks a winner
    /// with — z-index, then arrival — so among the portals that take the
    /// pointer, the one painted last is exactly the one a click reaches.
    /// Keeping the two orders in one place is what stops a compositor from
    /// looking right and behaving wrong.
    ///
    /// Every portal is painted, including the ones that take no pointer, so
    /// that agreement is narrower than it looks: a window drawn *over*
    /// another while inert hands its clicks to the window underneath, and
    /// what is on top is then not what you click. That is the deliberate
    /// exception rather than the failure above — the chrome asked for it by
    /// giving the element `pointer-events: none`, and it is asking because it
    /// has painted something over that window itself.
    pub fn draw_order(&self) -> Vec<&Portal> {
        let mut ordered: Vec<_> = self.portals.iter().enumerate().collect();
        ordered.sort_by_key(|(index, portal)| (portal.z_index, *index));
        ordered.into_iter().map(|(_, portal)| portal).collect()
    }

    /// Find the topmost app portal under `screen` that takes the pointer.
    ///
    /// Not simply the topmost one: a window the chrome made inert is passed
    /// straight over rather than allowed to win and then swallow the event,
    /// so what answers is whatever is under it — another window, or the
    /// chrome. This is where drawing and routing part company, and
    /// [`draw_order`](Scene::draw_order) says what that costs.
    pub fn hit_test(&self, screen: Point) -> Option<Hit> {
        let mut best: Option<(i32, usize, Hit)> = None;
        // Enumerated before the filter, so an inert portal still spends its
        // index: the tie-break is arrival order among *all* the portals, and
        // renumbering the survivors would reorder two that arrived either
        // side of one.
        let takes_pointer = self
            .portals
            .iter()
            .enumerate()
            .filter(|(_, portal)| portal.takes_pointer);
        for (index, portal) in takes_pointer {
            if let Some(local) = portal.local_hit(screen) {
                let candidate = (portal.z_index, index);
                let better = match &best {
                    Some((z, i, _)) => candidate > (*z, *i),
                    None => true,
                };
                if better {
                    best = Some((
                        portal.z_index,
                        index,
                        Hit {
                            app_id: portal.app_id.clone(),
                            local,
                        },
                    ));
                }
            }
        }
        best.map(|(_, _, hit)| hit)
    }

    /// Route a pointer at `screen` to an app (with local coords) or the chrome.
    pub fn route_pointer(&self, screen: Point) -> PointerTarget {
        match self.hit_test(screen) {
            Some(hit) => PointerTarget::App {
                app_id: hit.app_id,
                local: hit.local,
            },
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
