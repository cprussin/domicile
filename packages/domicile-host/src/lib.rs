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

use domicile_protocol::{ChromeMessage, HostMessage};

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
}

impl Host {
    pub fn new() -> Self {
        Host::default()
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
            } => {
                if !self.apps.contains_key(&app_id) {
                    return Err(HostError::UnknownApp(app_id));
                }
                if visible {
                    self.scene.upsert(
                        Portal::new(
                            app_id,
                            (size[0], size[1]),
                            transform_from_wire(transform),
                            z_index,
                        )
                        .styled(Style {
                            corner_radius,
                            opacity,
                        }),
                    );
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
            // something the scene models.
            ChromeMessage::GrabShortcut { .. }
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
