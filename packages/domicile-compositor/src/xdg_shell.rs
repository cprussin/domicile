//! xdg-shell and xdg-activation: the windows and popups clients create, and what
//! they ask of them.

use smithay::output::Output;
use smithay::reexports::{
    wayland_protocols::xdg::shell::server::xdg_toplevel,
    wayland_server::protocol::{wl_output, wl_seat, wl_surface::WlSurface},
};
use smithay::utils::{Serial, SERIAL_COUNTER};
use smithay::wayland::{
    compositor::with_states,
    shell::xdg::{
        PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
        XdgToplevelSurfaceData,
    },
    xdg_activation::{
        XdgActivationHandler, XdgActivationState, XdgActivationToken, XdgActivationTokenData,
    },
};
use smithay::{delegate_xdg_activation, delegate_xdg_shell};
use tracing::debug;

use domicile_protocol::WindowRequest;

use crate::activation;
use crate::chrome_hub::broadcast_focus_request;
use crate::clients::{is_chrome_surface, owner_of};
use crate::surface_commit::Role;
use crate::{grepped, DomicileCompositor};

impl XdgShellHandler for DomicileCompositor {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        // The chrome's own window is the desktop, not a window on it.
        // Announcing it would make the chrome embed itself.
        if is_chrome_surface(surface.wl_surface()) {
            debug!("the chrome mapped its toplevel -> compositing it over the apps");
            for live in &self.outputs {
                live.output.enter(surface.wl_surface());
            }
            // Size it to the desktop, as a compositor does for a fullscreen
            // window.
            surface.with_pending_state(|state| {
                state.size = Some(self.screens.size().into());
            });
            self.chrome_toplevel = Some(surface);
            self.focus_chrome();
            return;
        }

