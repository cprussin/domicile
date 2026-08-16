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

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use smithay::reexports::{
    calloop::{generic::Generic, EventLoop, Interest, Mode, PostAction},
    wayland_protocols::xdg::shell::server::xdg_toplevel,
    wayland_server::{
        backend::{ClientData, ClientId, DisconnectReason},
        protocol::{wl_buffer, wl_seat, wl_shm, wl_surface::WlSurface},
        Client, Display, DisplayHandle,
    },
};
use smithay::input::{pointer::CursorImageStatus, Seat, SeatHandler, SeatState};
use smithay::output::{Mode as OutputMode, Output, PhysicalProperties, Subpixel};
use smithay::utils::{Serial, Transform};
use smithay::wayland::{
    buffer::BufferHandler,
    compositor::{
        with_states, BufferAssignment, CompositorClientState, CompositorHandler, CompositorState,
        SurfaceAttributes,
    },
    output::{OutputHandler, OutputManagerState},
    shm::with_buffer_contents,
    shell::xdg::{
        PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
        XdgToplevelSurfaceData,
    },
    shm::{ShmHandler, ShmState},
    socket::ListeningSocketSource,
};
use smithay::{delegate_compositor, delegate_output, delegate_seat, delegate_shm, delegate_xdg_shell};
use tracing::info;

use wc_host::ipc::{handle_chrome_line, to_line};
use wc_host::Host;
use wc_protocol::HostMessage;

/// Data threaded through the calloop event loop.
struct CalloopData {
    state: LoomCompositor,
    display_handle: DisplayHandle,
}

/// Shared between the Wayland thread (calloop) and the chrome-connection threads.
///
/// Holds the single [`Host`] brain both sides drive, plus the write-halves of
/// connected chrome sockets so Wayland-side events (app appeared/closed) can be
/// broadcast to the chrome.
struct ChromeHub {
    host: Mutex<Host>,
    chromes: Mutex<Vec<Arc<Mutex<UnixStream>>>>,
}

impl ChromeHub {
    fn new() -> Arc<Self> {
        Arc::new(ChromeHub { host: Mutex::new(Host::new()), chromes: Mutex::new(Vec::new()) })
    }

    /// Send a host message to every connected chrome, dropping dead ones.
    fn broadcast(&self, message: &HostMessage) {
        let line = to_line(message);
        let mut chromes = self.chromes.lock().unwrap();
        chromes.retain(|writer| {
            let mut stream = writer.lock().unwrap();
            stream.write_all(line.as_bytes()).and_then(|_| stream.flush()).is_ok()
        });
    }
}

/// Serve the chrome protocol on a Unix socket: one thread per connection, all
/// sharing the same [`Host`] via the hub. Runs on its own thread so it never
/// blocks the Wayland event loop.
fn serve_chrome(hub: Arc<ChromeHub>, path: PathBuf) {
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(?path, %err, "cannot bind chrome socket");
            return;
        }
    };
    info!(?path, "chrome protocol socket up");

    for stream in listener.incoming().flatten() {
        let writer = Arc::new(Mutex::new(match stream.try_clone() {
            Ok(w) => w,
            Err(_) => continue,
        }));
        hub.chromes.lock().unwrap().push(writer.clone());
        info!("chrome client connected");
        let hub = hub.clone();
        thread::spawn(move || chrome_connection(hub, stream, writer));
    }
}

fn chrome_connection(hub: Arc<ChromeHub>, stream: UnixStream, writer: Arc<Mutex<UnixStream>>) {
    let reader = BufReader::new(stream);
    let mut ready = false;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        tracing::debug!(chrome_msg = %line.trim(), "chrome -> host");
        let responses = {
            let mut host = hub.host.lock().unwrap();
            handle_chrome_line(&mut host, &mut ready, &line)
        };
        let mut writer = writer.lock().unwrap();
        for message in responses {
            if writer.write_all(to_line(&message).as_bytes()).is_err() {
                return;
            }
            let _ = writer.flush();
        }
    }
}

/// The compositor state: Wayland protocol globals + the host brain.
struct LoomCompositor {
    compositor_state: CompositorState,
    xdg_shell_state: XdgShellState,
    shm_state: ShmState,
    seat_state: SeatState<LoomCompositor>,
    /// Kept alive so the xdg-output manager global persists.
    #[allow(dead_code)]
    output_manager_state: OutputManagerState,
    /// Kept alive so the wl_output global persists.
    _output: Output,

    /// Shared brain + connected chrome clients.
    hub: Arc<ChromeHub>,
    /// Mapped toplevels, paired with the host-assigned app id (Wayland-thread only).
    toplevels: Vec<(String, ToplevelSurface)>,
    /// For frame-callback timestamps.
    start: Instant,
    /// Last time a frame was broadcast per app, to throttle to ~30fps.
    last_frame: HashMap<String, Instant>,
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
        let Some((app_id, toplevel)) =
            self.toplevels.iter().find(|(_, t)| t.wl_surface() == surface).cloned()
        else {
            return;
        };

