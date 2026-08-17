//! `domicile-compositor` — the Smithay Wayland-server backend for Domicile.
//!
//! Architectural note: in Domicile the **web engine is the renderer**, so this
//! backend does NOT use Smithay's GL renderer, winit, or DRM. Smithay's role is
//! the Wayland protocol frontend and surface/buffer management. This binary
//! stands up the protocol globals a client needs (compositor, shm, xdg-shell),
//! accepts clients on a Wayland socket, and — the whole point — drives the
//! tested [`domicile_host::Host`] brain: when a client maps a toplevel we call
//! [`Host::app_appeared`]; when it goes away we call [`Host::app_closed`].
//!
//! GPU clients get a `zwp_linux_dmabuf_v1` global: their buffer is imported
//! into an offscreen GLES context (`dmabuf_import`) and recorded in the
//! [`BridgeRegistry`], which is what the engine will bind as an external
//! texture once the CEF path lands. Until then the imported frame is read back
//! and broadcast down the same `AppFrame` route as `wl_shm` — a copy, but the
//! copy is the only part the engine swap removes.
//!
//! What's intentionally missing (needs a GPU/display): presenting the engine's
//! composited frame.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;
use smithay::backend::input::{Axis, AxisSource, ButtonState, KeyState};
use smithay::input::{
    keyboard::{FilterResult, Keycode, XkbConfig},
    pointer::{AxisFrame, ButtonEvent, CursorIcon, CursorImageStatus, MotionEvent},
    Seat, SeatHandler, SeatState,
};
use smithay::output::{Mode as OutputMode, Output, PhysicalProperties, Scale, Subpixel};
use smithay::reexports::{
    calloop::{
        channel::{channel, Event as ChannelEvent, Sender},
        generic::Generic,
        EventLoop, Interest, Mode, PostAction,
    },
    wayland_protocols::xdg::shell::server::xdg_toplevel,
    wayland_server::{
        backend::{ClientData, ClientId, DisconnectReason},
        protocol::{wl_buffer, wl_seat, wl_shm, wl_surface::WlSurface},
        Client, Display, DisplayHandle,
    },
};
use smithay::utils::{Serial, Transform, SERIAL_COUNTER};
use smithay::wayland::{
    buffer::BufferHandler,
    compositor::{
        with_states, BufferAssignment, CompositorClientState, CompositorHandler, CompositorState,
        SurfaceAttributes,
    },
    cursor_shape::CursorShapeManagerState,
    dmabuf::{
        get_dmabuf, DmabufFeedbackBuilder, DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier,
    },
    output::{OutputHandler, OutputManagerState},
    shell::xdg::{
        PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
        XdgToplevelSurfaceData,
    },
    shm::with_buffer_contents,
    shm::{ShmHandler, ShmState},
    socket::ListeningSocketSource,
    tablet_manager::TabletSeatHandler,
};
use smithay::{
    delegate_compositor, delegate_cursor_shape, delegate_dmabuf, delegate_output, delegate_seat,
    delegate_shm, delegate_xdg_shell,
};
use tracing::info;

mod dmabuf_descriptor;
mod dmabuf_import;
mod outbound;
mod scale;
mod timing_window;

use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_import::DmabufImporter;
use crate::outbound::{outbound, Outbound, OutboundReceiver, OutboundSender};
use crate::scale::{logical_size, output_scale};
use crate::timing_window::TimingWindow;
use domicile_bridge::BridgeRegistry;
use domicile_config::Config;
use domicile_host::ipc::{apply_chrome_message, parse_chrome, to_line};
use domicile_host::Host;
use domicile_protocol::{ChromeMessage, CursorShape, HostMessage};

/// Data threaded through the calloop event loop. The `Display` lives here (not
/// inside the wayland source) so we can flush queued events after handling input
/// that originated off the Wayland thread.
struct CalloopData {
    display: Display<DomicileCompositor>,
    state: DomicileCompositor,
}

/// Something the chrome asked us to do to a client — inject an input event, or
/// reconfigure its toplevel. Sent over a calloop channel so it is handled on
/// the Wayland thread (where the seat and surfaces live).
enum ClientRequest {
    PointerMotion {
        app_id: String,
        x: f64,
        y: f64,
    },
    PointerLeave,
    PointerButton {
        button: u32,
        pressed: bool,
    },
    PointerAxis {
        dx: f64,
        dy: f64,
        v120_x: i32,
        v120_y: i32,
    },
    Key {
        keycode: u32,
        pressed: bool,
    },
    KeyboardFocus {
        app_id: Option<String>,
    },
    /// The chrome's display density changed; re-advertise the output scale so
    /// clients redraw at the resolution the screen actually has.
    SetOutputScale {
        scale: i32,
    },
    /// The chrome laid an app's element out at a new size; configure the client
    /// to match so it redraws at that resolution.
    ConfigureApp {
        app_id: String,
        width: i32,
        height: i32,
    },
}

/// Shared between the Wayland thread (calloop) and the chrome-connection threads.
///
/// Holds the single [`Host`] brain both sides drive, the write-halves of
/// connected chrome sockets (to broadcast app lifecycle), and senders to push
/// forwarded input onto the Wayland thread and pixels onto the writer thread.
struct ChromeHub {
    host: Mutex<Host>,
    chromes: Mutex<Vec<Arc<Mutex<UnixStream>>>>,
    request_tx: Mutex<Sender<ClientRequest>>,
    outbound: OutboundSender,
    timings: Mutex<FrameTimings>,
    /// The highest output scale to advertise, whatever the chrome reports.
    /// Read-only config, held here because it is the chrome connections that
    /// receive the density and have to bound it.
    max_scale: u32,
}

impl ChromeHub {
    fn new(request_tx: Sender<ClientRequest>, max_scale: u32) -> (Arc<Self>, OutboundReceiver) {
        let (outbound, outbound_rx) = outbound();
        let hub = Arc::new(ChromeHub {
            host: Mutex::new(Host::new()),
            chromes: Mutex::new(Vec::new()),
            request_tx: Mutex::new(request_tx),
            outbound,
            timings: Mutex::new(FrameTimings::default()),
            max_scale,
        });
        (hub, outbound_rx)
    }

    /// Forward an input event to the Wayland thread.
    fn send_request(&self, event: ClientRequest) {
        let _ = self.request_tx.lock().unwrap().send(event);
    }