        // Register a new window with `Host`, which assigns an app id. The
        // chromes hear of it when it first draws, in `announce_a_new_window`,
        // by when its client has said what it is.
        let wl_surface = surface.wl_surface().clone();
        {
            let mut host = self.hub.host.lock().unwrap();
            let app_id = host.app_created(owner_of(surface.wl_surface()));
            debug!(%app_id, "toplevel created -> Host::app_created");
            // Enter every output for now; the chrome has not placed the window.
            // Some toolkits (GLFW, kitty) wait for this before drawing.
            // `enter_the_displays_each_window_is_on` updates it on placement.
            for live in &self.outputs {
                live.output.enter(surface.wl_surface());
            }
            self.by_surface.insert(
                surface.wl_surface().clone(),
                (app_id.clone(), Role::Toplevel(surface.clone())),
            );
            self.unannounced.insert(app_id.clone());
            self.toplevels.push((app_id, surface));
        }
        self.the_running_apps_changed();
        // An inhibitor taken before the window mapped starts holding now (see
        // `crate::idle::holds`), which may wake a dark desktop.
        self.the_windows_changed("a window appeared under an inhibitor");
        self.a_window_may_have_taken_the_shortcuts(&wl_surface);
    }

    /// A client set or changed its window title.
    ///
    /// Titles arrive after the window is announced, and terminals rename
    /// constantly. Smithay filters unchanged titles before calling this.
    fn title_changed(&mut self, surface: ToplevelSurface) {
        // `None` for the chrome's own window, which is never announced.
        let Some(app_id) = self.app_id_of(surface.wl_surface()) else {
            return;
        };
        let title = with_states(surface.wl_surface(), |states| {
            states
                .data_map
                .get::<XdgToplevelSurfaceData>()
                .unwrap()
                .lock()
                .unwrap()
                .title
                .clone()
        });
        // Separate `let` so the host guard drops at the `;`, before the
        // broadcast. Inside the `if let` it would be held for the whole body.
        let titled = self
            .hub
            .host
            .lock()
            .unwrap()
            .app_titled(&app_id, title.clone());
        if let Some(titled) = titled {
            self.hub.broadcast(titled);
        }
        self.cast_if_asked(&app_id, title.as_deref());
    }

    /// A client set or changed its window's application id, which the
    /// Background portal reports and the chrome reads as its desktop id.
    fn app_id_changed(&mut self, surface: ToplevelSurface) {
        // `None` for the chrome's own window, which is never announced.
        if let Some(app_id) = self.app_id_of(surface.wl_surface()) {
            let desktop_id = with_states(surface.wl_surface(), |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .unwrap()
                    .lock()
                    .unwrap()
                    .app_id
                    .clone()
            })
            .expect("Smithay calls this only after the client set an app id");
            // Separate `let` so the host guard drops before the broadcast, as
            // in `title_changed`.
            let named = self
                .hub
                .host
                .lock()
                .unwrap()
                .app_desktop_id(&app_id, desktop_id);
            if let Some(named) = named {
                self.hub.broadcast(named);
            }
        }
        self.the_running_apps_changed();
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        if self
            .chrome_toplevel
            .as_ref()
            .is_some_and(|chrome| chrome.wl_surface() == surface.wl_surface())
        {
            debug!("the chrome's toplevel went away");
            self.chrome_toplevel = None;
            let keyboard = self.seat.get_keyboard().unwrap();
            let serial = SERIAL_COUNTER.next_serial();
            keyboard.set_focus(self, None, serial);
            return;
        }
        if let Some(pos) = self
            .toplevels
            .iter()
            .position(|(_, t)| t.wl_surface() == surface.wl_surface())
        {
            let (app_id, _) = self.toplevels.remove(pos);
            self.by_surface.remove(surface.wl_surface());
            self.forget(&app_id);
            self.the_running_apps_changed();
            // Return the keyboard to the chrome. The shell usually refocuses
            // something, but a crashed client gives it no chance, so the
            // compositor must guarantee a holder.
            self.focus_chrome();
            // An inhibitor on the closed window's surface stops holding, even
            // if the client still runs.
            self.the_windows_changed("the window holding this desktop awake is gone");
        }
    }

    /// The client destroyed a popup, usually after a dismissal.
    fn popup_destroyed(&mut self, surface: PopupSurface) {
        if let Some(pos) = self
            .popups
            .iter()
            .position(|(_, popup)| popup.wl_surface() == surface.wl_surface())
        {
            let (app_id, _) = self.popups.remove(pos);
            self.by_surface.remove(surface.wl_surface());
            debug!(%app_id, "popup destroyed -> Host::app_closed");
            self.forget(&app_id);
        }
        // A grabbing menu hands the keyboard to its parent menu, or to its
        // window after the last one.
        if let Some(at) = self.grabbing.iter().position(|popup| *popup == surface) {
            let root = self.window_under(&surface);
            self.grabbing.remove(at);
            let next = self
                .grabbing
                .last()
                .map(|popup| popup.wl_surface().clone())
                .or_else(|| root.and_then(|app_id| self.surface_for(&app_id)));
            let keyboard = self.seat.get_keyboard().unwrap();
            let serial = SERIAL_COUNTER.next_serial();
            keyboard.set_focus(self, next, serial);
        }
    }

    fn new_popup(&mut self, surface: PopupSurface, positioner: PositionerState) {
        // Configure immediately: a popup cannot attach a buffer until
        // configured, and an unconfigured menu hangs the client silently.
        let geometry = self.kept_on_screen(&surface, positioner);
        surface.with_pending_state(|state| {
            state.geometry = geometry;
            state.positioner = positioner;
        });
        if let Err(err) = surface.send_configure() {
            tracing::warn!(%err, "could not configure a popup");
        }
        // Enter displays by the rule
        // [`enter_the_displays_each_window_is_on`](Self::enter_the_displays_each_window_is_on)
        // applies to popups. Nothing else moved.
        self.place_window(surface.wl_surface(), None);
    }

    fn reposition_request(
        &mut self,
        surface: PopupSurface,
        positioner: PositionerState,
        token: u32,
    ) {
        let geometry = self.kept_on_screen(&surface, positioner);
        surface.with_pending_state(|state| {
            state.geometry = geometry;
            state.positioner = positioner;
        });
        surface.send_repositioned(token);
    }

    fn move_request(&mut self, _surface: ToplevelSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
    }

    fn maximize_request(&mut self, surface: ToplevelSurface) {
        self.pass_on_a_window_request(&surface, WindowRequest::Maximize);
    }

    fn unmaximize_request(&mut self, surface: ToplevelSurface) {
        self.pass_on_a_window_request(&surface, WindowRequest::Unmaximize);
    }

    fn fullscreen_request(
        &mut self,
        surface: ToplevelSurface,
        output: Option<wl_output::WlOutput>,
    ) {
        let display = output
            .as_ref()
            .and_then(Output::from_resource)
            .map(|output| output.name());
        self.pass_on_a_window_request(&surface, WindowRequest::Fullscreen { display });
    }

    fn unfullscreen_request(&mut self, surface: ToplevelSurface) {
        self.pass_on_a_window_request(&surface, WindowRequest::Unfullscreen);
    }

    fn resize_request(
        &mut self,
        _surface: ToplevelSurface,
        _seat: wl_seat::WlSeat,
        _serial: Serial,
        _edges: xdg_toplevel::ResizeEdge,
    ) {
    }

    /// A menu grabbing the keyboard and pointer until dismissed.
    ///
    /// The serial is not checked: all presses come from the chrome, and a
    /// refused grab would be a menu that silently never opens.
    fn grab(&mut self, surface: PopupSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        if !self.grabbing.contains(&surface) {
            self.grabbing.push(surface.clone());
        }
        let keyboard = self.seat.get_keyboard().unwrap();
        let serial = SERIAL_COUNTER.next_serial();
        keyboard.set_focus(self, Some(surface.wl_surface().clone()), serial);
    }
}