        // Send the initial configure once, so the client can map its buffer.
        let initial_configure_sent = with_states(surface, |states| {
            states.data_map.get::<XdgToplevelSurfaceData>().unwrap().lock().unwrap().initial_configure_sent
        });
        if !initial_configure_sent {
            toplevel.send_configure();
        }

        // Grab the newly-committed buffer's pixels and drain the frame callbacks.
        let (frame, callbacks) = with_states(surface, |states| {
            let mut guard = states.cached_state.get::<SurfaceAttributes>();
            let attrs = guard.current();
            let frame = match &attrs.buffer {
                Some(BufferAssignment::NewBuffer(buffer)) => shm_buffer_to_rgba(buffer),
                _ => None,
            };
            let callbacks = std::mem::take(&mut attrs.frame_callbacks);
            (frame, callbacks)
        });

        // Ask the client to draw its next frame (keeps it animating).
        let time = self.start.elapsed().as_millis() as u32;
        for callback in callbacks {
            callback.done(time);
        }

        // Broadcast the pixels to the chrome, throttled to ~30fps per app.
        if let Some((width, height, rgba)) = frame {
            let now = Instant::now();
            let due = self
                .last_frame
                .get(&app_id)
                .map_or(true, |t| now.duration_since(*t) >= Duration::from_millis(33));
            if due {
                self.last_frame.insert(app_id.clone(), now);
                let data = base64::engine::general_purpose::STANDARD.encode(&rgba);
                tracing::debug!(%app_id, width, height, "broadcast app frame");
                self.hub.broadcast(&HostMessage::AppFrame {
                    app_id,
                    width,
                    height,
                    format: "rgba".to_string(),
                    data,
                });
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

// ---- output (clients wait for a wl_output before mapping) -----------------

impl OutputHandler for LoomCompositor {}
delegate_output!(LoomCompositor);

// ---- xdg-shell: the seam into the host brain ------------------------------

impl XdgShellHandler for LoomCompositor {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        // A client mapped a window. Register it with the shared brain (which
        // assigns an app id) and announce it to every connected chrome so it can
        // mount an <app> element. Title/size arrive on later commits.
        let announce = {
            let mut host = self.hub.host.lock().unwrap();
            let (app_id, announce) = host.app_appeared(None, (0.0, 0.0));
            info!(%app_id, "toplevel mapped -> Host::app_appeared");
            self.toplevels.push((app_id, surface));
            announce
        };
        self.hub.broadcast(&announce);
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        if let Some(pos) = self.toplevels.iter().position(|(_, t)| t.wl_surface() == surface.wl_surface()) {
            let (app_id, _) = self.toplevels.remove(pos);
            self.last_frame.remove(&app_id);
            let closed = self.hub.host.lock().unwrap().app_closed(&app_id);
            info!(%app_id, "toplevel destroyed -> Host::app_closed");
            if let Some(closed) = closed {
                self.hub.broadcast(&closed);
            }
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

/// Copy a wl_shm buffer into row-major RGBA bytes.
///
/// wl_shm ARGB/XRGB8888 are stored little-endian, so a pixel is `[B, G, R, A]`
/// in memory; we swap to `[R, G, B, A]` for a browser canvas. Only these two
/// formats are handled (what typical toolkits use); others are skipped.
fn shm_buffer_to_rgba(buffer: &wl_buffer::WlBuffer) -> Option<(u32, u32, Vec<u8>)> {
    with_buffer_contents(buffer, |ptr, len, data| {
        let has_alpha = match data.format {
            wl_shm::Format::Argb8888 => true,
            wl_shm::Format::Xrgb8888 => false,
            _ => return None,
        };
        let (w, h) = (data.width.max(0) as usize, data.height.max(0) as usize);
        let stride = data.stride.max(0) as usize;
        let offset = data.offset.max(0) as usize;
        // Safety: valid for the duration of this callback (per with_buffer_contents).
        let src = unsafe { std::slice::from_raw_parts(ptr, len) };
        bgra_to_rgba(src, w, h, stride, offset, has_alpha).map(|rgba| (w as u32, h as u32, rgba))
    })
    .ok()
    .flatten()
}

/// Convert an ARGB/XRGB8888 buffer (`[B, G, R, A]` per pixel in memory) into
/// tightly-packed RGBA, honouring `stride` padding. Returns `None` if the source
/// is too small for the described geometry.
fn bgra_to_rgba(
    src: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    offset: usize,
    has_alpha: bool,
) -> Option<Vec<u8>> {
    if width == 0 || height == 0 || stride < width * 4 || offset + (height - 1) * stride + width * 4 > src.len() {
        return None;
    }
    let mut out = vec![0u8; width * height * 4];
    for y in 0..height {
        let row = offset + y * stride;
        for x in 0..width {
            let i = row + x * 4;
            let o = (y * width + x) * 4;
            out[o] = src[i + 2]; // R
            out[o + 1] = src[i + 1]; // G
            out[o + 2] = src[i]; // B
            out[o + 3] = if has_alpha { src[i + 3] } else { 255 };
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::bgra_to_rgba;

    #[test]
    fn swaps_b_and_r_and_keeps_alpha() {
        // two pixels: [B,G,R,A] = [10,20,30,40], [50,60,70,80]
        let src = [10, 20, 30, 40, 50, 60, 70, 80];
        let out = bgra_to_rgba(&src, 2, 1, 8, 0, true).unwrap();
        assert_eq!(out, vec![30, 20, 10, 40, 70, 60, 50, 80]);
    }

    #[test]
    fn xrgb_forces_opaque_alpha() {
        let src = [10, 20, 30, 0];
        let out = bgra_to_rgba(&src, 1, 1, 4, 0, false).unwrap();
        assert_eq!(out, vec![30, 20, 10, 255]);
    }

    #[test]
    fn honours_stride_padding() {
        // 1px wide, 2 rows, stride 8 (4 bytes pixel + 4 bytes padding).
        let src = [1, 2, 3, 4, 0, 0, 0, 0, 5, 6, 7, 8, 0, 0, 0, 0];
        let out = bgra_to_rgba(&src, 1, 2, 8, 0, true).unwrap();
        assert_eq!(out, vec![3, 2, 1, 4, 7, 6, 5, 8]);
    }

    #[test]
    fn rejects_undersized_buffers() {
        assert!(bgra_to_rgba(&[0, 0, 0], 2, 2, 8, 0, true).is_none());
    }
}

/// Resolve where the chrome protocol socket lives.
fn chrome_socket_path() -> PathBuf {
    // --chrome-socket PATH wins, then $LOOM_CHROME_SOCKET, then a default under
    // $XDG_RUNTIME_DIR (falling back to the current directory).
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--chrome-socket" {
            if let Some(path) = args.next() {
                return PathBuf::from(path);
            }
        }
    }
    if let Some(path) = std::env::var_os("LOOM_CHROME_SOCKET") {
        return PathBuf::from(path);
    }
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    dir.join("loom-chrome.sock")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().init();
    }

    // The chrome protocol socket: where a chrome shell connects. Overridable via
    // --chrome-socket or LOOM_CHROME_SOCKET; defaults under XDG_RUNTIME_DIR.
    let chrome_socket = chrome_socket_path();

    let mut event_loop: EventLoop<CalloopData> = EventLoop::try_new()?;
    let display: Display<LoomCompositor> = Display::new()?;
    let dh = display.handle();

    let mut seat_state = SeatState::new();
    // Advertise a keyboard and pointer; a real compositor would track hotplug.
    let mut seat: Seat<LoomCompositor> = seat_state.new_wl_seat(&dh, "loom");
    seat.add_keyboard(Default::default(), 200, 25)?;
    seat.add_pointer();

    // Advertise one virtual output. Many clients (e.g. weston-terminal) wait for
    // a wl_output before they will map a toplevel.
    let output_manager_state = OutputManagerState::new_with_xdg_output::<LoomCompositor>(&dh);
    let output = Output::new(
        "loom-0".to_string(),
        PhysicalProperties {
            size: (300, 200).into(),
            subpixel: Subpixel::Unknown,
            make: "Loom".into(),
            model: "Virtual".into(),
        },
    );
    output.create_global::<LoomCompositor>(&dh);
    let mode = OutputMode { size: (1280, 800).into(), refresh: 60_000 };
    output.change_current_state(Some(mode), Some(Transform::Normal), None, Some((0, 0).into()));
    output.set_preferred(mode);

    // Shared brain, driven by both the Wayland side and chrome connections.
    let hub = ChromeHub::new();
    {
        let hub = hub.clone();
        thread::spawn(move || serve_chrome(hub, chrome_socket));
    }

    let state = LoomCompositor {
        compositor_state: CompositorState::new::<LoomCompositor>(&dh),
        xdg_shell_state: XdgShellState::new::<LoomCompositor>(&dh),
        shm_state: ShmState::new::<LoomCompositor>(&dh, vec![]),
        seat_state,
        output_manager_state,
        _output: output,
        hub,
        toplevels: Vec::new(),
        start: Instant::now(),
        last_frame: HashMap::new(),
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
                let display = display.get_mut();
                display.dispatch_clients(&mut data.state).unwrap();
                // Flush queued events (registry globals, configures, ...) back
                // to clients, otherwise they hang waiting for our replies.
                display.flush_clients().unwrap();
            }
            Ok(PostAction::Continue)
        },
    )?;

    info!(?socket_name, "loom-compositor: Wayland server up (WAYLAND_DISPLAY)");
    std::env::set_var("WAYLAND_DISPLAY", &socket_name);

    event_loop.run(None, &mut data, |_| {})?;
    Ok(())
}
