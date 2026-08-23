//! The Domicile host orchestrator — the compositor's brain.
//!
//! [`Host`] is deliberately free of Wayland and GPU dependencies: it tracks
//! connected apps, applies the placement/focus decisions the chrome sends, and
//! decides where input goes. The Smithay Wayland-server backend (behind the
//! `smithay-backend` feature) is thin glue that drives this: it calls
//! [`Host::app_appeared`] when a client maps a toplevel, feeds
//! [`Host::handle_chrome_message`] with messages from the in-page bridge, and
//! asks [`Host::route_pointer`] / [`Host::keyboard_target`] where to deliver
//! input.
//!
//! This split keeps the interesting logic unit-testable end to end.

use std::collections::HashMap;

use domicile_protocol::{ChromeMessage, DisplayInfo, HostMessage};

pub mod ipc;
use domicile_scene::{KeyboardTarget, PointerTarget, Portal, Scene, Style, Transform};

/// Identifier for a connected app (Wayland toplevel), assigned by the host.
pub type AppId = String;

/// Something went wrong applying a chrome message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("no such app: {0}")]
    UnknownApp(AppId),
}

/// A connected app the host knows about (independent of whether the chrome has
/// given it an on-screen portal yet).
#[derive(Debug, Clone)]
pub struct App {
    pub app_id: AppId,
    /// Where this app falls in the order clients mapped, so a desktop can be
    /// re-announced in the order it was built up. Kept as a field because the
    /// alternative — reading the number back out of `app_id` — has to answer
    /// for an id with no number in it, and there is no such id.
    pub arrival: u64,
    pub title: Option<String>,
    /// The client's own content size, as of its latest committed buffer.
    pub size: (f64, f64),
    /// The size the chrome last laid its `<app>` element out at, which the
    /// compositor configures the client to. `None` until the chrome resizes it.
    pub requested_size: Option<(f64, f64)>,
}

/// Where an input event should be delivered.
#[derive(Debug, Clone, PartialEq)]
pub enum InputDelivery {
    /// Deliver to a Wayland client at an app-local coordinate.
    App { app_id: AppId, local: (f64, f64) },
    /// Deliver to the chrome (web page) at a screen coordinate.
    Chrome { screen: (f64, f64) },
}

/// The compositor's orchestration state.
#[derive(Debug, Default)]
pub struct Host {
    scene: Scene,
    apps: HashMap<AppId, App>,
    next_id: u64,
    /// The keyboard holder as the chromes were last told it, so that
    /// [`Host::focus_change`] can say nothing when nothing moved.
    told_focus: Option<AppId>,
    /// What the desktop is made of, as every chrome is told — on connecting,
    /// and again whenever it changes under them.
    ///
    /// Empty until something describes one, which is a desktop of no screens
    /// and nothing else. The compositor always describes at least one output,
    /// so a chrome on *it* never sees this — but a `Host` nobody has told is a
    /// real configuration, and the `domicile` daemon is one: it serves this
    /// protocol from a bare `Session` and never describes a desktop to it.
    /// Saying "no screens" beats inventing a display it never asked for.
    displays: Vec<DisplayInfo>,
}

impl Host {
    pub fn new() -> Self {
        Host::default()
    }

    /// Say what the desktop is made of, for every chrome that connects after.
    ///
    /// Replaces whatever was described before rather than adding to it: the
    /// argument is the desktop, not a display joining one. The compositor
    /// re-describes on the path where the desktop changes at runtime — with no
    /// displays configured it is Domicile's own window, and resizing that
    /// window resizes it — so a chrome connecting after has to be told the
    /// current desktop rather than whichever was first.
    pub fn describe_displays(&mut self, displays: Vec<DisplayInfo>) {
        self.displays = displays;
    }

    /// The desktop, in the message a chrome is told it as.
    ///
    /// Two callers and they are not the same event: the handshake answers a
    /// connecting chrome with it, and the compositor broadcasts it to the
    /// chromes already connected when the desktop changes under them.
    pub fn describe_desktop(&self) -> HostMessage {
        HostMessage::Displays {
            displays: self.displays.clone(),
        }
    }