    /// Queue a host message for every connected chrome.
    fn broadcast(&self, message: HostMessage) {
        self.outbound.message(message);
    }

    /// Queue an app's pixels, which are dropped if the chrome has not kept up.
    fn send_frame(&self, app_id: &str, width: u32, height: u32, scale: u32, rgba: Vec<u8>) {
        if !self.outbound.frame(app_id, width, height, scale, rgba) {
            tracing::debug!(%app_id, "chrome is behind; dropped a frame");
        }
    }
}

/// Encode and write everything bound for the chrome, off the Wayland thread.
///
/// This is the only place that blocks on a chrome socket. Before it existed a
/// slow chrome blocked `commit()`, which stopped frame callbacks, which stopped
/// every client on the compositor.
fn serve_outbound(hub: Arc<ChromeHub>, outbound: OutboundReceiver) {
    let mut window = FrameWindow::default();
    while let Some(item) = outbound.recv() {
        // A frame is a header line followed by its pixels; everything else is
        // just the line. The pixels go out as bytes rather than base64 inside
        // the JSON — see `HostMessage::AppFrame` for why that matters.
        let (message, pixels) = match item {
            Outbound::Message(message) => (message, Vec::new()),
            Outbound::Frame {
                app_id,
                width,
                height,
                scale,
                rgba,
            } => (
                HostMessage::AppFrame {
                    app_id,
                    width,
                    height,
                    scale,
                    format: "rgba".to_string(),
                    bytes: rgba.len() as u32,
                },
                rgba,
            ),
        };
        let line = to_line(&message);
        let is_frame = !pixels.is_empty();
        let started = Instant::now();
        let mut chromes = hub.chromes.lock().unwrap();
        chromes.retain(|writer| {
            let mut stream = writer.lock().unwrap();
            stream
                .write_all(line.as_bytes())
                .and_then(|_| stream.write_all(&pixels))
                .and_then(|_| stream.flush())
                .is_ok()
        });
        let attached = chromes.len();
        drop(chromes);

        if is_frame {
            window.sent += 1;
            window.bytes += line.len() + pixels.len();
            window.writing += started.elapsed();
        }
        if let Some(report) = window.due(&outbound, &hub) {
            info!(
                sent = report.sent,
                dropped = report.dropped,
                fps = report.fps,
                mb_per_s = report.mb_per_s,
                write_ms = report.write_ms,
                readback_ms = report.readback_ms,
                readback_worst_ms = report.readback_worst_ms,
                commit_ms = report.commit_ms,
                idle_ms = report.idle_ms,
                response_ms = report.response_ms,
                response_worst_ms = report.response_worst_ms,
                throttled = report.throttled,
                chromes = attached,
                "frames"
            );
        }
    }
}

/// The Wayland thread's half of the frame path, recorded there and read by the
/// writer thread when it reports.
///
/// The writer thread already knows its own half — how many frames it sent and
/// how long the socket took — and that half alone cannot say why the rate is
/// what it is. A compositor spending every millisecond in the GPU readback and
/// one sitting idle between a client's commits look identical from there.
#[derive(Default)]
struct FrameTimings {
    /// Time inside the GPU readback: the copy the CEF bridge deletes.
    readback: TimingWindow,
    /// Time handling one commit end to end — the readback plus everything the
    /// Wayland thread does around it.
    commit: TimingWindow,
    /// Time between one commit finishing and the next arriving: the client's
    /// half, and the throttle's. Large here means we are waiting, not working.
    idle: TimingWindow,
    /// Time from injecting a keystroke into a client to that client's next
    /// commit — the client's own think-and-redraw, isolated.
    ///
    /// This is the piece the chrome's round trip cannot separate: subtract
    /// this and the stages either side of it from `rt_ms` and what remains is
    /// how long the keystroke took to *reach* the client, which is entirely
    /// ours. Measured the same way as the chrome's, from the oldest keystroke
    /// still unanswered, so the two numbers compare.
    response: TimingWindow,
    /// Commits the ~30fps throttle refused. Every one is a redraw the client
    /// made and the chrome never saw, so if the client then goes idle the
    /// screen holds stale pixels until it happens to redraw again — which for
    /// a terminal answering a keystroke is latency the user feels directly.
    throttled: usize,
}

/// What the writer thread has done since it last said so.
///
/// Its own half: how many frames went out and how long the sockets took.
/// `dropped` climbing while `fps` stays flat means pixels are being made faster
/// than the chrome can drink them; a high `write_ms` means the socket itself is
/// what backs up. [`FrameTimings`] carries the Wayland thread's half, and the
/// report joins the two.
#[derive(Default)]
struct FrameWindow {
    since: Option<Instant>,
    sent: usize,
    bytes: usize,
    writing: Duration,
}

/// One window's worth of numbers, rounded for reading.
struct FrameReport {
    sent: usize,
    dropped: usize,
    fps: u32,
    mb_per_s: u32,
    write_ms: u32,
    readback_ms: u32,
    readback_worst_ms: u32,
    commit_ms: u32,
    idle_ms: u32,
    response_ms: u32,
    response_worst_ms: u32,
    throttled: usize,
}

/// The virtual output's size in *logical* units — what a client that sizes
/// itself to the screen gets, and what stays fixed as the scale changes.
///
/// A `wl_output` mode is in physical pixels, so the mode is this multiplied by
/// the scale. Advertising a fixed mode instead would shrink the desktop every
/// time the density went up, which a client feels as a smaller screen.
const OUTPUT_LOGICAL_SIZE: (i32, i32) = (1280, 800);

/// How often the writer thread reports. Long enough that the line is not noise,
/// short enough to watch while typing.
const REPORT_EVERY: Duration = Duration::from_secs(5);

