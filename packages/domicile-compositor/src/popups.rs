//! Popups and bubbles: announcing and placing them over their windows, keeping
//! menus on screen, and dismissing them.

use domicile_protocol::HostMessage;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::utils::{Logical, Point, Rectangle, Transform};
use smithay::wayland::viewporter::ViewportCachedState;
use smithay::wayland::{
    compositor::{
        get_children, get_parent, get_role, is_sync_subsurface, with_states, BufferAssignment,
        SubsurfaceCachedState, SurfaceAttributes,
    },
    shell::xdg::{PopupSurface, PositionerState, XDG_POPUP_ROLE},
};
use tracing::debug;

use crate::buffer_transform::upright_size;
use crate::surface_commit::{committed_buffer, window_geometry, Role};
use crate::viewport::surface_size;
use crate::DomicileCompositor;

/// An announced bubble. See `DomicileCompositor::bubbles`.
pub struct Bubble {
    pub app_id: String,
    pub surface: WlSurface,
    /// The surface it was announced over. Kept because a hidden bubble is
    /// no longer its child.
    pub parent: WlSurface,
    /// Its position and size as the chrome was last told them, logical.
    placed: ((f64, f64), (f64, f64)),
}

impl DomicileCompositor {
    /// Announce a window's popup on its first buffer commit.
    ///
    /// A popup that never draws needs no placement. Popups over the chrome's
    /// own window belong to the engine and are ignored.
    pub fn announce_a_new_popup(&mut self, surface: &WlSurface) {
        if get_role(surface) != Some(XDG_POPUP_ROLE) || self.by_surface.contains_key(surface) {
            return;
        }
        let Some(popup) = self
            .xdg_shell_state
            .popup_surfaces()
            .iter()
            .find(|popup| popup.wl_surface() == surface)
            .cloned()
        else {
            return;
        };
        let has_a_buffer = with_states(surface, |states| {
            let mut attributes = states.cached_state.get::<SurfaceAttributes>();
            matches!(
                attributes.current().buffer,
                Some(BufferAssignment::NewBuffer(_))
            )
        });
        let Some(parent) = popup
            .get_parent_surface()
            .and_then(|parent| self.app_id_of(&parent))
        else {
            return;
        };
        if !has_a_buffer {
            return;
        }
        let geometry = popup.with_pending_state(|state| state.geometry);
        let placed = self.hub.host.lock().unwrap().popup_placed(
            &parent,
            (f64::from(geometry.loc.x), f64::from(geometry.loc.y)),
            (f64::from(geometry.size.w), f64::from(geometry.size.h)),
            self.grabbing.contains(&popup),
        );
        if let Some((app_id, message)) = placed {
            debug!(%app_id, %parent, "popup mapped -> Host::popup_placed");
            self.presentations.appeared(&app_id);
            self.by_surface.insert(
                surface.clone(),
                (app_id.clone(), Role::Popup(popup.clone())),
            );
            self.popups.push((app_id, popup));
            self.hub.broadcast(message);
        }
    }

    /// Announce, move or forget the bubbles a commit of `surface` changes.
    ///
    /// That is `surface` itself, which may be a bubble, and the bubbles over
    /// it, since a parent's commit applies their positions.
    pub fn place_the_bubbles(&mut self, surface: &WlSurface) {
        let drawn = drawn_size(surface);
        let over_it = self
            .bubbles
            .iter()
            .filter(|bubble| bubble.parent == *surface)
            .map(|bubble| bubble.surface.clone());
        let children: Vec<WlSurface> = get_children(surface).into_iter().chain(over_it).collect();
        self.place_a_bubble(surface, drawn);
        for child in children {
            self.place_a_bubble(&child, None);
        }
    }

