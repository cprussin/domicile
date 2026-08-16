//! `loom-compositor` — the Smithay Wayland-server backend for Loom.
//!
//! Architectural note: in Loom the **web engine is the renderer**, so this
//! backend does NOT use Smithay's GL renderer, winit, or DRM. Smithay's role is
//! the Wayland protocol frontend and surface/buffer management. This binary
//! stands up the protocol globals a client needs (compositor, shm, xdg-shell),
//! accepts clients on a Wayland socket, and — the whole point — drives the
//! tested [`wc_host::Host`] brain: when a client maps a toplevel we call
//! [`Host::app_appeared`]; when it goes away we call [`Host::app_closed`].
//!
//! What's intentionally missing (next steps, all needing a GPU/display):
//! exporting each client's dmabuf to the web engine (the AppTextureBridge) and
//! presenting the engine's composited frame. This skeleton proves the
//! server<->brain seam compiles and runs headlessly.

use std::sync::Arc;

use smithay::reexports::{
    calloop::{generic::Generic, EventLoop, Interest, Mode, PostAction},
    wayland_protocols::xdg::shell::server::xdg_toplevel,
    wayland_server::{
        backend::{ClientData, ClientId, DisconnectReason},
        protocol::{wl_buffer, wl_seat, wl_surface::WlSurface},
        Client, Display, DisplayHandle,
    },
};
use smithay::input::{pointer::CursorImageStatus, Seat, SeatHandler, SeatState};
use smithay::utils::Serial;
use smithay::wayland::{
    buffer::BufferHandler,
    compositor::{with_states, CompositorClientState, CompositorHandler, CompositorState},
    shell::xdg::{
        PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
        XdgToplevelSurfaceData,
    },
    shm::{ShmHandler, ShmState},
    socket::ListeningSocketSource,
};
use smithay::{delegate_compositor, delegate_seat, delegate_shm, delegate_xdg_shell};
use tracing::info;

use wc_host::Host;

/// Data threaded through the calloop event loop.
struct CalloopData {
    state: LoomCompositor,
    display_handle: DisplayHandle,
}

/// The compositor state: Wayland protocol globals + the host brain.
struct LoomCompositor {
    compositor_state: CompositorState,
    xdg_shell_state: XdgShellState,
    shm_state: ShmState,
    seat_state: SeatState<LoomCompositor>,

    /// The tested decision core. The backend is thin glue over this.
    host: Host,
    /// Mapped toplevels, paired with the host-assigned app id.
    toplevels: Vec<(String, ToplevelSurface)>,
}

/// Per-client state required by the compositor global.
#[derive(Default)]
struct ClientState {
    compositor_state: CompositorClientState,
}

impl ClientData for ClientState {
    fn initialized(&self, _client_id: ClientId) {}
    fn disconnected(&self, _client_id: ClientId, _reason: DisconnectReason) {}
}

// ---- compositor + shm -----------------------------------------------------

impl CompositorHandler for LoomCompositor {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        &client.get_data::<ClientState>().unwrap().compositor_state
    }

    fn commit(&mut self, surface: &WlSurface) {
        // Send the initial configure once, so the client can map its buffer.
        if let Some((_, toplevel)) = self.toplevels.iter().find(|(_, t)| t.wl_surface() == surface) {
            let initial_configure_sent = with_states(surface, |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .unwrap()
                    .lock()
                    .unwrap()
                    .initial_configure_sent
            });
            if !initial_configure_sent {
                toplevel.send_configure();
            }
        }
    }
}

impl BufferHandler for LoomCompositor {
    fn buffer_destroyed(&mut self, _buffer: &wl_buffer::WlBuffer) {}
}

impl ShmHandler for LoomCompositor {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}

delegate_compositor!(LoomCompositor);
delegate_shm!(LoomCompositor);

// ---- seat (required by xdg-shell delegation) ------------------------------

impl SeatHandler for LoomCompositor {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<LoomCompositor> {
        &mut self.seat_state
    }

