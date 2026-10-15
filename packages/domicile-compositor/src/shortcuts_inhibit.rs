//! Honors `zwp_keyboard_shortcuts_inhibit_manager_v1`, as a remote desktop
//! viewer or a VM asks it to.
//!
//! The desktop's shortcuts are the chords the shell grabs in the engine, not
//! the compositor's. So the compositor activates every inhibitor and tells the
//! chromes which windows hold one
//! ([`HostMessage::AppInhibitsShortcuts`](domicile_protocol::HostMessage::AppInhibitsShortcuts)),
//! and the engine lets grabbed chords through to the window with the keyboard.

use smithay::delegate_keyboard_shortcuts_inhibit;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::wayland::keyboard_shortcuts_inhibit::{
    KeyboardShortcutsInhibitHandler, KeyboardShortcutsInhibitState, KeyboardShortcutsInhibitor,
    KeyboardShortcutsInhibitorSeat as _,
};
use tracing::debug;

use crate::surface_commit::Role;
use crate::DomicileCompositor;

impl KeyboardShortcutsInhibitHandler for DomicileCompositor {
    fn keyboard_shortcuts_inhibit_state(&mut self) -> &mut KeyboardShortcutsInhibitState {
        &mut self.keyboard_shortcuts_inhibit_state
    }

    /// Every inhibitor is honored, as sway does by default. The console switch
    /// stays, since the engine's DRM platform takes it below the page.
    fn new_inhibitor(&mut self, inhibitor: KeyboardShortcutsInhibitor) {
        inhibitor.activate();
        self.tell_whether_it_inhibits(inhibitor.wl_surface(), true);
    }

    fn inhibitor_destroyed(&mut self, inhibitor: KeyboardShortcutsInhibitor) {
        self.tell_whether_it_inhibits(inhibitor.wl_surface(), false);
    }
}

delegate_keyboard_shortcuts_inhibit!(DomicileCompositor);

impl DomicileCompositor {
    /// A surface became a window. Tell the chromes if it already took an
    /// inhibitor, which said of no window then.
    pub fn a_window_may_have_taken_the_shortcuts(&mut self, surface: &WlSurface) {
        if self
            .seat
            .keyboard_shortcuts_inhibitor_for_surface(surface)
            .is_some_and(|inhibitor| inhibitor.is_active())
        {
            self.tell_whether_it_inhibits(surface, true);
        }
    }

    /// Tell the chromes whether the window that `surface` is holds an inhibitor.
    ///
    /// Only a toplevel's counts: the keyboard goes to the window, never to a
    /// popup or a surface with no role.
    fn tell_whether_it_inhibits(&mut self, surface: &WlSurface, inhibits: bool) {
        let Some((app_id, Role::Toplevel(_))) = self.by_surface.get(surface) else {
            return;
        };
        let app_id = app_id.clone();
        // Collected so the host is unlocked before broadcasting. See
        // `title_changed`.
        let told = self
            .hub
            .host
            .lock()
            .unwrap()
            .app_inhibits_shortcuts(&app_id, inhibits);
        if let Some(message) = told {
            debug!(%app_id, inhibits, "keyboard shortcuts inhibitor -> app_inhibits_shortcuts");
            self.hub.broadcast(message);
        }
    }
}