delegate_xdg_shell!(DomicileCompositor);

impl XdgActivationHandler for DomicileCompositor {
    fn activation_state(&mut self) -> &mut XdgActivationState {
        &mut self.xdg_activation_state
    }

    /// A client asked for a window to be activated. Forwarded, not granted.
    ///
    /// A token made before the keyboard last moved, or a stale one the
    /// compositor minted, is dropped (see [`activation::granted`]): the window
    /// is asking on its own, not for the user. The rest are broadcast as
    /// `focus_requested`; a shell grants one with `focus_app`.
    fn request_activation(
        &mut self,
        token: XdgActivationToken,
        token_data: XdgActivationTokenData,
        surface: WlSurface,
    ) {
        // Always remove the token; nothing else prunes the pool, so clients
        // could grow it without bound.
        self.xdg_activation_state.remove_token(&token);
        let last_enter = self.seat.get_keyboard().unwrap().last_enter();
        if !activation::granted(&token_data, last_enter) {
            let asked = token_data.serial.map(|(serial, _)| serial);
            debug!(
                ?asked,
                ?last_enter,
                "{} -> dropped",
                grepped::FOCUS_REQUEST_DROPPED
            );
        } else if let Some(app_id) = self.app_id_of(&surface) {
            broadcast_focus_request(&self.hub, &app_id);
        }
    }
}

delegate_xdg_activation!(DomicileCompositor);

impl DomicileCompositor {
    /// Tell the pages listening what a client asked of its window, and answer
    /// with a configure of the states it has.
    ///
    /// The shell decides and sets states with `set_window_states`. xdg-shell
    /// requires the configure even when nothing changed. Before the first
    /// configure, that configure is the answer.
    fn pass_on_a_window_request(&self, surface: &ToplevelSurface, request: WindowRequest) {
        // `None` for the chrome's own window, which is never announced.
        if let Some(app_id) = self.app_id_of(surface.wl_surface()) {
            debug!(%app_id, ?request, "a window request -> the shell");
            self.hub.outbound.window_request(app_id, request);
        }
        if surface.is_initial_configure_sent() {
            surface.send_configure();
        }
    }
}
