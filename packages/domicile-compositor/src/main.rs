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

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;
use smithay::backend::allocator::Fourcc;
use smithay::backend::input::{
    AbsolutePositionEvent as _, Axis, AxisSource, ButtonState, InputEvent, KeyState,
    KeyboardKeyEvent as _, PointerAxisEvent as _, PointerButtonEvent as _,
};
use smithay::backend::winit::{WinitEvent, WinitInput};
use smithay::input::{
    keyboard::{FilterResult, Keycode, XkbConfig},
    pointer::{AxisFrame, ButtonEvent, CursorIcon, CursorImageStatus, MotionEvent},
    Seat, SeatHandler, SeatState,
};
use smithay::output::{Mode as OutputMode, Output, PhysicalProperties, Scale, Subpixel};
use smithay::reexports::winit::window::Cursor;
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
        Client, Display, DisplayHandle, Resource as _,
    },
};
use smithay::utils::{Rectangle, Serial, Transform, SERIAL_COUNTER};
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
    selection::data_device::{
        ClientDndGrabHandler, DataDeviceHandler, DataDeviceState, ServerDndGrabHandler,
    },
    selection::SelectionHandler,
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
    delegate_compositor, delegate_cursor_shape, delegate_data_device, delegate_dmabuf,
    delegate_output, delegate_seat, delegate_shm, delegate_xdg_shell,
};
use tracing::info;

mod compose;
mod dmabuf_descriptor;
mod dmabuf_import;
mod outbound;
mod scale;
mod shortcut;
mod timing_window;

use crate::compose::{draw_layers, logical_to_window, window_to_logical, Layer};
use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_import::{headless_renderer, DmabufImporter};
use crate::outbound::{outbound, Outbound, OutboundReceiver, OutboundSender};
use crate::scale::{logical_size, output_scale};
use crate::shortcut::{Modifiers, Shortcuts};
use crate::timing_window::TimingWindow;
use domicile_bridge::BridgeRegistry;
use domicile_config::Config;
use domicile_host::ipc::{apply_chrome_message, parse_chrome, to_line};
use domicile_host::Host;
use domicile_protocol::{ChromeMessage, CursorShape, HostMessage, Shortcut};
use domicile_scene::{Point as ScenePoint, PointerTarget, Transform as SceneTransform};
use smithay::backend::renderer::gles::{GlesRenderer, GlesTexture};
use smithay::backend::renderer::{Color32F, Frame as _, ImportMem as _, Renderer as _};
use smithay::backend::winit::WinitGraphicsBackend;

/// The renderer client buffers are imported on, and the policy that chose it.
///
/// One renderer serves both importing and — once the compositor presents —
/// drawing, because a texture belongs to the EGL context that created it.
struct Gpu {
    output: GpuOutput,
    importer: DmabufImporter,
}

/// Where the renderer lives, which is whoever is presenting.
enum GpuOutput {
    /// No output: the renderer is ours, and frames leave as `AppFrame` pixels.
    Headless(Box<GlesRenderer>),
    /// A window: the renderer belongs to it, and client surfaces are drawn
    /// into it rather than copied out.
    Window(Box<WinitGraphicsBackend<GlesRenderer>>),
}

impl Gpu {
    fn renderer(&mut self) -> &mut GlesRenderer {
        match &mut self.output {
            GpuOutput::Headless(renderer) => renderer,
            GpuOutput::Window(backend) => backend.renderer(),
        }
    }

    /// The window, when there is one. Compositing needs the backend itself —
    /// binding and submitting are its job, not the renderer's.
    fn window(&mut self) -> Option<&mut WinitGraphicsBackend<GlesRenderer>> {
        match &mut self.output {
            GpuOutput::Headless(_) => None,
            GpuOutput::Window(backend) => Some(backend),
        }
    }

    fn presenting(&self) -> bool {
        matches!(self.output, GpuOutput::Window(_))
    }
}

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
    /// The chrome claimed a key combination for the desktop.
    GrabShortcut {
        shortcut: Shortcut,
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
    /// The name of *our* Wayland socket, which is what a client we spawn must
    /// connect to.
    wayland_display: OsString,
    /// Whether Domicile has a window of its own, which decides who is believed
    /// about the output's density.
    presenting: bool,
}