impl FrameWindow {
    fn due(&mut self, outbound: &OutboundReceiver, hub: &ChromeHub) -> Option<FrameReport> {
        let since = *self.since.get_or_insert_with(Instant::now);
        let elapsed = since.elapsed();
        if elapsed < REPORT_EVERY {
            None
        } else {
            let dropped = outbound.take_dropped();
            let mut timings = hub.timings.lock().unwrap();
            // Nothing to say when nothing is being composited; an idle desktop
            // should not fill the log. Throttled commits count as something
            // happening: a window where every frame was refused is exactly the
            // one worth seeing, and it has no `sent` to announce itself with.
            let report = (self.sent > 0 || dropped > 0 || timings.throttled > 0).then(|| {
                // A path that recorded nothing reads as zero: "did not run" and
                // "took no time" are the same claim in a log line.
                let (readback, commit, idle, response) = (
                    timings.readback.take().unwrap_or_default(),
                    timings.commit.take().unwrap_or_default(),
                    timings.idle.take().unwrap_or_default(),
                    timings.response.take().unwrap_or_default(),
                );
                FrameReport {
                    sent: self.sent,
                    dropped,
                    fps: (self.sent as f64 / elapsed.as_secs_f64()).round() as u32,
                    mb_per_s: (self.bytes as f64 / 1e6 / elapsed.as_secs_f64()).round() as u32,
                    write_ms: self
                        .writing
                        .checked_div(self.sent.max(1) as u32)
                        .map_or(0, |per| per.as_millis() as u32),
                    readback_ms: readback.average.as_millis() as u32,
                    readback_worst_ms: readback.worst.as_millis() as u32,
                    commit_ms: commit.average.as_millis() as u32,
                    idle_ms: idle.average.as_millis() as u32,
                    response_ms: response.average.as_millis() as u32,
                    response_worst_ms: response.worst.as_millis() as u32,
                    throttled: std::mem::take(&mut timings.throttled),
                }
            });
            drop(timings);
            *self = FrameWindow {
                since: Some(Instant::now()),
                ..FrameWindow::default()
            };
            report
        }
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
        let responses = match parse_chrome(line.trim()) {
            // Compositor-level side effects: intercept before the (pure) brain.
            Ok(ChromeMessage::Spawn { command }) => {
                spawn_client(&command);
                Vec::new()
            }
            Ok(ChromeMessage::PointerMotion { app_id, x, y }) => {
                hub.send_request(ClientRequest::PointerMotion { app_id, x, y });
                Vec::new()
            }
            Ok(ChromeMessage::PointerLeave { .. }) => {
                hub.send_request(ClientRequest::PointerLeave);
                Vec::new()
            }
            Ok(ChromeMessage::PointerButton {
                button, pressed, ..
            }) => {
                hub.send_request(ClientRequest::PointerButton { button, pressed });
                Vec::new()
            }
            Ok(ChromeMessage::PointerAxis {
                dx,
                dy,
                v120_x,
                v120_y,
                ..
            }) => {
                hub.send_request(ClientRequest::PointerAxis {
                    dx,
                    dy,
                    v120_x,
                    v120_y,
                });
                Vec::new()
            }
            Ok(ChromeMessage::Key {
                keycode, pressed, ..
            }) => {
                hub.send_request(ClientRequest::Key { keycode, pressed });
                Vec::new()
            }
            // Compositor-level: the chrome's pixel density is the output's
            // scale, which is Wayland state rather than anything the brain
            // models — the scene is described in logical units either way.
            Ok(ChromeMessage::SetDevicePixelRatio { ratio }) => {
                hub.send_request(ClientRequest::SetOutputScale {
                    scale: output_scale(ratio, hub.max_scale),
                });
                Vec::new()
            }
            // A resize drives both the client's configure and the brain's model.
            Ok(ChromeMessage::ResizeApp { app_id, size }) => {
                hub.send_request(ClientRequest::ConfigureApp {
                    app_id: app_id.clone(),
                    width: size[0].round() as i32,
                    height: size[1].round() as i32,
                });
                let mut host = hub.host.lock().unwrap();
                apply_chrome_message(
                    &mut host,
                    &mut ready,
                    ChromeMessage::ResizeApp { app_id, size },
                )
            }
            // Focus drives both the seat (keyboard focus) and the brain's model.
            Ok(ChromeMessage::FocusApp { app_id }) => {
                hub.send_request(ClientRequest::KeyboardFocus {
                    app_id: Some(app_id.clone()),
                });
                let mut host = hub.host.lock().unwrap();
                apply_chrome_message(&mut host, &mut ready, ChromeMessage::FocusApp { app_id })
            }
            Ok(ChromeMessage::FocusChrome) => {
                hub.send_request(ClientRequest::KeyboardFocus { app_id: None });
                let mut host = hub.host.lock().unwrap();
                apply_chrome_message(&mut host, &mut ready, ChromeMessage::FocusChrome)
            }
            Ok(message) => {
                let mut host = hub.host.lock().unwrap();
                apply_chrome_message(&mut host, &mut ready, message)
            }
            Err(_) => Vec::new(),
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
struct DomicileCompositor {
    compositor_state: CompositorState,
    xdg_shell_state: XdgShellState,
    shm_state: ShmState,
    seat_state: SeatState<DomicileCompositor>,
    seat: Seat<DomicileCompositor>,
    /// Kept alive so the xdg-output manager global persists.
    #[allow(dead_code)]
    output_manager_state: OutputManagerState,
    /// The single virtual output. Every app surface is on it — a client asks
    /// which output it is on to learn its scale, and blocks until told.
    output: Output,
    /// Kept alive so the wp_cursor_shape_v1 global persists.
    #[allow(dead_code)]
    cursor_shape_state: CursorShapeManagerState,
    dmabuf_state: DmabufState,
    /// Kept alive so the zwp_linux_dmabuf_v1 global persists. `None` where EGL
    /// gave us no renderer, in which case the global was never advertised.
    #[allow(dead_code)]
    dmabuf_global: Option<DmabufGlobal>,
    /// The GLES context client buffers are imported into. Present exactly when
    /// the dmabuf global is, so a committed dmabuf always has one.
    dmabuf_importer: Option<DmabufImporter>,

    /// Shared brain + connected chrome clients.
    hub: Arc<ChromeHub>,
    /// Each app's engine texture and the dmabuf behind its latest frame — what
    /// the CEF external-texture path binds instead of copying pixels.
    bridge: BridgeRegistry,
    /// The buffers those descriptors point into, held so their plane fds stay
    /// open for as long as the descriptor names them.
    latest_dmabufs: HashMap<String, Dmabuf>,
    /// Mapped toplevels, paired with the host-assigned app id (Wayland-thread only).
    toplevels: Vec<(String, ToplevelSurface)>,
    /// The app the pointer is currently over, so a `set_cursor` request can be
    /// attributed to the element the chrome should restyle.
    pointer_app: Option<String>,
    /// For frame-callback timestamps.
    start: Instant,
    /// Last time a frame was broadcast per app, to throttle to ~30fps.
    last_frame: HashMap<String, Instant>,
    /// When the last buffer commit finished, so the gap to the next one can be
    /// timed. Not per-app: what it measures is whether *this thread* was busy.
    last_commit: Option<Instant>,
    /// When the oldest keystroke no client has answered yet was injected.
    /// Only the oldest is kept, for the reason the chrome keeps the oldest: a
    /// burst answered by one frame is felt as how long its first key waited.
    pending_key: Option<Instant>,
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

// ---- input injection (runs on the Wayland thread via the calloop channel) ---

impl DomicileCompositor {
    fn toplevel_for(&self, app_id: &str) -> Option<ToplevelSurface> {
        self.toplevels
            .iter()
            .find(|(id, _)| id == app_id)
            .map(|(_, toplevel)| toplevel.clone())
    }

    fn surface_for(&self, app_id: &str) -> Option<WlSurface> {
        self.toplevel_for(app_id)
            .map(|toplevel| toplevel.wl_surface().clone())
    }

    fn now_ms(&self) -> u32 {
        self.start.elapsed().as_millis() as u32
    }

    /// Record a client's committed content size in the brain, returning the
    /// chrome notification when it differs from what the brain already had.
    fn note_content_size(&self, app_id: &str, width: u32, height: u32) -> Option<HostMessage> {
        let size = (f64::from(width), f64::from(height));
        let mut host = self.hub.host.lock().unwrap();
        if host.app(app_id).map(|app| app.size) == Some(size) {
            None
        } else {
            host.app_resized(app_id, size)
        }
    }

    /// Turn a client's newly-attached buffer into pixels for the chrome,
    /// throttled to ~30fps per app.
    fn publish_frame(&mut self, app_id: &str, buffer: &wl_buffer::WlBuffer, buffer_scale: i32) {
        let Some(committed) = committed_buffer(buffer) else {
            return;
        };
        // Two sizes from here on, and they are not the same one at scale > 1:
        // the buffer's own device pixels, which are the pixel data and so the
        // canvas backing store, and the logical size the chrome lays out in
        // and `wl_pointer` speaks.
        let (width, height) = committed.size();
        let (logical_width, logical_height) = logical_size((width, height), buffer_scale);
        // A buffer of a new size is the client answering a configure (or
        // resizing itself); tell the chrome so its element and its pointer
        // mapping follow the client's real resolution.
        if let Some(resized) = self.note_content_size(app_id, logical_width, logical_height) {
            self.hub.broadcast(resized);
        }

        let now = Instant::now();
        let due = self.last_frame.get(app_id).map_or(true, |t| {
            now.duration_since(*t) >= Duration::from_millis(33)
        });
        if due {
            self.last_frame.insert(app_id.to_string(), now);
            // The GPU readback happens here rather than during classification:
            // it costs a pipeline stall, so a frame the throttle is about to
            // drop is never imported at all.
            let rgba = match committed {
                CommittedBuffer::Pixels { rgba, .. } => rgba,
                CommittedBuffer::Gpu(dmabuf) => self.import_gpu_frame(app_id, dmabuf),
            };
            tracing::debug!(%app_id, width, height, bytes = rgba.len(), "broadcast app frame");
            let scale = u32::try_from(buffer_scale).unwrap_or(1).max(1);
            self.hub.send_frame(app_id, width, height, scale, rgba);
        } else {
            self.hub.timings.lock().unwrap().throttled += 1;
        }
    }

    /// Read a client's GPU frame back as RGBA, recording the buffer it came
    /// from against the app's engine texture.
    ///
    /// The readback is the part the CEF bridge deletes: the descriptor stored
    /// here already names the very buffer the engine will sample directly.
    fn import_gpu_frame(&mut self, app_id: &str, dmabuf: Dmabuf) -> Vec<u8> {
        let importer = self.dmabuf_importer.as_mut().expect(
            "a dmabuf can only be committed where the global — and so the importer — exists",
        );
        // Every dmabuf was imported once already, when the client created it
        // (`DmabufHandler::dmabuf_imported`), so a failure here is not a client
        // handing us something unsupported — it is the renderer breaking.
        let started = Instant::now();
        let rgba = importer
            .read_rgba(&dmabuf)
            .expect("a dmabuf the importer accepted reads back");
        self.hub
            .timings
            .lock()
            .unwrap()
            .readback
            .record(started.elapsed());
        self.bridge
            .update_frame(app_id, descriptor_from(&dmabuf))
            .expect("every mapped toplevel is registered with the bridge");
        self.latest_dmabufs.insert(app_id.to_string(), dmabuf);
        rgba
    }

    /// Inject a forwarded input event into the appropriate client via the seat.
    fn handle_client_request(&mut self, event: ClientRequest) {
        match event {
            ClientRequest::PointerMotion { app_id, x, y } => {
                let Some(surface) = self.surface_for(&app_id) else {
                    tracing::debug!(%app_id, "pointer motion: no surface");
                    return;
                };
                tracing::debug!(%app_id, x, y, "pointer motion -> client");
                self.pointer_app = Some(app_id);
                let pointer = self.seat.get_pointer().unwrap();
                let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
                // The chrome sends surface-local coords, so anchor the focus at
                // the origin and treat the location as already surface-local.
                pointer.motion(
                    self,
                    Some((surface, (0.0, 0.0).into())),
                    &MotionEvent {
                        location: (x, y).into(),
                        serial,
                        time,
                    },
                );
                pointer.frame(self);
            }
            ClientRequest::PointerLeave => {
                self.pointer_app = None;
                let pointer = self.seat.get_pointer().unwrap();
                let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
                pointer.motion(
                    self,
                    None,
                    &MotionEvent {
                        location: (0.0, 0.0).into(),
                        serial,
                        time,
                    },
                );
                pointer.frame(self);
            }
            ClientRequest::PointerButton { button, pressed } => {
                tracing::debug!(button, pressed, "pointer button -> client");
                let pointer = self.seat.get_pointer().unwrap();
                let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
                let state = if pressed {
                    ButtonState::Pressed
                } else {
                    ButtonState::Released
                };
                pointer.button(
                    self,
                    &ButtonEvent {
                        button,
                        state,
                        serial,
                        time,
                    },
                );
                pointer.frame(self);
            }
            ClientRequest::PointerAxis {
                dx,
                dy,
                v120_x,
                v120_y,
            } => {
                let pointer = self.seat.get_pointer().unwrap();
                let mut frame = AxisFrame::new(self.now_ms()).source(AxisSource::Wheel);
                if dx != 0.0 {
                    frame = frame
                        .value(Axis::Horizontal, dx)
                        .v120(Axis::Horizontal, v120_x);
                }
                if dy != 0.0 {
                    frame = frame.value(Axis::Vertical, dy).v120(Axis::Vertical, v120_y);
                }
                pointer.axis(self, frame);
                pointer.frame(self);
            }
            ClientRequest::Key { keycode, pressed } => {
                // Started here rather than where the key arrived off the socket:
                // what this isolates is the client's think-and-redraw, so the
                // clock starts the moment the client can possibly know.
                //
                // Presses only, for the reason the chrome counts presses only:
                // a release changes nothing on screen, so it would time to some
                // unrelated redraw — a blinking cursor, half a second later.
                if pressed {
                    self.pending_key.get_or_insert_with(Instant::now);
                }
                let keyboard = self.seat.get_keyboard().unwrap();
                let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
                let state = if pressed {
                    KeyState::Pressed
                } else {
                    KeyState::Released
                };
                // wl keymaps use X keycodes (evdev + 8); the chrome sends evdev.
                let key: Keycode = (keycode + 8).into();
                keyboard.input::<(), _>(self, key, state, serial, time, |_, _, _| {
                    FilterResult::Forward
                });
            }
            ClientRequest::KeyboardFocus { app_id } => {
                let keyboard = self.seat.get_keyboard().unwrap();
                let serial = SERIAL_COUNTER.next_serial();
                let surface = app_id.and_then(|id| self.surface_for(&id));
                keyboard.set_focus(self, surface, serial);
            }
            ClientRequest::SetOutputScale { scale } => {
                if self.output.current_scale().integer_scale() != scale {
                    info!(scale, "advertising output scale");
                    // The mode is physical pixels, so it grows with the scale to
                    // hold the logical size still: a denser display is a sharper
                    // desktop, not a smaller one.
                    let mode = OutputMode {
                        size: (OUTPUT_LOGICAL_SIZE.0 * scale, OUTPUT_LOGICAL_SIZE.1 * scale).into(),
                        refresh: 60_000,
                    };
                    self.output.change_current_state(
                        Some(mode),
                        None,
                        Some(Scale::Integer(scale)),
                        None,
                    );
                    self.output.set_preferred(mode);
                    // A client only redraws at the new scale once something
                    // asks it to, and its own size is unchanged — so re-send
                    // the configure it already has to prompt one.
                    for (_, toplevel) in &self.toplevels {
                        toplevel.send_configure();
                    }
                }
            }
            ClientRequest::ConfigureApp {
                app_id,
                width,
                height,
            } => {
                let Some(toplevel) = self.toplevel_for(&app_id) else {
                    tracing::debug!(%app_id, "configure: no toplevel");
                    return;
                };
                tracing::debug!(%app_id, width, height, "configure -> client");
                toplevel.with_pending_state(|state| {
                    state.size = Some((width, height).into());
                });
                // Only sends when the size actually differs from the last
                // configure the client acknowledged.
                toplevel.send_pending_configure();
            }
        }
    }
}

// ---- compositor + shm + dmabuf --------------------------------------------

/// What a client just attached: pixels we can already read (`wl_shm`), or a
/// GPU buffer that has to go through the renderer first (`zwp_linux_dmabuf`).
enum CommittedBuffer {
    Pixels {
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    },
    Gpu(Dmabuf),
}

impl CommittedBuffer {
    /// The client's content size, known before any pixels are read — which is
    /// what lets the frame throttle run ahead of the GPU import.
    fn size(&self) -> (u32, u32) {
        match self {
            CommittedBuffer::Pixels { width, height, .. } => (*width, *height),
            CommittedBuffer::Gpu(dmabuf) => (dmabuf.width(), dmabuf.height()),
        }
    }
}

impl CompositorHandler for DomicileCompositor {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        &client.get_data::<ClientState>().unwrap().compositor_state
    }

    fn commit(&mut self, surface: &WlSurface) {
        let Some((app_id, toplevel)) = self
            .toplevels
            .iter()
            .find(|(_, t)| t.wl_surface() == surface)
            .cloned()
        else {
            return;
        };

        // Send the initial configure once, so the client can map its buffer.
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

        // Take the newly-attached buffer and drain the frame callbacks. Taking
        // it (rather than borrowing) hands us the release: Smithay would
        // otherwise hold it until the *next* buffer arrives, which is a buffer
        // the client cannot draw without the release it is waiting for.
        let (attached, callbacks, buffer_scale) = with_states(surface, |states| {
            let mut guard = states.cached_state.get::<SurfaceAttributes>();
            let attrs = guard.current();
            let attached = match attrs.buffer.take() {
                Some(BufferAssignment::NewBuffer(buffer)) => Some(buffer),
                Some(BufferAssignment::Removed) | None => None,
            };
            let callbacks = std::mem::take(&mut attrs.frame_callbacks);
            // How many buffer pixels the client drew per logical unit. Taken
            // here with the buffer rather than looked up later: it is the
            // scale *this* buffer was drawn at, and a client that is mid-way
            // through answering a scale change will commit the next one at a
            // different number.
            (attached, callbacks, attrs.buffer_scale)
        });

        // Ask the client to draw its next frame (keeps it animating).
        let time = self.start.elapsed().as_millis() as u32;
        for callback in callbacks {
            callback.done(time);
        }

        if let Some(buffer) = attached {
            // The gap since the last buffer commit is time the compositor was
            // not composing: a client drawing, or the throttle holding it back.
            let started = Instant::now();
            {
                let mut timings = self.hub.timings.lock().unwrap();
                if let Some(waited) = self.last_commit.map(|done| started.duration_since(done)) {
                    timings.idle.record(waited);
                }
                // A commit with no keystroke behind it is not a response to
                // one — a terminal redraws its blinking cursor unprompted, and
                // counting that would report the blink interval as think time.
                if let Some(keyed) = self.pending_key.take() {
                    timings.response.record(started.duration_since(keyed));
                }
            }
            self.publish_frame(&app_id, &buffer, buffer_scale);
            // The client may redraw into this buffer the instant it is
            // released, so the release comes after the pixels are out of it —
            // and it happens even for a frame the throttle dropped, or a
            // single-buffered client never draws again.
            buffer.release();
            tracing::debug!(%app_id, "buffer released");
            let done = Instant::now();
            self.hub
                .timings
                .lock()
                .unwrap()
                .commit
                .record(done - started);
            self.last_commit = Some(done);
        }
    }
}

impl BufferHandler for DomicileCompositor {
    fn buffer_destroyed(&mut self, _buffer: &wl_buffer::WlBuffer) {}
}

impl ShmHandler for DomicileCompositor {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}

impl DmabufHandler for DomicileCompositor {
    fn dmabuf_state(&mut self) -> &mut DmabufState {
        &mut self.dmabuf_state
    }

    // A client is asking whether we can use the GPU buffer it just allocated.
    // Answering by actually importing it is the only honest answer — and it
    // warms the renderer's cache, so the commit that follows is a lookup.
    fn dmabuf_imported(
        &mut self,
        _global: &DmabufGlobal,
        dmabuf: Dmabuf,
        notifier: ImportNotifier,
    ) {
        let importer = self
            .dmabuf_importer
            .as_mut()
            .expect("the dmabuf global is only advertised alongside an importer");
        if importer.accepts(&dmabuf) {
            tracing::debug!(format = ?dmabuf.format(), "client dmabuf accepted");
            if let Err(err) = notifier.successful::<DomicileCompositor>() {
                tracing::debug!(?err, "client went away before its dmabuf was acknowledged");
            }
        } else {
            tracing::warn!(format = ?dmabuf.format(), "rejecting a dmabuf the renderer cannot import");
            notifier.failed();
        }
    }
}

delegate_compositor!(DomicileCompositor);
delegate_shm!(DomicileCompositor);
delegate_dmabuf!(DomicileCompositor);

// ---- seat (required by xdg-shell delegation) ------------------------------

impl SeatHandler for DomicileCompositor {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<DomicileCompositor> {
        &mut self.seat_state
    }

    // A client asking for a cursor is really asking the *chrome* for one: the
    // pointer the user sees belongs to the web engine, so the request is
    // forwarded as a CSS cursor for the element the pointer is over.
    fn cursor_image(&mut self, _seat: &Seat<Self>, image: CursorImageStatus) {
        if let Some(app_id) = self.pointer_app.clone() {
            let cursor = match image {
                CursorImageStatus::Hidden => CursorShape::None,
                CursorImageStatus::Named(icon) => cursor_shape(icon),
                // The client drew its own cursor into a surface. Mirroring
                // those pixels needs the texture bridge (see CEF-SPIKE.md), so
                // until then the pointer keeps its ordinary arrow.
                CursorImageStatus::Surface(_) => CursorShape::Default,
            };
            self.hub
                .broadcast(HostMessage::AppCursor { app_id, cursor });
        }
    }

    fn focus_changed(&mut self, _seat: &Seat<Self>, _focused: Option<&WlSurface>) {}
}

impl TabletSeatHandler for DomicileCompositor {}

delegate_seat!(DomicileCompositor);
delegate_cursor_shape!(DomicileCompositor);

// ---- output (clients wait for a wl_output before mapping) -----------------

impl OutputHandler for DomicileCompositor {}
delegate_output!(DomicileCompositor);

// ---- xdg-shell: the seam into the host brain ------------------------------

impl XdgShellHandler for DomicileCompositor {
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
            // Tell the client which output it is on. Toolkits that scale their
            // content (GLFW, and so kitty) wait for this before drawing their
            // first frame, so without it the window maps and stays blank.
            self.output.enter(surface.wl_surface());
            // The engine texture id is stable for the element's whole life, so
            // it is claimed here rather than on the app's first GPU frame.
            self.bridge.register(&app_id);
            self.toplevels.push((app_id, surface));
            announce
        };
        self.hub.broadcast(announce);
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        if let Some(pos) = self
            .toplevels
            .iter()
            .position(|(_, t)| t.wl_surface() == surface.wl_surface())
        {
            let (app_id, _) = self.toplevels.remove(pos);
            self.last_frame.remove(&app_id);
            self.bridge.remove(&app_id);
            self.latest_dmabufs.remove(&app_id);
            let closed = self.hub.host.lock().unwrap().app_closed(&app_id);
            info!(%app_id, "toplevel destroyed -> Host::app_closed");
            if let Some(closed) = closed {
                self.hub.broadcast(closed);
            }
        }
    }

    fn new_popup(&mut self, _surface: PopupSurface, _positioner: PositionerState) {}

    fn reposition_request(
        &mut self,
        surface: PopupSurface,
        positioner: PositionerState,
        token: u32,
    ) {
        surface.with_pending_state(|state| {
            state.geometry = positioner.get_geometry();
            state.positioner = positioner;
        });
        surface.send_repositioned(token);
    }

    fn move_request(&mut self, _surface: ToplevelSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
    }

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

delegate_xdg_shell!(DomicileCompositor);

// ---- boot -----------------------------------------------------------------

/// Spawn a client process. It inherits the compositor's environment — including
/// the `WAYLAND_DISPLAY` we set — so it connects to Domicile. `DISPLAY` is removed so
/// GUI toolkits prefer Domicile's Wayland display over any outer X server. A reaper
/// thread waits on the child so it doesn't become a zombie.
fn spawn_client(command: &[String]) {
    let Some((program, args)) = command.split_first() else {
        return;
    };
    info!(?command, "spawning client");
    match std::process::Command::new(program)
        .args(args)
        .env_remove("DISPLAY")
        .spawn()
    {
        Ok(mut child) => {
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(err) => tracing::error!(%err, ?command, "failed to spawn client"),
    }
}

/// Advertise `zwp_linux_dmabuf_v1`, with feedback whenever we can name the DRM
/// node we import on.
///
/// The feedback (protocol v4) is what tells a client *which* device to allocate
/// on. Mesa has no other source for that here — Domicile advertises no
/// `wl_drm` — so against a v3-only global it sees a format list, cannot resolve
/// a GPU, and never allocates a buffer at all. v3 remains the fallback for a
/// software renderer, which has no DRM node to name.
fn advertise_dmabuf(
    state: &mut DmabufState,
    display: &DisplayHandle,
    importer: &DmabufImporter,
) -> DmabufGlobal {
    let formats: Vec<_> = importer.formats().into_iter().collect();
    let feedback = importer.main_device().and_then(|device| {
        match DmabufFeedbackBuilder::new(device, formats.clone()).build() {
            Ok(feedback) => Some(feedback),
            Err(err) => {
                tracing::warn!(%err, "cannot build dmabuf feedback; falling back to v3");
                None
            }
        }
    });
    info!(
        count = formats.len(),
        feedback = feedback.is_some(),
        "advertising zwp_linux_dmabuf_v1"
    );
    match feedback {
        Some(feedback) => {
            state.create_global_with_default_feedback::<DomicileCompositor>(display, &feedback)
        }
        None => state.create_global::<DomicileCompositor>(display, formats),
    }
}

/// Classify a newly-attached buffer. A dmabuf carries its `Dmabuf` as the
/// `wl_buffer`'s user data, which is what tells the two kinds apart.
fn committed_buffer(buffer: &wl_buffer::WlBuffer) -> Option<CommittedBuffer> {
    match get_dmabuf(buffer) {
        Ok(dmabuf) => Some(CommittedBuffer::Gpu(dmabuf.clone())),
        Err(_) => shm_buffer_to_rgba(buffer).map(|(width, height, rgba)| CommittedBuffer::Pixels {
            width,
            height,
            rgba,
        }),
    }
}

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
    if width == 0
        || height == 0
        || stride < width * 4
        || offset + (height - 1) * stride + width * 4 > src.len()
    {
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

/// Translate a client's requested cursor into the CSS keyword the chrome
/// assigns to its `<app>` element.
///
/// `wp_cursor_shape_v1` is modelled on the CSS cursor keywords, so almost every
/// shape maps across by name. The two that predate that alignment — and any
/// shape a future revision of the protocol adds — resolve to the nearest
/// keyword rather than something the chrome cannot use.
fn cursor_shape(icon: CursorIcon) -> CursorShape {
    match icon {
        CursorIcon::Default => CursorShape::Default,
        CursorIcon::ContextMenu => CursorShape::ContextMenu,
        CursorIcon::Help => CursorShape::Help,
        CursorIcon::Pointer => CursorShape::Pointer,
        CursorIcon::Progress => CursorShape::Progress,
        CursorIcon::Wait => CursorShape::Wait,
        CursorIcon::Cell => CursorShape::Cell,
        CursorIcon::Crosshair => CursorShape::Crosshair,
        CursorIcon::Text => CursorShape::Text,
        CursorIcon::VerticalText => CursorShape::VerticalText,
        CursorIcon::Alias => CursorShape::Alias,
        CursorIcon::Copy => CursorShape::Copy,
        CursorIcon::Move | CursorIcon::AllResize => CursorShape::Move,
        CursorIcon::NoDrop => CursorShape::NoDrop,
        CursorIcon::NotAllowed => CursorShape::NotAllowed,
        CursorIcon::Grab => CursorShape::Grab,
        CursorIcon::Grabbing => CursorShape::Grabbing,
        CursorIcon::EResize => CursorShape::EResize,
        CursorIcon::NResize => CursorShape::NResize,
        CursorIcon::NeResize => CursorShape::NeResize,
        CursorIcon::NwResize => CursorShape::NwResize,
        CursorIcon::SResize => CursorShape::SResize,
        CursorIcon::SeResize => CursorShape::SeResize,
        CursorIcon::SwResize => CursorShape::SwResize,
        CursorIcon::WResize => CursorShape::WResize,
        CursorIcon::EwResize => CursorShape::EwResize,
        CursorIcon::NsResize => CursorShape::NsResize,
        CursorIcon::NeswResize => CursorShape::NeswResize,
        CursorIcon::NwseResize => CursorShape::NwseResize,
        CursorIcon::ColResize => CursorShape::ColResize,
        CursorIcon::RowResize => CursorShape::RowResize,
        CursorIcon::AllScroll => CursorShape::AllScroll,
        CursorIcon::ZoomIn => CursorShape::ZoomIn,
        CursorIcon::ZoomOut => CursorShape::ZoomOut,
        _ => CursorShape::Default,
    }
}

/// Resolve where the config file lives.
///
/// Mirrors [`chrome_socket_path`]: `--config PATH` wins, then
/// `$DOMICILE_CONFIG`, then `domicile.toml` in the working directory.
fn config_path() -> PathBuf {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--config" {
            if let Some(path) = args.next() {
                return PathBuf::from(path);
            }
        }
    }
    std::env::var_os("DOMICILE_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("domicile.toml"))
}

/// Resolve where the chrome protocol socket lives.
fn chrome_socket_path() -> PathBuf {
    // --chrome-socket PATH wins, then $DOMICILE_CHROME_SOCKET, then a default under
    // $XDG_RUNTIME_DIR (falling back to the current directory).
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--chrome-socket" {
            if let Some(path) = args.next() {
                return PathBuf::from(path);
            }
        }
    }
    if let Some(path) = std::env::var_os("DOMICILE_CHROME_SOCKET") {
        return PathBuf::from(path);
    }
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.join("domicile-chrome.sock")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().init();
    }