    fn cursor_image(&mut self, _seat: &Seat<Self>, _image: CursorImageStatus) {}
    fn focus_changed(&mut self, _seat: &Seat<Self>, _focused: Option<&WlSurface>) {}
}

delegate_seat!(LoomCompositor);

// ---- xdg-shell: the seam into the host brain ------------------------------

impl XdgShellHandler for LoomCompositor {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        // A client mapped a window. Register it with the host brain, which
        // assigns an app id and (in the full system) tells the chrome to mount
        // an <app> element. Title/size arrive on later commits.
        let (app_id, _announce) = self.host.app_appeared(None, (0.0, 0.0));
        info!(%app_id, "toplevel mapped -> Host::app_appeared");
        self.toplevels.push((app_id, surface));
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        if let Some(pos) = self.toplevels.iter().position(|(_, t)| t.wl_surface() == surface.wl_surface()) {
            let (app_id, _) = self.toplevels.remove(pos);
            self.host.app_closed(&app_id);
            info!(%app_id, "toplevel destroyed -> Host::app_closed");
        }
    }

    fn new_popup(&mut self, _surface: PopupSurface, _positioner: PositionerState) {}

    fn reposition_request(&mut self, surface: PopupSurface, positioner: PositionerState, token: u32) {
        surface.with_pending_state(|state| {
            state.geometry = positioner.get_geometry();
            state.positioner = positioner;
        });
        surface.send_repositioned(token);
    }

    fn move_request(&mut self, _surface: ToplevelSurface, _seat: wl_seat::WlSeat, _serial: Serial) {}

    fn resize_request(
        &mut self,
        _surface: ToplevelSurface,
        _seat: wl_seat::WlSeat,
        _serial: Serial,
        _edges: xdg_toplevel::ResizeEdge,
    ) {
    }

    fn grab(&mut self, _surface: PopupSurface, _seat: wl_seat::WlSeat, _serial: Serial) {}
}

delegate_xdg_shell!(LoomCompositor);

// ---- boot -----------------------------------------------------------------

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().init();
    }

    let mut event_loop: EventLoop<CalloopData> = EventLoop::try_new()?;
    let display: Display<LoomCompositor> = Display::new()?;
    let dh = display.handle();

    let mut seat_state = SeatState::new();
    // Advertise a keyboard and pointer; a real compositor would track hotplug.
    let mut seat: Seat<LoomCompositor> = seat_state.new_wl_seat(&dh, "loom");
    seat.add_keyboard(Default::default(), 200, 25)?;
    seat.add_pointer();

    let state = LoomCompositor {
        compositor_state: CompositorState::new::<LoomCompositor>(&dh),
        xdg_shell_state: XdgShellState::new::<LoomCompositor>(&dh),
        shm_state: ShmState::new::<LoomCompositor>(&dh, vec![]),
        seat_state,
        host: Host::new(),
        toplevels: Vec::new(),
    };

    let mut data = CalloopData { state, display_handle: dh.clone() };

    // Accept clients on an auto-named Wayland socket.
    let source = ListeningSocketSource::new_auto()?;
    let socket_name = source.socket_name().to_os_string();
    let handle = event_loop.handle();
    handle.insert_source(source, move |stream, _, data: &mut CalloopData| {
        data.display_handle
            .insert_client(stream, Arc::new(ClientState::default()))
            .expect("failed to insert client");
    })?;

    // Drive the wayland-server dispatch from the event loop.
    handle.insert_source(
        Generic::new(display, Interest::READ, Mode::Level),
        |_, display, data: &mut CalloopData| {
            // Safety: the display is not dropped for the loop's lifetime.
            unsafe {
                display.get_mut().dispatch_clients(&mut data.state).unwrap();
            }
            Ok(PostAction::Continue)
        },
    )?;

    info!(?socket_name, "loom-compositor: Wayland server up (WAYLAND_DISPLAY)");
    std::env::set_var("WAYLAND_DISPLAY", &socket_name);

    event_loop.run(None, &mut data, |_| {})?;
    Ok(())
}