    /// Register a newly-mapped Wayland toplevel. Returns its assigned id and the
    /// message to forward to the chrome so it can mount an `<app>` element. The
    /// app has no on-screen portal until the chrome places it.
    pub fn app_appeared(
        &mut self,
        title: Option<String>,
        size: (f64, f64),
    ) -> (AppId, HostMessage) {
        self.next_id += 1;
        let app_id = format!("app-{}", self.next_id);
        self.apps.insert(
            app_id.clone(),
            App {
                app_id: app_id.clone(),
                arrival: self.next_id,
                title: title.clone(),
                size,
                requested_size: None,
            },
        );
        let message = HostMessage::AppAppeared {
            app_id: app_id.clone(),
            title,
            size: [size.0, size.1],
        };
        (app_id, message)
    }

    /// Everything a chrome needs to mount the desktop as it stands, as if each
    /// window had just appeared.
    ///
    /// `app_appeared` is sent once, when the client maps, and nothing ever says
    /// it again — so a chrome that was not listening at that moment loses that
    /// window for good, while the client goes on running and drawing. Two ways
    /// in: a client that maps in the milliseconds between the page's handshake
    /// and its first React commit, and every reload, which starts a fresh page
    /// against a compositor full of clients.
    ///
    /// In the order the apps arrived rather than the map's, which is arbitrary
    /// — a desktop that mounts its windows in a different order on each reload
    /// is its own bug.
    pub fn open_apps(&self) -> Vec<HostMessage> {
        let mut open: Vec<&App> = self.apps.values().collect();
        open.sort_by_key(|app| app.arrival);
        open.iter()
            .map(|app| HostMessage::AppAppeared {
                app_id: app.app_id.clone(),
                title: app.title.clone(),
                size: [app.size.0, app.size.1],
            })
            // And who has the keyboard, which a page that has just loaded has
            // no other way to learn. After the windows: it names one of them.
            //
            // Sent unconditionally rather than through `focus_change`, and
            // without disturbing what that has told the other chromes. This
            // announcement is a catch-up rather than a change, so it must not
            // consume the delta the chromes that were already listening are
            // still owed — and the compositor broadcasts it, so a chrome that
            // already knew is told what it already knew, which is the same
            // no-op as a second `app_appeared`.
            .chain(std::iter::once(HostMessage::FocusChanged {
                app_id: self.focus_holder(),
            }))
            .collect()
    }

    /// Who holds the keyboard, in the shape the chrome is told it.
    fn focus_holder(&self) -> Option<AppId> {
        match self.scene.keyboard_target() {
            KeyboardTarget::App(app_id) => Some(app_id),
            KeyboardTarget::Chrome => None,
        }
    }

    /// What the chrome has to be told about focus, which is nothing unless it
    /// moved since the last time this was asked.
    ///
    /// Asked after anything that could move it rather than returned from each
    /// of those, because the things that move focus do not look alike — a
    /// chrome message, a click the compositor routed, a client going away —
    /// and the one thing they have in common is that afterwards the answer to
    /// this question may have changed.
    pub fn focus_change(&mut self) -> Option<HostMessage> {
        let holder = self.focus_holder();
        if holder == self.told_focus {
            return None;
        }
        self.told_focus = holder.clone();
        Some(HostMessage::FocusChanged { app_id: holder })
    }

    /// Record a client's new content size. Returns the chrome notification, or
    /// `None` if the app is unknown.
    pub fn app_resized(&mut self, app_id: &str, size: (f64, f64)) -> Option<HostMessage> {
        let app = self.apps.get_mut(app_id)?;
        app.size = size;
        Some(HostMessage::AppResized {
            app_id: app_id.to_string(),
            size: [size.0, size.1],
        })
    }

    /// Tear down a client: forget it and remove any portal. Returns the chrome
    /// notification, or `None` if the app was already gone.
    pub fn app_closed(&mut self, app_id: &str) -> Option<HostMessage> {
        self.apps.remove(app_id)?;
        self.scene.remove(app_id);
        Some(HostMessage::AppClosed {
            app_id: app_id.to_string(),
        })
    }