    // The chrome protocol socket: where a chrome shell connects. Overridable via
    // --chrome-socket or DOMICILE_CHROME_SOCKET; defaults under XDG_RUNTIME_DIR.
    let chrome_socket = chrome_socket_path();

    // Config is optional: a missing/invalid file means run with defaults rather
    // than refuse to boot, the same call the daemon makes.
    let config = match Config::load(config_path()) {
        Ok(config) => config,
        Err(err) => {
            tracing::warn!(%err, "using the default config");
            Config::default()
        }
    };

    let mut event_loop: EventLoop<CalloopData> = EventLoop::try_new()?;
    let display: Display<DomicileCompositor> = Display::new()?;
    let dh = display.handle();

    let mut seat_state = SeatState::new();
    // Advertise a keyboard and pointer; a real compositor would track hotplug.
    let mut seat: Seat<DomicileCompositor> = seat_state.new_wl_seat(&dh, "domicile");
    // The keymap the seat compiles is what every Wayland client is handed, so
    // the config's keyboard section lands here and nowhere else. A keymap xkb
    // cannot compile (a layout or variant that does not exist) fails the boot
    // rather than silently handing clients a keymap they did not ask for.
    let keyboard = &config.input.keyboard;
    seat.add_keyboard(
        XkbConfig {
            rules: &keyboard.xkb_rules,
            model: &keyboard.xkb_model,
            layout: &keyboard.xkb_layout,
            variant: &keyboard.xkb_variant,
            options: Some(keyboard.xkb_options_string()),
        },
        200,
        25,
    )?;
    seat.add_pointer();

