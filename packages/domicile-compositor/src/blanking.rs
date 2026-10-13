//! Blanks the screens when nobody is here, and honors the idle inhibitors that
//! hold them on. The clock is `crate::idle`'s.

use std::time::{Duration, Instant};

use smithay::delegate_idle_inhibit;
use smithay::reexports::{
    calloop::{
        timer::{TimeoutAction, Timer},
        InsertError,
    },
    wayland_server::{protocol::wl_surface::WlSurface, Resource as _},
};
use smithay::wayland::{idle_inhibit::IdleInhibitHandler, shell::xdg::ToplevelSurface};
use tracing::debug;

use crate::client_requests::ClientRequest;
use crate::idle::{announced, darkened, somebody_is_here, Blanking, Idle, StillThere};
use crate::{CalloopData, DomicileCompositor};

/// Routes `zwp_idle_inhibitor_v1` requests to the idle clock.
///
/// Smithay passes only the surface, so `Idle` stores surfaces. Dead clients'
/// inhibitors are released by
/// [`DomicileCompositor::let_go_of_what_the_dead_were_holding`]; inhibitors on
/// surfaces with no window are handled by
/// [`DomicileCompositor::the_windows_changed`].
impl IdleInhibitHandler for DomicileCompositor {
    fn inhibit(&mut self, surface: WlSurface) {
        self.hold_the_screens_on(surface);
    }

    fn uninhibit(&mut self, surface: WlSurface) {
        self.let_the_screens_go(&surface);
    }
}

delegate_idle_inhibit!(DomicileCompositor);

/// An inhibitor holds only while its surface is alive.
///
/// A dead client's objects stop being alive when its connection is cleaned up,
/// so its inhibitor stops holding without a destroy. See [`StillThere`].
impl StillThere for WlSurface {
    fn still_there(&self) -> bool {
        self.is_alive()
    }
}

impl DomicileCompositor {
    /// Record user activity, and wake the screens if they were dark.
    ///
    /// All input passes through the page and arrives here.
    /// [`crate::idle::somebody_is_here`] decides which requests count.
    pub fn keep_the_desktop_awake(&mut self, request: &ClientRequest) {
        if !somebody_is_here(request) {
            return;
        }
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        match idle.stirred(Instant::now()) {
            Some(Blanking::ComeBack) => {
                debug!("somebody is at this desktop again; its screens come back on");
                self.tell_the_chromes_whether_anybody_is_here();
                self.state_the_connectors();
            }
            Some(Blanking::CallOff) => {
                debug!("somebody is at this desktop again; its screens stay on");
                self.tell_the_shells_how_soon_the_screens_blank();
            }
            Some(Blanking::Warn | Blanking::GoDark) => {
                unreachable!("input never darkens a desktop")
            }
            None => {}
        }
    }

    /// Handle the idle timer. Returns when to fire next; see
    /// [`Idle::next_check`].
    fn the_idle_clock_came_round(&mut self) -> Duration {
        // First, so the lock screen is up before a modeset lights a screen,
        // and so `next_check` knows the lock has fired.
        self.lock_if_nobody_is_here("nobody is at this desktop; it locks itself");
        let now = Instant::now();
        let on_the_desktop = self.surfaces_on_the_desktop();
        let idle = self
            .idle
            .as_mut()
            .expect("the idle clock is armed only where a timeout was stated");
        let edge = idle.elapsed(now, &on_the_desktop);
        // Before acting on the change, which borrows `self`.
        let next = idle.next_check(now);
        self.tell_the_shells_how_soon_the_screens_blank();
        if edge == Some(Blanking::Warn) {
            debug!("nobody is at this desktop; its screens go dark soon");
        }
        if edge == Some(Blanking::GoDark) {
            debug!(
                connectors = self.engine_displays.len(),
                "nobody is at this desktop; its screens go dark"
            );
            self.tell_the_chromes_whether_anybody_is_here();
            self.state_the_connectors();
        }
        next
    }