    /// Announce a subsurface of an app as a bubble once it has drawn, place it
    /// again when it moves or resizes, and forget it once it is no longer a
    /// subsurface.
    ///
    /// `drawn` is the size of a buffer it just committed. Chromium hides a
    /// bubble by destroying its `wl_subsurface` and keeping the surface.
    fn place_a_bubble(&mut self, surface: &WlSurface, drawn: Option<(f64, f64)>) {
        let tracked = self
            .bubbles
            .iter()
            .position(|bubble| bubble.surface == *surface);
        let parent = get_parent(surface)
            .and_then(|parent| self.app_id_of(&parent).map(|app_id| (parent, app_id)));
        match (tracked, parent) {
            (Some(at), None) => {
                let bubble = self.bubbles.remove(at);
                self.by_surface.remove(&bubble.surface);
                debug!(app_id = %bubble.app_id, "bubble hidden -> Host::app_closed");
                self.forget(&bubble.app_id);
            }
            (Some(at), Some((parent, _))) => {
                let bubble = &mut self.bubbles[at];
                let placed = (
                    bubble_position(surface, &parent),
                    drawn.unwrap_or(bubble.placed.1),
                );
                if placed == bubble.placed {
                    return;
                }
                bubble.placed = placed;
                let moved =
                    self.hub
                        .host
                        .lock()
                        .unwrap()
                        .popup_moved(&bubble.app_id, placed.0, placed.1);
                if let Some(message) = moved {
                    self.tell_the_move(message);
                }
            }
            (None, Some((parent, parent_id))) => {
                let Some(size) = drawn else {
                    return;
                };
                let position = bubble_position(surface, &parent);
                let placed = self
                    .hub
                    .host
                    .lock()
                    .unwrap()
                    .popup_placed(&parent_id, position, size, false);
                if let Some((app_id, message)) = placed {
                    debug!(%app_id, parent = %parent_id, "bubble mapped -> Host::popup_placed");
                    self.by_surface
                        .insert(surface.clone(), (app_id.clone(), Role::Bubble));
                    self.bubbles.push(Bubble {
                        app_id,
                        surface: surface.clone(),
                        parent,
                        placed: (position, size),
                    });
                    self.tell_the_move(message);
                }
            }
            (None, None) => {}
        }
    }

    /// Tell the chromes a bubble moved: at once, or, if frames sync, once its
    /// commit transaction is applied. See
    /// `docs/architecture/WINDOW-COMPOSITING.md#synced-frames`.
    fn tell_the_move(&mut self, moved: HostMessage) {
        if self.syncs_frames() {
            self.synced_moves.hold(moved);
        } else {
            self.hub.broadcast(moved);
        }
    }

    /// Whether the engine and every chrome sync frames.
    fn syncs_frames(&self) -> bool {
        self.engine
            .as_ref()
            .is_some_and(|session| session.syncs_frames())
            && self.hub.syncs_frames()
    }

    /// Sync `app_id`'s next submit if it goes with a held move. Called just
    /// before the submit, so the frame is named only once it is submitted.
    pub fn sync_with_the_moves(&mut self, app_id: &str) {
        if !self.synced_moves.awaited() {
            return;
        }
        let Some(frame) = self.hub.host.lock().unwrap().sync_frame(app_id) else {
            return;
        };
        let session = self.engine.as_mut().expect("a held move needs an engine");
        if session.sync(app_id, frame) {
            self.synced_moves.synced(app_id, frame);
        }
    }

    /// Tell the chromes the moves a commit transaction held, once its last
    /// commit is applied. Smithay applies a sync subsurface's commit before
    /// its parent's (`Transaction::apply`).
    pub fn tell_the_held_moves(&mut self, surface: &WlSurface) {
        if is_sync_subsurface(surface) {
            return;
        }
        for moved in self.synced_moves.release() {
            self.hub.broadcast(moved);
        }
    }

    /// The window a popup is over, however many popups deep: the app id of
    /// the toplevel at the bottom of its chain.
    pub fn window_under(&self, popup: &PopupSurface) -> Option<String> {
        let mut parent = popup.get_parent_surface()?;
        loop {
            match self
                .popups
                .iter()
                .find(|(_, popup)| *popup.wl_surface() == parent)
            {
                Some((_, popup)) => parent = popup.get_parent_surface()?,
                None => return self.app_id_of(&parent),
            }
        }
    }