    // Advertise one virtual output. Many clients (e.g. weston-terminal) wait for
    // a wl_output before they will map a toplevel.
    let output_manager_state = OutputManagerState::new_with_xdg_output::<DomicileCompositor>(&dh);
    let output = Output::new(
        "domicile-0".to_string(),
        PhysicalProperties {
            size: (300, 200).into(),
            subpixel: Subpixel::Unknown,
            make: "Domicile".into(),
            model: "Virtual".into(),
        },
    );
    output.create_global::<DomicileCompositor>(&dh);
    let mode = OutputMode {
        size: OUTPUT_LOGICAL_SIZE.into(),
        refresh: 60_000,
    };
    output.change_current_state(
        Some(mode),
        Some(Transform::Normal),
        None,
        Some((0, 0).into()),
    );
    output.set_preferred(mode);

    // Forward input from the chrome onto the Wayland thread via a channel.
    let (request_tx, request_rx) = channel::<ClientRequest>();

    // Shared brain, driven by both the Wayland side and chrome connections.
    let (hub, outbound_rx) = ChromeHub::new(request_tx, config.output.max_scale);
    {
        let hub = hub.clone();
        thread::spawn(move || serve_chrome(hub, chrome_socket));
    }
    {
        let hub = hub.clone();
        thread::spawn(move || serve_outbound(hub, outbound_rx));
    }