    /// Lock the desktop, logging `why`, if `idle.lock_after_seconds` has
    /// passed with nobody here. See [`Idle::lock_due`].
    fn lock_if_nobody_is_here(&mut self, why: &str) {
        let toplevels = &self.toplevels;
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        if idle.lock_due(Instant::now(), || desktop_surfaces(toplevels)) {
            self.shut_the_desk(why);
        }
    }

    /// Arm the idle timer for [`Idle::next_check`], replacing any existing
    /// one.
    ///
    /// A desktop that never blanks gets no timer. Removing the old one keeps
    /// reloads from piling up timers.
    pub fn arm_the_idle_clock(&mut self) -> Result<(), InsertError<Timer>> {
        if let Some(armed) = self.idle_clock.take() {
            self.loop_handle.remove(armed);
        }
        if let Some(idle) = &self.idle {
            self.idle_clock = Some(self.loop_handle.insert_source(
                Timer::from_duration(idle.next_check(Instant::now())),
                |_, _, data: &mut CalloopData| {
                    TimeoutAction::ToDuration(data.state.the_idle_clock_came_round())
                },
            )?);
        }
        Ok(())
    }

    /// Tell the engine which connectors to light.
    ///
    /// Awake: [`Screens::scanout`] (a profile's connectors, or empty for no
    /// opinion). Dark: every reported connector, turned off. An empty list
    /// would light everything, so an empty [`crate::idle::darkened`] is not
    /// sent.
    pub fn state_the_connectors(&self) {
        // Every blanking edge passes here.
        self.tell_the_portal_about_the_screensaver();
        let Some(session) = self.engine.as_ref() else {
            return;
        };
        if self.the_screens_are_dark() {
            let dark = darkened(&self.engine_displays, self.screens.scanout());
            if !dark.is_empty() {
                session.configure_displays(&dark);
            }
        } else {
            session.configure_displays(self.screens.scanout());
        }
    }

    /// Whether this desktop's screens are off because nobody is here.
    pub fn the_screens_are_dark(&self) -> bool {
        self.idle.as_ref().is_some_and(Idle::dark)
    }

    /// Keep a blanked desktop dark after a hotplug.
    ///
    /// A hotplugged monitor arrives lit, and on a described desktop (or an
    /// unappliable profile) nothing else sets the connectors. Only acts when
    /// dark, to avoid a needless modeset.
    pub fn keep_the_screens_dark(&self) {
        if self.the_screens_are_dark() {
            self.state_the_connectors();
        }
    }

    /// Tell every chrome whether the desktop is idle.
    ///
    /// Call before setting the connectors. Relighting takes tens of
    /// milliseconds and a page repaints in one, so the shell can hide sensitive
    /// content before the screen is visible. See [`HostMessage::Idle`].
    ///
    /// Unguarded, unlike
    /// [`tell_a_new_chrome_whether_anybody_is_here`](DomicileCompositor::tell_a_new_chrome_whether_anybody_is_here):
    /// every caller is a state change, including a reload that removes the
    /// timeout while the screens are dark.
    pub fn tell_the_chromes_whether_anybody_is_here(&self) {
        self.hub.broadcast(announced(self.the_screens_are_dark()));
    }

    /// Tell the shells when the screens blank, while a warning runs. See
    /// `domicile_host::idle_warnings`, which tells them only of a change.
    pub fn tell_the_shells_how_soon_the_screens_blank(&self) {
        self.hub
            .idle_warnings
            .warn(self.idle.as_ref().and_then(Idle::blanks_at));
    }

    /// Tell a new chrome whether the desktop is idle.
    ///
    /// Silent if the desktop never blanks, so the shell does not show idle UI
    /// that can never trigger. A blanking desktop sends `false` even when
    /// active.
    pub fn tell_a_new_chrome_whether_anybody_is_here(&self) {
        if self.idle.as_ref().is_some_and(Idle::blanks) {
            self.tell_the_chromes_whether_anybody_is_here();
        }
    }