    /// Every grabbing popup dismissed, innermost first, as xdg-shell wants.
    pub fn dismiss_the_menus(&mut self) {
        for menu in self.grabbing.drain(..).rev() {
            menu.send_popup_done();
        }
    }

    /// Where `positioner` puts `popup`, adjusted as its
    /// `constraint_adjustment` allows to stay on its window's screen
    /// ([`Screens::screen_of`]).
    ///
    /// As given when there is no screen to keep it on: it has no parent yet (a
    /// layer surface's popup), or the page has not put its window on a screen.
    pub fn kept_on_screen(
        &self,
        popup: &PopupSurface,
        positioner: PositionerState,
    ) -> Rectangle<i32, Logical> {
        let placed = popup.get_parent_surface().and_then(|parent| {
            let window = self.bounds_of(&self.window_under_menus(&parent))?;
            Some((parent, window, self.screens.screen_of(window)?))
        });
        match placed {
            None => positioner.get_geometry(),
            Some((parent, window, screen)) => {
                // The positioner works relative to the parent's geometry.
                let parent_at =
                    Point::from((window.min.x, window.min.y)) + self.menu_offset(&parent).to_f64();
                let target = Rectangle::<f64, Logical>::new(
                    Point::from((screen.min.x, screen.min.y)) - parent_at,
                    (screen.max.x - screen.min.x, screen.max.y - screen.min.y).into(),
                );
                positioner.get_unconstrained_geometry(target.to_i32_round())
            }
        }
    }

    /// Where `surface` is relative to the window under its menus: the sum of
    /// their positions, or zero for a surface that is not a menu.
    fn menu_offset(&self, surface: &WlSurface) -> Point<i32, Logical> {
        self.xdg_shell_state
            .popup_surfaces()
            .iter()
            .find(|popup| popup.wl_surface() == surface)
            .map_or_else(Point::default, |popup| {
                let at = popup.with_pending_state(|state| state.geometry.loc);
                popup
                    .get_parent_surface()
                    .map_or(at, |parent| at + self.menu_offset(&parent))
            })
    }

    /// The window a menu (or nested menu) was opened over, or `surface` itself
    /// if it is not a menu.
    ///
    /// Asks the shell, not `popups`, because a menu grabs the keyboard before
    /// it has drawn.
    pub fn window_under_menus(&self, surface: &WlSurface) -> WlSurface {
        self.xdg_shell_state
            .popup_surfaces()
            .iter()
            .find(|popup| popup.wl_surface() == surface)
            .and_then(|popup| popup.get_parent_surface())
            .map_or_else(
                || surface.clone(),
                |parent| self.window_under_menus(&parent),
            )
    }
}

/// The logical size of the buffer `surface` is committing, or `None` if it
/// commits none.
fn drawn_size(surface: &WlSurface) -> Option<(f64, f64)> {
    with_states(surface, |states| {
        let destination = states
            .cached_state
            .get::<ViewportCachedState>()
            .current()
            .dst
            .map(|size| (size.w, size.h));
        let mut attributes = states.cached_state.get::<SurfaceAttributes>();
        let attributes = attributes.current();
        let Some(BufferAssignment::NewBuffer(buffer)) = &attributes.buffer else {
            return None;
        };
        let (width, height) = surface_size(
            upright_size(
                committed_buffer(buffer)?.size(),
                Transform::from(attributes.buffer_transform),
            ),
            attributes.buffer_scale,
            destination,
        );
        Some((f64::from(width), f64::from(height)))
    })
}

/// Where a bubble is over `parent`, logical: its subsurface position from
/// the corner of the parent's window geometry, as a popup's is.
fn bubble_position(surface: &WlSurface, parent: &WlSurface) -> (f64, f64) {
    let location = with_states(surface, |states| {
        states
            .cached_state
            .get::<SubsurfaceCachedState>()
            .current()
            .location
    });
    let (x, y) = with_states(parent, window_geometry).map_or((0, 0), |(x, y, _, _)| (x, y));
    (f64::from(location.x - x), f64::from(location.y - y))
}