    // GPU clients need somewhere for their buffers to land. Where EGL gives us
    // nothing to render on — a container, a machine with no DRM device — the
    // global is simply not advertised, and clients fall back to wl_shm rather
    // than allocating buffers we would then have to reject.
    let dmabuf_importer = match DmabufImporter::new() {
        Ok(importer) => Some(importer),
        Err(err) => {
            tracing::warn!(%err, "no EGL renderer: serving wl_shm clients only");
            None
        }
    };
    let mut dmabuf_state = DmabufState::new();
    let dmabuf_global = dmabuf_importer
        .as_ref()
        .map(|importer| advertise_dmabuf(&mut dmabuf_state, &dh, importer));

    let state = DomicileCompositor {
        compositor_state: CompositorState::new::<DomicileCompositor>(&dh),
        xdg_shell_state: XdgShellState::new::<DomicileCompositor>(&dh),
        shm_state: ShmState::new::<DomicileCompositor>(&dh, vec![]),
        seat_state,
        seat,
        output_manager_state,
        output,
        // Modern toolkits ask for cursors by name through this global, which
        // maps straight onto CSS cursor keywords.
        cursor_shape_state: CursorShapeManagerState::new::<DomicileCompositor>(&dh),
        dmabuf_state,
        dmabuf_global,
        dmabuf_importer,
        hub,
        bridge: BridgeRegistry::new(),
        latest_dmabufs: HashMap::new(),
        toplevels: Vec::new(),
        pointer_app: None,
        start: Instant::now(),
        last_frame: HashMap::new(),
        last_commit: None,
        pending_key: None,
    };