    /// A client took an idle inhibitor for `surface`.
    ///
    /// Without a timeout there is nothing to inhibit.
    fn hold_the_screens_on(&mut self, surface: WlSurface) {
        let on_the_desktop = self.surfaces_on_the_desktop();
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.inhibited_by(surface, Instant::now(), &on_the_desktop);
        self.the_inhibitors_changed(edge, "a client is holding this desktop awake");
    }

    /// Whether an application holds an idle inhibitor through the portal.
    pub fn held_awake_by_the_portal(&mut self, held: bool) {
        let on_the_desktop = self.surfaces_on_the_desktop();
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.held_by_portals(held, Instant::now(), &on_the_desktop);
        self.the_inhibitors_changed(edge, "an application's portal inhibitor changed");
    }

    /// A client released an idle inhibitor.
    fn let_the_screens_go(&mut self, surface: &WlSurface) {
        let on_the_desktop = self.surfaces_on_the_desktop();
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.uninhibited_by(surface, Instant::now(), &on_the_desktop);
        self.the_inhibitors_changed(edge, "nothing is holding this desktop awake now");
    }

    /// Release inhibitors held by dead clients.
    ///
    /// A crashed client sends no destroy, so this runs after every client
    /// dispatch. Otherwise its inhibitor would keep the desktop awake forever.
    /// Smithay only exposes the inhibitor's surface on the request, so there is
    /// no `destroyed` hook to use. Cheap: it checks a handful of inhibitors and
    /// acts only on a change.
    ///
    /// Usually [`the_windows_changed`](DomicileCompositor::the_windows_changed)
    /// has already handled the dead client's window. This still releases
    /// inhibitors on surfaces that were never windows.
    pub fn let_go_of_what_the_dead_were_holding(&mut self) {
        let toplevels = &self.toplevels;
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.the_dead_let_go(Instant::now(), || desktop_surfaces(toplevels));
        self.the_inhibitors_changed(edge, "the client holding this desktop awake is gone");
    }

    /// Re-evaluate inhibitors after the windows changed.
    ///
    /// An inhibitor holds only while its surface is a window on the desktop,
    /// and clients send no inhibitor request when a window maps or closes.
    pub fn the_windows_changed(&mut self, why: &str) {
        let on_the_desktop = self.surfaces_on_the_desktop();
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.the_desktop_changed(Instant::now(), &on_the_desktop);
        self.the_inhibitors_changed(edge, why);
    }

    /// Act on an inhibitor state change, logging `why`.
    ///
    /// Sets the connectors only when the screens go dark or come back.
    ///
    /// Also locks a desktop whose lock timeout passed while an inhibitor held
    /// it.
    fn the_inhibitors_changed(&mut self, edge: Option<Blanking>, why: &str) {
        self.lock_if_nobody_is_here("nothing holds this desktop awake now; it locks itself");
        let Some(edge) = edge else {
            return;
        };
        self.tell_the_shells_how_soon_the_screens_blank();
        match edge {
            Blanking::Warn => debug!("{why}; this desktop's screens go dark soon"),
            Blanking::CallOff => debug!("{why}; this desktop's screens stay on"),
            Blanking::GoDark => {
                debug!("{why}; this desktop's screens go dark");
                self.state_the_connectors();
            }
            Blanking::ComeBack => {
                debug!("{why}; this desktop's screens come back on");
                self.state_the_connectors();
            }
        }
    }

    /// Every toplevel surface on the desktop. See [`desktop_surfaces`].
    pub fn surfaces_on_the_desktop(&self) -> Vec<WlSurface> {
        desktop_surfaces(&self.toplevels)
    }
}

/// Every surface of `toplevels`.
///
/// The idle clock needs it because an inhibitor on any other surface holds
/// nothing. Cloned (a refcount) because the clock is borrowed mutably
/// alongside.
fn desktop_surfaces(toplevels: &[(String, ToplevelSurface)]) -> Vec<WlSurface> {
    toplevels
        .iter()
        .map(|(_, toplevel)| toplevel.wl_surface().clone())
        .collect()
}