    /// Apply a message received from the chrome bridge.
    pub fn handle_chrome_message(&mut self, message: ChromeMessage) -> Result<(), HostError> {
        match message {
            ChromeMessage::Hello { .. } => {
                // The handshake is handled by the connection layer; nothing to do here.
            }
            ChromeMessage::SetDevicePixelRatio { .. } => {
                // The scene is described in logical units, which do not change
                // when the display's pixel density does. This is the
                // compositor's business — it becomes the `wl_output` scale —
                // and it is intercepted there before reaching the brain.
            }
            ChromeMessage::PlacePortal {
                app_id,
                transform,
                size,
                z_index,
                visible,
                corner_radius,
                opacity,
                shadow,
                native,
                takes_pointer,
            } => {
                if !self.apps.contains_key(&app_id) {
                    return Err(HostError::UnknownApp(app_id));
                }
                if visible {
                    let placed = Portal::new(
                        app_id,
                        (size[0], size[1]),
                        transform_from_wire(transform),
                        z_index,
                    )
                    .styled(Style {
                        corner_radius,
                        opacity,
                        shadow: shadow.map(|shadow| domicile_scene::Shadow {
                            blur: shadow.blur,
                            color: shadow.color,
                            dx: shadow.dx,
                            dy: shadow.dy,
                            spread: shadow.spread,
                        }),
                    });
                    // A window styled in a way the shaders have no answer for
                    // goes back down the copy path — that window, and only
                    // that window.
                    let placed = if native { placed } else { placed.copied() };
                    // And a window the chrome painted something over takes no
                    // pointer, so the click reaches what covers it.
                    let placed = if takes_pointer {
                        placed
                    } else {
                        placed.inert()
                    };
                    self.scene.upsert(placed);
                } else {
                    // A hidden app is not composited or hit-tested.
                    self.scene.remove(&app_id);
                }
            }
            ChromeMessage::RemovePortal { app_id } => {
                self.scene.remove(&app_id);
            }
            ChromeMessage::ResizeApp { app_id, size } => match self.apps.get_mut(&app_id) {
                Some(app) => app.requested_size = Some((size[0], size[1])),
                None => return Err(HostError::UnknownApp(app_id)),
            },
            ChromeMessage::FocusApp { app_id } => {
                // Focus is what a click means, so it raises the app too:
                // otherwise a click on the lower of two overlapping apps would
                // type into it while the other still takes the pointer.
                self.scene.raise(&app_id);
                self.scene.focus_app(&app_id);
            }
            ChromeMessage::FocusChrome => {
                self.scene.focus_chrome();
            }
            // Compositor-level, like Spawn: a claim on the keyboard is not
            // something the scene models, and a close is the client's to
            // answer — the window leaves the scene when it actually goes away.
            ChromeMessage::CloseApp { .. }
            | ChromeMessage::GrabShortcut { .. }
            | ChromeMessage::Spawn { .. }
            | ChromeMessage::PointerMotion { .. }
            | ChromeMessage::PointerLeave { .. }
            | ChromeMessage::PointerButton { .. }
            | ChromeMessage::PointerAxis { .. }
            | ChromeMessage::Key { .. } => {
                // Compositor-level side effects (spawning, input injection). The
                // compositor intercepts these; the brain ignores them so it stays
                // pure and testable.
            }
        }
        Ok(())
    }

    /// Decide where a pointer event at screen `(x, y)` should be delivered.
    pub fn route_pointer(&self, x: f64, y: f64) -> InputDelivery {
        match self.scene.route_pointer(domicile_scene::Point::new(x, y)) {
            PointerTarget::App { app_id, local } => InputDelivery::App {
                app_id,
                local: (local.x, local.y),
            },
            PointerTarget::Chrome { screen } => InputDelivery::Chrome {
                screen: (screen.x, screen.y),
            },
        }
    }

    /// The current keyboard delivery target.
    pub fn keyboard_target(&self) -> KeyboardTarget {
        self.scene.keyboard_target()
    }

    /// Read-only access to the scene (portals + focus).
    pub fn scene(&self) -> &Scene {
        &self.scene
    }

    /// Look up a connected app.
    pub fn app(&self, app_id: &str) -> Option<&App> {
        self.apps.get(app_id)
    }

    /// Number of connected apps (mapped clients), regardless of placement.
    pub fn app_count(&self) -> usize {
        self.apps.len()
    }
}

/// Convert a wire affine `[a, b, c, d, e, f]` into a scene [`Transform`].
fn transform_from_wire([a, b, c, d, e, f]: [f64; 6]) -> Transform {
    Transform { a, b, c, d, e, f }
}
