//! `zwp_pointer_constraints_v1`: a game or VM viewer locking the pointer in
//! place, or confining it to its window.
//!
//! The engine draws the pointer and moves it, so the compositor cannot hold it
//! still itself. It offers the ask to the page instead
//! ([`HostMessage::AppPointerConstraint`]), and only for the window under the
//! pointer. The page takes the pointer (a pointer lock on the window's
//! element, or confining it to the element) and says so with
//! [`ChromeMessage::PointerConstrained`](domicile_protocol::ChromeMessage::PointerConstrained);
//! only then is the client told `locked` or `confined`. The page lets go the
//! same way, so Escape and a focus change are the shell's to decide.
//!
//! Smithay says nothing when a client destroys its constraint, so the offer is
//! checked again at each pointer motion, which keeps coming while a lock is
//! held.

use domicile_protocol::{HostMessage, PointerConstraint};
use smithay::delegate_pointer_constraints;
use smithay::input::pointer::PointerHandle;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::utils::{Logical, Point};
use smithay::wayland::pointer_constraints::{
    with_pointer_constraint, PointerConstraint as Constraint, PointerConstraintsHandler,
};
use tracing::debug;

use crate::DomicileCompositor;

/// The constraint offered to the page: on which window, and which kind.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Offered {
    app_id: String,
    surface: WlSurface,
    constraint: PointerConstraint,
}

impl DomicileCompositor {
    /// The constraint the client asked for on `surface`, if any.
    fn constraint_on(&self, surface: &WlSurface) -> Option<PointerConstraint> {
        let pointer = self.seat.get_pointer()?;
        with_pointer_constraint(surface, &pointer, |constraint| {
            constraint.map(|constraint| match &*constraint {
                Constraint::Locked(_) => PointerConstraint::Lock,
                Constraint::Confined(_) => PointerConstraint::Confine,
            })
        })
    }

    /// Whether the pointer is locked over `surface`: a lock the page took and
    /// the client was told of. Absolute motion then stays with the page.
    pub(crate) fn pointer_locked_over(&self, surface: &WlSurface) -> bool {
        let Some(pointer) = self.seat.get_pointer() else {
            return false;
        };
        with_pointer_constraint(surface, &pointer, |constraint| {
            constraint.is_some_and(|constraint| {
                matches!(&*constraint, Constraint::Locked(_)) && constraint.is_active()
            })
        })
    }

    /// Bring the page's offer in line with the window under the pointer:
    /// withdraw one for a window the pointer left or whose client withdrew
    /// it, and offer the one the window under the pointer asked for.
    pub(crate) fn offer_pointer_constraint(&mut self) {
        let wanted = match (self.pointer_app.clone(), self.pointer_surface.clone()) {
            (Some(app_id), Some(surface)) => {
                self.constraint_on(&surface).map(|constraint| Offered {
                    app_id,
                    surface,
                    constraint,
                })
            }
            _ => None,
        };
        if wanted == self.pointer_constraint_offered {
            return;
        }
        if let Some(offered) = self.pointer_constraint_offered.take() {
            self.release_constraint(&offered.surface);
            debug!(app_id = %offered.app_id, "pointer constraint withdrawn -> Host");
            self.hub.broadcast(HostMessage::AppPointerConstraint {
                app_id: offered.app_id,
                constraint: None,
            });
        }
        if let Some(wanted) = wanted {
            debug!(app_id = %wanted.app_id, constraint = ?wanted.constraint, "pointer constraint offered -> Host");
            self.hub.broadcast(HostMessage::AppPointerConstraint {
                app_id: wanted.app_id.clone(),
                constraint: Some(wanted.constraint),
            });
            self.pointer_constraint_offered = Some(wanted);
        }
    }

    /// A window went away: forget its offer without telling the page, which
    /// is dropping the window's element.
    pub(crate) fn forget_pointer_constraint(&mut self, app_id: &str) {
        if self
            .pointer_constraint_offered
            .as_ref()
            .is_some_and(|offered| offered.app_id == app_id)
        {
            self.pointer_constraint_offered = None;
        }
    }

    /// The page took (`active`) or let go of the pointer for `app_id`.
    ///
    /// Dropped unless that window holds the offer: the page answering an
    /// offer withdrawn since must not lock a window the pointer has left.
    pub(crate) fn page_constrained(&mut self, app_id: &str, active: bool) {
        let Some(offered) = self
            .pointer_constraint_offered
            .clone()
            .filter(|offered| offered.app_id == app_id)
        else {
            debug!(%app_id, active, "pointer constraint not offered -> dropped");
            return;
        };
        let Some(pointer) = self.seat.get_pointer() else {
            return;
        };
        if active {
            with_pointer_constraint(&offered.surface, &pointer, |constraint| {
                if let Some(constraint) = constraint.filter(|constraint| !constraint.is_active()) {
                    constraint.activate();
                }
            });
            debug!(%app_id, constraint = ?offered.constraint, "pointer constrained");
        } else {
            self.release_constraint(&offered.surface);
            debug!(%app_id, "pointer let go");
            // A oneshot constraint ends at release, which withdraws the offer.
            self.offer_pointer_constraint();
        }
    }

    /// Tell the client on `surface` its pointer is free, if it was told
    /// otherwise.
    fn release_constraint(&self, surface: &WlSurface) {
        let Some(pointer) = self.seat.get_pointer() else {
            return;
        };
        with_pointer_constraint(surface, &pointer, |constraint| {
            if let Some(constraint) = constraint.filter(|constraint| constraint.is_active()) {
                constraint.deactivate();
            }
        });
    }
}

impl PointerConstraintsHandler for DomicileCompositor {
    fn new_constraint(&mut self, _surface: &WlSurface, _pointer: &PointerHandle<Self>) {
        // Offered now if the pointer is over the window, otherwise when it
        // arrives.
        self.offer_pointer_constraint();
    }

    fn cursor_position_hint(
        &mut self,
        _surface: &WlSurface,
        _pointer: &PointerHandle<Self>,
        _location: Point<f64, Logical>,
    ) {
        // Where the client would like the pointer at unlock. The page puts it
        // back where the lock began, which is a place the user saw it.
    }
}

delegate_pointer_constraints!(DomicileCompositor);
