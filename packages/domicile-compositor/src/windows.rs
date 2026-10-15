//! Toplevel windows: announcing them to the chromes, their sizes and resizes, and
//! forgetting them.

use std::time::Instant;

use smithay::reexports::{
    calloop::timer::{TimeoutAction, Timer},
    wayland_server::protocol::wl_surface::WlSurface,
};
use smithay::wayland::{
    compositor::with_states,
    shell::xdg::{SurfaceCachedState, ToplevelSurface},
};
use tracing::debug;

use domicile_protocol::HostMessage;

use crate::chrome_hub::broadcast_closed;
use crate::configure_answers::Resize;
use crate::decorations::asks_to_draw_its_frame;
use crate::surface_commit::Role;
use crate::{CalloopData, DomicileCompositor};

/// A window's smallest and largest size, `(width, height)` each, as
/// `xdg_toplevel` states them. Zero is no limit.
pub type SizeLimits = ((i32, i32), (i32, i32));

impl DomicileCompositor {
    pub fn toplevel_for(&self, app_id: &str) -> Option<ToplevelSurface> {
        self.toplevels
            .iter()
            .find(|(id, _)| id == app_id)
            .map(|(_, toplevel)| toplevel.clone())
    }

    /// The surface an app id names: a window, or a popup over one.
    pub fn surface_for(&self, app_id: &str) -> Option<WlSurface> {
        self.toplevel_for(app_id)
            .map(|toplevel| toplevel.wl_surface().clone())
            .or_else(|| {
                self.popups
                    .iter()
                    .find(|(id, _)| id == app_id)
                    .map(|(_, popup)| popup.wl_surface().clone())
            })
            .or_else(|| {
                self.bubbles
                    .iter()
                    .find(|bubble| bubble.app_id == app_id)
                    .map(|bubble| bubble.surface.clone())
            })
    }

    /// The window this surface is, if it is one this compositor announced.
    pub fn app_id_of(&self, surface: &WlSurface) -> Option<String> {
        self.by_surface
            .get(surface)
            .map(|(app_id, _)| app_id.clone())
    }

    /// The window `surface` draws for: itself, or the window under the popup
    /// or bubble it is. `None` for the chrome.
    pub fn window_of(&self, surface: &WlSurface) -> Option<String> {
        match self.by_surface.get(surface) {
            Some((app_id, Role::Toplevel(_))) => Some(app_id.clone()),
            Some((_, Role::Bubble)) => self
                .bubbles
                .iter()
                .find(|bubble| bubble.surface == *surface)
                .and_then(|bubble| self.window_of(&bubble.parent)),
            // A popup, announced or not, or a surface with no role yet.
            Some((_, Role::Popup(_))) | None => {
                let window = self.window_under_menus(surface);
                match self.by_surface.get(&window) {
                    Some((app_id, Role::Toplevel(_))) => Some(app_id.clone()),
                    Some((_, Role::Popup(_) | Role::Bubble)) | None => None,
                }
            }
        }
    }

    /// Where the page last put the window `surface` is, if it has said.
    pub fn bounds_of(&self, surface: &WlSurface) -> Option<domicile_scene::Bounds> {
        match self.by_surface.get(surface) {
            Some((app_id, Role::Toplevel(_))) => self.app_bounds.get(app_id).copied(),
            Some((_, Role::Popup(_) | Role::Bubble)) | None => None,
        }
    }

    /// Announce a window to the chromes at its first frame, with what its
    /// client said before drawing it. `size` is from [`window_size`].
    pub fn announce_a_new_window(
        &mut self,
        app_id: &str,
        toplevel: &ToplevelSurface,
        size: (f64, f64),
    ) {
        self.unannounced.remove(app_id);
        self.presentations.appeared(app_id);
        let mapped = domicile_host::Mapped {
            size,
            has_parent: toplevel.parent().is_some(),
            client_frame: asks_to_draw_its_frame(toplevel.wl_surface()),
        };
        // Collected so the host is unlocked before broadcasting. See
        // `title_changed`.
        let announce = self.hub.host.lock().unwrap().app_mapped(app_id, mapped);
        debug!(%app_id, ?mapped, "toplevel drew -> app_appeared");
        for message in announce {
            self.hub.broadcast(message);
        }
    }

    /// Tell the chromes a window's size, if it changed. `size` is from
    /// [`window_size`].
    ///
    /// The engine maps the pointer into the window by this size, so a stale
    /// one offsets every click.
    pub fn tell_the_size(&mut self, app_id: &str, size: (f64, f64)) {
        let resized = self.hub.host.lock().unwrap().app_resized(app_id, size);
        if let Some(message) = resized {
            debug!(%app_id, ?size, "toplevel resized -> app_resized");
            self.hub.broadcast(message);
        }
    }