impl ChromeHub {
    fn new(
        request_tx: Sender<ClientRequest>,
        max_scale: u32,
        wayland_display: OsString,
        presenting: bool,
    ) -> (Arc<Self>, OutboundReceiver) {
        let (outbound, outbound_rx) = outbound();
        let hub = Arc::new(ChromeHub {
            host: Mutex::new(Host::new()),
            chromes: Mutex::new(Vec::new()),
            request_tx: Mutex::new(request_tx),
            outbound,
            timings: Mutex::new(FrameTimings::default()),
            max_scale,
            wayland_display,
            presenting,
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
    // On a timeout as well as on traffic: the report is on a schedule, and the
    // compositing path produces no outbound items at all — waiting for one
    // would leave it silent however hard it was working.
    while let Some(next) = outbound.recv_until(REPORT_EVERY) {
        let Some(item) = next else {
            report(&mut window, &outbound, &hub);
            continue;
        };
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
        drop(chromes);

        if is_frame {
            window.sent += 1;
            window.bytes += line.len() + pixels.len();
            window.writing += started.elapsed();
        }
        report(&mut window, &outbound, &hub);
    }
}

/// Print one line, if the window that just closed saw anything.
fn report(window: &mut FrameWindow, outbound: &OutboundReceiver, hub: &Arc<ChromeHub>) {
    let Some(report) = window.due(outbound, hub) else {
        return;
    };
    info!(
        sent = report.sent,
        composited = report.composited,
        dropped = report.dropped,
        fps = report.fps,
        mb_per_s = report.mb_per_s,
        write_ms = report.write_ms,
        readback_ms = report.readback_ms,
        readback_worst_ms = report.readback_worst_ms,
        commit_ms = report.commit_ms,
        composite_ms = report.composite_ms,
        composite_worst_ms = report.composite_worst_ms,
        idle_ms = report.idle_ms,
        response_ms = report.response_ms,
        response_worst_ms = report.response_worst_ms,
        throttled = report.throttled,
        chromes = hub.chromes.lock().unwrap().len(),
        "frames"
    );
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
    /// How long a whole composite took — import, draw, submit.
    composite: TimingWindow,
    /// How many of them there were.
    composited: usize,
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
    /// Frames drawn into the window. The native path's answer to `sent`: the
    /// pixels went to the screen instead of to the chrome.
    composited: usize,
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
    /// Importing a client's buffer, drawing every layer, and submitting.
    composite_ms: u32,
    composite_worst_ms: u32,
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
            let composited = std::mem::take(&mut timings.composited);
            let report =
                worth_reporting(self.sent, dropped, timings.throttled, composited).then(|| {
                    // A path that recorded nothing reads as zero: "did not run" and
                    // "took no time" are the same claim in a log line.
                    let (readback, commit, idle, response, composite) = (
                        timings.readback.take().unwrap_or_default(),
                        timings.commit.take().unwrap_or_default(),
                        timings.idle.take().unwrap_or_default(),
                        timings.response.take().unwrap_or_default(),
                        timings.composite.take().unwrap_or_default(),
                    );
                    FrameReport {
                        sent: self.sent,
                        composited,
                        dropped,
                        // Frames that got somewhere, which is a different somewhere
                        // on each path: sent to the chrome, or drawn into the
                        // window. Exactly one of the two can be non-zero, because
                        // a compositor with a window sends no pixels and one
                        // without draws none.
                        fps: ((self.sent + composited) as f64 / elapsed.as_secs_f64()).round()
                            as u32,
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
                        composite_ms: composite.average.as_millis() as u32,
                        composite_worst_ms: composite.worst.as_millis() as u32,
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
            // Compositor-level, before the brain: a claim on the keyboard is
            // the compositor's to keep, since it is the only thing that sees a
            // key before its client does.
            Ok(ChromeMessage::GrabShortcut { shortcut }) => {
                hub.send_request(ClientRequest::GrabShortcut { shortcut });
                Vec::new()
            }
            Ok(ChromeMessage::Spawn { command }) => {
                spawn_client(&command, &hub.wayland_display);
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
                // Ignored where the window knows better — see
                // `set_output_scale`. The chrome would only be reporting back
                // the density we gave it.
                if !hub.presenting {
                    hub.send_request(ClientRequest::SetOutputScale {
                        scale: output_scale(ratio, hub.max_scale),
                    });
                }
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
    /// Drag-and-drop and the clipboard.
    ///
    /// Advertised because a desktop without it is not one — but the reason it
    /// went in when it did is that its *absence* freezes a chrome. A page that
    /// starts an HTML5 drag has the engine start a Wayland one, and the engine
    /// runs a nested loop until the drag completes. With no
    /// `wl_data_device_manager` there is nothing to complete it, so the chrome
    /// stops answering anything while every other client carries on — which
    /// reads as the compositor having crashed, and does not look like a missing
    /// global at all.
    data_device_state: DataDeviceState,
    /// Kept alive so the wp_cursor_shape_v1 global persists.
    #[allow(dead_code)]
    cursor_shape_state: CursorShapeManagerState,
    dmabuf_state: DmabufState,
    /// Kept alive so the zwp_linux_dmabuf_v1 global persists. `None` where EGL
    /// gave us no renderer, in which case the global was never advertised.
    #[allow(dead_code)]
    dmabuf_global: Option<DmabufGlobal>,
    /// Where client buffers are imported and, when presenting, drawn.
    ///
    /// One renderer, not two: a texture belongs to the EGL context that made
    /// it, so importing on one context and drawing on another would not work.
    /// Present exactly when the dmabuf global is, so a committed dmabuf always
    /// has somewhere to go.
    gpu: Option<Gpu>,

    /// Shared brain + connected chrome clients.
    hub: Arc<ChromeHub>,
    /// Each app's engine texture and the dmabuf behind its latest frame — what
    /// the CEF external-texture path binds instead of copying pixels.
    bridge: BridgeRegistry,
    /// The buffers those descriptors point into, held so their plane fds stay
    /// open for as long as the descriptor names them.
    latest_dmabufs: HashMap<String, Dmabuf>,
    /// Each app's latest surface as a texture, when presenting. Kept rather
    /// than read back and dropped: this *is* the client's buffer, and drawing
    /// it is what costs nothing.
    textures: HashMap<String, SurfaceTexture>,
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
    /// The chrome's own toplevel, when it is a client of ours. Kept apart from
    /// `toplevels` because it is not an app: it is never announced, never
    /// placed by a portal, and is drawn over everything rather than in
    /// `draw_order`.
    chrome_toplevel: Option<ToplevelSurface>,
    /// The chrome's latest surface as a texture. Transparent wherever an
    /// `<app>` element is, which is what lets the app below show through.
    chrome_texture: Option<SurfaceTexture>,
    /// Which kinds of window input have been seen, so each is reported once
    /// rather than on every pointer motion.
    window_input_seen: HashSet<&'static str>,
    /// What the chrome's last frame looked like, so the line describing it is
    /// printed when it changes rather than sixty times a second.
    chrome_frame_shape: Option<((f64, f64), bool, bool)>,
    /// The highest output scale to advertise, whatever a display reports.
    max_scale: u32,
    /// The key combinations the chrome has claimed for the desktop.
    shortcuts: Shortcuts,
    /// The desktop's size in logical units. Follows the window where there is
    /// one; [`OUTPUT_LOGICAL_SIZE`] is what a headless run is stuck with.
    output_logical: (i32, i32),
    /// Whether anything has changed since the last frame was drawn.
    ///
    /// Compositing does not happen where the change is noticed. Submitting a
    /// frame blocks until the display will take it, so drawing once per client
    /// commit means blocking the Wayland thread once per client commit — and a
    /// client that commits faster than the display refreshes stops the
    /// compositor from serving anything at all. Every other client freezes, the
    /// chrome included, which is what it looks like from outside.
    ///
    /// So commits mark the desktop dirty and the event loop draws at most once
    /// per pass, coalescing however many arrived.
    needs_present: bool,
    /// Set when the window is closed, which is the user closing the desktop.
    /// Read by the event loop, which is the only thing that can act on it.
    stop: Arc<AtomicBool>,
}

/// Per-client state required by the compositor global.
#[derive(Default)]
struct ClientState {
    compositor_state: CompositorClientState,
    /// Whether this client arrived on the chrome's own socket, and so is the
    /// engine drawing the desktop rather than an app running on it.
    ///
    /// The socket is the discriminator because it is the one thing we control
    /// and a client cannot spoof: an `xdg_toplevel` app id is set by the
    /// client, and arrives whenever the client feels like sending it — which
    /// is not necessarily before the toplevel it names.
    is_chrome: bool,
}

impl ClientState {
    fn chrome() -> Self {
        ClientState {
            is_chrome: true,
            ..ClientState::default()
        }
    }
}

/// Whether `surface` belongs to the chrome rather than to an app.
fn is_chrome_surface(surface: &WlSurface) -> bool {
    surface
        .client()
        .and_then(|client: Client| client.get_data::<ClientState>().map(|data| data.is_chrome))
        .unwrap_or(false)
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

    /// Who committed `surface`, and the toplevel to configure — the two roles
    /// share every step of a commit except what becomes of the buffer.
    fn committer(&self, surface: &WlSurface) -> Option<(Committer, ToplevelSurface)> {
        if let Some(chrome) = &self.chrome_toplevel {
            if chrome.wl_surface() == surface {
                return Some((Committer::Chrome, chrome.clone()));
            }
        }
        self.toplevels
            .iter()
            .find(|(_, toplevel)| toplevel.wl_surface() == surface)
            .map(|(app_id, toplevel)| (Committer::App(app_id.clone()), toplevel.clone()))
    }

    /// Keep the chrome's latest frame as the texture drawn over the apps.
    ///
    /// Unthrottled, unlike an app's: this is the desktop, and a frame of it
    /// dropped is the whole picture going stale rather than one window's.
    fn publish_chrome_frame(&mut self, buffer: &wl_buffer::WlBuffer, buffer_scale: i32) {
        let Some(committed) = committed_buffer(buffer) else {
            return;
        };
        let texture = self.texture_from(committed, buffer_scale);
        // Once, and again whenever what arrives changes shape. This is the one
        // line that says what the desktop is actually made of — which kind of
        // buffer, at what size, and which way up — and a picture that is the
        // wrong size or upside down is answered here rather than by guessing
        // from what it looks like.
        let shape = texture.as_ref().map(|surface| {
            (
                surface.logical_size,
                surface.y_inverted,
                surface.from_dmabuf,
            )
        });
        if shape != self.chrome_frame_shape {
            self.chrome_frame_shape = shape;
            match shape {
                Some(((width, height), y_inverted, from_dmabuf)) => info!(
                    width,
                    height,
                    y_inverted,
                    dmabuf = from_dmabuf,
                    scale = buffer_scale,
                    "the chrome committed a frame"
                ),
                None => info!("the chrome's frame could not be made into a texture"),
            }
        }
        self.chrome_texture = texture;
        self.needs_present = true;
    }

    /// A committed buffer as a texture to draw, whichever kind it is.
    ///
    /// A dmabuf costs nothing — it *is* the client's buffer. Shared memory
    /// costs an upload, which is still the cheap half of what the copy path
    /// does, and is what a software-rendering client commits.
    fn texture_from(
        &mut self,
        committed: CommittedBuffer,
        buffer_scale: i32,
    ) -> Option<SurfaceTexture> {
        let (width, height) = committed.size();
        let (logical_width, logical_height) = logical_size((width, height), buffer_scale);
        let logical_size = (f64::from(logical_width), f64::from(logical_height));
        let gpu = self.gpu.as_mut()?;
        match committed {
            CommittedBuffer::Gpu(dmabuf) => Some(SurfaceTexture {
                from_dmabuf: true,
                texture: DmabufImporter::import(gpu.renderer(), &dmabuf)
                    .expect("a dmabuf the importer accepted imports"),
                // A client that renders with GL hands the buffer over the way
                // GL made it, and says so on the buffer.
                y_inverted: dmabuf.y_inverted(),
                logical_size,
            }),
            CommittedBuffer::Pixels { rgba, .. } => {
                let size = (
                    i32::try_from(width).unwrap_or(i32::MAX),
                    i32::try_from(height).unwrap_or(i32::MAX),
                );
                match gpu
                    .renderer()
                    .import_memory(&rgba, Fourcc::Abgr8888, size.into(), false)
                {
                    Ok(texture) => Some(SurfaceTexture {
                        from_dmabuf: false,
                        texture,
                        // Shared memory is described the way it is laid out.
                        y_inverted: false,
                        logical_size,
                    }),
                    Err(err) => {
                        tracing::warn!(%err, "a shm buffer would not upload");
                        None
                    }
                }
            }
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
        let due = frame_is_due(
            self.last_frame
                .get(app_id)
                .map(|last| now.duration_since(*last)),
            self.gpu.as_ref().is_some_and(Gpu::presenting),
        );
        if due {
            self.last_frame.insert(app_id.to_string(), now);
            // The GPU readback happens here rather than during classification:
            // it costs a pipeline stall, so a frame the throttle is about to
            // drop is never imported at all.
            let rgba = match committed {
                CommittedBuffer::Pixels { rgba, .. } => rgba,
                CommittedBuffer::Gpu(dmabuf) => self.import_gpu_frame(app_id, dmabuf, buffer_scale),
            };
            if rgba.is_empty() {
                // Presenting: the pixels never left the GPU, so there is
                // nothing to send. The window is where this app appears — but
                // not from here. See `needs_present`.
                self.needs_present = true;
            } else {
                tracing::debug!(%app_id, width, height, bytes = rgba.len(), "broadcast app frame");
                let scale = u32::try_from(buffer_scale).unwrap_or(1).max(1);
                self.hub.send_frame(app_id, width, height, scale, rgba);
            }
        } else {
            self.hub.timings.lock().unwrap().throttled += 1;
        }
    }

    /// Read a client's GPU frame back as RGBA, recording the buffer it came
    /// from against the app's engine texture.
    ///
    /// The readback is the part the CEF bridge deletes: the descriptor stored
    /// here already names the very buffer the engine will sample directly.
    fn import_gpu_frame(&mut self, app_id: &str, dmabuf: Dmabuf, buffer_scale: i32) -> Vec<u8> {
        let gpu = self.gpu.as_mut().expect(
            "a dmabuf can only be committed where the global — and so the renderer — exists",
        );
        // Every dmabuf was imported once already, when the client created it
        // (`DmabufHandler::dmabuf_imported`), so a failure here is not a client
        // handing us something unsupported — it is the renderer breaking.
        let started = Instant::now();
        let rgba = if gpu.presenting() {
            // Presenting: the client's buffer becomes a texture we draw, and
            // nothing is copied. The chrome gets no pixels for this app —
            // there is a hole in the page where the compositor puts it.
            if let Some(surface) =
                self.texture_from(CommittedBuffer::Gpu(dmabuf.clone()), buffer_scale)
            {
                self.textures.insert(app_id.to_string(), surface);
            }
            Vec::new()
        } else {
            DmabufImporter::read_rgba(gpu.renderer(), &dmabuf)
                .expect("a dmabuf the importer accepted reads back")
        };
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

    /// Draw the desktop into the window: every placed app bottom to top, then
    /// the chrome over all of them.
    ///
    /// The apps' geometry is the scene's — `draw_order` gives the stacking the
    /// chrome asked for and `hit_test` resolves, and `surface_to_output` places
    /// each surface exactly where a click on it would land. An app with no
    /// texture yet is skipped rather than drawn empty: it has been announced
    /// but has not committed.
    ///
    /// The chrome goes last and covers the output, and blending is what makes
    /// that work rather than hide everything: it is transparent wherever an
    /// `<app>` element is, so the app below shows through the hole, and opaque
    /// wherever it has drawn a panel. Chrome *below* an app — a wallpaper —
    /// would need a second engine surface, which nothing asks for yet.
    fn present(&mut self) {
        let started = Instant::now();
        let Some(gpu) = self.gpu.as_mut() else {
            return;
        };
        let Some(backend) = gpu.window() else {
            return;
        };
        let size = backend.window_size();
        // The scene is in the chrome's logical units and the window is in
        // device pixels, and on a scaled display those are not the same number.
        let to_window = logical_to_window(self.output_logical, (size.w, size.h));
        let placements: Vec<_> = {
            let host = self.hub.host.lock().unwrap();
            host.scene()
                .draw_order()
                .into_iter()
                .map(|portal| (portal.app_id.clone(), portal.surface_to_output()))
                .collect()
        };
        let mut layers: Vec<_> = placements
            .iter()
            .filter_map(|(app_id, surface_to_output)| {
                let surface = self.textures.get(app_id)?;
                Some(Layer {
                    alpha: 1.0,
                    surface_to_output: surface_to_output.then(to_window),
                    texture: &surface.texture,
                    y_inverted: surface.y_inverted,
                })
            })
            .collect();
        if let Some(chrome) = self.chrome_texture.as_ref() {
            layers.push(Layer {
                alpha: 1.0,
                // At its own size rather than stretched over the output: it is
                // asked to be the output's size, and a chrome that has not
                // taken that size yet should show as a gap it has not filled
                // rather than as a picture quietly scaled to fit.
                surface_to_output: SceneTransform::scale(
                    chrome.logical_size.0,
                    chrome.logical_size.1,
                )
                .then(to_window),
                texture: &chrome.texture,
                y_inverted: chrome.y_inverted,
            });
        }

        let Some(backend) = self.gpu.as_mut().and_then(Gpu::window) else {
            return;
        };
        let Ok((renderer, mut framebuffer)) = backend.bind() else {
            tracing::warn!("could not bind the window for drawing");
            return;
        };
        let drawn = (|| {
            let mut frame = renderer.render(&mut framebuffer, size, output_transform())?;
            frame.clear(
                Color32F::new(0.0, 0.0, 0.0, 1.0),
                &[Rectangle::from_size(size)],
            )?;
            draw_layers(&mut frame, &layers)?;
            frame.finish()
        })();
        drop(framebuffer);
        match drawn {
            Ok(sync) => {
                let _ = sync;
                if let Some(backend) = self.gpu.as_mut().and_then(Gpu::window) {
                    if let Err(err) = backend.submit(None) {
                        tracing::warn!(%err, "could not submit the frame");
                    }
                }
                // Counted after the submit, and only when one happened: a frame
                // that failed to draw is not a frame, and reporting it as one
                // would say the desktop was keeping up while it was blank.
                let mut timings = self.hub.timings.lock().unwrap();
                timings.composited += 1;
                timings.composite.record(started.elapsed());
            }
            Err(err) => tracing::warn!(%err, "could not draw the scene"),
        }
    }

    /// Take the density of the display Domicile's window is on as the output's.
    ///
    /// Without this the chrome renders at whatever scale it was first told —
    /// one — and the host compositor stretches the result over a denser screen.
    /// It does not look like the wrong scale, it looks like a blurry desktop.
    fn adopt_window_scale(&mut self, scale_factor: f64) {
        let physical = self.window_size();
        let scale = output_scale(scale_factor, self.max_scale);
        // The desktop is the window: a client asking how big the screen is
        // should be told what the user dragged the window to, not the size it
        // started at. Without this the scene is mapped through a fixed
        // 1280x800 whatever the window's shape, so a window that is not that
        // shape shows the desktop stretched to fit it.
        let logical = ((physical.0 / scale).max(1), (physical.1 / scale).max(1));
        self.set_output(logical, scale);
    }

    /// Advertise a new output scale, so clients redraw at the resolution the
    /// screen actually has.
    ///
    /// Two things ask for this and they do not agree on who knows best. The
    /// chrome reports its own density, which is the answer where Domicile has
    /// no window of its own — but where it does, that density is a number
    /// *we* gave the chrome, so believing it back would pin the scale at
    /// whatever it started as. The window's is the one that comes from outside.
    fn set_output_scale(&mut self, scale: i32) {
        let logical = self.output_logical;
        self.set_output(logical, scale);
    }

    /// Advertise the desktop's size and density together, because a mode is
    /// both and neither can be changed without restating the other.
    fn set_output(&mut self, logical: (i32, i32), scale: i32) {
        if self.output_logical == logical && self.output.current_scale().integer_scale() == scale {
            return;
        }
        info!(
            width = logical.0,
            height = logical.1,
            scale,
            "advertising output scale"
        );
        self.output_logical = logical;
        // The mode is physical pixels, so it grows with the scale to
        // hold the logical size still: a denser display is a sharper
        // desktop, not a smaller one.
        let mode = OutputMode {
            size: (logical.0 * scale, logical.1 * scale).into(),
            refresh: 60_000,
        };
        self.output
            .change_current_state(Some(mode), None, Some(Scale::Integer(scale)), None);
        self.output.set_preferred(mode);
        // A client only redraws at the new scale once something
        // asks it to, and its own size is unchanged — so re-send
        // the configure it already has to prompt one.
        for (_, toplevel) in &self.toplevels {
            toplevel.send_configure();
        }
        // The chrome covers the desktop, so its size *is* the desktop's and it
        // has to be told when that changes — nothing else will tell it.
        if let Some(chrome) = self.chrome_toplevel.clone() {
            chrome.with_pending_state(|state| {
                state.size = Some(logical.into());
            });
            chrome.send_configure();
        }
    }

    /// Ask the session Domicile's window is in for the cursor a client wants.
    ///
    /// `CursorIcon` is `cursor-icon`'s, which is the type winit takes as well,
    /// so a named shape passes straight through — the two agree on the names
    /// because they are the same names.
    fn apply_window_cursor(&mut self, image: &CursorImageStatus) {
        let Some(backend) = self.gpu.as_mut().and_then(Gpu::window) else {
            return;
        };
        let window = backend.window();
        match image {
            CursorImageStatus::Hidden => window.set_cursor_visible(false),
            CursorImageStatus::Named(icon) => {
                window.set_cursor_visible(true);
                window.set_cursor(Cursor::Icon(*icon));
            }
            // A client that drew its own pointer into a surface. Compositing
            // that surface is the eventual answer; an arrow is the honest
            // stand-in until then, and hiding it instead would lose the pointer.
            CursorImageStatus::Surface(_) => {
                window.set_cursor_visible(true);
                window.set_cursor(Cursor::Icon(CursorIcon::Default));
            }
        }
    }

    /// Give the chrome the keyboard.
    ///
    /// There is one seat, and the chrome and the apps take turns on it: the
    /// chrome holds the keyboard until it says a window has been focused, and
    /// gets it back when it says one has not. A second seat for the chrome
    /// would let both hold a focus at once, but a client does not have to bind
    /// more than one — GTK asserts and Electron drops the connection outright —
    /// so the desktop cannot depend on it.
    ///
    /// Called again when the window is focused as well as when the chrome maps,
    /// because a client that had not bound its keyboard by the time the first
    /// one happened would have missed the enter — and a desktop that ignores
    /// the keyboard looks like one that has hung.
    fn focus_chrome(&mut self) {
        let Some(surface) = self
            .chrome_toplevel
            .as_ref()
            .map(|toplevel| toplevel.wl_surface().clone())
        else {
            return;
        };
        let keyboard = self.seat.get_keyboard().unwrap();
        if keyboard.current_focus().as_ref() == Some(&surface) {
            return;
        }
        info!("the chrome has the window's keyboard");
        let serial = SERIAL_COUNTER.next_serial();
        keyboard.set_focus(self, Some(surface), serial);
    }

    /// Hand the window's own input to the chrome.
    ///
    /// Everything the user does to Domicile's window is the chrome's to
    /// interpret: it is the desktop, it knows where its `<app>` elements are,
    /// and it already forwards what belongs to a client back to us over the
    /// socket. So this delivers to the chrome's surface and stops there — the
    /// compositor does no hit-testing of its own, exactly as when the chrome
    /// was a window in someone else's session.
    fn handle_window_input(&mut self, event: InputEvent<WinitInput>) {
        let Some(surface) = self
            .chrome_toplevel
            .as_ref()
            .map(|toplevel| toplevel.wl_surface().clone())
        else {
            // Input before the chrome has mapped. Dropped rather than queued:
            // a click on a desktop that is not up yet has nothing to land on.
            return;
        };
        // Once per kind, so the log distinguishes the three ways this fails:
        // nothing arrives at all (the window's events are not wired up),
        // something arrives but the chrome has no focus to receive it, or it
        // arrives and is delivered and the chrome does nothing with it.
        let kind = match &event {
            InputEvent::PointerMotionAbsolute { .. } => Some("pointer motion"),
            InputEvent::PointerButton { .. } => Some("pointer button"),
            InputEvent::PointerAxis { .. } => Some("scroll"),
            InputEvent::Keyboard { .. } => Some("key"),
            _ => None,
        };
        if let Some(kind) = kind {
            if self.window_input_seen.insert(kind) {
                let focused = self
                    .seat
                    .get_keyboard()
                    .and_then(|keyboard| keyboard.current_focus())
                    .is_some();
                info!(
                    kind,
                    chrome_has_keyboard = focused,
                    "the window's input reached the compositor"
                );
            }
        }

        let time = self.now_ms();
        match event {
            InputEvent::PointerMotionAbsolute { event } => {
                let window = self.window_size();
                let position = event.position_transformed(window.into());
                let logical = window_to_logical(self.output_logical, (window.0, window.1))
                    .apply(ScenePoint::new(position.x, position.y));
                let (focus, location) = self.pointer_target(logical, &surface);
                let pointer = self.seat.get_pointer().unwrap();
                let serial = SERIAL_COUNTER.next_serial();
                pointer.motion(
                    self,
                    // Anchored at the origin, so the location is already
                    // surface-local: for the chrome that is the desktop's own
                    // coordinate, and for an app the scene has converted it.
                    Some((focus, (0.0, 0.0).into())),
                    &MotionEvent {
                        location: (location.x, location.y).into(),
                        serial,
                        time,
                    },
                );
                pointer.frame(self);
            }
            InputEvent::PointerButton { event } => {
                // Pressing on a window is what focuses it. The pointer's own
                // focus was settled by the motion that got here, so the surface
                // under the pointer is the one the seat is already pointing at.
                if event.state() == ButtonState::Pressed {
                    self.focus_pointed_at();
                }
                let pointer = self.seat.get_pointer().unwrap();
                let serial = SERIAL_COUNTER.next_serial();
                pointer.button(
                    self,
                    &ButtonEvent {
                        button: event.button_code(),
                        state: event.state(),
                        serial,
                        time,
                    },
                );
                pointer.frame(self);
            }
            InputEvent::PointerAxis { event } => {
                let mut frame = AxisFrame::new(time).source(AxisSource::Wheel);
                for axis in [Axis::Horizontal, Axis::Vertical] {
                    if let Some(delta) = event.amount(axis) {
                        frame = frame.value(axis, delta);
                    }
                    if let Some(steps) = event.amount_v120(axis) {
                        frame = frame.v120(axis, steps as i32);
                    }
                }
                let pointer = self.seat.get_pointer().unwrap();
                pointer.axis(self, frame);
                pointer.frame(self);
            }
            InputEvent::Keyboard { event } => {
                let keyboard = self.seat.get_keyboard().unwrap();
                let serial = SERIAL_COUNTER.next_serial();
                // Already an X keycode: the winit backend applies the evdev +8
                // itself, unlike the chrome, which sends evdev and has it added
                // where its keys are injected.
                let key = event.key_code();
                let pressed = event.state() == KeyState::Pressed;
                // The filter runs with the modifier state this key produced, so
                // a claimed combination is taken out of the stream here — before
                // the focused client is given it, which is the only place it can
                // be taken from a window that has the keyboard.
                let grabbed = keyboard.input(
                    self,
                    key,
                    event.state(),
                    serial,
                    time,
                    |state, modifiers, _| {
                        let held = Modifiers {
                            alt: modifiers.alt,
                            ctrl: modifiers.ctrl,
                            shift: modifiers.shift,
                            logo: modifiers.logo,
                        };
                        match state.shortcuts.pressed(key.raw(), held) {
                            // Releases are swallowed too, so a client never sees
                            // half of a chord it was not given the start of.
                            Some(shortcut) => FilterResult::Intercept(pressed.then_some(shortcut)),
                            None => FilterResult::Forward,
                        }
                    },
                );
                if let Some(Some(shortcut)) = grabbed {
                    info!(key = shortcut.key, "a claimed shortcut -> the chrome");
                    self.hub.broadcast(HostMessage::Shortcut { shortcut });
                }
            }
            _ => {}
        }
    }

    /// Where a pointer at `logical` on the desktop belongs, and the coordinate
    /// to deliver it in.
    ///
    /// The compositor does this itself rather than handing every motion to the
    /// chrome and taking its word for where it landed. One seat has one pointer
    /// focus, and two things driving it means the one that moved it last gets
    /// the next click — which is how a window could stop being clickable while
    /// still tracking the mouse. The scene already knows where the windows are;
    /// `route_pointer` is the same lookup the chrome would have done.
    fn pointer_target(&self, logical: ScenePoint, chrome: &WlSurface) -> (WlSurface, ScenePoint) {
        let target = self.hub.host.lock().unwrap().scene().route_pointer(logical);
        match target {
            PointerTarget::App { app_id, local } => match self.surface_for(&app_id) {
                Some(surface) => (surface, local),
                // Placed but not mapped: the chrome laid out an element for a
                // window that has not shown itself yet.
                None => (chrome.clone(), logical),
            },
            PointerTarget::Chrome { screen } => (chrome.clone(), screen),
        }
    }

    /// Give the keyboard to whatever the pointer is over.
    fn focus_pointed_at(&mut self) {
        let Some(surface) = self
            .seat
            .get_pointer()
            .and_then(|pointer| pointer.current_focus())
        else {
            return;
        };
        let keyboard = self.seat.get_keyboard().unwrap();
        if keyboard.current_focus().as_ref() == Some(&surface) {
            return;
        }
        let app_id = self
            .toplevels
            .iter()
            .find(|(_, toplevel)| toplevel.wl_surface() == &surface)
            .map(|(app_id, _)| app_id.clone());
        match &app_id {
            Some(app_id) => {
                info!(%app_id, "clicked -> the window has the keyboard");
                // Through the brain rather than around it, so the click also
                // raises the window — the same thing the chrome's own focus
                // message does, because it is the same message.
                let mut host = self.hub.host.lock().unwrap();
                let mut ready = true;
                let _ = apply_chrome_message(
                    &mut host,
                    &mut ready,
                    ChromeMessage::FocusApp {
                        app_id: app_id.clone(),
                    },
                );
            }
            None => info!("clicked -> the chrome has the keyboard"),
        }
        let serial = SERIAL_COUNTER.next_serial();
        keyboard.set_focus(self, Some(surface), serial);
    }

    /// The window's size in device pixels, or the output's logical size where
    /// there is no window — which only happens headless, where nothing asks.
    fn window_size(&mut self) -> (i32, i32) {
        self.gpu
            .as_mut()
            .and_then(Gpu::window)
            .map(|backend| {
                let size = backend.window_size();
                (size.w, size.h)
            })
            .unwrap_or(self.output_logical)
    }

    /// Inject a forwarded input event into the appropriate client via the seat.
    fn handle_client_request(&mut self, event: ClientRequest) {
        // Where Domicile presents, it routes the pointer itself from the
        // window's own events — see `pointer_target`. The chrome's forwarded
        // pointer is the copy path's mechanism, and a second thing driving one
        // focus is how a window ends up tracking the mouse but never receiving
        // the click: whichever moved the focus last got it.
        if self.gpu.as_ref().is_some_and(Gpu::presenting)
            && matches!(
                event,
                ClientRequest::PointerMotion { .. }
                    | ClientRequest::PointerLeave
                    | ClientRequest::PointerButton { .. }
                    | ClientRequest::PointerAxis { .. }
            )
        {
            return;
        }
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
                let requested = match &app_id {
                    Some(id) => self.surface_for(id),
                    None => None,
                };
                if let Some(id) = &app_id {
                    if requested.is_some() {
                        info!(app_id = %id, "keyboard focus -> client");
                    } else {
                        // The chrome asked for a window that has no surface —
                        // one that closed while the message was in flight, or
                        // has not mapped yet. Handing the keyboard to nothing
                        // here is what makes a desktop go permanently deaf,
                        // because nothing afterwards takes it back.
                        info!(app_id = %id, "keyboard focus -> a window with no surface; the chrome keeps it");
                    }
                }
                // The chrome is the fallback for every case: no window asked
                // for, or one that cannot have it. The keyboard belongs
                // somewhere as long as there is a desktop to hold it.
                let surface = requested.or_else(|| {
                    self.chrome_toplevel
                        .as_ref()
                        .map(|toplevel| toplevel.wl_surface().clone())
                });
                let keyboard = self.seat.get_keyboard().unwrap();
                let serial = SERIAL_COUNTER.next_serial();
                keyboard.set_focus(self, surface, serial);
            }
            ClientRequest::GrabShortcut { shortcut } => {
                info!(key = shortcut.key, "the chrome claimed a shortcut");
                self.shortcuts.grab(shortcut);
            }
            ClientRequest::SetOutputScale { scale } => self.set_output_scale(scale),
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
/// A client's latest surface, as something to draw.
struct SurfaceTexture {
    texture: GlesTexture,
    /// Whether the client handed over a GPU buffer or shared memory. Recorded
    /// for the log: it is the difference between a frame that cost nothing and
    /// one that cost an upload, and it is not visible in the picture.
    from_dmabuf: bool,
    /// See [`Layer::y_inverted`]. Smithay records this on the texture but does
    /// not expose it, so it is kept from where the buffer said so.
    y_inverted: bool,
    /// The surface's own size in logical units, which is the box it is drawn
    /// into. Not the output's: a client that has not answered a configure yet
    /// is still its old size, and stretching it to the output would hide that
    /// rather than show it.
    logical_size: (f64, f64),
}

/// Which of the two kinds of client committed a buffer.
#[derive(Debug)]
enum Committer {
    /// A window on the desktop, named by the id the host gave it.
    App(String),
    /// The engine drawing the desktop itself.
    Chrome,
}

/// Whether a reporting window saw anything worth a line.
///
/// An idle desktop should not fill the log, but "idle" has to mean idle on
/// *either* path. Counting only what the copy path produces leaves the native
/// one silent however hard it is working — which is what happened the moment
/// the throttle stopped firing, and it read as a compositor doing nothing
/// rather than as instrumentation that could not see it.
fn worth_reporting(sent: usize, dropped: usize, throttled: usize, composited: usize) -> bool {
    sent > 0 || dropped > 0 || throttled > 0 || composited > 0
}

/// Whether a client's commit should be drawn, or dropped on the floor.
///
/// The throttle is the copy path's, and it exists for the socket: a frame is
/// megabytes, and a chrome that reads slowly is a chrome whose socket fills
/// within a frame or two. Dropping one costs nothing there, because the next
/// supersedes it.
///
/// Presenting, there is no socket and no chrome — the client's buffer is
/// imported and drawn, which costs a texture bind and a quad. Throttling that
/// is not protecting anything; it is refusing half the frames a client drew and
/// holding a stale desktop between them. Measured: kitty committing ~59 times a
/// second had ~29 of them composited, for nothing.
fn frame_is_due(since_last: Option<Duration>, presenting: bool) -> bool {
    if presenting {
        return true;
    }
    since_last.map_or(true, |elapsed| elapsed >= Duration::from_millis(33))
}

/// Whether this commit can be the answer to a keystroke we forwarded.
///
/// Only a window can: a keystroke goes to the focused *client*, and the frame
/// that answers it is that client's. The chrome repaints constantly and for
/// reasons of its own — a clock ticking is enough — so letting its commits
/// consume the pending keystroke would report the clock's interval as the time
/// the user waited, and the real answer would go uncounted.
fn answers_keystroke(committer: &Committer) -> bool {
    match committer {
        Committer::App(_) => true,
        Committer::Chrome => false,
    }
}

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
        let Some((committer, toplevel)) = self.committer(surface) else {
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
                // Nor is a commit by the chrome, which repaints on its own and
                // is not where the keystroke went.
                if answers_keystroke(&committer) {
                    if let Some(keyed) = self.pending_key.take() {
                        timings.response.record(started.duration_since(keyed));
                    }
                }
            }
            match &committer {
                Committer::App(app_id) => self.publish_frame(app_id, &buffer, buffer_scale),
                Committer::Chrome => self.publish_chrome_frame(&buffer, buffer_scale),
            }
            // The client may redraw into this buffer the instant it is
            // released, so the release comes after the pixels are out of it —
            // and it happens even for a frame the throttle dropped, or a
            // single-buffered client never draws again.
            buffer.release();
            tracing::debug!(?committer, "buffer released");
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
        let gpu = self
            .gpu
            .as_mut()
            .expect("the dmabuf global is only advertised alongside a renderer");
        if DmabufImporter::accepts(gpu.renderer(), &dmabuf) {
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
        // Where Domicile has a window it is a client of the session it is
        // running in, and the pointer the user sees is that session's. Asking
        // for it is the only way the cursor ever changes: a client of ours
        // setting one is a request we have to pass on, not something the user
        // can see by itself.
        self.apply_window_cursor(&image);

        // And the chrome, which draws the pointer itself on the copy path.
        if let Some(app_id) = self.pointer_app.clone() {
            let cursor = match image {
                CursorImageStatus::Hidden => CursorShape::None,
                CursorImageStatus::Named(icon) => cursor_shape(icon),
                // The client drew its own cursor into a surface. Mirroring
                // those pixels needs native compositing (see WINDOW-COMPOSITING.md), so
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
        // The chrome's own window is not a window *on* the desktop, so none of
        // the below applies to it: announcing it would have the chrome mount an
        // <app> element for itself, inside itself.
        if is_chrome_surface(surface.wl_surface()) {
            info!("the chrome mapped its toplevel -> compositing it over the apps");
            self.output.enter(surface.wl_surface());
            // It covers the desktop, because it *is* the desktop. A size it did
            // not ask for is exactly what a compositor gives a fullscreen
            // window, and the portals it reports back are in these units.
            surface.with_pending_state(|state| {
                state.size = Some(self.output_logical.into());
            });
            self.chrome_toplevel = Some(surface);
            self.focus_chrome();
            return;
        }

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
        if self
            .chrome_toplevel
            .as_ref()
            .is_some_and(|chrome| chrome.wl_surface() == surface.wl_surface())
        {
            info!("the chrome's toplevel went away");
            self.chrome_toplevel = None;
            self.chrome_texture = None;
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
            self.last_frame.remove(&app_id);
            self.bridge.remove(&app_id);
            self.latest_dmabufs.remove(&app_id);
            self.textures.remove(&app_id);
            if self.pointer_app.as_deref() == Some(app_id.as_str()) {
                self.pointer_app = None;
            }
            let closed = self.hub.host.lock().unwrap().app_closed(&app_id);
            info!(%app_id, "toplevel destroyed -> Host::app_closed");
            if let Some(closed) = closed {
                self.hub.broadcast(closed);
            }
            // The window that had the keyboard has gone, and a keyboard with
            // nowhere to go is a desktop that has stopped listening. The chrome
            // will usually ask for it back — but it does not have to, and a
            // client that crashed rather than closed never got the chance, so
            // the compositor is the one that has to guarantee this.
            self.focus_chrome();
        }
    }

    fn new_popup(&mut self, surface: PopupSurface, positioner: PositionerState) {
        // A popup cannot attach a buffer until it has been configured, so a
        // compositor that ignores one leaves the client waiting — and a client
        // waiting on its own menu is a client that has stopped answering
        // anything. The same shape of hang as the missing data device, and just
        // as invisible: nothing errors, it simply never appears.
        //
        // The positioner's own geometry is taken as given. Constraining a popup
        // to the output is what the flags are for and is not done here; the
        // menus that exist are small and near where they were asked for.
        surface.with_pending_state(|state| {
            state.geometry = positioner.get_geometry();
            state.positioner = positioner;
        });
        if let Err(err) = surface.send_configure() {
            tracing::warn!(%err, "could not configure a popup");
        }
    }

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

// ---- data device: drag-and-drop, and the clipboard ------------------------

impl SelectionHandler for DomicileCompositor {
    type SelectionUserData = ();
}

impl ClientDndGrabHandler for DomicileCompositor {}
impl ServerDndGrabHandler for DomicileCompositor {}

impl DataDeviceHandler for DomicileCompositor {
    fn data_device_state(&self) -> &DataDeviceState {
        &self.data_device_state
    }
}

delegate_data_device!(DomicileCompositor);

// ---- boot -----------------------------------------------------------------

/// Which way up the window is drawn.
///
/// Over. Smithay's projection sends output-y=0 to NDC -1, which is GL's
/// *bottom*, and on a window that is the bottom of what the user sees — so
/// drawn as-is the whole desktop is upside down. Settled on a display, because
/// nothing without one can: reading a buffer back is consistent either way, and
/// the offscreen tests pass under both.
///
/// `Flipped180` is a reflection in the horizontal axis, not a rotation, so the
/// left of the desktop stays on the left. Pointer coordinates need no matching
/// change: winit's y grows downward and so does the output's, which is what
/// makes the two agree once the picture is the right way up.
fn output_transform() -> Transform {
    Transform::Flipped180
}

/// The display name the chrome connects on, given ours.
///
/// A separate socket rather than a flag, so that "this client is the chrome" is
/// something the compositor knows rather than something a client claims.
fn chrome_display(socket_name: &OsStr) -> String {
    format!("{}-chrome", socket_name.to_string_lossy())
}

/// Spawn a client process onto Domicile's display.
///
/// A reaper thread waits on the child so it doesn't become a zombie.
fn spawn_client(command: &[String], wayland_display: &OsStr) {
    let Some(mut child) = client_command(command, wayland_display) else {
        return;
    };
    info!(?command, ?wayland_display, "spawning client");
    match child.spawn() {
        Ok(mut child) => {
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(err) => tracing::error!(%err, ?command, "failed to spawn client"),
    }
}

/// The command a spawned client runs under.
///
/// `WAYLAND_DISPLAY` is set on the child rather than left to the compositor's
/// own environment. When Domicile presents to a window it is itself a client of
/// the session it was started from, so it must keep that session's
/// `WAYLAND_DISPLAY` to reach it — and a client that inherited it would open on
/// the host desktop instead of on Domicile. `DISPLAY` is removed so a toolkit
/// with both backends prefers Wayland over any outer X server.
fn client_command(command: &[String], wayland_display: &OsStr) -> Option<Command> {
    let (program, args) = command.split_first()?;
    let mut child = Command::new(program);
    child
        .args(args)
        .env("WAYLAND_DISPLAY", wayland_display)
        .env_remove("DISPLAY");
    Some(child)
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
    main_device: Option<u64>,
    formats: Vec<smithay::backend::allocator::Format>,
) -> DmabufGlobal {
    let feedback = main_device.and_then(|device| {
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

/// Whether to open a window and draw client surfaces into it, rather than
/// copying them out to the chrome.
///
/// `--present`, or `DOMICILE_PRESENT=1`. Off by default: the headless
/// compositor is what the e2e scripts drive and what a machine with no display
/// can run at all.
fn presenting() -> bool {
    std::env::args().skip(1).any(|arg| arg == "--present")
        || std::env::var_os("DOMICILE_PRESENT").is_some_and(|value| value == "1")
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
    let data_device_state = DataDeviceState::new::<DomicileCompositor>(&dh);
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

    // Bind the Wayland socket before anything can ask us to put a client on
    // it. A chrome that connects the moment its own socket appears may send a
    // `spawn` straight away, and a client spawned with no display of ours to
    // name would land on whichever session we inherited. Inserting the source
    // into the event loop happens later; binding is what reserves the name.
    let source = ListeningSocketSource::new_auto()?;
    let socket_name = source.socket_name().to_os_string();
    // A second socket, for the chrome alone. Which socket a client arrived on
    // is how the compositor knows the engine drawing the desktop from an app
    // running on it — see `ClientState::is_chrome`. Naming it after the first
    // means one lookup gives both.
    let chrome_socket_name = chrome_display(&socket_name);
    let chrome_source = ListeningSocketSource::with_name(&chrome_socket_name)?;
    // One line each, and each naming only its own display: a script reading
    // these back has to be able to tell them apart, and two values on one line
    // are two values a pattern for either can match.
    info!(
        display = ?socket_name,
        "domicile-compositor: apps connect here (WAYLAND_DISPLAY)"
    );
    info!(
        display = ?chrome_socket_name,
        "domicile-compositor: the chrome connects here (WAYLAND_DISPLAY)"
    );

    // Forward input from the chrome onto the Wayland thread via a channel.
    let (request_tx, request_rx) = channel::<ClientRequest>();

    // Shared brain, driven by both the Wayland side and chrome connections.
    let (hub, outbound_rx) = ChromeHub::new(
        request_tx,
        config.output.max_scale,
        socket_name.clone(),
        presenting(),
    );
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
    // Presenting is opt-in. Headless is what every e2e script drives and what
    // a machine with no display can run, so a window is something you ask for
    // rather than something that happens to you.
    let mut window_events = None;
    let mut gpu = if presenting() {
        match smithay::backend::winit::init::<GlesRenderer>() {
            Ok((backend, events)) => {
                info!(size = ?backend.window_size(), "presenting to a window");
                window_events = Some(events);
                Some(Gpu {
                    importer: DmabufImporter::for_existing_renderer(),
                    output: GpuOutput::Window(Box::new(backend)),
                })
            }
            Err(err) => {
                tracing::error!(%err, "--present was asked for but no window could be opened");
                return Err(err.into());
            }
        }
    } else {
        match headless_renderer() {
            Ok((renderer, importer)) => Some(Gpu {
                importer,
                output: GpuOutput::Headless(Box::new(renderer)),
            }),
            Err(err) => {
                tracing::warn!(%err, "no EGL renderer: serving wl_shm clients only");
                None
            }
        }
    };
    let mut dmabuf_state = DmabufState::new();
    let dmabuf_global = gpu.as_mut().map(|gpu| {
        let importer_device = gpu.importer.main_device();
        let formats: Vec<_> = DmabufImporter::formats(gpu.renderer())
            .into_iter()
            .collect();
        advertise_dmabuf(&mut dmabuf_state, &dh, importer_device, formats)
    });

    let state = DomicileCompositor {
        compositor_state: CompositorState::new::<DomicileCompositor>(&dh),
        xdg_shell_state: XdgShellState::new::<DomicileCompositor>(&dh),
        shm_state: ShmState::new::<DomicileCompositor>(&dh, vec![]),
        seat_state,
        data_device_state,
        seat,
        output_manager_state,
        output,
        // Modern toolkits ask for cursors by name through this global, which
        // maps straight onto CSS cursor keywords.
        cursor_shape_state: CursorShapeManagerState::new::<DomicileCompositor>(&dh),
        dmabuf_state,
        dmabuf_global,
        gpu,
        hub,
        bridge: BridgeRegistry::new(),
        latest_dmabufs: HashMap::new(),
        textures: HashMap::new(),
        toplevels: Vec::new(),
        pointer_app: None,
        start: Instant::now(),
        last_frame: HashMap::new(),
        last_commit: None,
        pending_key: None,
        chrome_toplevel: None,
        chrome_texture: None,
        chrome_frame_shape: None,
        max_scale: config.output.max_scale,
        output_logical: OUTPUT_LOGICAL_SIZE,
        shortcuts: Shortcuts::default(),
        needs_present: false,
        window_input_seen: HashSet::new(),
        stop: Arc::new(AtomicBool::new(false)),
    };

    let mut data = CalloopData { display, state };

    // Start accepting on the sockets bound above.
    let handle = event_loop.handle();
    handle.insert_source(source, move |stream, _, data: &mut CalloopData| {
        data.display
            .handle()
            .insert_client(stream, Arc::new(ClientState::default()))
            .expect("failed to insert client");
    })?;
    handle.insert_source(chrome_source, move |stream, _, data: &mut CalloopData| {
        data.display
            .handle()
            .insert_client(stream, Arc::new(ClientState::chrome()))
            .expect("failed to insert the chrome");
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

    // The window's own events: what the user does to Domicile rather than what
    // a chrome asked us to do. Without this the window is a picture — it draws
    // and it never hears anything, which looks exactly like a compositor that
    // has frozen.
    // The window's density before anything is drawn, so the chrome is told the
    // truth on its very first frame rather than after the first resize.
    if let Some(scale_factor) = data
        .state
        .gpu
        .as_mut()
        .and_then(Gpu::window)
        .map(|backend| backend.scale_factor())
    {
        data.state.adopt_window_scale(scale_factor);
    }

    if let Some(events) = window_events {
        handle.insert_source(events, |event, _, data: &mut CalloopData| match event {
            WinitEvent::Input(input) => data.state.handle_window_input(input),
            // The window changed size or density, so everything drawn in it
            // is wrong until the next frame — and nothing else is going to ask
            // for one, because a resize is not a client commit.
            WinitEvent::Resized { scale_factor, .. } => {
                data.state.adopt_window_scale(scale_factor);
                data.state.needs_present = true;
            }
            WinitEvent::Redraw => data.state.needs_present = true,
            WinitEvent::CloseRequested => data.state.stop.store(true, Ordering::SeqCst),
            // A window that has just been given the keyboard: assert the
            // chrome's focus, in case it bound its keyboard after mapping.
            WinitEvent::Focus(true) => data.state.focus_chrome(),
            WinitEvent::Focus(false) => {}
        })?;
    }

    // Flush after every loop iteration so events queued while handling input
    // (which arrives off the wayland fd) reach clients promptly.
    let stop = data.state.stop.clone();
    let signal = event_loop.get_signal();
    event_loop.run(None, &mut data, move |data| {
        if std::mem::take(&mut data.state.needs_present) {
            data.state.present();
        }
        let _ = data.display.flush_clients();
        if stop.load(Ordering::SeqCst) {
            signal.stop();
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};
    use std::time::Duration;

    use smithay::input::pointer::CursorIcon;

    use domicile_protocol::CursorShape;

    use super::{
        answers_keystroke, bgra_to_rgba, client_command, cursor_shape, frame_is_due, Committer,
    };

    /// What a spawned client would find in its environment for `name`, where
    /// `None` is the variable being cleared rather than left alone.
    fn child_env(command: &[String], display: &str, name: &str) -> Option<OsString> {
        client_command(command, OsStr::new(display))
            .expect("a command with a program builds")
            .get_envs()
            .find(|(key, _)| *key == OsStr::new(name))
            .map(|(_, value)| value.map(OsStr::to_os_string))
            .expect("the variable is one this sets or clears")
    }

    fn kitty() -> Vec<String> {
        vec!["kitty".to_string()]
    }

    #[test]
    fn a_spawned_client_is_pointed_at_our_display_not_the_one_we_inherited() {
        // The compositor keeps the session's own WAYLAND_DISPLAY, because
        // presenting to a window means being a client of it. A child left to
        // inherit that opens on the host desktop rather than on Domicile,
        // which looks like a compositor that is not compositing.
        assert_eq!(
            child_env(&kitty(), "wayland-7", "WAYLAND_DISPLAY"),
            Some(OsString::from("wayland-7")),
        );
    }

    #[test]
    fn a_spawned_client_gets_no_x_display() {
        assert_eq!(child_env(&kitty(), "wayland-7", "DISPLAY"), None);
    }

    #[test]
    fn a_clients_first_frame_is_always_due() {
        assert!(frame_is_due(None, false));
    }

    #[test]
    fn the_copy_path_drops_a_frame_that_came_too_soon() {
        // The socket is what this protects: a frame is megabytes, and the next
        // one supersedes the one dropped.
        assert!(!frame_is_due(Some(Duration::from_millis(5)), false));
        assert!(frame_is_due(Some(Duration::from_millis(40)), false));
    }

    #[test]
    fn presenting_draws_every_frame_a_client_commits() {
        // Nothing is being protected: there is no socket and no chrome, and the
        // client's own buffer costs a bind and a quad. Refusing it holds a
        // stale desktop for no reason — measured at half of kitty's frames.
        assert!(frame_is_due(Some(Duration::from_millis(1)), true));
    }

    #[test]
    fn a_window_can_be_the_answer_to_a_keystroke() {
        assert!(answers_keystroke(&Committer::App("term".to_string())));
    }

    #[test]
    fn the_chromes_own_repaint_is_not_an_answer_to_a_keystroke() {
        // The chrome repaints on its own — a clock ticking is enough — and it
        // is not where a forwarded keystroke went. Counting its commits would
        // report the clock's interval as the time the user waited, and leave
        // the real answer uncounted.
        assert!(!answers_keystroke(&Committer::Chrome));
    }

    #[test]
    fn an_empty_command_spawns_nothing() {
        assert!(client_command(&[], OsStr::new("wayland-7")).is_none());
    }

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