    let mut data = CalloopData { display, state };

    // Accept clients on an auto-named Wayland socket.
    let source = ListeningSocketSource::new_auto()?;
    let socket_name = source.socket_name().to_os_string();
    let handle = event_loop.handle();
    handle.insert_source(source, move |stream, _, data: &mut CalloopData| {
        data.display
            .handle()
            .insert_client(stream, Arc::new(ClientState::default()))
            .expect("failed to insert client");
    })?;

    // Drive wayland-server dispatch from the event loop, flushing replies after.
    let poll_fd = data.display.backend().poll_fd().try_clone_to_owned()?;
    handle.insert_source(
        Generic::new(poll_fd, Interest::READ, Mode::Level),
        |_, _, data: &mut CalloopData| {
            data.display.dispatch_clients(&mut data.state).unwrap();
            data.display.flush_clients().unwrap();
            Ok(PostAction::Continue)
        },
    )?;

    // Inject forwarded input (from chrome threads) on the Wayland thread.
    handle.insert_source(request_rx, |event, _, data: &mut CalloopData| {
        if let ChannelEvent::Msg(input) = event {
            data.state.handle_client_request(input);
        }
    })?;

    info!(
        ?socket_name,
        "domicile-compositor: Wayland server up (WAYLAND_DISPLAY)"
    );
    std::env::set_var("WAYLAND_DISPLAY", &socket_name);

    // Flush after every loop iteration so events queued while handling input
    // (which arrives off the wayland fd) reach clients promptly.
    event_loop.run(None, &mut data, |data| {
        let _ = data.display.flush_clients();
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use smithay::input::pointer::CursorIcon;

    use domicile_protocol::CursorShape;

    use super::{bgra_to_rgba, cursor_shape};

    #[test]
    fn cursor_icons_map_to_css_keywords() {
        assert_eq!(cursor_shape(CursorIcon::Default), CursorShape::Default);
        assert_eq!(cursor_shape(CursorIcon::Text), CursorShape::Text);
        assert_eq!(cursor_shape(CursorIcon::Grabbing), CursorShape::Grabbing);
        assert_eq!(
            cursor_shape(CursorIcon::NwseResize),
            CursorShape::NwseResize
        );
    }

    #[test]
    fn cursor_icons_without_a_css_keyword_fall_back() {
        // `wp_cursor_shape_v1` carries two shapes CSS has no keyword for; they
        // must still resolve to something the chrome can assign.
        assert_eq!(cursor_shape(CursorIcon::DndAsk), CursorShape::Default);
        assert_eq!(cursor_shape(CursorIcon::AllResize), CursorShape::Move);
    }

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