    /// Tell the chromes a window's size limits, if they changed.
    ///
    /// Checked on every commit because xdg-shell double-buffers them; they
    /// usually arrive on the first, bufferless commit.
    pub fn tell_the_size_limits(&mut self, app_id: &str, surface: &WlSurface) {
        let limits = with_states(surface, |states| {
            let mut cached = states.cached_state.get::<SurfaceCachedState>();
            let state = cached.current();
            (
                (state.min_size.w, state.min_size.h),
                (state.max_size.w, state.max_size.h),
            )
        });
        if self.size_limits.get(app_id) == Some(&limits) {
            return;
        }
        self.size_limits.insert(app_id.to_owned(), limits);
        let (min, max) = limits;
        // Collected so the host is unlocked before broadcasting. See
        // `title_changed`.
        let told: Vec<HostMessage> = {
            let mut host = self.hub.host.lock().unwrap();
            let smallest = host.app_min_size(app_id, (f64::from(min.0), f64::from(min.1)));
            let largest = host.app_max_size(app_id, (f64::from(max.0), f64::from(max.1)));
            smallest.into_iter().chain(largest).collect()
        };
        for told in told {
            self.hub.broadcast(told);
        }
    }

    /// Configure `toplevel` at the engine's box. Sent even at an unchanged
    /// size, so the client's commit names the new box and the page stops
    /// waiting for it. See [`crate::configure_answers`].
    pub fn send_resize(&mut self, app_id: &str, toplevel: &ToplevelSurface, resize: Resize) {
        toplevel.with_pending_state(|state| {
            state.size = Some((resize.size.0 as i32, resize.size.1 as i32).into());
        });
        let serial = toplevel.send_configure();
        let changed = self
            .configure_answers
            .get_mut(app_id)
            .expect("a resize comes from the window's configure answers")
            .sent(serial, resize, Instant::now());
        // A client may not redraw at the size it has, so only a new size
        // waits to be presented.
        if changed {
            self.presentations.resized(app_id, resize.number);
        }
    }

    /// Send `app_id`'s waiting resize at `until` if its client has not
    /// answered the last one by then.
    pub fn resize_when_overdue(&self, app_id: String, until: Instant) {
        self.loop_handle
            .insert_source(
                Timer::from_deadline(until),
                move |_, _, data: &mut CalloopData| {
                    let state = &mut data.state;
                    let overdue = state
                        .configure_answers
                        .get_mut(&app_id)
                        .and_then(|answers| answers.overdue(Instant::now()));
                    // The window may have closed meanwhile.
                    if let (Some(resize), Some(toplevel)) = (overdue, state.toplevel_for(&app_id)) {
                        tracing::debug!(%app_id, "a client did not answer its last resize in time");
                        state.send_resize(&app_id, &toplevel, resize);
                    }
                    TimeoutAction::Drop
                },
            )
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
    }

    /// Release everything held for an app (window or popup) and tell the
    /// chromes it is gone.
    pub fn forget(&mut self, app_id: &str) {
        // Take back the engine's held buffers now. No release will come for a
        // gone surface, and the client may still be running.
        let abandoned = self
            .engine
            .as_mut()
            .map(|session| session.window_gone(app_id))
            .unwrap_or_default();
        for release in abandoned {
            self.returned(release.buffer);
        }
        // All of viz's buffers came back above, so the uploads can go.
        self.uploads.forget(app_id);
        self.configure_answers.remove(app_id);
        self.shown.missed(app_id);
        self.size_limits.remove(app_id);
        self.last_buffers.remove(app_id);
        self.unannounced.remove(app_id);
        self.app_bounds.remove(app_id);
        self.held_frames.forget(app_id);
        self.suspended.remove(app_id);
        self.presentations.forget(app_id);
        let unreported = self.frame_callbacks.forget(app_id);
        self.answer_unreported(unreported);
        self.casting.window_gone(app_id);
        self.shm_refused.forget(app_id);
        self.first_frame_logged.forget(app_id);
        // An app id can return (a reconnecting client), but it then names a
        // different window.
        if self.pointer_app.as_deref() == Some(app_id) {
            self.pointer_app = None;
        }
        debug!(%app_id, "gone -> Host::app_closed");
        broadcast_closed(&self.hub, app_id);
    }
}
