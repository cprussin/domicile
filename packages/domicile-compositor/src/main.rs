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
use smithay::reexports::winit::dpi::LogicalSize;
use smithay::reexports::winit::window::Cursor;
use smithay::reexports::winit::window::Window as WinitWindow;
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
        Damage, SurfaceAttributes,
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
use tracing::{debug, info, warn};

mod bands;
mod chrome_frame;
mod coalesce;
mod compose;
mod damage;
mod dmabuf_descriptor;
mod dmabuf_import;
mod modifiers;
mod outbound;
mod scale;
mod screens;
mod shortcut;
mod stacking;
mod straight_alpha;
mod timing_window;

use crate::bands::{Bands, Layered, Next};
use crate::chrome_frame::{what_arrived, Arrival, Buffer};
use crate::coalesce::last_of_burst;
use crate::compose::chrome_onto_output;
use crate::compose::shadow_quad;
use crate::compose::{draw_layers, logical_to_window, window_to_logical, Layer, Shaders, Shadow};
use crate::damage::{covered, Look, Painted};
use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_import::{headless_renderer, DmabufImporter};
use crate::modifiers::{Held, Modifiers};
use crate::outbound::{outbound, Outbound, OutboundReceiver, OutboundSender};
use crate::scale::{logical_size, output_scale};
use crate::screens::{Advertised, Screens, Slot};
use crate::shortcut::Shortcuts;
use crate::timing_window::TimingWindow;
use domicile_bridge::BridgeRegistry;
use domicile_config::{Config, ConfigError, ConfigStore};
use domicile_host::ipc::{apply_chrome_message, parse_chrome, to_line};
use domicile_host::Host;
use domicile_launch::arguments::arguments;
use domicile_launch::session::{publish, Session};
use domicile_protocol::band_label::band_in;
use domicile_protocol::{ChromeMessage, CursorShape, HostMessage, Shortcut};
use domicile_scene::{
    Point as ScenePoint, PointerTarget, Scene, Style as SceneStyle, Transform as SceneTransform,
};
use smithay::backend::renderer::gles::{GlesRenderer, GlesTexture};
use smithay::backend::renderer::{
    Color32F, ExportMem as _, Frame as _, ImportMem as _, Renderer as _, Texture as _,
};
use smithay::backend::winit::WinitGraphicsBackend;

/// The log messages *this change's* scripts and tests grep for, pinned to them.
///
/// Each is the only trace some code path leaves, so a script asserts on the
/// *spelling*. Renaming one in place leaves the script passing on the arms a
/// clean run takes and lying on the arm it does not — a verdict against the
/// compositor for a string that moved.
///
/// `the_grepped_log_messages_are_what_the_scripts_expect` reads the scripts
/// themselves, so a rename here fails against the file that has to agree with
/// it rather than against a second copy in this one, which would rename along
/// with the first. `tests/desktop.rs` spells one of these out too, and is not
/// read by that test — but it lives in another file, so no rename catches both
/// at once and the disagreement still surfaces as a failure.
///
/// Three of at least nine: `e2e-chrome-layer.sh` and `e2e-dmabuf.sh` grep for
/// `toplevel mapped`, `broadcast app frame`, `chrome client connected` and
/// more, none of them named or pinned. Those predate this change; these three
/// are the ones it introduced or newly depended on.
mod grepped {
    /// `e2e-hidpi.sh`: told a density it could not read.
    pub const UNPARSEABLE: &str = "unparseable chrome message";
    /// `tests/desktop.rs::a_described_desktop_refuses_a_chromes_density`: the
    /// guarded return in `set_output_scale`.
    ///
    /// No script greps this any more — `e2e-two-displays.sh` was the last, and
    /// it is gone. What pins it now is a Rust test that spells the string,
    /// which is a weaker arrangement in one specific way: a rename here and in
    /// that test together are one edit a reviewer sees whole, where a script
    /// was a second file that had to be remembered. Kept a constant because
    /// the wait is still a wait on a string, and a string with a name is
    /// easier to find than one written twice.
    pub const DENSITY_REFUSED: &str = "a described desktop keeps its own scale";
    /// `e2e-hidpi.sh`: the logical size it derives the expected mode from.
    pub const ADVERTISING: &str = "advertising output scale";
    /// `e2e-bands.sh`: a chrome frame recognised as the band it says it is.
    /// The only trace the label's read-back leaves, and the whole of what says
    /// the round trip closed rather than stalled.
    pub const BAND_ANSWERED: &str = "a band answered";
}

/// The renderer client buffers are imported on, and the policy that chose it.
///
/// One renderer serves both importing and — once the compositor presents —
/// drawing, because a texture belongs to the EGL context that created it.
struct Gpu {
    output: GpuOutput,
    importer: DmabufImporter,
    /// Compiled against this renderer, because a program belongs to the
    /// context that built it. `None` where there is no window: the copy path
    /// draws nothing and would only be paying the compile.
    shaders: Option<Shaders>,
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

/// The last frame an app drew, kept so the compositor can give it to the
/// chrome again.
///
/// Two forms because there are two kinds of client and the difference survives
/// all the way here. A GPU client's buffer is held as the buffer — the
/// descriptor the bridge hands the engine names this very allocation, so its
/// plane fds have to stay open anyway, and its pixels are read back only if
/// somebody asks. A software client's pixels have already been read, and are
/// shared rather than copied: the same allocation is on its way to the chrome.
enum LastFrame {
    Gpu {
        dmabuf: Dmabuf,
        buffer_scale: i32,
    },
    Pixels {
        rgba: Arc<Vec<u8>>,
        width: u32,
        height: u32,
        scale: u32,
    },
}

/// One band of the chrome, drawn whole at the depth it was declared at.
///
/// Unclipped, unlike a `stacking` band: this raster holds only that depth, so
/// there is nothing of another depth in it to confine away.
fn band_layer<'a>(texture: &'a SurfaceTexture, to_window: SceneTransform) -> Layer<'a> {
    Layer {
        alpha: 1.0,
        clip: &[],
        corner_radius: 0.0,
        shadow: None,
        surface_to_output: chrome_onto_output(texture.logical_size, to_window),
        texture: &texture.texture,
        y_inverted: texture.y_inverted,
    }
}

/// One window as the scene placed it: where its surface goes, how it is
/// styled, whether its chrome asked for it to be drawn natively, and how deep
/// it sits — the last so the chrome can be interleaved with it rather than
/// only drawn over it. See `stacking`.
type Placed = (String, SceneTransform, SceneStyle, bool, i32);

/// One placed window, and whether the compositor is in fact the one drawing
/// it — which is not the same as its chrome having asked for that.
type Drawn<'a> = (&'a str, bool);

/// Keep a frame against whatever this app last drew, and hand back the pixels
/// to send.
///
/// A software client's pixels are all anybody has: it is never drawn natively,
/// so nothing can produce them a second time, and a window whose element moves
/// in the page loses its canvas and needs them back. They are kept, and the
/// same allocation does both jobs — a copy per frame, to cover a gesture,
/// would cost more than the gesture is worth.
///
/// A GPU client's frame leaves nothing, because it has already left something
/// better. `import_gpu_frame` keeps the buffer itself, which is both cheaper
/// than its pixels and the allocation the bridge's descriptor names — its
/// plane fds have to stay open for as long as that descriptor does. Replacing
/// it with a copy of the same frame's pixels would drop the buffer to gain
/// nothing but a readback that [`pixels_to_hand_over`] performs on demand.
///
/// The map is a parameter rather than the caller's business because the
/// keeping and the sending have to happen together. Handed back as two values
/// for the caller to use as it liked, the keeping was the half a refactor
/// could drop in silence — and did, through three revisions of this change, in
/// each of which reverting the fix left every test passing.
fn keep_frame(
    latest: &mut HashMap<String, LastFrame>,
    app_id: &str,
    from_gpu: bool,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    scale: u32,
) -> Arc<Vec<u8>> {
    let rgba = Arc::new(rgba);
    if !from_gpu {
        latest.insert(
            app_id.to_string(),
            LastFrame::Pixels {
                rgba: Arc::clone(&rgba),
                width,
                height,
                scale,
            },
        );
    }
    rgba
}

/// The pixels to hand the chrome for whatever this app last drew.
///
/// A software client's are already read, and are handed on as they are — that
/// is what keeping them bought. A GPU client's are still on the card, so
/// producing them costs whatever `read_back` costs, which is a pipeline stall
/// on the Wayland thread and the reason a caller asks whether the chrome has
/// room before calling this at all.
fn pixels_to_hand_over(
    last: &LastFrame,
    read_back: impl FnOnce(&Dmabuf) -> Vec<u8>,
) -> (Arc<Vec<u8>>, u32, u32, u32) {
    match last {
        LastFrame::Pixels {
            rgba,
            width,
            height,
            scale,
        } => (Arc::clone(rgba), *width, *height, *scale),
        LastFrame::Gpu {
            dmabuf,
            buffer_scale,
        } => (
            Arc::new(read_back(dmabuf)),
            dmabuf.width(),
            dmabuf.height(),
            u32::try_from(*buffer_scale).unwrap_or(1).max(1),
        ),
    }
}

/// Which of these windows the compositor is actually drawing.
///
/// Two things have to be true, and the placement is only one of them. A
/// `wl_shm` client's pixels live in main memory and are never imported as a
/// texture, so `present()` draws nothing for that window however ordinary its
/// element's CSS — and reading the placement alone would call it drawn, and
/// leave it blank the moment its element moved in the page and took its canvas
/// with it. Having the texture is what says the compositor can draw it; the
/// placement says whether it should.
fn drawn_by_the_compositor<'a>(
    placed: &'a [Placed],
    has_texture: impl Fn(&str) -> bool,
) -> Vec<Drawn<'a>> {
    placed
        .iter()
        .map(|(app_id, _, _, natively, _)| (app_id.as_str(), *natively && has_texture(app_id)))
        .collect()
}

/// The app whose element this message says has stopped showing it, if it does.
///
/// The compositor cannot see the page, so it keeps its own record of which
/// windows the chrome holds a canvas for. `remove_portal` is what takes a
/// canvas away without the compositor asking: an element unmounted, or one
/// whose `app-id` changed to another window. Both drop their pixels, and the
/// second has to — they are the *previous* app's, and nothing would ever
/// correct them, because the message that clears a canvas is only sent to a
/// window whose pixels we sent under that name.
///
/// A window merely *hidden* is emphatically not that, and reading it as such
/// is a bug with a long fuse. The shell keeps every window mounted and toggles
/// `hidden`, which reaches the host as a placement with `visible: false` and
/// takes the portal out of the scene — while the element, and the canvas
/// holding that window's last frame, stay exactly where they were. Forgetting
/// the canvas then means never telling the chrome to drop it, so a window
/// backgrounded on the copy path and brought back native wears a still of
/// itself for good.
fn unmounts_the_element(message: &ChromeMessage) -> Option<&str> {
    match message {
        ChromeMessage::RemovePortal { app_id } => Some(app_id),
        _ => None,
    }
}

/// What came of offering one window's pixels to the chrome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HandOver {
    /// The chrome has them, and will not be offered them again. Carries the
    /// buffer size they were sent at, because that is what the chrome's canvas
    /// is now sized to — and recording that it holds a frame without recording
    /// which size is what let the two records drift apart.
    Sent { size: (u32, u32) },
    /// The chrome is behind and the frame was dropped. Offer them again.
    Refused,
    /// Announced but never committed: there is nothing to offer yet.
    NothingToSend,
}

/// Offer their pixels to the chrome for every window that has just left the
/// native path.
///
/// A window changes paths because the *page* changed: a filter appears on the
/// element in front of a client that knows nothing about it and may never draw
/// again. Nothing else would send that client's pixels to the chrome, and
/// until something does the window is a hole in the page with nothing behind
/// it — the compositor has stopped drawing it and the engine has no canvas to
/// draw instead.
///
/// The question is "does the chrome have this window's pixels, and can I give
/// them to it" — not "has this window changed paths". Those were the same set
/// until a window could lose its canvas without changing paths at all, and a
/// `wl_shm` client is never in the second set however ordinary its CSS: its
/// pixels never reach a texture, so the chrome draws that window always.
///
/// `held` is what stops this firing on every presented frame: a window the
/// chrome draws would otherwise be read back once per composite as well as
/// once per client commit, which is the readback the native path exists to
/// avoid, twice over. It holds only what the chrome was actually given — a
/// dropped frame is not a hand-over, and a window recorded on the strength of
/// one is a hole nothing ever fills again.
///
/// What is deliberately *not* here is any inference from a window being absent
/// from the scene. A backgrounded window leaves the scene while its element,
/// and its canvas, stay in the page — see [`unmounts_the_element`].
fn hand_over(
    windows: &[Drawn],
    held: &mut HashMap<String, (u32, u32)>,
    mut offer: impl FnMut(&str) -> HandOver,
) -> Refusals {
    let mut refused = false;
    for (app_id, drawn_here) in windows {
        if !drawn_here && !held.contains_key(*app_id) {
            match offer(app_id) {
                HandOver::Sent { size } => {
                    held.insert((*app_id).to_string(), size);
                }
                HandOver::Refused => refused = true,
                HandOver::NothingToSend => {}
            }
        }
    }
    if refused {
        Refusals::Some
    } else {
        Refusals::None
    }
}

/// Whether any window is still waiting for its pixels to be handed over.
///
/// The queue is one frame deep, so a batch of windows leaving the native path
/// together — which is what a single stylesheet rule produces — sends the first
/// and is refused for the rest. Somebody has to ask again, and the only thing
/// that runs the hand-over is a present.
#[derive(Debug, PartialEq, Eq)]
enum Refusals {
    None,
    Some,
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
    DeclareBands {
        depths: Vec<i32>,
    },
    SetOutputScale {
        scale: i32,
    },
    /// The chrome asked a client to close the window `app_id`.
    ///
    /// A request the client answers, so it goes to the Wayland thread where
    /// its toplevel is rather than to the brain, which has nothing that ends a
    /// client.
    CloseApp {
        app_id: String,
    },
    /// The chrome laid an app's element out at a new size; configure the client
    /// to match so it redraws at that resolution.
    ConfigureApp {
        app_id: String,
        width: i32,
        height: i32,
    },
    /// The chrome moved or restyled a portal.
    ///
    /// The scene is mutated on the chrome's own thread, which draws nothing
    /// and cannot wake the event loop. Without this a placement waits for an
    /// unrelated reason to redraw — and one of the things it waits for is the
    /// hand-over to the engine, which only runs while presenting.
    ScenePlaced,
    /// A chrome's page said `hello`. Whatever it is, it holds no pixels yet.
    ChromeHello,
    /// The chrome unmounted an app's element, which took its canvas with it.
    PortalRemoved {
        app_id: String,
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

    /// Whether a frame sent now would be taken rather than dropped. Advisory —
    /// see [`OutboundSender::has_room`].
    fn can_send_frame(&self) -> bool {
        self.outbound.has_room()
    }

    /// Queue an app's pixels, returning whether the chrome took them.
    ///
    /// They are dropped if it has not kept up, and the queue is one frame
    /// deep — so a caller that needs the chrome to *have* this frame, rather
    /// than merely offering it the latest one, has to look at the answer.
    fn send_frame(
        &self,
        app_id: &str,
        width: u32,
        height: u32,
        scale: u32,
        rgba: Arc<Vec<u8>>,
        region: Option<[u32; 4]>,
    ) -> bool {
        let taken = self
            .outbound
            .frame(app_id, width, height, scale, rgba, region);
        if !taken {
            tracing::debug!(%app_id, "chrome is behind; dropped a frame");
        }
        taken
    }
}

/// Apply a focus decision the *compositor* made, and tell every chrome.
///
/// Broadcast rather than sent to one page: focus is the desktop's, and
/// [`Host::focus_change`] reports a change *once*, so a chrome that was not
/// told has missed it for good — it would go on marking the wrong window
/// active until some other page happened to connect.
///
/// A free function taking the hub, like [`announce_open_apps`], because the
/// alternative is wiring only a running compositor can reach — and this is
/// the wiring the whole change is about.
fn broadcast_focus_decision(hub: &ChromeHub, decision: ChromeMessage) {
    let moved = {
        let mut host = hub.host.lock().unwrap();
        let mut ready = true;
        let _ = apply_chrome_message(&mut host, &mut ready, decision);
        host.focus_change()
    };
    if let Some(message) = moved {
        hub.broadcast(message);
    }
}

/// Forget a client that went away, and tell every chrome what that changed.
///
/// Two things, in this order: that the app is gone, and — if it was the one
/// being typed into — that the keyboard came back. A chrome told only the
/// first would go on marking a window that no longer exists as active.
fn broadcast_closed(hub: &ChromeHub, app_id: &str) {
    let (closed, focus) = {
        let mut host = hub.host.lock().unwrap();
        let closed = host.app_closed(app_id);
        // Asked after the close, because the window going away is what hands
        // the keyboard back.
        (closed, host.focus_change())
    };
    for message in closed.into_iter().chain(focus) {
        hub.broadcast(message);
    }
}

/// Tell every connected chrome what is already running.
///
/// `app_appeared` goes out once, when the client maps, and a page that was not
/// listening then never hears it — there is nothing to ask and nothing that
/// repeats. That loses a live, drawing client its window for good, and it
/// happens two ways: a client that maps in the milliseconds between the page's
/// handshake and its first React commit, and every reload.
///
/// Broadcast rather than sent to the one page that asked. The writer is
/// reachable from the `hello` arm, but a chrome that already holds the window
/// ignores a second announcement — the shell keys its windows by app id — so
/// singling one out buys nothing and would need the hub to grow a
/// send-to-one path.
///
/// A free function, and the guard is dropped before the first broadcast:
/// holding `host` across a loop that writes to `outbound` puts a lock the
/// Wayland thread needs underneath a queue a chrome could be slow to drain.
fn announce_open_apps(hub: &ChromeHub) {
    let announcements = hub.host.lock().unwrap().open_apps();
    for announcement in announcements {
        hub.broadcast(announcement);
    }
}

/// Writes one message's answers to the connection that asked, in order.
///
/// False if the socket is gone, which ends the connection.
///
/// A function rather than a loop inside `read_chrome_messages` so that the
/// [`freshened`] call has a seam: the answers and the desktop they were built
/// against are handed in separately here, which *is* the interleaving, with no
/// threads and no timing.
fn write_responses(
    hub: &ChromeHub,
    writer: &Arc<Mutex<UnixStream>>,
    responses: Vec<HostMessage>,
) -> bool {
    let mut writer = writer.lock().unwrap();
    for message in responses {
        let message = freshened(hub, message);
        if writer.write_all(to_line(&message).as_bytes()).is_err() {
            return false;
        }
        let _ = writer.flush();
    }
    true
}

/// The desktop as it is *now*, for a `displays` about to go on the wire.
///
/// `responses` is built under the `host` lock and written later under the
/// writer lock, and `set_output` can land in between: it describes a new
/// desktop and broadcasts it, and the broadcast goes out on the writer thread.
/// Writing the handshake's own copy afterwards would put the desktop that is
/// gone last on the socket, where latest-wins leaves it — and on a desktop
/// nobody is resizing again there is no next message to correct it.
///
/// What makes the last `displays` on a socket the last one described is not
/// this function alone. It is that [`DomicileCompositor::set_output`] describes
/// and then broadcasts *that* desktop, on the one Wayland thread, into a queue
/// one writer thread drains in order — so a line carrying a desktop that has
/// since been replaced always has the newer one queued behind it. A broadcast
/// is serialised before the writer lock is taken, so the writer lock is not
/// what orders those; the FIFO is.
///
/// Re-reading here closes the one case the FIFO does not: the answer, written
/// by a different thread, landing last with nothing queued after it.
///
/// That leaves a describe without a broadcast as the way to break this, and
/// there is one — the startup describe in `main`, safe only because no socket
/// thread exists yet. A second would reintroduce exactly the bug this closes.
///
/// Any other message passes through: this is the only one whose content is a
/// fact about the world rather than an answer to what was asked.
fn freshened(hub: &ChromeHub, message: HostMessage) -> HostMessage {
    if !matches!(message, HostMessage::Displays { .. }) {
        return message;
    }
    hub.host.lock().unwrap().describe_desktop()
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
            Outbound::Message(message) => (message, Arc::new(Vec::new())),
            Outbound::Frame {
                app_id,
                width,
                height,
                scale,
                rgba,
                region,
            } => (
                HostMessage::AppFrame {
                    app_id,
                    width,
                    height,
                    scale,
                    format: "rgba".to_string(),
                    bytes: rgba.len() as u32,
                    region,
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
        submit_ms = report.submit_ms,
        submit_worst_ms = report.submit_worst_ms,
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
    /// The drawing: the scene read, the hand-over and the draw calls, stopping
    /// before the submit. Not the client-buffer import, which is on the commit
    /// path — the only import inside this is the hand-over's.
    composite: TimingWindow,
    /// The submit alone. What the two mean and how to read them together is
    /// the legend in ROADMAP.md; `record_present` is what keeps them apart.
    submit: TimingWindow,
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
    /// Importing a client's buffer and drawing every layer, up to but not
    /// including the submit — see `submit_ms`, and the legend in ROADMAP.md
    /// for how to read the two together.
    composite_ms: u32,
    composite_worst_ms: u32,
    /// The submit, which on a nested window blocks for a frame callback.
    submit_ms: u32,
    submit_worst_ms: u32,
    throttled: usize,
}

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
                    let submit = timings.submit.take().unwrap_or_default();
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
                        submit_ms: submit.average.as_millis() as u32,
                        submit_worst_ms: submit.worst.as_millis() as u32,
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
/// Bind the chrome protocol socket.
///
/// Separate from serving it, and called on the main thread, because that is
/// what makes a failed bind fatal. The race it was originally moved here to
/// close — a shell this compositor started arriving before the listener
/// existed — cannot happen any more: the shell picks this path itself and does
/// not start its chrome until the session is published, which is the last
/// thing `main` does.
///
/// Being here is what made it fatal, which it was not when it lived in the
/// thread — a failed bind used to log and leave the thread, and the compositor
/// carried on with no socket for any chrome to arrive on. That is the right way
/// round: the chrome protocol is not an optional extra.
///
/// The path is carried in the error rather than only in the success line. It is
/// what the commonest failure is *about* — `sun_path` caps a Unix socket near
/// 108 bytes, so a deep `XDG_RUNTIME_DIR` fails here and nowhere else — and
/// this error propagates out of `main`, where a bare `Os { code: 2 }` names
/// nothing at all.
fn bind_chrome_socket(path: &std::path::Path) -> Result<UnixListener, Box<dyn std::error::Error>> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path).map_err(|err| {
        format!(
            "cannot bind the chrome protocol socket at {}: {err}",
            path.display()
        )
    })?;
    info!(?path, "chrome protocol socket up");
    Ok(listener)
}

fn serve_chrome(hub: Arc<ChromeHub>, listener: UnixListener) {
    for stream in listener.incoming().flatten() {
        let writer = Arc::new(Mutex::new(match stream.try_clone() {
            Ok(w) => w,
            Err(_) => continue,
        }));
        // Connected, but not yet a broadcast target: what arrives on this
        // socket next is a `hello` naming a protocol version, and until that
        // is agreed there is no version to write to it in. `read_chrome_messages`
        // adds it once there is.
        info!("chrome client connected");
        let hub = hub.clone();
        thread::spawn(move || chrome_connection(hub, stream, writer));
    }
}

/// One chrome connection, from accept to EOF, and then forgotten.
///
/// Forgetting it here rather than leaving it to the next failed broadcast:
/// `chromes` is only pruned when a write to a dead socket fails, and on an
/// idle desktop there is no write. A shell whose page reloads opens a new
/// connection each time, so without this the list grows one dead writer per
/// reload — every one of them held open, and counted in the `chromes=` field
/// of the frame line.
fn chrome_connection(hub: Arc<ChromeHub>, stream: UnixStream, writer: Arc<Mutex<UnixStream>>) {
    read_chrome_messages(&hub, stream, &writer);
    hub.chromes
        .lock()
        .unwrap()
        .retain(|held| !Arc::ptr_eq(held, &writer));
    info!("chrome client disconnected");
}

fn read_chrome_messages(hub: &Arc<ChromeHub>, stream: UnixStream, writer: &Arc<Mutex<UnixStream>>) {
    let reader = BufReader::new(stream);
    let mut ready = false;
    // Whether this connection is in the hub's broadcast list. Separate from
    // `ready` only because a `hello` can arrive twice on one socket, and the
    // list must not gain a second copy of the same writer.
    let mut joined = false;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        tracing::debug!(chrome_msg = %line.trim(), "chrome -> host");
        let responses = match parse_chrome(line.trim()) {
            // Compositor-level side effects: intercept before the (pure) brain.
            // Compositor-level, before the brain: a claim on the keyboard is
            // the compositor's to keep, since it is the only thing that sees a
            // key before its client does.
            // A page that has just started has no canvas for anything, and
            // the canvases belong to the *page* rather than to this socket.
            // `hello` is the one message that says a page has started — it is
            // sent by the page's own bundle, so it arrives again after a
            // reload or a crash-and-recreate whatever the socket did — so it
            // is what the record of what the chrome holds is cleared on. A
            // stale entry is a window drawn as a patch onto a blank canvas,
            // and for a client that then goes idle, a hole that stays until it
            // is resized.
            Ok(ChromeMessage::Hello { protocol_version }) => {
                // Scoped so the `host` guard is dropped before `chromes` is
                // taken below, and that is a deadlock and not a tidiness
                // preference: `serve_outbound` takes `chromes` then a
                // `writer`, and `write_responses` takes a `writer` then
                // `host`, through `freshened`. Widening this block over the
                // join — the obvious "why is this scoped?" simplification —
                // closes that into `host` -> `chromes` -> `writer` -> `host`.
                // Three threads, so it takes two chromes: this one's reader,
                // `serve_outbound`, and a second connection's reader sitting
                // in `write_responses` — an arrangement with an e2e check of
                // its own, not a corner.
                // The same holds for the `chromes` lock in the `else` arm.
                let responses = {
                    let mut host = hub.host.lock().unwrap();
                    apply_chrome_message(
                        &mut host,
                        &mut ready,
                        ChromeMessage::Hello { protocol_version },
                    )
                };
                if ready {
                    // Joined here rather than at accept. A broadcast is
                    // written in *this* build's protocol, so sending one to a
                    // page that has not said it speaks that is a guess — and
                    // sending one to a page that has just been told it does
                    // not is worse. A refused chrome gets its `welcome`
                    // naming the disagreement, on its own socket, and nothing
                    // else.
                    if !joined {
                        hub.chromes.lock().unwrap().push(writer.clone());
                        joined = true;
                        info!("chrome agreed the protocol; it now gets the desktop");
                    }
                    // *Then* the announcement, in that order: this is what has
                    // the Wayland thread describe the windows already open,
                    // and it describes them by broadcast — so a chrome not yet
                    // in the list would miss exactly the windows it connected
                    // too late to see map.
                    //
                    // Measured, with the caveat that matters: swapping these
                    // two makes `e2e-late-chrome` fail with "the chrome came
                    // up to an empty desktop with a client still drawing" —
                    // but only once a delay is inserted between them to widen
                    // the window. The unmodified swap still passed 3 runs of
                    // 3. So a reader who swaps them, sees green and concludes
                    // this comment is stale has reproduced nothing; the race
                    // is narrow, not absent.
                    hub.send_request(ClientRequest::ChromeHello);
                } else if joined {
                    // Taken back out. This connection agreed a version earlier
                    // and has now named one this build cannot speak, so it has
                    // stopped being a peer — and a list that only ever grew
                    // would go on writing this build's protocol to it, which
                    // is the whole thing this arm exists to prevent. The same
                    // `retain` `chrome_connection` uses on disconnect, so a
                    // later good `hello` re-joins it without duplicating.
                    hub.chromes
                        .lock()
                        .unwrap()
                        .retain(|held| !Arc::ptr_eq(held, writer));
                    joined = false;
                    info!("chrome took its protocol agreement back; it no longer gets the desktop");
                }
                responses
            }
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
            // Compositor-level for the same reason as the density above: what
            // depths the chrome draws at is what the compositor interleaves
            // windows with, and the brain models neither.
            Ok(ChromeMessage::DeclareBands { depths }) => {
                hub.send_request(ClientRequest::DeclareBands { depths });
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
            // Compositor-level, and nothing the brain models: only the
            // client's own toplevel can end it, and the window leaves the
            // scene when it goes away and `app_closed` says so.
            Ok(ChromeMessage::CloseApp { app_id }) => {
                hub.send_request(ClientRequest::CloseApp { app_id });
                Vec::new()
            }
            Ok(ChromeMessage::FocusChrome) => {
                hub.send_request(ClientRequest::KeyboardFocus { app_id: None });
                let mut host = hub.host.lock().unwrap();
                apply_chrome_message(&mut host, &mut ready, ChromeMessage::FocusChrome)
            }
            // A placement changes what is drawn and where, so the desktop is
            // dirty — and the chrome's thread is not the one that can draw.
            Ok(
                message @ (ChromeMessage::PlacePortal { .. } | ChromeMessage::RemovePortal { .. }),
            ) => {
                // Read before the message is consumed, and from the message
                // rather than from the scene: a backgrounded window leaves the
                // scene too, and its element is still in the page.
                let unmounted = unmounts_the_element(&message).map(str::to_string);
                let responses = {
                    let mut host = hub.host.lock().unwrap();
                    apply_chrome_message(&mut host, &mut ready, message)
                };
                hub.send_request(match unmounted {
                    Some(app_id) => ClientRequest::PortalRemoved { app_id },
                    None => ClientRequest::ScenePlaced,
                });
                responses
            }
            // No catch-all: every message is named above, so a new one is a
            // compile error here rather than a silent trip to the brain that
            // skips whatever compositor-level effect it also wanted.
            //
            // A message that will not parse is dropped — there is nothing else
            // to do with it, and a chrome one version out of step must not
            // take the compositor down — but it is said out loud. Silently is
            // how it was, and a chrome whose message the compositor could not
            // read is indistinguishable from one that never sent it: the frame
            // is logged above, before this, so the log shows the message
            // arriving and nothing showing what became of it.
            Err(err) => {
                // The error names the field, which is what identifies the
                // drift. The frame itself is *not* repeated here: it is
                // already logged at debug a few lines up, and a `ChromeMessage`
                // carries `Key`'s keycodes and `Spawn`'s argv — a chrome one
                // version out of step is exactly when this fires, so at a level
                // the default subscriber shows, that would put every forwarded
                // keystroke in the log. It would also be one line per frame:
                // `pointer_motion` drifting is 60 a second.
                warn!(%err, "{}", grepped::UNPARSEABLE);
                Vec::new()
            }
        };
        // Whatever that message did, it may have moved the keyboard — a focus
        // message obviously, a placement less so, since hiding the focused
        // window's portal hands the keyboard back. Asked once here rather than
        // per message type, because a list of "the messages that can move
        // focus" is a list to keep in step with the protocol.
        //
        // Broadcast, not returned: `responses` goes to the one connection that
        // asked, and focus is the whole desktop's. `Host::focus_change`
        // reports a change *once*, so a second chrome that was not told has
        // missed it for good — it would mark the wrong window active until
        // some other page happened to connect. The guard is dropped before the
        // broadcast rather than held across it, since the Wayland thread wants
        // that lock too.
        let moved = hub.host.lock().unwrap().focus_change();
        if let Some(message) = moved {
            hub.broadcast(message);
        }
        if !write_responses(hub, writer, responses) {
            return;
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
    /// Every advertised output, in the order [`Screens`] lists them.
    ///
    /// **In that order, and one for one.** Built from `screens.outputs()` at
    /// startup. Two things change it afterwards and neither can break the
    /// pairing: `set_output` restates the one output it is asserted to have,
    /// in place, so the length cannot move; and
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) rebuilds
    /// this list and `screens` from one `Rearrangement`, so they are replaced
    /// together or not at all. That is what lets [`Screens::entered_by`]'s
    /// answer be zipped against this: it is one decision per output,
    /// positional, with nothing naming which is which.
    ///
    /// Which of them a surface enters is [`Screens::entered_by`]: the outputs
    /// its portal reaches, and every one of them for a surface that has no
    /// portal or reaches none. See
    /// [`enter_the_displays_each_window_is_on`](DomicileCompositor::enter_the_displays_each_window_is_on).
    outputs: Vec<LiveOutput>,
    /// The live config, and the last edit that would not parse.
    ///
    /// A store rather than a `Config`, because the file is watched: an edit
    /// that does not parse leaves the live one in place and is remembered,
    /// which is the guarantee `ConfigStore` makes and this type would have to
    /// reimplement. Only the display list is acted on — see
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) — so the
    /// rest of a reloaded config is stored and not yet obeyed.
    ///
    /// Note what this does *not* cover: a save caught half-written parses
    /// perfectly, it just says less. Keeping that from reaching the desktop is
    /// the coalescing on the watcher thread, not the store.
    config: ConfigStore,
    /// What the outputs above are, and who gets to change them.
    screens: Screens,
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
    /// What each app last drew, in whatever form it can be given to the chrome
    /// again without waiting for that client to draw. The compositor is the
    /// only thing that can re-supply a window's pixels, and a window can need
    /// them at a moment no client knows anything about — see [`hand_over`].
    latest_frames: HashMap<String, LastFrame>,
    /// How many times each surface has committed, keyed as [`painted_key`].
    ///
    /// Not the pixels, and it does not need to be: this is what tells a window
    /// that redrew in place from one that merely stayed there, which nothing
    /// about its geometry says. It is not the *only* thing that can differ
    /// between two frames of a window that has not moved — `Look` and the draw
    /// order are the others, and they are compared beside it.
    /// A counter that wrapped would report a redraw as no change once in
    /// 2^64 commits, which is not a number of frames anything here will see.
    content: HashMap<String, u64>,
    /// The last frame's layers, and the output they were measured against.
    ///
    /// `None` before the first frame, which is the one case that has to report
    /// everything: there is no previous picture for a difference to be against.
    painted: Option<damage::Frame>,
    /// Which apps the chrome holds a frame of, and at what buffer size.
    ///
    /// The compositor cannot see the page, so this is its own record rather
    /// than an observation, and exactly four things change it: a frame the
    /// chrome took goes in; `app_composited` — which is us telling the chrome
    /// to drop the canvas — takes one out; so does the element being
    /// unmounted, which arrives as `remove_portal`; and a chrome that has just
    /// said `hello` empties it, because that page has no canvas in it yet.
    ///
    /// Not a placement that says `native`. The chrome keeps its canvas until
    /// told, and it cannot be told until there is a frame to put in its place.
    /// Not a window leaving the scene either — a backgrounded window does that
    /// with its element still in the page. See [`unmounts_the_element`].
    ///
    /// One map rather than a set beside it, because the size is what decides
    /// whether a partial frame is safe and the two must agree: `drawFrame`
    /// assigns `canvas.width`/`canvas.height` from these, and assigning either
    /// resets the backing store to transparent. The logical size is not a
    /// proxy for it — at scale 2 a buffer can go 806x491 to 1612x982 with the
    /// logical size unmoved, and 801 and 800 both floor to 400 — so a record
    /// that says "held" without saying "at what" is a canvas the chrome
    /// silently blanks while the compositor patches it.
    held: HashMap<String, (u32, u32)>,
    /// Damage owed to the chrome: what a frame the throttle dropped, or the
    /// outbound queue refused, changed and never showed it. Folded into the
    /// next frame that gets through, because that frame is a patch over a
    /// canvas still holding the one before the drop.
    pending_damage: HashMap<String, PendingDamage>,
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
    /// Which band the chrome is being asked for, and which have answered.
    bands: Bands,
    /// The texture each answered band committed, by its index in `bands`.
    ///
    /// A band is a full-size raster that is transparent wherever that depth
    /// paints nothing, so these are drawn whole and in depth order rather than
    /// clipped: nothing in them was flattened together, which is the entire
    /// reason for asking separately. Kept between frames because asking is a
    /// round trip — a desktop that has not repainted redraws from these.
    band_textures: HashMap<usize, SurfaceTexture>,
    /// Which kinds of window input have been seen, so each is reported once
    /// rather than on every pointer motion.
    window_input_seen: HashSet<&'static str>,
    /// What the chrome's last frame looked like, so the line describing it is
    /// printed when it changes rather than sixty times a second.
    chrome_frame_shape: Option<((f64, f64), bool, bool)>,
    /// The highest output scale to advertise, whatever the window's is.
    ///
    /// `adopt_window_scale`'s bound, and only its: the chrome's reported
    /// density is bounded by [`ChromeHub::max_scale`], which is where the
    /// chrome connections are. Applies only where nothing described a desktop
    /// — a configured display states its own scale, and neither number is
    /// weighed against it.
    max_scale: u32,
    /// The key combinations the chrome has claimed for the desktop.
    shortcuts: Shortcuts,
    /// Which modifiers the chrome was last told are held.
    modifiers: Held,
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
        if host.app(app_id).and_then(|app| app.size) == Some(size) {
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
        // A buffer this cannot read is still a *commit*, and the chrome
        // believes it answered — so it is sorted like any other frame rather
        // than returned on. Returning early here left the question standing
        // with nothing to answer it, and the chrome stopped updating for the
        // rest of the run.
        let (came, texture) = match committed_buffer(buffer) {
            Some(committed) => match self.texture_from(committed, buffer_scale) {
                Some(texture) => (Buffer::Textured, Some(texture)),
                None => (Buffer::Readable, None),
            },
            None => (Buffer::Unreadable, None),
        };
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
        // What this frame *is* — see `chrome_frame`, which is where that is
        // decided and where it can be tested. Everything below is applying the
        // answer to state this method owns.
        let asked = self.bands.outstanding();
        // Read only while a question is outstanding, which is both halves of
        // the bargain: the chrome may leave its last label up between cycles,
        // and the compositor pays for a pixel of read-back only while it is
        // waiting for a band.
        let said = match (asked, &texture) {
            (Some(_), Some(surface)) => self.band_labelled_on(surface),
            _ => None,
        };
        let arrived = what_arrived(asked, said, came, !self.bands.depths().is_empty());
        match arrived {
            Arrival::Banded(band) => {
                info!(band, "{}", grepped::BAND_ANSWERED);
                self.bands.answered();
                self.band_textures
                    .insert(band, texture.expect("a banded frame made a texture"));
                self.ask_for_the_next_band();
            }
            Arrival::AskAgain(_) => {
                self.bands.unusable();
                self.ask_for_the_next_band();
            }
            Arrival::StaleBands => {
                self.chrome_texture = texture;
                self.bands.went_stale();
                self.band_textures.clear();
                self.ask_for_the_next_band();
            }
            Arrival::Chrome => self.chrome_texture = texture,
            // Nothing was read, so nothing is known and nothing changes — not
            // even a present, which would only redraw the frame already up.
            Arrival::Nothing => return,
        }
        self.needs_present = true;
    }

    /// Which band this frame's own pixels say it is.
    ///
    /// The label is one pixel at the top-left of the picture — see
    /// `domicile_protocol::band_label` for why it is in the picture at all —
    /// and this is the read-back that gets it. A texture rather than the
    /// buffer, because the buffer is a dmabuf in every case that matters: the
    /// chrome is a GPU-accelerated browser and its frame never touches the CPU
    /// on the way in.
    ///
    /// `None` for anything that could not be read. A label nobody could read
    /// is a frame the compositor cannot attribute, which is the same answer as
    /// a frame with no label: it is not the band that was asked for.
    fn band_labelled_on(&mut self, surface: &SurfaceTexture) -> Option<usize> {
        // The top-left of the *picture*. `copy_texture` reads in GL's own
        // coordinates, whose origin is the first row of the texture — and a
        // client that rendered with GL hands its buffer over bottom row first,
        // which is what `y_inverted` says. So the picture's top row is the
        // texture's last one exactly when the buffer is inverted.
        let top = if surface.y_inverted {
            surface.texture.height().saturating_sub(1)
        } else {
            0
        };
        let corner = Rectangle::new((0, i32::try_from(top).unwrap_or(0)).into(), (1, 1).into());
        let gpu = self.gpu.as_mut()?;
        let mapping = match gpu
            .renderer()
            .copy_texture(&surface.texture, corner, Fourcc::Abgr8888)
        {
            Ok(mapping) => mapping,
            Err(err) => {
                tracing::warn!(%err, "a chrome frame's label would not copy");
                return None;
            }
        };
        let read = match gpu.renderer().map_texture(&mapping) {
            Ok(read) => read,
            Err(err) => {
                tracing::warn!(%err, "a chrome frame's label would not map");
                return None;
            }
        };
        // The same byte order the shm path uploads in: `Abgr8888` is R, G, B, A
        // in memory.
        let pixel = <[u8; 4]>::try_from(read.get(..4)?).ok()?;
        band_in(pixel)
    }

    /// Ask the chrome for the next band that has not answered, if any.
    ///
    /// One at a time. The frame that answers says which band it is in its own
    /// pixels — see `domicile_protocol::band_label` — so this is no longer
    /// what attributes a commit; it is what keeps the answer unambiguous,
    /// because a label then only has to be told from the band actually asked
    /// for rather than from every band declared.
    fn ask_for_the_next_band(&mut self) {
        let Next::Ask(band) = self.bands.next() else {
            return;
        };
        self.bands.asked(band);
        let asked = u32::try_from(band).expect("a band index fits a u32");
        self.hub.broadcast(HostMessage::RenderBand { band: asked });
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

    /// [`draws_natively`] against the scene the chrome has placed.
    fn draws_natively(&self, app_id: &str) -> bool {
        draws_natively(self.hub.host.lock().unwrap().scene(), app_id)
    }

    /// Tell every client which displays its surfaces are on, and which they
    /// are not — every window, and every menu over one.
    ///
    /// Run whenever a placement changes rather than only when a window maps,
    /// because a window moves: the chrome drags an `<app>` element across the
    /// page and the display under it changes with no Wayland event of its own.
    /// [`Screens::entered_by`] is the rule and this is only its application —
    /// every output, every window, enter or leave, so a window that left a
    /// screen is told that too.
    ///
    /// Both halves are idempotent in Smithay: an output keeps the set of
    /// surfaces on it and sends `wl_surface.enter`/`leave` only when that set
    /// changes. So this can run on every placement without the compositor
    /// keeping a second copy of the same bookkeeping, and without a client
    /// seeing an `enter` for a screen it is already on.
    ///
    /// The chrome's own toplevel is not here. It is the desktop rather than a
    /// window on it, so it belongs on every output rather than on the ones some
    /// portal reaches. `new_toplevel` puts it on the outputs there are when it
    /// maps, and
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) puts it on
    /// the ones a reload adds — which is why that is not "once and for all",
    /// as this said while the display list could not change.
    fn enter_the_displays_each_window_is_on(&self) {
        let host = self.hub.host.lock().unwrap();
        let scene = host.scene();
        let where_it_is = |app_id: &str| scene.get(app_id).map(domicile_scene::Portal::bounds);
        for (app_id, toplevel) in &self.toplevels {
            self.enter_only(toplevel.wl_surface(), where_it_is(app_id));
        }
        // And a popup goes where its parent's window goes. Decided on every
        // pass rather than once when the popup is created, because the window
        // under it moves: a menu left holding the screen its window used to be
        // on is a client drawing it at that screen's density over a window now
        // at another's.
        //
        // Smithay's own list rather than one of ours: it is pushed to before
        // `new_popup` is dispatched and popped from when the popup goes away,
        // so a second copy here would be a lifecycle to keep in step for
        // nothing.
        //
        // The *root* rather than the immediate parent, because a submenu's
        // parent is another popup: resolved one step, a nested menu would fall
        // through to every display and be drawn at the largest scale of them —
        // which is the failure this narrowing exists to prevent, arrived at by
        // going one level deeper into the same menu.
        //
        // `None` — a popup whose chain does not end at a window this
        // compositor announced, or one whose window has no portal — takes the
        // every-display fallback, which is where a surface with nothing to
        // place it by belongs.
        for popup in self.xdg_shell_state.popup_surfaces() {
            let on = self
                .window_under(popup)
                .and_then(|app_id| where_it_is(&app_id));
            self.enter_only(popup.wl_surface(), on);
        }
    }

    /// Put `surface` on the displays `bounds` reaches, and take it off the
    /// rest.
    ///
    /// Zipped, because `self.outputs` is built from `self.screens` in order
    /// and [`Screens::entered_by`]'s answer is one decision per output — see
    /// the `outputs` field, which says what keeps the two in step.
    fn enter_only(&self, surface: &WlSurface, bounds: Option<domicile_scene::Bounds>) {
        for (live, entered) in self.outputs.iter().zip(self.screens.entered_by(bounds)) {
            let output = &live.output;
            if entered {
                output.enter(surface);
            } else {
                output.leave(surface);
            }
        }
    }

    /// The window a popup ultimately belongs to, through any submenus.
    ///
    /// A popup's parent is either the window it hangs off or the menu it hangs
    /// off, so this walks until it reaches something announced as a window.
    /// Resolving one step instead would leave every *nested* menu with no
    /// window, and so on every display at the largest scale of them — the
    /// failure the narrowing exists to prevent, one level deeper into the same
    /// menu.
    ///
    /// Bounded by the number of live popups, which is what a chain can be at
    /// its longest. `xdg_shell` forbids a cycle, and a bound is what keeps a
    /// client that made one anyway from taking the compositor with it.
    fn window_under(&self, popup: &PopupSurface) -> Option<String> {
        let popups = self.xdg_shell_state.popup_surfaces();
        let mut surface = popup.get_parent_surface()?;
        for _ in 0..=popups.len() {
            if let Some(app_id) = self.app_id_of(&surface) {
                return Some(app_id);
            }
            surface = popups
                .iter()
                .find(|above| above.wl_surface() == &surface)?
                .get_parent_surface()?;
        }
        None
    }

    /// The window this surface is, if it is one this compositor announced.
    fn app_id_of(&self, surface: &WlSurface) -> Option<String> {
        self.toplevels
            .iter()
            .find(|(_, toplevel)| toplevel.wl_surface() == surface)
            .map(|(app_id, _)| app_id.clone())
    }

    /// Turn a client's newly-attached buffer into pixels for the chrome,
    /// throttled to ~30fps per app.
    fn publish_frame(
        &mut self,
        app_id: &str,
        buffer: &wl_buffer::WlBuffer,
        buffer_scale: i32,
        damaged: Option<Region>,
    ) {
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
        let from_gpu = matches!(committed, CommittedBuffer::Gpu(_));
        let taking = disposition(
            from_gpu,
            self.gpu.as_ref().is_some_and(Gpu::presenting),
            self.draws_natively(app_id),
            self.last_frame
                .get(app_id)
                .map(|last| now.duration_since(*last)),
        );
        // Recorded before anything can drop this frame, and left recorded until
        // one actually goes. `frame_fate` decides the rest in one place: split
        // across the early returns below, the ordering was prose, and moving
        // this line under the throttle left the suite green while a client's
        // pixels went missing.
        let pending = owed(&mut self.pending_damage, app_id, damaged);
        let fate = frame_fate(
            taking,
            pending,
            self.held.get(app_id).copied(),
            (width, height),
        );
        if taking == Disposition::Throttle {
            self.hub.timings.lock().unwrap().throttled += 1;
            return;
        }
        self.last_frame.insert(app_id.to_string(), now);
        // What the chrome is getting, decided above and needed here: the
        // readback is a pipeline stall proportional to what it reads, so it
        // reads what is going to be sent and nothing else.
        let sending = readback_area(fate);
        // The GPU readback happens here rather than during classification: it
        // costs a pipeline stall, so a frame the throttle has just dropped is
        // never imported at all.
        let rgba = match committed {
            // Straightened here rather than in `bgra_to_rgba`, because a
            // decoded shm buffer has two consumers and they want opposite
            // things. This one is bytes for the page, which draws them with
            // `putImageData` and multiplies by alpha again; the other is
            // `texture_from`, a texture the compositor draws itself, and
            // `shaders/rounded.frag` says in as many words that it wants the
            // colour premultiplied. Converting where the buffer is decoded
            // reached both, and made every partial-alpha pixel of the chrome's
            // own frame composite too bright.
            //
            // The dmabuf arm below already works this way: `read_rgba` runs
            // only on the copy branch, while the composited branch hands the
            // buffer straight to the GPU.
            CommittedBuffer::Pixels { mut rgba, .. } => {
                straight_alpha::to_straight(&mut rgba);
                rgba
            }
            CommittedBuffer::Gpu(dmabuf) => self.import_gpu_frame(
                app_id,
                dmabuf,
                buffer_scale,
                taking == Disposition::Draw,
                sending,
            ),
        };
        if rgba.is_empty() {
            // Drawn here: the pixels never left the GPU, so there is nothing to
            // send. The window is where this app appears — but not from here.
            // See `needs_present`.
            self.needs_present = true;
            // And this is the first frame of it drawn since the chrome last
            // held pixels for it, so its canvas is a still of a window that is
            // now live underneath. Here rather than when the placement
            // arrived, because until this moment there was nothing to put in
            // the canvas's place.
            // Nothing is owed to a chrome that holds no pixels for this
            // window; the frame it gets next will be a whole one.
            self.pending_damage.remove(app_id);
            if let Some(taken_back) = hand_back(app_id, &mut self.held) {
                info!(%app_id, "drawing this window natively -> chrome should drop its pixels");
                self.hub.broadcast(taken_back);
            }
        } else {
            tracing::debug!(%app_id, width, height, bytes = rgba.len(), "broadcast app frame");
            let scale = u32::try_from(buffer_scale).unwrap_or(1).max(1);
            // Kept whether or not the chrome takes it: a refused frame is
            // still the only copy of those pixels anybody has.
            let rgba = keep_frame(
                &mut self.latest_frames,
                app_id,
                from_gpu,
                rgba,
                width,
                height,
                scale,
            );
            // Only what changed, and only when the chrome still holds the
            // frame this one patches — `held` is exactly that record.
            //
            // Asserted rather than assumed: `readback_area` has to answer for
            // every `Frame`, because it is called before the readback settles
            // which one this is, and its answer for the other two is the safe
            // one. Here the invariant is knowable and violating it means a
            // frame with pixels that nothing decided the fate of.
            assert!(
                matches!(fate, Frame::Sent(_)),
                "a frame with pixels to send is `Disposition::Send`, not {fate:?}"
            );
            let (pixels, region) = match sending {
                None => (rgba, None),
                Some(region) => (
                    only_the_region(rgba, from_gpu, width, region),
                    Some([region.x, region.y, region.width, region.height]),
                ),
            };
            if self
                .hub
                .send_frame(app_id, width, height, scale, pixels, region)
            {
                self.held.insert(app_id.to_string(), (width, height));
                // Drawn: nothing is owed until the client changes something
                // else. A refusal by a full outbound queue leaves it owed,
                // which is this branch not being taken rather than a branch of
                // its own.
                self.pending_damage.remove(app_id);
            }
        }
    }

    /// Read a client's GPU frame back as RGBA, recording the buffer it came
    /// from against the app's engine texture.
    ///
    /// The readback is the part the CEF bridge deletes: the descriptor stored
    /// here already names the very buffer the engine will sample directly.
    fn import_gpu_frame(
        &mut self,
        app_id: &str,
        dmabuf: Dmabuf,
        buffer_scale: i32,
        composited: bool,
        area: Option<Region>,
    ) -> Vec<u8> {
        let gpu = self.gpu.as_mut().expect(
            "a dmabuf can only be committed where the global — and so the renderer — exists",
        );
        // Every dmabuf was imported once already, when the client created it
        // (`DmabufHandler::dmabuf_imported`), so a failure here is not a client
        // handing us something unsupported — it is the renderer breaking.
        let started = Instant::now();
        let rgba = if composited {
            // Presenting: the client's buffer becomes a texture we draw, and
            // nothing is copied out. The chrome gets no pixels for this app —
            // there is a hole in the page where the compositor puts it.
            if let Some(surface) =
                self.texture_from(CommittedBuffer::Gpu(dmabuf.clone()), buffer_scale)
            {
                self.textures.insert(app_id.to_string(), surface);
            }
            Vec::new()
        } else {
            DmabufImporter::read_rgba(gpu.renderer(), &dmabuf, area)
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
        self.latest_frames.insert(
            app_id.to_string(),
            LastFrame::Gpu {
                dmabuf,
                buffer_scale,
            },
        );
        rgba
    }

    /// Send one frame to the chrome for every window that has just left the
    /// native path.
    ///
    /// A window changes paths because the *page* changed: a filter appears on
    /// the element in front of a client that knows nothing about it and may
    /// never draw again. Nothing else would send that client's pixels to the
    /// chrome, and until something does the window is a hole in the page with
    /// nothing behind it — the compositor has stopped drawing it and the
    /// engine has no canvas to draw instead. So the compositor pushes the
    /// buffer it is already holding, once, and the client's own frames take
    /// over from there.
    ///
    /// Nothing happens for a window that never left: the readback is the whole
    /// cost of the copy path and doing it per presented frame would be worse
    /// than never having had a native path at all.
    fn hand_over_to_the_engine(&mut self, placed: &[Placed]) {
        let windows = drawn_by_the_compositor(placed, |app_id| self.textures.contains_key(app_id));
        let (hub, latest, gpu) = (&self.hub, &self.latest_frames, &mut self.gpu);
        let refusals = hand_over(&windows, &mut self.held, |app_id| {
            let Some(last) = latest.get(app_id) else {
                // Announced but never committed: there is nothing to hand over,
                // and the client's first frame goes down the copy path of its
                // own accord.
                return HandOver::NothingToSend;
            };
            // Asked before the pixels are produced rather than after, because
            // producing them is what this costs: for a GPU client a readback,
            // which stalls the pipeline on the Wayland thread, for a frame the
            // queue would refuse. Several windows leaving at once is the
            // ordinary case — one stylesheet rule matches all of them — and
            // paying it once per window per present for a queue one frame deep
            // is most of that work wasted.
            if !hub.can_send_frame() {
                return HandOver::Refused;
            }
            let (rgba, width, height, scale) = pixels_to_hand_over(last, |dmabuf| {
                let renderer = gpu
                    .as_mut()
                    .expect("a dmabuf was imported, so the renderer that imported it exists")
                    .renderer();
                // Whole: the chrome has no pixels for this window, which is
                // why it is being handed any.
                DmabufImporter::read_rgba(renderer, dmabuf, None)
                    .expect("a dmabuf the importer accepted reads back")
            });
            info!(%app_id, "handing this window's pixels to the engine");
            // Whole buffer: the chrome has no pixels for this window, which
            // is why it is being handed any.
            if hub.send_frame(app_id, width, height, scale, rgba, None) {
                HandOver::Sent {
                    size: (width, height),
                }
            } else {
                // Not recording it is the whole point: the next present tries
                // again, where recording it would leave a hole in the page with
                // nothing behind it for as long as the client stayed idle.
                HandOver::Refused
            }
        });
        // Ask again, rather than leaving those windows to whatever wakes the
        // loop next. In practice the chrome repaints when it draws the frame
        // that filled the queue, and that commit schedules a present — but
        // that is the chrome scheduling the compositor's work by accident, and
        // it does not happen at all while the frames in flight belong to some
        // *other* copy-path window. Not a spin: this only decides whether the
        // next turn of the loop draws, and the frame that refused us has to
        // drain before there is a turn worth using.
        if refusals == Refusals::Some {
            self.needs_present = true;
        }
    }

    /// Draw the desktop into the window: every placed app bottom to top, then
    /// the chrome over all of them.
    ///
    /// The apps' geometry is the scene's — `draw_order` gives the stacking the
    /// chrome asked for, and `surface_to_output` places each surface exactly
    /// where a click on it would land. `hit_test` resolves the same stacking
    /// among the windows that take the pointer; every window is drawn,
    /// including the ones that do not, so a window the chrome made inert is
    /// painted over the window its clicks now go to. An app with no texture
    /// yet is skipped rather than drawn empty: it has been announced but has
    /// not committed.
    ///
    /// The chrome covers the output, and blending is what makes that work
    /// rather than hide everything: it is transparent wherever an `<app>`
    /// element is *and nothing behind that element painted*, so the app shows
    /// through the hole, and opaque wherever it has drawn a panel. Which of
    /// its depths goes where among the windows is [`stacking::steps`]; today
    /// nothing reports those depths, so it is one draw over the lot as before.
    ///
    /// A wallpaper is what that caveat is about, and it is why interleaving is
    /// only half an answer: a chrome that paints behind its own `<app>`
    /// element hands over a texel that is already wallpaper-under-panel, and
    /// no ordering of one raster can put a window between the two.
    fn present(&mut self) {
        let started = Instant::now();
        let placed: Vec<Placed> = {
            let host = self.hub.host.lock().unwrap();
            host.scene()
                .draw_order()
                .into_iter()
                .map(|portal| {
                    (
                        portal.app_id.clone(),
                        portal.surface_to_output(),
                        portal.style,
                        portal.draws_natively,
                        portal.z_index,
                    )
                })
                .collect()
        };
        // Before the checks below, not after: a headless desktop draws nothing
        // here and returns, and it is the desktop where the chrome draws
        // *every* window — so it is the one that can least afford a window the
        // chrome has no pixels for and nobody to ask.
        self.hand_over_to_the_engine(&placed);
        let Some(gpu) = self.gpu.as_mut() else {
            return;
        };
        let Some(backend) = gpu.window() else {
            return;
        };
        let size = backend.window_size();
        // The scene is in the chrome's logical units and the window is in
        // device pixels, and on a scaled display those are not the same number.
        let to_window = logical_to_window(self.screens.size(), (size.w, size.h));
        // A window on the copy path is drawn by the engine, into the canvas in
        // its own hole. Drawing it here as well would put the compositor's
        // picture over the engine's — two versions of the same window, the
        // wrong one on top.
        let placements: Vec<_> = placed
            .into_iter()
            .filter(|(_, _, _, natively, _)| *natively)
            .map(|(app_id, surface_to_output, style, _, z_index)| {
                (app_id, surface_to_output, style, z_index)
            })
            .collect();
        // Everything a style measures is in the chrome's logical units and the
        // shader works in output pixels.
        let scale = to_window.a;
        // The depth of each window that made it into `layers`, in that order,
        // so `stacking` places the chrome against the windows actually drawn
        // rather than against the ones the scene offered.
        let depths: Vec<i32> = placements
            .iter()
            .filter(|(app_id, _, _, _)| self.textures.contains_key(app_id))
            .map(|(_, _, _, z_index)| *z_index)
            .collect();
        // Nothing reports these yet: the chrome knows its own depths and the
        // protocol has no message for them, so today every frame is the
        // all-above case. The interleaving exists first so that message has
        // somewhere to arrive.
        let bands: Vec<stacking::Band> = Vec::new();
        // Where the chrome goes among the windows rather than only over them.
        // Out here rather than beside its use because the clip rectangles are
        // borrowed into the layers, so the plan has to outlive them.
        let plan = stacking::steps(&depths, &bands);
        // The windows alone, in the order the scene drew them, and never
        // reassigned. Both plans below name a window by its position in *this*
        // list; `layers` is what each plan produces, and reading a window back
        // out of that would be reading a position in a plan.
        let windows: Vec<_> = placements
            .iter()
            .filter_map(|(app_id, surface_to_output, style, _)| {
                let surface = self.textures.get(app_id)?;
                Some(Layer {
                    alpha: style.opacity as f32,
                    clip: &[],
                    shadow: style.shadow.map(|shadow| shadow_in_pixels(shadow, scale)),
                    // The radius is in the chrome's logical units and the
                    // shader works in output pixels, so it scales with
                    // everything else — a rounded window on a 2x display has
                    // twice the radius in pixels and looks the same.
                    corner_radius: (style.corner_radius * scale) as f32,
                    surface_to_output: surface_to_output.then(to_window),
                    texture: &surface.texture,
                    y_inverted: surface.y_inverted,
                })
            })
            .collect();
        let mut layers = windows.clone();
        // What each layer covers, from the same transform it is drawn with, so
        // the reported box and the drawn pixels cannot describe different
        // rectangles. Built here rather than from the scene, which is in
        // logical units and would need the same mapping applied a second time.
        let mut painted: Vec<Painted> = placements
            .iter()
            .filter(|(app_id, _, _, _)| self.textures.contains_key(app_id))
            .map(|(app_id, surface_to_output, style, _)| {
                let onto_output = surface_to_output.then(to_window);
                // Where the shadow lands, from the same function that draws it
                // — so the box and the pixels cannot describe different places.
                let cast = style
                    .shadow
                    .and_then(|shadow| shadow_quad(onto_output, shadow_in_pixels(shadow, scale)))
                    .map(|(quad, _)| quad);
                Painted {
                    app_id: app_id.clone(),
                    rect: covered(onto_output, cast),
                    placed: onto_output,
                    // Present by construction: `textures` is only written
                    // from inside `commit`, which bumps this first, and the
                    // two are removed together when a window closes.
                    content: self.content[app_id],
                    // In the units the shader is handed, not the scene's:
                    // both are scaled on the way to `draw_layers`, and the
                    // logical numbers can stay put while the drawn ones move.
                    look: Look {
                        opacity: style.opacity,
                        corner_radius: style.corner_radius * scale,
                        shadow: style.shadow.map(|shadow| shadow_in_pixels(shadow, scale)),
                    },
                }
            })
            .collect();
        if let Some(chrome) = self.chrome_texture.as_ref() {
            let chrome_onto_output = chrome_onto_output(chrome.logical_size, to_window);
            painted.push(Painted {
                app_id: CHROME_LAYER.to_string(),
                rect: covered(chrome_onto_output, None),
                placed: chrome_onto_output,
                // Not indexed like an app's: the chrome's texture outlives
                // the page that drew it, so this map can legitimately have no
                // entry for it after a reload cleared nothing.
                content: self.content.get(CHROME_LAYER).copied().unwrap_or_default(),
                // The desktop is never rounded, never translucent and casts
                // nothing — the same three facts its `Layer` below states.
                look: Look {
                    opacity: 1.0,
                    corner_radius: 0.0,
                    shadow: None,
                },
            });
            // `bands` is empty until a chrome reports its own depths, and
            // with none `steps` puts every window down and the whole chrome
            // over the lot — the frame the compositor has always drawn.
            let mut drawn = Vec::with_capacity(plan.len());
            for step in &plan {
                match step {
                    // Already in `layers`, in this order, from the loop
                    // above: `depths` and `layers` are built from the same
                    // vector under the same filter, so an index `steps`
                    // produced by enumerating one addresses the other.
                    stacking::Step::Window(at) => drawn.push(windows[*at].clone()),
                    stacking::Step::Chrome(rects) => drawn.push(Layer {
                        alpha: 1.0,
                        // The whole quad as `&[]` rather than as one instance
                        // covering it. Both draw the same pixels, but only the
                        // empty one takes the path every frame took before
                        // there were bands — and the test that covers the
                        // other needs a GPU, so on a machine without one the
                        // difference would go unwatched.
                        clip: if rects == &[stacking::WHOLE] {
                            &[]
                        } else {
                            rects
                        },
                        // The desktop itself is not a window: it is never
                        // rounded and casts nothing.
                        corner_radius: 0.0,
                        shadow: None,
                        // The same placement the `Painted` above reports, and
                        // from the same call: drawn in one place and reported
                        // as damaged in another is a desktop that repaints the
                        // wrong rectangle.
                        surface_to_output: chrome_onto_output,
                        texture: &chrome.texture,
                        y_inverted: chrome.y_inverted,
                    }),
                }
            }
            layers = drawn;
        }
        // Bands, where the chrome declared any and has answered for them.
        // Each is a full-size raster that is transparent wherever that depth
        // paints nothing, so they are drawn whole and in depth order rather
        // than clipped out of one another — nothing in them was flattened
        // together, which is the entire reason for having asked separately.
        //
        // Only once every band has answered. A frame drawn from a partial set
        // is the desktop with a layer missing, and asking is a round trip, so
        // half-answered is a state this passes through on any repaint rather
        // than an unusual one. Until then the single `chrome_texture` above is
        // what is drawn, which is the same picture flattened.
        if self.bands.next() == Next::Complete && !self.bands.depths().is_empty() {
            // The order is `bands`' to decide — see `Bands::drawn_with`, which
            // is where it can be tested. What is left here is turning that
            // order into layers, which needs the textures this owns.
            //
            // Indexing rather than `get`, on both arms. `drawn_with`
            // enumerates the depths handed to it, and `depths` and `windows`
            // are built from one vector under one filter, so a window it names
            // is a window there. A band it names was declared, and a declared
            // band that answered has a texture: every place that forgets one
            // forgets the other in the same breath, and `Arrival::AskAgain` is
            // what stops a band being counted answered without.
            layers = self
                .bands
                .drawn_with(&depths)
                .into_iter()
                .map(|drawn| match drawn {
                    Layered::Window(at) => windows[at].clone(),
                    Layered::Band(band) => band_layer(&self.band_textures[&band], to_window),
                })
                .collect();
        }

        let Some(gpu) = self.gpu.as_mut() else {
            return;
        };
        // Taken out for the borrow: binding hands back the renderer, and the
        // shaders live beside it.
        let Some(shaders) = gpu.shaders.take() else {
            return;
        };
        let Some(backend) = gpu.window() else {
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
            draw_layers(&mut frame, &shaders, &layers)?;
            frame.finish()
        })();
        drop(framebuffer);
        if let Some(gpu) = self.gpu.as_mut() {
            gpu.shaders = Some(shaders);
        }
        match drawn {
            Ok(sync) => {
                let _ = sync;
                // Only on `Ok`: a frame that failed to draw is not a frame,
                // and reporting it as one would say the desktop was keeping up
                // while it was blank.
                let backend = self
                    .gpu
                    .as_mut()
                    .and_then(Gpu::window)
                    .expect("present returned early without a window to draw into");
                // What actually changed, rather than `None` — which is
                // always correct and always the most expensive thing to say:
                // a nested host re-reads the whole surface for it, and a
                // display controller can skip nothing.
                // `damage::reported` is the rule for when `None` is still
                // the honest answer.
                let changed = damage::reported(self.painted.as_ref(), &painted, (size.w, size.h))
                    .map(|rects| {
                        rects
                            .into_iter()
                            .map(|rect| {
                                Rectangle::new(
                                    (rect.x, rect.y).into(),
                                    (rect.width, rect.height).into(),
                                )
                            })
                            .collect::<Vec<_>>()
                    });
                let mut reached_the_screen = true;
                record_present(&self.hub.timings, started, || {
                    if let Err(err) = backend.submit(changed.as_deref()) {
                        tracing::warn!(%err, "could not submit the frame");
                        reached_the_screen = false;
                    }
                });
                // Only what was actually presented becomes the next frame's
                // baseline. A submit that failed leaves the screen showing the
                // frame before this one, so recording this one would take the
                // next difference against a picture nobody ever saw — and
                // everything this frame changed would be silently dropped.
                self.painted = reached_the_screen.then_some(damage::Frame {
                    into: (size.w, size.h),
                    layers: painted,
                });
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
        // Only where nothing described the desktop. With displays configured
        // it is a fact about the user's screens, so dragging Domicile's window
        // shows more or less of it rather than resizing it.
        if !self.screens.follows_the_window() {
            return;
        }
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
        // As above: a described display states its own scale, and the chrome's
        // reported density is not a thing to weigh against it.
        if !self.screens.follows_the_window() {
            // Logged because refusing is otherwise invisible: someone who
            // sets a `devicePixelRatio` and sees nothing happen has no way to
            // tell a config that overrode them from a message that never
            // arrived. It is also the only trace this path leaves for a test,
            // which cannot otherwise distinguish "the density was refused"
            // from "no chrome ever spoke".
            debug!(scale, "{}", grepped::DENSITY_REFUSED);
            return;
        }
        let logical = self.screens.size();
        self.set_output(logical, scale);
    }

    /// Advertise the desktop's size and density together, because a mode is
    /// both and neither can be changed without restating the other.
    ///
    /// Only for a window-following desktop. Everything below assumes one
    /// output, and on a described desktop it would rewrite `self.screens` to a
    /// single `Advertised` while `self.outputs` kept the rest — a desktop and
    /// its outputs disagreeing, with nothing to say so. The callers guard, and
    /// this asserts it: the `expect`s further down only find the list
    /// non-empty, which a described desktop is too.
    fn set_output(&mut self, logical: (i32, i32), scale: i32) {
        assert!(
            self.screens.follows_the_window(),
            "a described desktop is the config's, not this function's to replace"
        );
        // Both halves from `Screens`, which carries them together. Reading the
        // scale off the Smithay `Output` instead would be one fact from two
        // places, and it is what made this need a borrow it could not have.
        let advertised = self
            .screens
            .outputs()
            .next()
            .expect("a window-following desktop advertises its one output");
        if self.screens.size() == logical && advertised.scale == scale {
            return;
        }
        info!(
            width = logical.0,
            height = logical.1,
            scale,
            "{}",
            grepped::ADVERTISING
        );
        self.screens = Screens::following_the_window(logical, scale);
        // The mode is physical pixels, so it grows with the scale to
        // hold the logical size still: a denser display is a sharper
        // desktop, not a smaller one. Read back off the *new* `Screens`, not
        // the one the staleness check above looked at, which is the desktop
        // this call is replacing.
        let mode = OutputMode {
            size: self
                .screens
                .outputs()
                .next()
                .expect("a window-following desktop advertises its one output")
                .mode()
                .into(),
            refresh: 60_000,
        };
        let output = &self
            .outputs
            .first()
            .expect("a window-following desktop advertises its one output")
            .output;
        output.change_current_state(Some(mode), None, Some(Scale::Integer(scale)), None);
        output.set_preferred(mode);
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
        // And the desktop the chrome *lays out* against, which is a different
        // fact from the size of its own surface: `<Screen>` positions come
        // from the display list. This path is the one where that changes at
        // runtime — a window resized, or a density adopted — so it does both
        // halves. The retained answer, so the next chrome to connect is told
        // the current desktop rather than the one Domicile started on; and a
        // message now, so the pages already connected are not left laying out
        // against a desktop that is gone.
        //
        // Describe and then broadcast *that* desktop, in that order and on this
        // one thread. Both halves are load-bearing and `freshened` explains
        // why: they are what puts a newer line behind every stale one on every
        // socket, and a describe without a broadcast breaks it.
        let desktop = {
            let mut host = self.hub.host.lock().unwrap();
            host.describe_displays(self.screens.outputs().map(Advertised::described).collect());
            host.describe_desktop()
        };
        self.hub.broadcast(desktop);
    }

    /// Ask the session Domicile's window is in to resize it to the desktop.
    ///
    /// The same question `window_showing_it` answers at startup, asked again
    /// because the desktop is not the same one. Without it a config that
    /// gained a display left the wider desktop scaled into the window it
    /// already had — `logical_to_window` stretching to fit rather than the
    /// window growing to suit, which is a desktop that went blurry and small
    /// rather than one that grew.
    ///
    /// A request rather than a guarantee, exactly as at startup: a window
    /// manager is free to give us something else, `WinitEvent::Resized` is what
    /// says what we got, and the desktop is scaled into whatever that is. Some
    /// return the new size and some answer with a later event, so the answer is
    /// ignored here and the event is what is believed.
    ///
    /// Only where the desktop is described. Where it *follows* the window,
    /// asking would be the tail wagging the dog: `adopt_window_scale` derives
    /// the desktop from the window's size, so a resize from here would feed
    /// its own answer back in.
    ///
    /// A real condition rather than a restated guarantee, because
    /// `adopt_the_desktop` *is* reached with a window-following desktop.
    /// `reloaded_into` has three arms, not two: a config that **stops**
    /// describing displays hands the desktop back to the window as
    /// `compositor.nested_size`, which follows the window and still goes
    /// through here. Asserting instead of returning aborted the compositor on
    /// that edit in a debug build, and in a release one — where the assert is
    /// compiled out — snapped the user's window to `nested_size` for having
    /// deleted a display from their config.
    fn ask_for_a_window_showing_the_desktop(&mut self) {
        if self.screens.follows_the_window() {
            return;
        }
        let within = self.config.current().compositor.nested_size;
        let (width, height) = self.screens.window_showing_it(within);
        let Some(backend) = self.gpu.as_mut().and_then(Gpu::window) else {
            return;
        };
        info!(width, height, "asking for a window that shows the desktop");
        let _ = backend
            .window()
            .request_inner_size(LogicalSize::new(f64::from(width), f64::from(height)));
    }

    /// Take up a desktop the config now describes, keeping the displays that
    /// stayed.
    ///
    /// The counterpart to [`set_output`](DomicileCompositor::set_output),
    /// which is the *window*-following desktop changing under its own steam.
    /// This is the described one changing because the file did, so it is the
    /// only path that can add or remove a display rather than restate the one
    /// there is — and unlike `set_output` it holds for either kind of desktop,
    /// including a config that stopped describing one at all.
    ///
    /// Nothing happens when the desktop did not change. A config file is
    /// rewritten for all sorts of reasons — a chrome package, a keymap, a
    /// stray newline — and an editor's atomic-rename save produces several
    /// events for one edit. Re-advertising the same displays each time would
    /// have every client redraw for nothing.
    ///
    /// The display list is the only thing a reload acts on. `output.max_scale`,
    /// the keymap and the rest are stored and keep their startup values, which
    /// is a gap rather than a decision — `ROADMAP.md` carries it.
    fn adopt_the_desktop(&mut self, dh: &DisplayHandle, screens: Screens) {
        if screens == self.screens {
            return;
        }
        let plan = self.screens.rearranged_into(&screens);
        info!(
            displays = screens.outputs().count(),
            retired = plan.retired.len(),
            "taking up a reloaded desktop"
        );
        // Every old output moved out first, so the new list can take the ones
        // it keeps and what is left is exactly what nothing kept. Taking them
        // in place instead would need the old list borrowed while the new one
        // is built out of it.
        let mut had: Vec<Option<LiveOutput>> = self.outputs.drain(..).map(Some).collect();
        let outputs: Vec<LiveOutput> = plan
            .slots
            .iter()
            .zip(screens.outputs())
            .map(|(slot, advertised)| match slot {
                Slot::Kept(index) => {
                    // Unreachable: `OutputConfig::validate` rejects two
                    // displays with one name and `Screens`' fields are
                    // private, so no public path builds one with duplicates —
                    // and `rearranged_into` matches on the name, so each index
                    // is kept at most once. Asserted rather than coped with
                    // because the alternative is advertising one `wl_output`
                    // as two displays, silently.
                    let live = had[*index]
                        .take()
                        .expect("no two displays share one output");
                    restate_output(&live.output, advertised);
                    live
                }
                Slot::New => advertise_output(dh, advertised),
            })
            .collect();
        // `retired` is exactly the indices no slot kept, by construction, so
        // this cannot reach an output the list above is using and the order of
        // the two loops does not matter. Written after it for reading rather
        // than for safety: what is destroyed is easier to check against a list
        // that is already built.
        for retired in plan.retired {
            let live = had[retired]
                .take()
                .expect("a retired output is one no slot kept");
            // The global rather than the `Output`. Dropping the `Output` frees
            // our own record and leaves the global bound, so the display stays
            // advertised to every client for the rest of the run — a monitor
            // that was unplugged and that nothing can be told about.
            dh.remove_global::<DomicileCompositor>(live.global);
        }
        self.outputs = outputs;
        self.screens = screens;
        // The chrome is on every display, because it *is* the desktop — so a
        // display that just appeared is one it has to be told it is on, and a
        // toolkit picks its density from exactly this.
        if let Some(chrome) = self.chrome_toplevel.clone() {
            for live in &self.outputs {
                live.output.enter(chrome.wl_surface());
            }
            // And it covers the new desktop. Sent unconditionally rather
            // than on a size change, because the desktop can differ without
            // its *size* differing at all: a display renamed, or one whose
            // scale alone moved, leaves the logical bounding box byte for
            // byte the same. The early return above compares whole `Screens`,
            // not sizes. A configure the chrome already has is a no-op to it.
            chrome.with_pending_state(|state| {
                state.size = Some(self.screens.size().into());
            });
            chrome.send_configure();
        }
        // Every window re-narrowed to the displays it is now over. A window
        // that did not move can still be on a different set of them: the
        // displays moved under it.
        self.enter_the_displays_each_window_is_on();
        // A client redraws at a new scale only when something asks it to, and
        // its own size has not changed.
        for (_, toplevel) in &self.toplevels {
            toplevel.send_configure();
        }
        // And the desktop the chrome lays `<Screen>` out against. Described
        // and then broadcast, in that order and on this one thread, for the
        // reason `set_output` gives: that is what puts a newer line behind
        // every stale one on every socket.
        let desktop = {
            let mut host = self.hub.host.lock().unwrap();
            host.describe_displays(self.screens.outputs().map(Advertised::described).collect());
            host.describe_desktop()
        };
        self.hub.broadcast(desktop);
        // And a window the size of the desktop it now shows. Last, because it
        // is a request to the session outside rather than part of describing
        // the desktop within: everything above has to hold whatever the
        // window manager does with this.
        self.ask_for_a_window_showing_the_desktop();
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
        // The brain as well as the seat. Every route that hands the keyboard
        // back to the page comes through here — a click on the desktop,
        // alt-tabbing into Domicile, the chrome's own window mapping — and
        // moving the seat without telling the brain leaves `keyboard_target`
        // naming a window the compositor is no longer typing into, with the
        // chrome still marking it active.
        broadcast_focus_decision(&self.hub, ChromeMessage::FocusChrome);
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
                let logical = window_to_logical(self.screens.size(), (window.0, window.1))
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
                        // Releases are swallowed too, so a client never sees
                        // half of a chord it was not given the start of — but
                        // on the record of what was taken rather than on the
                        // chord the release would match now. The modifiers
                        // move in between: an Enter forwarded on its own, let
                        // go of while alt happens to be down, matches
                        // Alt+Enter and would have had its release swallowed,
                        // leaving that client a key it can never lift.
                        if pressed {
                            match state.shortcuts.press(key.raw(), held) {
                                Some(shortcut) => FilterResult::Intercept(Some(shortcut)),
                                None => FilterResult::Forward,
                            }
                        } else if state.shortcuts.release(key.raw()) {
                            FilterResult::Intercept(None)
                        } else {
                            FilterResult::Forward
                        }
                    },
                );
                if let Some(Some(shortcut)) = grabbed {
                    info!(key = shortcut.key, "a claimed shortcut -> the chrome");
                    self.hub.broadcast(HostMessage::Shortcut { shortcut });
                }
                self.tell_the_chromes_the_modifiers();
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

    /// Tell every chrome which modifiers are held, when that has changed.
    ///
    /// The seat is asked rather than the filter answering, because a key
    /// reaches the seat from three places and only one of them runs a filter
    /// worth reading: the desktop's own keyboard, the keys a chrome injects
    /// into a window, and the releases a dead chrome's held keys are let go
    /// with. All three move the modifiers, so all three end here.
    fn tell_the_chromes_the_modifiers(&mut self) {
        let state = self.seat.get_keyboard().unwrap().modifier_state();
        let now = Modifiers {
            alt: state.alt,
            ctrl: state.ctrl,
            shift: state.shift,
            logo: state.logo,
        };
        if let Some(held) = self.modifiers.moved_to(now) {
            self.hub.broadcast(HostMessage::Modifiers {
                alt: held.alt,
                ctrl: held.ctrl,
                shift: held.shift,
                logo: held.logo,
            });
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
                // message does, because it is the same message. And out to
                // every chrome: this is a focus move the chrome did not ask
                // for, so it is the one it cannot work out for itself.
                broadcast_focus_decision(
                    &self.hub,
                    ChromeMessage::FocusApp {
                        app_id: app_id.clone(),
                    },
                );
            }
            None => {
                info!("clicked -> the chrome has the keyboard");
                // The same for a click that landed on the desktop. The seat
                // moves below either way; without this the brain still names
                // the last window and the chrome still marks it active, one
                // click after the marker was right.
                broadcast_focus_decision(&self.hub, ChromeMessage::FocusChrome);
            }
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
            .unwrap_or(self.screens.size())
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
                self.tell_the_chromes_the_modifiers();
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
            ClientRequest::ScenePlaced => {
                // A placement is also a window possibly having moved to
                // another screen, and nothing else tells the client that.
                self.enter_the_displays_each_window_is_on();
                self.needs_present = true;
            }
            ClientRequest::ChromeHello => {
                // A page has started, and whatever the page before it was
                // holding down is gone along with it: nothing will ever send
                // those releases, and the seat keeps a key down until
                // something does.
                //
                // `hello` is the signal there is rather than the one to want.
                // Every new connection sends one, so on a two-chrome desktop a
                // page starting anywhere drops the keys a user is holding
                // through another — and a chrome that dies and never comes
                // back leaves them down until some page connects. `held` is
                // cleared here on the same terms and for the same reason.
                self.release_pressed_keys();
                // Nothing is held and nothing is owed. The windows a chrome
                // needs are re-supplied by the hand-over pass in `present`,
                // which is what an empty `held` asks for.
                self.held.clear();
                self.pending_damage.clear();
                self.needs_present = true;
                announce_open_apps(&self.hub);
            }
            ClientRequest::PortalRemoved { app_id } => {
                // The element left the page and its canvas went with it, so
                // the chrome no longer holds this window's pixels. Mounted
                // again it is a fresh element with nothing in it, and needs
                // the hand-over a remembered record would skip.
                self.held.remove(&app_id);
                // And nothing is owed to a canvas that no longer exists.
                self.pending_damage.remove(&app_id);
                // A window with no portal is on every display, and this
                // window has just lost one: its element left the page, so
                // there is nothing laid out to place it by. Told nothing, it
                // would keep the screen it was last on and draw at that
                // density wherever the chrome mounts it next.
                //
                // Not the backgrounding case, which never reaches here — a
                // backgrounded tab is laid out invisibly, which arrives as a
                // `place_portal` and so as `ScenePlaced`. `unmounts_the_element`
                // is what tells the two apart.
                self.enter_the_displays_each_window_is_on();
                self.needs_present = true;
            }
            ClientRequest::DeclareBands { depths } => {
                self.bands.declared(depths);
                self.band_textures.clear();
                self.ask_for_the_next_band();
            }
            ClientRequest::SetOutputScale { scale } => self.set_output_scale(scale),
            ClientRequest::CloseApp { app_id } => match self.toplevel_for(&app_id) {
                Some(toplevel) => {
                    info!(%app_id, "close -> client");
                    toplevel.send_close();
                }
                // The window went away while the message was in flight, which
                // is the outcome that was asked for — said out loud rather
                // than passed over, because the other way to reach this line
                // is an id the chrome invented. At `info!` for that reason:
                // the default subscriber is INFO, so a `debug!` here would be
                // the passing over it claims not to be.
                None => info!(%app_id, "close: a window with no toplevel"),
            },
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

    /// Every key the seat still has down, released.
    ///
    /// A key only comes up because something says so, and the two things that
    /// can say so both go away mid-press: the page that forwarded the press
    /// (a reload or a crash delivers no `keyup` for it, and a crash delivers
    /// nothing at all) and the window the compositor reads its own keys from.
    /// The seat outlives both, so the key stays down in it for the rest of the
    /// session.
    ///
    /// For an ordinary key that is a modifier nobody can let go of. For a lock
    /// key it cannot be recovered from at all: xkb unlocks one only on the
    /// release of the press it saw lock it, so while that press is unfinished
    /// every later press of the key is a refcount on the filter already
    /// holding the lock rather than a new toggle. `caps:swapescape` — the
    /// desktop's own default — puts `Caps_Lock` on the physical Escape key, so
    /// one lost release is every window typing in capitals, including the
    /// windows opened afterwards, until Domicile is restarted.
    ///
    /// Releasing a key the user is still physically holding costs that key's
    /// repeat and nothing else: the release that eventually arrives finds
    /// nothing down and changes no state.
    fn release_pressed_keys(&mut self) {
        let keyboard = self.seat.get_keyboard().unwrap();
        let pressed = keyboard.pressed_keys();
        if !pressed.is_empty() {
            info!(
                count = pressed.len(),
                "releasing the keys the seat had down"
            );
        }
        let time = self.now_ms();
        for key in pressed {
            let serial = SERIAL_COUNTER.next_serial();
            keyboard.input::<(), _>(
                self,
                key,
                KeyState::Released,
                serial,
                time,
                |state, _, _| {
                    // Taken here if its press was taken. `pressed_keys` includes
                    // the keys a claimed chord kept from the client — smithay
                    // records a press before it runs the filter, and keeps the set
                    // that would tell them apart to itself — and a client that was
                    // never given a key going down must not be given it coming up.
                    // The seat's own state is updated either way, which is the
                    // half of this that clears a stuck lock.
                    //
                    // The other direction is not worth a record: once this
                    // pass has let a key go, the physical release that arrives
                    // afterwards is forwarded to a client that no longer holds
                    // it. A release for a press a client is not holding is
                    // what `wl_keyboard.leave` already tells it to expect.
                    if state.shortcuts.release(key.raw()) {
                        FilterResult::Intercept(())
                    } else {
                        FilterResult::Forward
                    }
                },
            );
        }
        self.tell_the_chromes_the_modifiers();
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

/// What a surface is called in [`DomicileCompositor::content`] and in the
/// painted frame.
///
/// The chrome is not an app and has no `app_id`, but it is a layer like any
/// other and has to be diffed like one. A name no host-assigned id can collide
/// with, because the two share one map: ids are `app-N`.
fn painted_key(committer: &Committer) -> String {
    match committer {
        Committer::App(app_id) => app_id.clone(),
        Committer::Chrome => CHROME_LAYER.to_string(),
    }
}

/// See [`painted_key`].
const CHROME_LAYER: &str = "<the chrome>";

/// Which of the two kinds of client committed a buffer.
#[derive(Debug)]
enum Committer {
    /// A window on the desktop, named by the id the host gave it.
    App(String),
    /// The engine drawing the desktop itself.
    Chrome,
}

/// A shadow the way the shader wants it: lengths in output pixels, colour
/// channels counted to one.
///
/// Everything a style measures is in the chrome's logical units, so a window on
/// a 2x display casts a shadow twice as far in pixels and looks the same. The
/// colour is the exception — CSS counts channels to 255 and a shader counts
/// everything to one, and alpha is already 0-1 on both sides.
fn shadow_in_pixels(shadow: domicile_scene::Shadow, scale: f64) -> Shadow {
    Shadow {
        blur: (shadow.blur * scale) as f32,
        color: [
            (shadow.color[0] / 255.0) as f32,
            (shadow.color[1] / 255.0) as f32,
            (shadow.color[2] / 255.0) as f32,
            shadow.color[3] as f32,
        ],
        dx: (shadow.dx * scale) as f32,
        dy: (shadow.dy * scale) as f32,
        spread: (shadow.spread * scale) as f32,
    }
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

/// Record what one present cost, with the submit's time kept out of the
/// drawing's.
///
/// The submit is `eglSwapBuffers`, and on a window nested in another
/// compositor it blocks until that compositor hands back a frame callback.
/// Counting that wait as drawing made `composite_ms` say the compositor could
/// not keep up precisely when nothing was being asked of it.
///
/// This owns the recording rather than handing two durations back, because the
/// defect was never in the arithmetic — it was a caller assigning the wrong
/// span to the right field, and a caller with no durations in its hands has
/// nothing to misassign. It is not sealed: submitting *outside* the closure
/// and passing an empty one puts the wait back in `composite_ms`. Sealing it
/// would take a `&mut impl Submits` whose exclusive borrow makes that a
/// visible double submit, which is machinery against a mutation that reads as
/// wrong on sight — passing `|| {}` to a parameter called `submit`.
///
/// `composited` counts here too: a present that drew is a present that
/// submitted, and the count and the two timings have to describe the same
/// frames or the self-check over them means nothing.
///
/// Neither span is the whole cost. GLES hands work to the driver rather than
/// doing it, so `composite_ms` under-reports the GPU's share and `submit_ms`
/// carries it along with the wait.
fn record_present(timings: &Mutex<FrameTimings>, started: Instant, submit: impl FnOnce()) {
    let composing = started.elapsed();
    let submitting = Instant::now();
    submit();
    let submitted = submitting.elapsed();
    let mut timings = timings.lock().unwrap();
    timings.composited += 1;
    timings.composite.record(composing);
    timings.submit.record(submitted);
}

/// RGBA, which is what the readback produces and what `ImageData` takes.
const BYTES_PER_PIXEL: usize = 4;

/// A rectangle of a client's buffer, in buffer pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl Region {
    fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Region {
            x,
            y,
            width,
            height,
        }
    }
}

/// Damage the chrome has not been shown yet.
///
/// Not every frame reaches it: the throttle drops one that came too soon after
/// the last, and a full outbound queue refuses one outright. Neither clears
/// `copied`, so the chrome goes on holding the frame *before* the dropped one
/// — and a partial frame after that would patch around the hole rather than
/// over it, leaving a stale rectangle in a live window until the client next
/// touched those pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PendingDamage {
    /// A client that reported no damage, which is not a claim that little
    /// changed. Sticky: folding a smaller claim into it must not shrink it.
    Everything,
    /// The box around everything not yet drawn.
    Region(Region),
}

/// Fold this commit's damage into whatever has not reached the chrome yet.
fn accumulate(pending: Option<PendingDamage>, latest: Option<Region>) -> PendingDamage {
    match (pending, latest) {
        (Some(PendingDamage::Everything), _) | (_, None) => PendingDamage::Everything,
        (None, Some(region)) => PendingDamage::Region(region),
        (Some(PendingDamage::Region(held)), Some(region)) => {
            // Saturating for the same reason as `damage_bounds`: neither box
            // has been clamped to the buffer yet, so both still carry whatever
            // the client asked for.
            let right = held
                .x
                .saturating_add(held.width)
                .max(region.x.saturating_add(region.width));
            let bottom = held
                .y
                .saturating_add(held.height)
                .max(region.y.saturating_add(region.height));
            let (x, y) = (held.x.min(region.x), held.y.min(region.y));
            PendingDamage::Region(Region::new(x, y, right - x, bottom - y))
        }
    }
}

/// What a frame costs the chrome, and what it leaves owed.
///
/// The whole decision in one place because its two halves are one rule: damage
/// is recorded before anything can drop the frame, and cleared only where a
/// frame actually goes. Split across `publish_frame`'s early returns it was
/// prose — moving the record below the throttle, or dropping either clear,
/// left the suite green while a client's pixels went missing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Frame {
    /// Dropped before it was drawn. Whatever it changed is still owed.
    Held(PendingDamage),
    /// Drawn by the compositor; the chrome holds nothing for this window.
    Native,
    /// Sent, with the region the chrome should patch — `None` for all of it.
    Sent(Option<Region>),
}

/// Decide a frame's fate from what is known before any of it is done.
fn frame_fate(
    taking: Disposition,
    pending: PendingDamage,
    held: Option<(u32, u32)>,
    size: (u32, u32),
) -> Frame {
    match taking {
        Disposition::Throttle => Frame::Held(pending),
        Disposition::Draw => Frame::Native,
        Disposition::Send => Frame::Sent(region_to_send(pending, held, size)),
    }
}

/// Fold this commit's damage into what the chrome is owed, and keep it there.
///
/// Kept rather than taken: a frame reaches the chrome only if it survives the
/// throttle and the outbound queue, and the debt is cleared where it is paid.
/// Every other path out of `publish_frame` is then correct by doing nothing.
fn owed(
    pending_damage: &mut HashMap<String, PendingDamage>,
    app_id: &str,
    damaged: Option<Region>,
) -> PendingDamage {
    let pending = accumulate(pending_damage.get(app_id).copied(), damaged);
    pending_damage.insert(app_id.to_string(), pending);
    pending
}

/// Which part of a frame the chrome needs, or `None` for all of it.
///
/// The copy path's cost is bytes: a frame is megabytes, and it crosses a Unix
/// socket and then Electron's process boundary, which together measured ~103ms
/// against ~8ms for the readback that produced it. A client that changed a
/// cursor cell should pay for a cursor cell.
///
/// Sending less is only sound when the chrome still holds the frame this one
/// patches, which is why every case that leaves it holding nothing — or
/// holding a canvas that is about to be reset — asks for the whole buffer.
fn region_to_send(
    pending: PendingDamage,
    held: Option<(u32, u32)>,
    (width, height): (u32, u32),
) -> Option<Region> {
    // One comparison for both halves of the question, and that is the point:
    // assigning either canvas dimension resets the backing store, so a chrome
    // holding this window at another size is holding a blank canvas — which is
    // the same situation as holding nothing, and cannot be told apart from it
    // by a record that keeps them in separate maps.
    if held != Some((width, height)) {
        None
    } else {
        match pending {
            PendingDamage::Everything => None,
            PendingDamage::Region(region) => clamp_to(region, (width, height))
                .filter(|region| region.width < width || region.height < height),
        }
    }
}

/// The part of `region` that lies inside the buffer, if any of it does.
fn clamp_to(region: Region, (width, height): (u32, u32)) -> Option<Region> {
    let right = region.x.saturating_add(region.width).min(width);
    let bottom = region.y.saturating_add(region.height).min(height);
    // Wholly outside: there is nothing to crop to, and sending nothing would
    // freeze the window. The caller reads `None` as "send all of it".
    if region.x >= right || region.y >= bottom {
        None
    } else {
        Some(Region::new(
            region.x,
            region.y,
            right - region.x,
            bottom - region.y,
        ))
    }
}

/// How much of a frame to read back off the GPU.
///
/// The same region it is going to be sent as, because the readback is a
/// pipeline stall proportional to what it reads and there is nothing to do
/// with the rest. It is the last cost on the copy path that was still
/// proportional to the window rather than to what changed: a client moving a
/// cursor cell stalled for a window.
///
/// `None` reads the whole buffer, which is what a frame the chrome cannot
/// patch needs. A frame nobody is sending reads nothing extra either way —
/// `Native` never leaves the GPU, and `Held` returned before this — so the
/// safe answer is the whole one.
fn readback_area(fate: Frame) -> Option<Region> {
    match fate {
        Frame::Sent(region) => region,
        Frame::Held(_) | Frame::Native => None,
    }
}

/// The bytes for a partial frame.
///
/// A GPU frame is *already* only those rows: the readback took them and
/// nothing else, which is the whole point of narrowing it — reading a window
/// to send a cursor cell is a pipeline stall paid for pixels that are then
/// thrown away. A software client's pixels are the whole buffer, because that
/// is what it committed and what `latest_frames` has to go on keeping, so
/// those are cropped here.
fn only_the_region(
    rgba: Arc<Vec<u8>>,
    already_narrowed: bool,
    width: u32,
    region: Region,
) -> Arc<Vec<u8>> {
    if already_narrowed {
        rgba
    } else {
        Arc::new(crop_region(&rgba, width, region))
    }
}

/// The rows and columns `region` names, packed tight.
///
/// The caller has already clamped `region` to the buffer, so every index here
/// is inside it.
fn crop_region(rgba: &[u8], width: u32, region: Region) -> Vec<u8> {
    let stride = width as usize * BYTES_PER_PIXEL;
    let run = region.width as usize * BYTES_PER_PIXEL;
    let left = region.x as usize * BYTES_PER_PIXEL;
    (region.y..region.y + region.height)
        .flat_map(|row| {
            let start = row as usize * stride + left;
            rgba[start..start + run].iter().copied()
        })
        .collect()
}

/// The bounds of what a client damaged since the last commit, leaving nothing
/// behind.
///
/// Taken, not read. Smithay aggregates damage in the current state until the
/// compositor clears it — `Cacheable for SurfaceAttributes` does
/// `into.damage.extend(self.damage)` — so borrowing it gives every rectangle
/// the surface has ever reported: a vector growing for the life of the window,
/// walked on every commit by the Wayland thread, and a box that only ever
/// widens until it is the whole window and none of this saves anything.
///
/// What is owed *across dropped frames* is `pending_damage`'s job, where it is
/// bounded and cleared where it is paid.
fn take_damage(damage: &mut Vec<Damage>, buffer_scale: i32) -> Option<Region> {
    damage_bounds(&std::mem::take(damage), buffer_scale)
}

/// The one rectangle covering everything a client said it changed.
///
/// A bounding box rather than the rectangles themselves: the win is not paying
/// for a whole window when a cursor cell moved, and a box captures that. Two
/// far-apart edits fall back to most of the window, which is the honest answer
/// for a single blit anyway.
///
/// `Surface` damage is in logical units and `Buffer` damage is already in
/// buffer pixels, so the first is scaled and the second is not — mixing them up
/// silently under-damages a HiDPI window, which draws as a stale band down the
/// right and bottom of whatever changed.
fn damage_bounds(damage: &[Damage], buffer_scale: i32) -> Option<Region> {
    let scale = buffer_scale.max(1);
    damage
        .iter()
        .map(|reported| match reported {
            // Saturating throughout: `wl_surface.damage` takes four `i32`s a
            // client picks, and "everything changed" is conventionally
            // `(0, 0, i32::MAX, i32::MAX)`. Multiplied by a scale that
            // overflows, a debug build panics on the Wayland thread — taking
            // the compositor and every client on it — and a release build
            // wraps negative, which the positive filter below then drops, so
            // the client's claim that all of it changed disappears. The result
            // is clamped to the buffer a moment later, so a saturated value
            // costs nothing.
            Damage::Surface(rect) => (
                rect.loc.x.saturating_mul(scale),
                rect.loc.y.saturating_mul(scale),
                rect.size.w.saturating_mul(scale),
                rect.size.h.saturating_mul(scale),
            ),
            Damage::Buffer(rect) => (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h),
        })
        .filter(|(_, _, w, h)| *w > 0 && *h > 0)
        .map(|(x, y, w, h)| (x, y, x.saturating_add(w), y.saturating_add(h)))
        .reduce(|(ax, ay, ar, ab), (bx, by, br, bb)| {
            (ax.min(bx), ay.min(by), ar.max(br), ab.max(bb))
        })
        .map(|(x, y, right, bottom)| {
            // A client may damage at a negative offset; the part off the top
            // or left of the buffer is not ours to draw.
            let (x, y) = (x.max(0), y.max(0));
            Region::new(
                x as u32,
                y as u32,
                (right - x).max(0) as u32,
                (bottom - y).max(0) as u32,
            )
        })
}

#[cfg(test)]
mod damage_tests {
    use smithay::utils::{Buffer as BufferCoords, Physical, Point, Rectangle, Size};

    use super::{
        accumulate, crop_region, damage_bounds, frame_fate, only_the_region, owed, readback_area,
        region_to_send, take_damage, Damage, Disposition, Frame, PendingDamage, Region,
    };
    use std::collections::HashMap;
    use std::sync::Arc;

    fn buffer(x: i32, y: i32, w: i32, h: i32) -> Damage {
        Damage::Buffer(Rectangle::new(
            Point::<i32, BufferCoords>::from((x, y)),
            Size::<i32, BufferCoords>::from((w, h)),
        ))
    }

    fn surface(x: i32, y: i32, w: i32, h: i32) -> Damage {
        Damage::Surface(Rectangle::new(
            Point::<i32, Physical>::from((x, y)).to_logical(1),
            Size::<i32, Physical>::from((w, h)).to_logical(1),
        ))
    }

    #[test]
    fn taking_the_damage_leaves_none_for_the_next_commit() {
        // Smithay aggregates damage from commit to commit until it is cleared,
        // so reading it without taking gives every rectangle the surface has
        // ever reported. The box then only widens, converges on the whole
        // window, and a blinking cursor costs a whole frame again — which is
        // the thing this all exists to stop.
        let mut damage = vec![surface(1, 1, 2, 2)];

        let first = take_damage(&mut damage, 1);
        let second = take_damage(&mut damage, 1);

        assert_eq!(first, Some(Region::new(1, 1, 2, 2)));
        assert_eq!(second, None, "the next commit starts from nothing");
    }

    #[test]
    fn nothing_reported_is_no_bounds() {
        assert_eq!(damage_bounds(&[], 1), None);
    }

    #[test]
    fn two_rectangles_become_the_box_around_both() {
        assert_eq!(
            damage_bounds(&[surface(1, 1, 2, 2), surface(10, 5, 1, 1)], 1),
            Some(Region::new(1, 1, 10, 5))
        );
    }

    #[test]
    fn surface_damage_scales_to_buffer_pixels() {
        // The half a HiDPI window gets wrong if this is skipped: the client
        // damages in logical units and the buffer is twice that, so an
        // unscaled box leaves a stale band down the right and bottom of
        // whatever changed.
        assert_eq!(
            damage_bounds(&[surface(3, 4, 5, 6)], 2),
            Some(Region::new(6, 8, 10, 12))
        );
    }

    #[test]
    fn a_client_claiming_everything_is_not_multiplied_into_nothing() {
        // `(0, 0, i32::MAX, i32::MAX)` is how a client conventionally says all
        // of it changed. Multiplied by a scale it overflows: a debug build
        // panics on the Wayland thread, taking the compositor and every client
        // on it, and a release build wraps negative — which the positive
        // filter drops, so the loudest claim a client can make becomes no
        // claim at all.
        let bounds = damage_bounds(&[surface(0, 0, i32::MAX, i32::MAX)], 2);

        // Saturating at `i32::MAX` rather than wrapping: the arithmetic is in
        // the type the client's numbers arrive in. Clamped to the buffer a
        // moment later, so the exact ceiling does not matter — that it is a
        // ceiling rather than a negative number does.
        assert_eq!(
            bounds,
            Some(Region::new(0, 0, i32::MAX as u32, i32::MAX as u32))
        );
    }

    #[test]
    fn damage_starting_near_the_end_of_the_axis_does_not_wrap() {
        let bounds = damage_bounds(&[surface(i32::MAX - 1, 0, 8, 8)], 1);

        assert_eq!(
            bounds,
            Some(Region::new((i32::MAX - 1) as u32, 0, 1, 8)),
            "the far edge saturates rather than wrapping behind the near one"
        );
    }

    #[test]
    fn a_damage_offset_past_the_scale_saturates_rather_than_folding_back() {
        // The location is scaled too, and it is the term the two tests above
        // miss between them: the far-edge case runs at scale 1, where nothing
        // is multiplied, and the `i32::MAX` case starts at the origin, where
        // the multiply is zero.
        //
        // A near rectangle and an absurd one. Wrapping puts the far one at
        // -294967296, which is *behind* the near one — so the box that should
        // cover both stops at the near one's edge, and every pixel past it is
        // left holding whatever the last frame put there.
        let bounds = damage_bounds(&[surface(0, 0, 4, 4), surface(2_000_000_000, 0, 8, 8)], 2);

        assert_eq!(bounds, Some(Region::new(0, 0, i32::MAX as u32, 16)));
    }

    #[test]
    fn a_pending_box_near_the_end_of_the_axis_does_not_wrap() {
        let carried = accumulate(
            Some(PendingDamage::Region(Region::new(0, 0, u32::MAX, 4))),
            Some(Region::new(1, 1, 2, 2)),
        );

        assert_eq!(
            carried,
            PendingDamage::Region(Region::new(0, 0, u32::MAX, 4))
        );
    }

    #[test]
    fn buffer_damage_is_already_in_buffer_pixels() {
        // The arm most clients take: `damage_buffer` has been the preferred
        // request since `wl_compositor` v4. Scaling it the way surface damage
        // is scaled would over-damage a HiDPI window by the scale factor —
        // the mirror of the bug the test below guards.
        assert_eq!(
            damage_bounds(&[buffer(3, 4, 5, 6)], 2),
            Some(Region::new(3, 4, 5, 6))
        );
    }

    #[test]
    fn damage_reaching_off_the_top_left_starts_at_the_corner() {
        assert_eq!(
            damage_bounds(&[surface(-4, -2, 8, 6)], 1),
            Some(Region::new(0, 0, 4, 4))
        );
    }

    const FULL: (u32, u32) = (4, 3);

    #[test]
    fn a_throttled_frame_stays_owed() {
        // The bug this whole accumulator exists for: a frame the throttle
        // dropped leaves the chrome holding the one before it, so what this
        // one changed has to survive to the next.
        let pending = PendingDamage::Region(Region::new(1, 1, 2, 2));

        assert_eq!(
            frame_fate(Disposition::Throttle, pending, Some(FULL), FULL),
            Frame::Held(pending)
        );
    }

    #[test]
    fn a_frame_the_compositor_draws_owes_the_chrome_nothing() {
        // The chrome has no canvas for a natively drawn window, so there is
        // nothing to patch and nothing to remember.
        assert_eq!(
            frame_fate(
                Disposition::Draw,
                PendingDamage::Region(Region::new(1, 1, 2, 2)),
                Some(FULL),
                FULL
            ),
            Frame::Native
        );
    }

    #[test]
    fn a_frame_that_goes_carries_its_region_and_owes_nothing_after() {
        assert_eq!(
            frame_fate(
                Disposition::Send,
                PendingDamage::Region(Region::new(1, 1, 2, 2)),
                Some(FULL),
                FULL
            ),
            Frame::Sent(Some(Region::new(1, 1, 2, 2)))
        );
    }

    #[test]
    fn damage_from_a_frame_that_never_went_is_carried_to_the_next_one() {
        // The bug this exists to prevent. Two paths drop a frame after the
        // chrome already holds pixels — the throttle, and an outbound queue
        // that is full — and neither clears `copied`. Without carrying the
        // damage forward the next frame is sent partial, and whatever the
        // dropped frame changed is never drawn: a stale rectangle in a live
        // window, for as long as the client leaves those pixels alone.
        let carried = accumulate(
            Some(PendingDamage::Region(Region::new(0, 0, 2, 2))),
            Some(Region::new(6, 6, 2, 2)),
        );

        assert_eq!(carried, PendingDamage::Region(Region::new(0, 0, 8, 8)));
    }

    #[test]
    fn damage_stays_owed_until_a_frame_actually_goes() {
        // The bug the arithmetic alone does not catch: `owed` records before
        // the throttle can drop the frame, and only a send clears it. Two
        // dropped frames in a row owe the box around both.
        let mut owing = HashMap::new();

        owed(&mut owing, "term", Some(Region::new(0, 0, 2, 2)));
        let after_two = owed(&mut owing, "term", Some(Region::new(6, 6, 2, 2)));

        assert_eq!(after_two, PendingDamage::Region(Region::new(0, 0, 8, 8)));
        assert_eq!(
            owing.get("term"),
            Some(&PendingDamage::Region(Region::new(0, 0, 8, 8))),
            "a frame that never went is still owed"
        );
    }

    #[test]
    fn a_frame_that_went_leaves_nothing_owed() {
        let mut owing = HashMap::new();
        owed(&mut owing, "term", Some(Region::new(0, 0, 2, 2)));

        owing.remove("term");
        let next = owed(&mut owing, "term", Some(Region::new(6, 6, 2, 2)));

        assert_eq!(
            next,
            PendingDamage::Region(Region::new(6, 6, 2, 2)),
            "the frame that went is not owed a second time"
        );
    }

    #[test]
    fn nothing_pending_carries_only_this_frame() {
        assert_eq!(
            accumulate(None, Some(Region::new(1, 2, 3, 4))),
            PendingDamage::Region(Region::new(1, 2, 3, 4))
        );
    }

    #[test]
    fn a_dropped_frame_that_claimed_everything_keeps_claiming_it() {
        // `Everything` is what a client reporting no damage means, and it has
        // to survive being folded with a later, smaller claim — otherwise a
        // tiny commit after a full one would shrink the region and lose the
        // rest.
        assert_eq!(
            accumulate(
                Some(PendingDamage::Everything),
                Some(Region::new(1, 1, 1, 1))
            ),
            PendingDamage::Everything
        );
    }

    #[test]
    fn a_frame_claiming_everything_widens_what_was_pending() {
        assert_eq!(
            accumulate(Some(PendingDamage::Region(Region::new(1, 1, 1, 1))), None),
            PendingDamage::Everything
        );
    }

    #[test]
    fn a_chrome_holding_nothing_gets_the_whole_buffer() {
        // A partial frame is only meaningful against the previous one. The
        // chrome that has no canvas yet — first frame, or one whose pixels
        // were handed back when the window went native — has nothing to patch,
        // so a damaged region would leave the rest of the window undrawn.
        assert_eq!(
            region_to_send(PendingDamage::Region(Region::new(1, 1, 2, 2)), None, FULL),
            None
        );
    }

    #[test]
    fn a_resize_gets_the_whole_buffer() {
        // Assigning either canvas dimension resets the backing store, so the
        // frame that reports a new size is drawing into a blank canvas — and
        // "holding another size" is the only way that is visible from here.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(1, 1, 2, 2)),
                Some((FULL.0, FULL.1 + 1)),
                FULL
            ),
            None
        );
    }

    #[test]
    fn a_client_that_reported_no_damage_gets_the_whole_buffer() {
        // `wl_surface.damage` is what a client uses to say less than
        // everything changed. Saying nothing is not the same claim, and a
        // client that omits it entirely has to be taken at its word that the
        // frame is new.
        assert_eq!(
            region_to_send(PendingDamage::Everything, Some(FULL), FULL),
            None
        );
    }

    #[test]
    fn damage_covering_the_buffer_is_sent_as_the_whole_buffer() {
        // Cropping to the full size is the same bytes plus the arithmetic, and
        // it costs the chrome a sub-image blit where a plain one would do.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(0, 0, 4, 3)),
                Some(FULL),
                FULL
            ),
            None
        );
    }

    #[test]
    fn only_the_part_being_sent_is_read_back() {
        // The whole point. Reading a window off the GPU to send a cursor cell
        // is a pipeline stall paid for pixels that are then thrown away, and
        // it was the last cost on this path still proportional to the window.
        let corner = Region::new(1, 1, 2, 2);

        assert_eq!(
            readback_area(Frame::Sent(Some(corner))),
            Some(corner),
            "a patch reads the patch"
        );
        assert_eq!(
            readback_area(Frame::Sent(None)),
            None,
            "a frame the chrome cannot patch reads all of it"
        );
        assert_eq!(
            readback_area(Frame::Native),
            None,
            "a frame the compositor draws is not read back at all, and a region \
             would be a claim about a readback that does not happen"
        );
        assert_eq!(
            readback_area(Frame::Held(PendingDamage::Everything)),
            None,
            "nor is one the throttle dropped"
        );
    }

    #[test]
    fn a_gpu_frame_is_sent_as_it_was_read_back() {
        // The readback already took only the region, so cropping it again
        // would take a corner *of the corner*: the second crop reads with the
        // full buffer's stride across bytes that no longer have one.
        let patch = Arc::new(vec![1, 2, 3, 4, 5, 6, 7, 8]);

        let sending = only_the_region(Arc::clone(&patch), true, 4, Region::new(1, 1, 1, 2));

        assert!(
            Arc::ptr_eq(&sending, &patch),
            "handed on, not cropped a second time"
        );
    }

    #[test]
    fn a_software_frame_is_cropped_to_the_region() {
        // Nothing narrowed a `wl_shm` client's pixels: they are the whole
        // buffer, because that is what it committed and what `latest_frames`
        // keeps.
        let whole: Vec<u8> = (0..(2 * 2 * 4) as u8).collect();

        let sending = only_the_region(Arc::new(whole), false, 2, Region::new(1, 0, 1, 1));

        assert_eq!(*sending, vec![4, 5, 6, 7]);
    }

    #[test]
    fn a_damaged_corner_is_sent_as_that_corner() {
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(1, 1, 2, 2)),
                Some(FULL),
                FULL
            ),
            Some(Region::new(1, 1, 2, 2))
        );
    }

    #[test]
    fn damage_past_the_buffer_is_clamped_to_it() {
        // A client may damage in surface coordinates that round outward, or
        // simply overreach. Trusting it would read past the frame.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(3, 2, 99, 99)),
                Some(FULL),
                FULL
            ),
            Some(Region::new(3, 2, 1, 1))
        );
    }

    #[test]
    fn damage_spanning_one_full_axis_is_still_sent_partially() {
        // The commonest partial damage there is: a terminal scrolling a line
        // damages the full width and a few rows, and so does a status bar or a
        // progress bar. Requiring both axes to be smaller sends every one of
        // those whole, which is most of the win.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(0, 0, 4, 2)),
                Some(FULL),
                FULL
            ),
            Some(Region::new(0, 0, 4, 2))
        );
    }

    #[test]
    fn damage_starting_at_the_far_edge_sends_the_whole_buffer() {
        // A client damaging just past its own edge. Clamped, this region has
        // zero width — and a zero-width patch reaches the chrome as
        // `new ImageData(bytes, 0, h)`, which throws inside the frame handler
        // rather than merely drawing the wrong thing.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(4, 0, 2, 2)),
                Some(FULL),
                FULL
            ),
            None
        );
    }

    #[test]
    fn damage_outside_on_one_axis_only_sends_the_whole_buffer() {
        // Outside on one axis is enough. Treating it as inside underflows
        // `right - region.x` on `u32`, which is a panic on the Wayland thread
        // in debug and a ~17GB slice index in release.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(9, 0, 2, 2)),
                Some(FULL),
                FULL
            ),
            None
        );
    }

    #[test]
    fn damage_wholly_outside_the_buffer_sends_the_whole_buffer() {
        // Nothing to crop to. Sending everything is wrong-but-visible rather
        // than sending nothing, which would freeze the window.
        assert_eq!(
            region_to_send(
                PendingDamage::Region(Region::new(9, 9, 2, 2)),
                Some(FULL),
                FULL
            ),
            None
        );
    }

    #[test]
    fn cropping_takes_the_rows_the_region_names() {
        // 4x3 RGBA where each pixel's red channel is its index, so a wrong
        // stride or offset shows up as the wrong numbers rather than as a
        // length that happens to match.
        let rgba: Vec<u8> = (0..12u8).flat_map(|i| [i, 0, 0, 255]).collect();

        // Non-square and at an asymmetric offset on purpose: with a 2x2 at
        // (1,1), `x` and `y` are interchangeable and so are `width` and
        // `height`, so a crop taking its column offset from `y` or its run
        // length from `height` reads exactly the same bytes.
        let cropped = crop_region(&rgba, 4, Region::new(2, 1, 1, 2));

        // Column 2 of row 1 is pixel 6; column 2 of row 2 is pixel 10.
        assert_eq!(cropped, vec![6, 0, 0, 255, 10, 0, 0, 255]);
    }
}

/// Whether a client's commit should be drawn, or dropped on the floor.
///
/// The throttle is the copy path's, and it exists for the socket: a frame is
/// megabytes, and a chrome that reads slowly is a chrome whose socket fills
/// within a frame or two. Dropping one costs nothing there, because the next
/// supersedes it.
fn frame_is_due(since_last: Option<Duration>) -> bool {
    since_last.map_or(true, |elapsed| elapsed >= Duration::from_millis(33))
}

/// What becomes of a client's newly-committed frame.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Disposition {
    /// Drawn by the compositor from the client's own buffer. Nothing is copied
    /// and nothing is sent, so nothing is throttled either: it costs a texture
    /// bind and a quad, and refusing half of them would only hold a stale
    /// desktop between the ones drawn. Measured: kitty committing ~59 times a
    /// second had ~29 of them composited, for nothing.
    Draw,
    /// Read back and sent for the chrome to draw into a canvas.
    Send,
    /// Superseded before it could be sent. See [`frame_is_due`].
    Throttle,
}

/// Which of the two paths this frame takes, and whether it is due at all.
///
/// Three things have to hold for the compositor to draw a window itself, and
/// each fails for a different desktop:
///
/// - there is an output to draw into. A headless run copies everything, which
///   is what every check in the repo drives.
/// - the chrome has not asked for this window to be copied, because its
///   element wears a style the shaders have no answer for.
/// - the client committed a **dmabuf**. A `wl_shm` client's pixels are in main
///   memory and are never imported as a texture, so that window is on the copy
///   path whatever its CSS says. Reading only the first two would call it
///   composited and hand it an unthrottled socket, which is a megabyte per
///   commit down a queue one frame deep.
fn disposition(
    from_gpu: bool,
    presenting: bool,
    draws_natively: bool,
    since_last: Option<Duration>,
) -> Disposition {
    if from_gpu && presenting && draws_natively {
        Disposition::Draw
    } else if frame_is_due(since_last) {
        Disposition::Send
    } else {
        Disposition::Throttle
    }
}

/// Whether this app's own buffer is what the compositor draws.
///
/// False for a window whose chrome reported a style the shaders have no answer
/// for. That window goes back down the copy path — read back, sent over the
/// socket, drawn into a canvas by the engine — which is slow and correct
/// rather than fast and wrong. Every other window on the desktop stays native.
///
/// An app with no portal is treated as native, because the fast path is the
/// one to be on and a placement always arrives before it matters. That is not
/// only the moment before the first placement: a *hidden* window has no portal
/// either, and reading absence as "copy this" would put every backgrounded
/// window on the socket for frames nobody is looking at.
fn draws_natively(scene: &Scene, app_id: &str) -> bool {
    scene
        .get(app_id)
        .map_or(true, |portal| portal.draws_natively)
}

/// The message telling the chrome to drop a window's pixels, if it has any.
///
/// `None` for a chrome that was never sent this window's pixels, which is
/// every window that has only ever been drawn natively — and is why this is
/// asked on the frame the compositor draws rather than when the placement
/// arrived. Until there is a texture to put in the canvas's place, dropping it
/// would blank the window.
fn hand_back(app_id: &str, held: &mut HashMap<String, (u32, u32)>) -> Option<HostMessage> {
    held.remove(app_id).map(|_| HostMessage::AppComposited {
        app_id: app_id.to_string(),
    })
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
        // Before anything below can return early, which is deliberately the
        // *over*-reporting choice: a commit that attaches no buffer, or one
        // whose buffer we cannot use, moves this counter without changing a
        // drawn pixel, and the frame after it damages this window for nothing.
        // Bumping where the texture is actually replaced would be exact — and
        // would have to be right in three places instead of one, with a stale
        // pixel as the price of missing any of them.
        *self.content.entry(painted_key(&committer)).or_default() += 1;

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
        let (attached, callbacks, buffer_scale, damaged) = with_states(surface, |states| {
            let mut guard = states.cached_state.get::<SurfaceAttributes>();
            let attrs = guard.current();
            let attached = match attrs.buffer.take() {
                Some(BufferAssignment::NewBuffer(buffer)) => Some(buffer),
                Some(BufferAssignment::Removed) | None => None,
            };
            let callbacks = std::mem::take(&mut attrs.frame_callbacks);
            // Taken, not read. Smithay aggregates damage from commit to commit
            // until the compositor clears it — `Cacheable for
            // SurfaceAttributes` does `into.damage.extend(self.damage)` — so
            // borrowing it gives every rectangle the surface has ever
            // reported. That is a vector growing for the life of the window,
            // walked on every commit by the Wayland thread, and a bounding box
            // that only ever widens until it is the whole window and this
            // stops saving anything. What is owed across dropped frames is
            // `pending_damage`'s job, where it is bounded and testable.
            let damaged = take_damage(&mut attrs.damage, attrs.buffer_scale);
            // How many buffer pixels the client drew per logical unit. Taken
            // here with the buffer rather than looked up later: it is the
            // scale *this* buffer was drawn at, and a client that is mid-way
            // through answering a scale change will commit the next one at a
            // different number.
            (attached, callbacks, attrs.buffer_scale, damaged)
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
                Committer::App(app_id) => {
                    self.publish_frame(app_id, &buffer, buffer_scale, damaged)
                }
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

/// The desktop a config describes, at startup.
///
/// Startup only. A *reload* asks a different question — see
/// [`Screens::reloaded_into`], which is allowed to answer "leave it alone":
/// nothing has negotiated with the host yet when this runs, so there is
/// nothing here for a config to overwrite.
fn screens_at_startup(config: &Config) -> Screens {
    match config.output.desktop() {
        Some(desktop) => Screens::described(&desktop),
        None => Screens::nested(config.compositor.nested_size),
    }
}

/// One advertised `wl_output`, and the global clients see it through.
///
/// The global's id is kept because a desktop can stop describing a display.
/// Destroying the global is how a client learns the monitor is gone, and
/// `DisplayHandle::remove_global` is the only thing that does it — dropping
/// the `Output` alone leaves the global bound and the display advertised for
/// the rest of the run.
struct LiveOutput {
    output: Output,
    global: smithay::reexports::wayland_server::backend::GlobalId,
}

/// Advertise `advertised` as a new `wl_output`.
///
/// The one place an output is created, so startup and a config reload cannot
/// advertise two different things from the same description.
fn advertise_output(dh: &DisplayHandle, advertised: &Advertised) -> LiveOutput {
    let output = Output::new(
        advertised.name.clone(),
        PhysicalProperties {
            // Fiction, and knowingly the same fiction on every display:
            // nothing tells a nested compositor how many millimetres a
            // described screen is. A client computing DPI from it gets a wrong
            // answer — now a differently wrong one per display, since they no
            // longer share a size. Whatever fixes that wants a real number in
            // the config, which nothing has asked for.
            size: (300, 200).into(),
            subpixel: Subpixel::Unknown,
            make: "Domicile".into(),
            model: "Virtual".into(),
        },
    );
    let global = output.create_global::<DomicileCompositor>(dh);
    restate_output(&output, advertised);
    LiveOutput { output, global }
}

/// Restate an existing output's mode, scale and position.
///
/// Apart from creating one because a display that only changed shape keeps the
/// `wl_output` it had — see [`Slot::Kept`], which says what destroying it
/// instead would tell a client.
fn restate_output(output: &Output, advertised: &Advertised) {
    let mode = OutputMode {
        size: advertised.mode().into(),
        refresh: 60_000,
    };
    output.change_current_state(
        Some(mode),
        Some(Transform::Normal),
        Some(Scale::Integer(advertised.scale)),
        Some(advertised.position.into()),
    );
    output.set_preferred(mode);
}

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
            for live in &self.outputs {
                live.output.enter(surface.wl_surface());
            }
            // It covers the desktop, because it *is* the desktop. A size it did
            // not ask for is exactly what a compositor gives a fullscreen
            // window, and the portals it reports back are in these units.
            surface.with_pending_state(|state| {
                state.size = Some(self.screens.size().into());
            });
            self.chrome_toplevel = Some(surface);
            self.focus_chrome();
            return;
        }

        // A client mapped a window. Register it with the shared brain (which
        // assigns an app id) and announce it to every connected chrome so it can
        // mount an <app> element.
        //
        // With no size, because the client has not committed a buffer and so
        // has not said one — how big it wants to be is something a Wayland
        // client says by drawing. It arrives on the `app_resized` that follows
        // its first commit. This used to announce `(0.0, 0.0)`, which reads as
        // a size rather than as the absence of one, and a chrome that believed
        // it opened a window with no box at all.
        //
        // With no title, for the same reason: a client names its window with
        // `set_title`, which it sends after creating the toplevel this is
        // announcing. That arrives at `title_changed`, which is also where a
        // rename does.
        let announce = {
            let mut host = self.hub.host.lock().unwrap();
            let (app_id, announce) = host.app_appeared(None, None);
            info!(%app_id, "toplevel mapped -> Host::app_appeared");
            // Tell the client which outputs it is on — every one of them, at
            // this point: the chrome has not placed the window yet, so there
            // is no portal to say where it is. Toolkits that scale their
            // content (GLFW, and so kitty) wait for this before drawing their
            // first frame, so without it the window maps and stays blank, and
            // "none of them" is not an answer either.
            //
            // Narrowed to the displays it is actually over by
            // `enter_the_displays_each_window_is_on`, on the first placement
            // and every one after it.
            for live in &self.outputs {
                live.output.enter(surface.wl_surface());
            }
            // The engine texture id is stable for the element's whole life, so
            // it is claimed here rather than on the app's first GPU frame.
            self.bridge.register(&app_id);
            self.toplevels.push((app_id, surface));
            announce
        };
        self.hub.broadcast(announce);
    }

    /// A client named its window, or renamed it.
    ///
    /// Where the name has to come from: the announcement goes out when the
    /// client *creates* the toplevel, and `set_title` is a request it makes
    /// afterwards, so there is never a name to announce. A terminal renames
    /// itself on every command it runs, so this is not a once-per-window
    /// event either.
    ///
    /// Smithay drops a `set_title` that does not change the title before
    /// calling this, so what arrives here is already a change.
    fn title_changed(&mut self, surface: ToplevelSurface) {
        // `None` for a toplevel the host never announced — the chrome's own
        // window, which names itself and is not a window *on* the desktop.
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
        // Bound by a `let` statement rather than asked for inside the `if let`:
        // the guard is a temporary of the statement, so it is dropped at the
        // `;` and the broadcast below runs with the host unlocked. Folded into
        // an `if let` it would be held across the whole body.
        let titled = self.hub.host.lock().unwrap().app_titled(&app_id, title);
        if let Some(titled) = titled {
            self.hub.broadcast(titled);
        }
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
            // The bands with it. They are that page's rasters, and the
            // question outstanding is that page's to answer — left standing,
            // the next page's first commit would be taken for the dead one's
            // answer, and because a question being outstanding is what routes
            // a commit away from `chrome_texture`, nothing would ever refill
            // it: a desktop with no chrome at all until something re-declared.
            self.bands = Bands::default();
            self.band_textures.clear();
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
            self.latest_frames.remove(&app_id);
            // The commit counter too, which was the one sibling map this
            // forgot. A stale entry could never be *read* — host ids are
            // monotonic, so no later window takes this name — but it would sit
            // there for the life of the process.
            self.content.remove(&app_id);
            self.held.remove(&app_id);
            // And nothing is owed to a canvas that no longer exists.
            self.pending_damage.remove(&app_id);
            self.textures.remove(&app_id);
            if self.pointer_app.as_deref() == Some(app_id.as_str()) {
                self.pointer_app = None;
            }
            info!(%app_id, "toplevel destroyed -> Host::app_closed");
            broadcast_closed(&self.hub, &app_id);
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
        // A popup has no portal of its own — it is the client's own menu,
        // positioned against its parent rather than laid out in the page — but
        // it is drawn over that parent, so the screen the window is on is the
        // screen the menu is on. Entering every display instead would tell a
        // menu whose window is on the 1x screen that it is also on the 2x one,
        // and a toolkit takes the largest scale it was entered onto: a menu
        // drawn for the wrong density over a correctly-scaled window, on the
        // desktop this whole rule is for.
        //
        // The whole pass rather than this one surface: smithay pushes a popup
        // onto `popup_surfaces` before dispatching this, so it is already in
        // there, and one rule applied in one place is what stops the answer a
        // popup gets here drifting from the one a later placement gives it.
        self.enter_the_displays_each_window_is_on();
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
///
/// The alpha stays **premultiplied**, which is what a client committed and what
/// the compositor's own shaders expect. Undoing it is the page's business and
/// happens where the bytes are handed to the page — see `publish_frame`. Doing
/// it here would reach both consumers of a decoded buffer, and the other one
/// draws it.
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().init();
    }

    // The whole command line, read before anything is bound: it is written by
    // the shell that started us, so a mistake in it is a bug in a program
    // rather than a typo at a prompt, and reporting it after the sockets are
    // up buries it under a compositor's startup log.
    let arguments = arguments(std::env::args_os().skip(1))?;

    // A config that will not load is fatal, not a warning. The old fallback to
    // defaults made sense while a person wrote this file by hand and might be
    // mid-edit; a shell generates it now, so an unreadable one means the shell
    // is broken — and coming up wearing settings nobody chose hides that
    // behind a desktop that merely looks wrong.
    let config = match &arguments.config {
        Some(path) => Config::load(path)?,
        None => Config::default(),
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

    // Advertise an output per described display, or the one that follows
    // Domicile's own window where nothing described any. Many clients (e.g.
    // weston-terminal) wait for a wl_output before they will map a toplevel,
    // so this happens before there is a socket for anything to arrive on.
    let output_manager_state = OutputManagerState::new_with_xdg_output::<DomicileCompositor>(&dh);
    let screens = screens_at_startup(&config);
    let outputs: Vec<LiveOutput> = screens
        .outputs()
        .map(|advertised| advertise_output(&dh, advertised))
        .collect();

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
        arguments.present,
    );
    // Before any chrome can connect: the desktop rides with the handshake, so
    // a page that arrives in the same millisecond as the socket still gets it.
    hub.host
        .lock()
        .unwrap()
        .describe_displays(screens.outputs().map(Advertised::described).collect());
    // Bound here rather than in the serving thread, so that a socket that
    // cannot be bound ends the run rather than a thread. The shell is waiting
    // on the session document, which is published long after this — so nothing
    // can arrive before the listener exists, whatever order the rest takes.
    let chrome_listener = bind_chrome_socket(&arguments.chrome_socket)?;
    {
        let hub = hub.clone();
        thread::spawn(move || serve_chrome(hub, chrome_listener));
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
    let mut gpu = if arguments.present {
        // Sized to show the desktop rather than to winit's default. `init()`
        // is called with no attributes and opens a 1280x800 window titled
        // "Smithay", so a two-display desktop was shown in a window the size
        // of neither of them — and since a configured desktop does not follow
        // the window, what that cost was the rest of it, scaled down.
        //
        // Bounded by `compositor.nested_size`, so a desktop that fits is shown
        // at its own size and one that does not is scaled to fit, shape
        // intact. Unbounded, four 4K displays would ask a host for a
        // 15360-wide window — off the screen, or past what GL will allocate,
        // and worse than the fixed size this replaced.
        //
        // A request rather than a guarantee: a window manager is free to give
        // us something else, `WinitEvent::Resized` is what says what we got,
        // and `logical_to_window` scales the desktop into whatever that is.
        let window = screens.window_showing_it(config.compositor.nested_size);
        let attributes = WinitWindow::default_attributes()
            .with_inner_size(LogicalSize::new(f64::from(window.0), f64::from(window.1)))
            .with_title("Domicile")
            .with_visible(true);
        match smithay::backend::winit::init_from_attributes::<GlesRenderer>(attributes) {
            Ok((backend, events)) => {
                info!(size = ?backend.window_size(), "presenting to a window");
                window_events = Some(events);
                let mut backend = backend;
                let shaders = match Shaders::compile(backend.renderer()) {
                    Ok(shaders) => Some(shaders),
                    Err(err) => {
                        // A driver that will not compile it leaves nothing to
                        // draw with, and drawing squares instead would be a
                        // desktop quietly missing the thing this is for.
                        tracing::error!(%err, "the compositor's shader would not compile");
                        return Err(err.into());
                    }
                };
                Some(Gpu {
                    importer: DmabufImporter::for_existing_renderer(),
                    output: GpuOutput::Window(Box::new(backend)),
                    shaders,
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
                shaders: None,
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
        outputs,
        config: ConfigStore::new(config.clone()),
        // Modern toolkits ask for cursors by name through this global, which
        // maps straight onto CSS cursor keywords.
        cursor_shape_state: CursorShapeManagerState::new::<DomicileCompositor>(&dh),
        dmabuf_state,
        dmabuf_global,
        gpu,
        hub,
        bridge: BridgeRegistry::new(),
        latest_frames: HashMap::new(),
        content: HashMap::new(),
        painted: None,
        held: HashMap::new(),
        pending_damage: HashMap::new(),
        textures: HashMap::new(),
        toplevels: Vec::new(),
        pointer_app: None,
        start: Instant::now(),
        last_frame: HashMap::new(),
        last_commit: None,
        pending_key: None,
        bands: Bands::default(),
        band_textures: HashMap::new(),
        chrome_toplevel: None,
        chrome_texture: None,
        chrome_frame_shape: None,
        max_scale: config.output.max_scale,
        screens,
        shortcuts: Shortcuts::default(),
        modifiers: Held::default(),
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

    // How long the config file has to stop changing before a reload is taken
    // as final. Long enough to cover a save's own writes, short enough that a
    // deliberate edit feels immediate.
    const SETTLE: Duration = Duration::from_millis(150);
    // And how long a burst may go on being coalesced regardless. Without it a
    // directory written to faster than `SETTLE` never settles, and the reload
    // is not late but lost.
    const BURST: Duration = Duration::from_secs(2);

    // The config file, so a display list is not fixed for the run.
    //
    // Two hops rather than one. `domicile_config::watch` hands back an
    // `std::sync::mpsc::Receiver` fed by the notify thread, and the desktop can
    // only be changed where the outputs and surfaces are — this thread. So a
    // forwarding thread moves each parse onto a calloop channel, which is the
    // same shape `request_rx` uses and for the same reason.
    //
    // A watcher that cannot start is logged and left: it means the displays
    // stay as they are, which is exactly the behaviour this replaces, and it is
    // not a reason to refuse to run a desktop. A run with no config file has
    // nothing to watch at all, and says so rather than reporting a failure.
    match arguments.config.as_ref() {
        None => info!("no config file, so the desktop is fixed for this run"),
        Some(path) => match domicile_config::watch(path) {
            Ok(watcher) => {
                let (reload_tx, reload_rx) = channel::<Result<Config, ConfigError>>();
                thread::spawn(move || {
                    // The whole watcher, named so it is captured whole. A `move`
                    // closure in edition 2021 captures the *fields* it mentions,
                    // so writing only `watcher.rx` below takes the receiver and
                    // leaves the OS watcher behind to be dropped at the end of the
                    // enclosing scope — which closes the channel, so the first
                    // `recv` returns `Err`, this thread ends before anything is
                    // ever edited, and the config appears simply not to be
                    // watched. It cost an afternoon; `e2e-reload-displays.sh` is
                    // what catches it coming back.
                    let watcher = watcher;
                    // Ends when the watcher is dropped with this thread, or when
                    // the event loop has gone and nothing is listening.
                    while let Ok(first) = watcher.rx.recv() {
                        // One save is several events, and the ones in the middle
                        // are of a file that is halfway written. `ConfigStore`
                        // does not catch that: a truncated config *parses*, it
                        // just describes no displays — which is a legal desktop
                        // meaning "follow Domicile's window". So a plain
                        // write-then-write save was taking the whole desktop down
                        // to `domicile-0` and putting it back a moment later, and
                        // every client on it was told its monitor had gone and
                        // come back.
                        //
                        // So: take the last parse of a burst rather than each one.
                        //
                        // Bounded by a deadline on the whole burst, not only by the
                        // quiet between events. `recv_timeout(SETTLE)` alone starts
                        // its budget again on every event, so a config in a
                        // directory that is written to more often than that defers
                        // the reload for as long as the writing goes on. Not late:
                        // never. And the directory is not hypothetical — the watch
                        // is on it rather than on the file because that is how an
                        // atomic rename is caught, and a shell puts the config in
                        // the run directory beside the chrome socket and the
                        // session document published into it.
                        let latest = last_of_burst(&watcher.rx, first, SETTLE, BURST);
                        if reload_tx.send(latest).is_err() {
                            return;
                        }
                    }
                });
                handle.insert_source(reload_rx, |event, _, data: &mut CalloopData| {
                    let ChannelEvent::Msg(parsed) = event else {
                        return;
                    };
                    // Through the store, which is what keeps a half-written save
                    // from taking the desktop down: a config that does not parse
                    // leaves the live one in place and is remembered as the last
                    // error rather than applied.
                    if let Err(err) = data.state.config.apply_watch(parsed) {
                        tracing::warn!(%err, "keeping the last config that parsed");
                        return;
                    }
                    // `None` means the reload has nothing to say about the
                    // desktop — an undescribed config, where the window is the
                    // authority and rebuilding from the file would undo the
                    // density it negotiated.
                    let config = data.state.config.current();
                    let Some(screens) = data.state.screens.reloaded_into(
                        config.output.desktop().as_ref(),
                        config.compositor.nested_size,
                    ) else {
                        return;
                    };
                    let dh = data.display.handle();
                    data.state.adopt_the_desktop(&dh, screens);
                })?;
            }
            Err(err) => {
                tracing::warn!(%err, "not watching the config; its displays are fixed for this run");
            }
        },
    }

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
            // The window stops receiving keys the moment it loses focus, so
            // the releases for whatever is held now are never coming.
            WinitEvent::Focus(false) => data.state.release_pressed_keys(),
        })?;
    }

    // Last of all, and that placement is the whole point.
    //
    // The shell that started us is blocked on this file appearing, and takes
    // its appearance as "everything named in it is live". So nothing that can
    // fail may come after it: a window that would not open, a shader that
    // would not compile, an event source that would not insert would each
    // return from `main` — and a shell that had already read the document
    // would be connecting to a compositor on its way out, with no reason
    // given. Every one of those is behind us here, and the only `?` left is
    // this call's own.
    //
    // The sockets themselves were bound far above, which is a separate
    // ordering and still necessary: the chrome connects the moment it is told
    // where to, and there has to be something listening when it does.
    publish(
        &Session {
            protocol: domicile_protocol::PROTOCOL_VERSION,
            chrome_socket: arguments.chrome_socket.clone(),
            wayland_display: socket_name.to_string_lossy().into_owned(),
            chrome_wayland_display: chrome_socket_name.clone(),
            // What actually happened, not what was asked for. `--present` on a
            // machine with no display leaves the compositor headless, and a
            // shell told otherwise would open a transparent window over
            // nothing rather than one it draws a desktop into.
            composited: data.state.gpu.as_ref().is_some_and(Gpu::presenting),
        },
        &arguments.session,
    )?;

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
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    use std::sync::Mutex;
    use std::thread;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use smithay::input::pointer::CursorIcon;

    use domicile_protocol::CursorShape;

    use super::{
        announce_open_apps, answers_keystroke, bgra_to_rgba, broadcast_closed,
        broadcast_focus_decision, channel, chrome_connection, client_command, cursor_shape,
        disposition, drawn_by_the_compositor, draws_natively, frame_is_due, freshened, hand_back,
        hand_over, keep_frame, pixels_to_hand_over, record_present, shadow_in_pixels, to_line,
        unmounts_the_element, write_responses, ChromeHub, ClientRequest, Committer, Disposition,
        Drawn, FrameTimings, HandOver, LastFrame, Outbound, Placed, Refusals,
    };

    use std::collections::HashMap;
    use std::sync::Arc;

    use domicile_protocol::{ChromeMessage, HostMessage};
    use domicile_scene::{Portal, Scene, Style as SceneStyle, Transform as SceneTransform};

    /// Each grepped message, against the exact pattern its script greps for.
    ///
    /// The scripts are the other half of the contract, so they are what this
    /// reads. A test that spelled the strings out again would live in the same
    /// file as the constants and rename along with them, which is the whole
    /// failure it exists to catch.
    ///
    /// A row per *pair*, not per constant: `UNPARSEABLE` was grepped by two
    /// scripts, and a table keyed on the constant alone left the second pair
    /// unpinned — renaming it in `e2e-hidpi.sh` stayed green. One of that pair
    /// has since been ported to `tests/outputs.rs` and deleted, which is why
    /// the shape now looks like more machinery than the rows need.
    ///
    /// The pattern is *built from* the constant rather than searched for in
    /// the file, because both weaker forms let a rename through. Spelling the
    /// strings again missed a one-file `sed`; `script.contains(message)` missed
    /// a constant *shortened* to a prefix, which changes what is logged while
    /// the script goes on grepping for the whole of the old text. Building the
    /// pattern means any edit to the constant that the script does not match
    /// leaves nothing for this to find.
    #[test]
    fn the_grepped_log_messages_are_what_the_scripts_expect() {
        for (pattern, script, name) in [
            (
                crate::grepped::UNPARSEABLE.to_string(),
                include_str!("../../../scripts/e2e-hidpi.sh"),
                "e2e-hidpi.sh",
            ),
            (
                // The one whose script reads fields off the line as well, so
                // the tail is part of what has to agree.
                format!(
                    "{} width=[0-9]+ height=[0-9]+ scale=[0-9]+",
                    crate::grepped::ADVERTISING
                ),
                include_str!("../../../scripts/e2e-hidpi.sh"),
                "e2e-hidpi.sh",
            ),
            (
                // Read with its field too: the script tells the bands apart by
                // the number, so the field's name is part of the agreement.
                format!("{} band=[0-9]*", crate::grepped::BAND_ANSWERED),
                include_str!("../../../scripts/e2e-bands.sh"),
                "e2e-bands.sh",
            ),
        ] {
            assert!(
                script.contains(&format!("\"{pattern}\"")),
                "{name} greps for no such pattern as {pattern:?}; renaming the constant here left the script asserting on the old spelling"
            );
        }
    }

    /// A frame committed one millisecond after the last one, so only the path
    /// decides whether it is drawn, sent or dropped.
    fn just_committed(from_gpu: bool, presenting: bool, draws_natively: bool) -> Disposition {
        disposition(
            from_gpu,
            presenting,
            draws_natively,
            Some(Duration::from_millis(1)),
        )
    }

    #[test]
    fn a_chrome_that_goes_away_is_forgotten() {
        // `chromes` is otherwise pruned only by a broadcast that fails to
        // write, and an idle desktop never broadcasts — so a shell whose page
        // reloads left one dead writer per reload, held open and counted in
        // the `chromes=` field of the frame line.
        //
        // A real socket pair and a real EOF, because that is what the
        // connection thread is waiting on: nothing short of the peer going
        // away ends the loop this asserts the far side of.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        hub.chromes.lock().unwrap().push(writer.clone());

        let serving = {
            let hub = hub.clone();
            thread::spawn(move || chrome_connection(hub, compositor, writer))
        };
        drop(page);
        serving.join().expect("the connection thread ends at EOF");

        assert!(
            hub.chromes.lock().unwrap().is_empty(),
            "the writer for a chrome that disconnected is not kept"
        );
    }

    #[test]
    fn a_socket_that_has_gone_away_ends_the_connection() {
        // The `false` is what stops `read_chrome_messages` reading on from a
        // peer that is not there. Written as a return value when the loop moved
        // out of that function, and this is the callee half of it. The caller's
        // `if !write_responses(…) { return; }` is not pinned by anything and
        // deliberately so: it is the bare `return` the extraction moved, was
        // equally unpinned before, and is close to inert — a peer that closed
        // both ends gives the read loop EOF on the next pass regardless, so
        // only a half-close makes it observable.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        drop(page);

        assert!(
            !write_responses(
                &hub,
                &writer,
                vec![HostMessage::Welcome {
                    protocol_version: domicile_protocol::PROTOCOL_VERSION,
                }],
            ),
            "a write to a peer that is gone ends the connection rather than looping"
        );
    }

    #[test]
    fn the_answer_on_the_wire_carries_the_desktop_as_of_when_it_was_written() {
        // The whole point of `freshened`, at the seam where it is called. The
        // answers are built under `host` and written later under the writer
        // lock, so handing in answers built against an older desktop is the
        // interleaving — without having to win a race to produce it.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));

        let booted = vec![domicile_protocol::DisplayInfo {
            name: "domicile-0".to_string(),
            position: [0, 0],
            size: [1280, 800],
            scale: 1,
        }];
        hub.host.lock().unwrap().describe_displays(booted);
        let answers = vec![
            HostMessage::Welcome {
                protocol_version: domicile_protocol::PROTOCOL_VERSION,
            },
            hub.host.lock().unwrap().describe_desktop(),
        ];

        // And now the desktop changes, after the answers were built and before
        // they are written — which is `set_output` landing in the gap.
        let now = vec![domicile_protocol::DisplayInfo {
            name: "domicile-0".to_string(),
            position: [0, 0],
            size: [1280, 800],
            scale: 2,
        }];
        hub.host.lock().unwrap().describe_displays(now.clone());

        assert!(
            write_responses(&hub, &writer, answers),
            "the socket is open"
        );
        drop(writer);
        drop(compositor);

        // Compared as the bytes that went out, through the same encoder the
        // caller uses: this is about what a chrome reads off the socket.
        let written: Vec<String> = BufReader::new(page)
            .lines()
            .map(|line| line.expect("a line"))
            .collect();
        let expected: Vec<String> = [
            HostMessage::Welcome {
                protocol_version: domicile_protocol::PROTOCOL_VERSION,
            },
            HostMessage::Displays { displays: now },
        ]
        .iter()
        .map(|message| to_line(message).trim_end().to_string())
        .collect();
        assert_eq!(
            written, expected,
            "the welcome is the answer it was built as, and the desktop is the current one"
        );
    }

    #[test]
    fn a_stale_desktop_in_a_handshake_answer_is_replaced_before_it_is_written() {
        // The answer is built under the `host` lock and written later under the
        // writer lock, and `set_output` can land in between — describing a new
        // desktop and broadcasting it on the writer thread. Written as built,
        // the answer's own copy lands last on the socket, and latest-wins
        // leaves the chrome on the desktop that is gone.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let described = vec![domicile_protocol::DisplayInfo {
            name: "domicile-0".to_string(),
            position: [0, 0],
            size: [1280, 800],
            scale: 2,
        }];
        hub.host
            .lock()
            .unwrap()
            .describe_displays(described.clone());

        let built_earlier = HostMessage::Displays {
            displays: vec![domicile_protocol::DisplayInfo {
                name: "domicile-0".to_string(),
                position: [0, 0],
                size: [1280, 800],
                scale: 1,
            }],
        };

        assert_eq!(
            freshened(&hub, built_earlier),
            HostMessage::Displays {
                displays: described
            },
            "the desktop written is the one described now, not the one the answer was built from"
        );
    }

    #[test]
    fn the_rest_of_a_handshake_answer_is_written_as_it_was_built() {
        // Only `displays` is a fact about the world. `welcome` is an answer to
        // what this chrome asked, and a version re-derived at write time would
        // be a different chrome's answer on this chrome's socket.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let welcome = HostMessage::Welcome {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
        };

        assert_eq!(
            freshened(&hub, welcome.clone()),
            welcome,
            "a message that is not the desktop passes through untouched"
        );
    }

    #[test]
    fn a_page_that_says_hello_is_told_what_is_already_running() {
        // Nothing else ever re-sends `app_appeared`. Without this the desktop
        // is only ever built up by live ones, so a page that reloads comes back
        // to a compositor full of running clients and an empty screen.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let (first, _) = hub
            .host
            .lock()
            .unwrap()
            .app_appeared(Some("a terminal".to_string()), Some((640.0, 480.0)));
        let (second, _) = hub
            .host
            .lock()
            .unwrap()
            .app_appeared(None, Some((100.0, 200.0)));

        announce_open_apps(&hub);

        // Four reads for two windows and a focus message: everything was
        // queued before the first read, so the last is what says nothing
        // followed them.
        let mut announced = Vec::new();
        for _ in 0..4 {
            match outbound.recv_until(Duration::from_millis(100)) {
                Some(Some(Outbound::Message(HostMessage::AppAppeared { app_id, .. }))) => {
                    announced.push(app_id);
                }
                // Who holds the keyboard rides along with the windows, so a
                // page that has just loaded knows without having to ask. Not
                // what this test is about — `domicile-host` pins its content —
                // but it is on the wire and has to be read past.
                Some(Some(Outbound::Message(HostMessage::FocusChanged { .. }))) => {}
                Some(Some(_)) => panic!("something other than an announcement was queued"),
                Some(None) => break,
                None => panic!("the queue's sending half went away"),
            }
        }

        assert_eq!(
            announced,
            vec![first, second],
            "both open windows, in the order they arrived"
        );
    }

    #[test]
    fn a_chrome_asking_for_focus_is_answered_to_every_chrome() {
        // The line the whole change turned on. `chrome_connection` asks the
        // brain what moved *after* the message rather than taking a delta back
        // from it — so the answer is the desktop's and goes to everyone, and a
        // second chrome is not left marking the wrong window active. Returning
        // it from the message's own handling is what put it on one socket, and
        // only a real connection reaches that line.
        let (hub, outbound, app_id) = hub_with_an_app();
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        hub.chromes.lock().unwrap().push(writer.clone());
        let serving = {
            let hub = hub.clone();
            thread::spawn(move || chrome_connection(hub, compositor, writer))
        };

        {
            use std::io::Write as _;
            let version = domicile_protocol::PROTOCOL_VERSION;
            let mut writing = &page;
            for message in [
                format!("{{\"type\":\"hello\",\"protocol_version\":{version}}}"),
                format!("{{\"type\":\"focus_app\",\"app_id\":\"{app_id}\"}}"),
            ] {
                writeln!(writing, "{message}").expect("the page can write");
            }
        }
        // Drained before the page goes away, not after: the handshake's
        // `Welcome` is written back to this socket, and closing the reading
        // end first breaks that write — which ends the connection thread
        // before it ever reads the second line.
        let seen = queued(&outbound);
        drop(page);
        serving.join().expect("the connection thread ends at EOF");

        assert!(
            seen.contains(&HostMessage::FocusChanged {
                app_id: Some(app_id.clone()),
            }),
            "every chrome is told the window took the keyboard: {seen:?}"
        );
    }

    #[test]
    fn a_chrome_closing_a_window_asks_the_client_rather_than_the_brain() {
        // The X button on a native window's tab. Nothing in the scene ends a
        // client — only its own toplevel can — so the message has to leave the
        // chrome thread for the Wayland one, where the toplevel is.
        let (request_tx, requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        let serving = {
            let hub = hub.clone();
            thread::spawn(move || chrome_connection(hub, compositor, writer))
        };

        {
            use std::io::Write as _;
            let version = domicile_protocol::PROTOCOL_VERSION;
            let mut writing = &page;
            // The handshake first, so this drives the connection the product
            // reaches rather than one that skipped it.
            for message in [
                format!("{{\"type\":\"hello\",\"protocol_version\":{version}}}"),
                "{\"type\":\"close_app\",\"app_id\":\"term\"}".to_string(),
            ] {
                writeln!(writing, "{message}").expect("the page can write");
            }
        }
        // Collected before the page goes away, not after: the handshake's
        // `welcome` is written back to this socket, and closing the reading end
        // first breaks that write — which ends the connection thread before it
        // ever reads the second line. Waited for rather than read once, because
        // the thread that sends these is not the one asserting on them.
        let mut asked = Vec::new();
        for _ in 0..200 {
            while let Ok(request) = requests.try_recv() {
                asked.push(request);
            }
            if asked.len() >= 2 {
                break;
            }
            sleep(Duration::from_millis(10));
        }
        drop(page);
        serving.join().expect("the connection thread ends at EOF");

        assert!(
            matches!(
                asked.as_slice(),
                [ClientRequest::ChromeHello, ClientRequest::CloseApp { app_id }]
                    if app_id == "term"
            ),
            "the handshake, and then the one client asked to close"
        );
    }

    /// Drain what the hub has queued for the chromes, in order.
    ///
    /// Reads until one comes back empty, so it works whether everything was
    /// queued before the first read or is still arriving from a connection
    /// thread. A caller that knows how many to expect should assert on the
    /// length rather than trusting the drain to have caught up.
    fn queued(outbound: &crate::outbound::OutboundReceiver) -> Vec<HostMessage> {
        let mut seen = Vec::new();
        while let Some(Some(item)) = outbound.recv_until(Duration::from_millis(100)) {
            match item {
                Outbound::Message(message) => seen.push(message),
                Outbound::Frame { .. } => panic!("a frame was queued, not a message"),
            }
        }
        seen
    }

    /// A hub with one placed app, ready to be focused.
    fn hub_with_an_app() -> (Arc<ChromeHub>, crate::outbound::OutboundReceiver, String) {
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"), false);
        let app_id = {
            let mut host = hub.host.lock().unwrap();
            let (app_id, _) = host.app_appeared(None, Some((100.0, 100.0)));
            host.handle_chrome_message(ChromeMessage::PlacePortal {
                app_id: app_id.clone(),
                corner_radius: 0.0,
                native: true,
                opacity: 1.0,
                shadow: None,
                size: [100.0, 100.0],
                takes_pointer: true,
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                visible: true,
                z_index: 0,
            })
            .expect("the portal is placed — without it `focus_app` refuses");
            app_id
        };
        (hub, outbound, app_id)
    }

    #[test]
    fn a_focus_the_compositor_decided_reaches_every_chrome() {
        // The click that focuses a window happens inside the compositor, so it
        // is the one move the chrome cannot work out for itself — and
        // `focus_change` reports a change once, so a page not told has missed
        // it for good.
        let (hub, outbound, app_id) = hub_with_an_app();

        broadcast_focus_decision(
            &hub,
            ChromeMessage::FocusApp {
                app_id: app_id.clone(),
            },
        );

        assert_eq!(
            queued(&outbound),
            vec![HostMessage::FocusChanged {
                app_id: Some(app_id)
            }]
        );
    }

    #[test]
    fn a_click_on_the_desktop_says_the_keyboard_came_back() {
        // The mirror, and the one that was silent: the seat moved to the page
        // while the brain still named the window, so the marker stayed on a
        // window the compositor was no longer typing into.
        let (hub, outbound, app_id) = hub_with_an_app();
        broadcast_focus_decision(&hub, ChromeMessage::FocusApp { app_id });
        let _ = queued(&outbound);

        broadcast_focus_decision(&hub, ChromeMessage::FocusChrome);

        assert_eq!(
            queued(&outbound),
            vec![HostMessage::FocusChanged { app_id: None }]
        );
    }

    #[test]
    fn a_focused_window_closing_says_both_things_in_order() {
        // The app is gone *and* the keyboard came back. A chrome told only the
        // first would go on marking a window that no longer exists as active,
        // and the order is what lets it act on them in one pass.
        let (hub, outbound, app_id) = hub_with_an_app();
        broadcast_focus_decision(
            &hub,
            ChromeMessage::FocusApp {
                app_id: app_id.clone(),
            },
        );
        let _ = queued(&outbound);

        broadcast_closed(&hub, &app_id);

        assert_eq!(
            queued(&outbound),
            vec![
                HostMessage::AppClosed {
                    app_id: app_id.clone()
                },
                HostMessage::FocusChanged { app_id: None },
            ]
        );
    }

    /// A buffer size for a window whose size is beside the point.
    const ANY_SIZE: (u32, u32) = (64, 48);

    /// The record of which apps the chrome holds a frame of, all at the same
    /// size: what these read is which apps are in it.
    fn holding(app_ids: &[&str]) -> HashMap<String, (u32, u32)> {
        app_ids
            .iter()
            .map(|id| ((*id).to_string(), ANY_SIZE))
            .collect()
    }

    /// One window in the draw order, and who is drawing it.
    fn drawn(app_id: &str, drawn_here: bool) -> Drawn<'_> {
        (app_id, drawn_here)
    }

    /// One window as the scene placed it, styled and positioned the same way
    /// every time: only `natively` matters to what reads these.
    fn placed(app_id: &str, natively: bool) -> Placed {
        (
            app_id.to_string(),
            SceneTransform::identity(),
            SceneStyle::default(),
            natively,
            0,
        )
    }

    /// Run `hand_over` against a chrome that answers `answer` to everything,
    /// reporting which apps were offered pixels and what was recorded.
    fn offering(
        windows: &[Drawn<'_>],
        held: &[&str],
        answer: HandOver,
    ) -> (Vec<String>, Vec<String>, Refusals) {
        let mut chrome_holds = holding(held);
        let mut offered = Vec::new();
        let refusals = hand_over(windows, &mut chrome_holds, |app_id| {
            offered.push(app_id.to_string());
            answer
        });
        let mut recorded: Vec<_> = chrome_holds.into_keys().collect();
        recorded.sort();
        (offered, recorded, refusals)
    }

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

    #[test]
    fn a_shadows_colour_is_counted_to_one_for_the_shader() {
        // CSS counts channels to 255 and a shader counts everything to one, so
        // a scene shadow cannot be handed to the shader as it stands. Alpha is
        // already 0-1 on both sides and must not be divided again — doing so
        // would make every shadow invisible rather than merely wrong.
        let white = domicile_scene::Shadow {
            blur: 0.0,
            color: [255.0, 128.0, 0.0, 0.5],
            dx: 0.0,
            dy: 0.0,
            spread: 0.0,
        };

        let converted = shadow_in_pixels(white, 1.0);

        assert_eq!(converted.color[0], 1.0);
        assert!((converted.color[1] - 128.0 / 255.0).abs() < f32::EPSILON);
        assert_eq!(converted.color[2], 0.0);
        assert_eq!(converted.color[3], 0.5, "alpha is already counted to one");
    }

    #[test]
    fn a_shadow_scales_with_the_display_it_is_drawn_on() {
        // Every length in a style is in the chrome's logical units. A window on
        // a 2x display casts a shadow twice as far in pixels and looks the
        // same; a shadow that did not scale would drift as the density changed.
        let shadow = domicile_scene::Shadow {
            blur: 12.0,
            color: [0.0, 0.0, 0.0, 1.0],
            dx: 3.0,
            dy: -4.0,
            spread: 2.0,
        };

        let converted = shadow_in_pixels(shadow, 2.0);

        assert_eq!(
            (converted.blur, converted.dx, converted.dy, converted.spread),
            (24.0, 6.0, -8.0, 4.0)
        );
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
        assert!(frame_is_due(None));
    }

    #[test]
    fn the_copy_path_drops_a_frame_that_came_too_soon() {
        // The socket is what this protects: a frame is megabytes, and the next
        // one supersedes the one dropped.
        assert!(!frame_is_due(Some(Duration::from_millis(5))));
        assert!(frame_is_due(Some(Duration::from_millis(40))));
    }

    #[test]
    fn compositing_draws_every_frame_a_client_commits() {
        // Nothing is being protected: there is no socket and no chrome, and the
        // client's own buffer costs a bind and a quad. Refusing it holds a
        // stale desktop for no reason — measured at half of kitty's frames.
        assert_eq!(just_committed(true, true, true), Disposition::Draw);
    }

    #[test]
    fn a_copy_path_window_is_throttled_even_where_the_desktop_is_presented() {
        // The throttle is the socket's, and this window is on the socket
        // whatever the rest of the desktop is doing: its pixels are read back
        // and sent because its own element wears a style the shaders cannot
        // draw. Reading only whether the compositor is presenting would send a
        // megabyte per commit down a queue one frame deep.
        assert_eq!(just_committed(true, true, false), Disposition::Throttle);
    }

    #[test]
    fn a_shared_memory_client_is_copied_however_ordinary_its_css() {
        // Its pixels are in main memory and are never imported as a texture,
        // so `present()` has nothing to draw for it whatever the placement
        // says: its frames go to the chrome.
        assert_eq!(disposition(false, true, true, None), Disposition::Send);
        // And being on the socket, it wants the socket's throttle. Calling it
        // composited would hand it an unthrottled one — a megabyte per commit
        // down a queue one frame deep — which `Send` alone does not catch,
        // because a first frame is due on every path.
        assert_eq!(just_committed(false, true, true), Disposition::Throttle);
    }

    #[test]
    fn a_headless_desktop_copies_everything() {
        // What every check in the repo drives: there is no output to draw
        // into, so the frame goes to the chrome however the window is styled.
        assert_eq!(disposition(true, false, true, None), Disposition::Send);
    }

    #[test]
    fn a_placed_window_is_drawn_the_way_its_chrome_asked() {
        let mut scene = Scene::new();
        scene.upsert(Portal::new(
            "term",
            (100.0, 50.0),
            SceneTransform::identity(),
            0,
        ));
        assert!(draws_natively(&scene, "term"));

        scene.upsert(Portal::new("term", (100.0, 50.0), SceneTransform::identity(), 0).copied());
        assert!(!draws_natively(&scene, "term"));
    }

    #[test]
    fn a_window_with_no_portal_is_drawn_natively() {
        // Two windows are in this state and neither wants the socket: one that
        // has been announced and not yet placed, where a placement is about to
        // arrive and the fast path is the one to start on — and a *hidden*
        // one, which has no portal either. Reading absence as "copy this"
        // would put every backgrounded window on the socket, sending frames
        // for windows nobody is looking at.
        assert!(draws_natively(&Scene::new(), "term"));
    }

    #[test]
    fn a_window_the_chrome_never_held_is_not_asked_to_drop_anything() {
        // Every window that has only ever been drawn natively. Sending it
        // would be a message per frame per window, all of them telling the
        // chrome to drop a canvas it never had.
        let mut chrome_holds = holding(&[]);
        assert_eq!(hand_back("term", &mut chrome_holds), None);
    }

    #[test]
    fn a_window_the_chrome_holds_is_asked_to_drop_it_once() {
        // Once, because the canvas is gone after the first — and the message
        // is what makes it gone, so a second would be for a window that has
        // been drawn natively all along.
        let mut chrome_holds = holding(&["term"]);
        assert_eq!(
            hand_back("term", &mut chrome_holds),
            Some(HostMessage::AppComposited {
                app_id: "term".to_string()
            })
        );
        assert_eq!(hand_back("term", &mut chrome_holds), None);
    }

    #[test]
    fn unmounting_an_element_is_what_takes_its_canvas() {
        assert_eq!(
            unmounts_the_element(&ChromeMessage::RemovePortal {
                app_id: "term".to_string()
            }),
            Some("term")
        );
    }

    #[test]
    fn hiding_a_window_does_not_take_its_canvas() {
        // The bug this function exists to prevent, and it is not visible from
        // the scene: the shell keeps every window mounted and toggles
        // `hidden`, which arrives as this and removes the portal — while the
        // element, and its canvas, stay in the page. Reading it as an unmount
        // means never telling that chrome to drop the canvas, so a window
        // backgrounded on the copy path and brought back native wears a still
        // of itself for good.
        let hidden = |visible| ChromeMessage::PlacePortal {
            app_id: "term".to_string(),
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            size: [0.0, 0.0],
            z_index: 0,
            visible,
            corner_radius: 0.0,
            opacity: 1.0,
            shadow: None,
            native: true,
            takes_pointer: true,
        };
        assert_eq!(unmounts_the_element(&hidden(false)), None);
        // Nor does any other placement: `remove_portal` is the only message
        // that says the chrome has stopped holding a window's pixels.
        assert_eq!(unmounts_the_element(&hidden(true)), None);
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
        // two pixels: [B,G,R,A] = [10,20,30,255], [50,60,70,255].
        //
        // Opaque, so this reads the channel order and nothing else: at alpha
        // 255 undoing the premultiply is the identity. What it does to a
        // translucent pixel is `premultiplied_colour_is_divided_back_out`.
        let src = [10, 20, 30, 255, 50, 60, 70, 255];
        let out = bgra_to_rgba(&src, 2, 1, 8, 0, true).unwrap();
        assert_eq!(out, vec![30, 20, 10, 255, 70, 60, 50, 255]);
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
        // Opaque, for the same reason as `swaps_b_and_r_and_keeps_alpha`.
        let src = [1, 2, 3, 255, 0, 0, 0, 0, 5, 6, 7, 255, 0, 0, 0, 0];
        let out = bgra_to_rgba(&src, 1, 2, 8, 0, true).unwrap();
        assert_eq!(out, vec![3, 2, 1, 255, 7, 6, 5, 255]);
    }

    #[test]
    fn rejects_undersized_buffers() {
        assert!(bgra_to_rgba(&[0, 0, 0], 2, 2, 8, 0, true).is_none());
    }

    #[test]
    fn a_window_the_compositor_is_not_drawing_is_handed_over() {
        // Two windows are in this state and nothing else would send either.
        // One has just left the native path — the page changed, not the
        // client, so a client that is not drawing would leave a hole with
        // nothing behind it. The other is a `wl_shm` client, which is never
        // drawn natively however ordinary its CSS, and so needs its pixels
        // back every time its element moves in the page and drops its canvas.
        let (offered, recorded, _) = offering(
            &[drawn("term", false)],
            &[],
            HandOver::Sent { size: ANY_SIZE },
        );
        assert_eq!(offered, vec!["term".to_string()]);
        assert_eq!(recorded, vec!["term".to_string()]);
    }

    #[test]
    fn a_window_the_compositor_draws_is_not_handed_over() {
        let (offered, _, _) = offering(
            &[drawn("term", true)],
            &[],
            HandOver::Sent { size: ANY_SIZE },
        );
        assert!(offered.is_empty());
    }

    #[test]
    fn a_software_frame_is_kept_without_being_copied() {
        // The whole reason a frame's pixels travel as an `Arc`: keeping them
        // has to cost a refcount rather than a second full-frame copy, on
        // every frame of every software-rendered client, to cover a gesture
        // that happens rarely. A `(*rgba).clone()` here would be invisible in
        // behaviour and expensive in the only path that carries megabytes.
        let mut latest = HashMap::new();
        let sent = keep_frame(&mut latest, "term", false, vec![1, 2, 3, 4], 1, 1, 1);
        let Some(LastFrame::Pixels { rgba, .. }) = latest.get("term") else {
            panic!("a software frame is kept as pixels");
        };
        assert!(
            Arc::ptr_eq(rgba, &sent),
            "the frame that was kept is the one that was sent, not a copy of it"
        );
    }

    #[test]
    fn a_gpu_frame_on_the_copy_path_leaves_its_pixels_behind() {
        // Its buffer is already kept, by `import_gpu_frame`, and that is both
        // cheaper than these pixels and the allocation the bridge's descriptor
        // names — its plane fds stay open only while something owns it.
        // Keeping a copy of the same frame's pixels here would drop the buffer
        // to gain a readback that is performed on demand anyway.
        let mut latest = HashMap::new();
        let sent = keep_frame(&mut latest, "term", true, vec![1, 2, 3, 4], 1, 1, 1);
        assert!(
            !latest.contains_key("term"),
            "a GPU client's buffer is what is kept, and `import_gpu_frame` kept it"
        );
        assert_eq!(*sent, vec![1, 2, 3, 4], "and its pixels still go out");
    }

    #[test]
    fn a_software_frame_is_kept_at_the_size_the_client_drew() {
        // The chrome is told a frame's shape in the header that precedes its
        // bytes, so a size that did not travel with the pixels would draw this
        // window at the wrong one when it was handed back.
        // Three distinct values for the same reason as the hand-over's
        // fixture below: a height and a scale that agree cannot tell a
        // transposition from a correct answer.
        let mut latest = HashMap::new();
        keep_frame(&mut latest, "term", false, vec![0; 32], 8, 4, 2);
        let Some(LastFrame::Pixels {
            width,
            height,
            scale,
            ..
        }) = latest.get("term")
        else {
            panic!("a software frame is kept as pixels");
        };
        assert_eq!((*width, *height, *scale), (8, 4, 2));
    }

    #[test]
    fn a_kept_software_frame_is_handed_over_without_touching_the_gpu() {
        // The point of keeping them. A software client's pixels are already in
        // main memory, so handing them back must not cost a readback — and it
        // cannot, because there is no buffer on the card to read.
        // Three distinct values, none of them a fallback: a square frame
        // cannot tell a transposition from a correct answer, and a scale of 1
        // is what *both* arms fall back to, so it cannot tell the kept scale
        // from the default. This repo has fallen into the first trap once
        // already — see `on_screen_size` in ROADMAP.md.
        let mut latest = HashMap::new();
        let sent = keep_frame(&mut latest, "term", false, vec![9; 32], 8, 4, 2);
        let kept = latest.get("term").expect("a software frame is kept");
        let (rgba, width, height, scale) = pixels_to_hand_over(kept, |_| {
            unreachable!("a software client's pixels are read already")
        });

        assert!(Arc::ptr_eq(&rgba, &sent), "handed back, not copied");
        assert_eq!((width, height, scale), (8, 4, 2));
    }

    #[test]
    fn a_window_with_no_texture_is_not_drawn_by_the_compositor() {
        // The `wl_shm` case. Its chrome asked for the fast path and its CSS is
        // ordinary, so the placement says native — but the pixels never became
        // a texture, so `present()` has nothing to draw and the chrome is
        // still the one showing this window.
        assert_eq!(
            drawn_by_the_compositor(&[placed("term", true)], |_| false),
            vec![("term", false)]
        );
    }

    #[test]
    fn a_native_window_with_a_texture_is_drawn_by_the_compositor() {
        assert_eq!(
            drawn_by_the_compositor(&[placed("term", true)], |_| true),
            vec![("term", true)]
        );
    }

    #[test]
    fn a_copy_path_window_is_not_drawn_by_the_compositor_texture_or_not() {
        // It has one — it was drawn natively until its chrome asked otherwise,
        // and the texture is still there. Having a texture is not permission
        // to use it.
        assert_eq!(
            drawn_by_the_compositor(&[placed("term", false)], |_| true),
            vec![("term", false)]
        );
    }

    #[test]
    fn a_window_the_chrome_already_has_pixels_for_is_not_handed_over_again() {
        // The readback is the whole cost of the copy path. Doing it once per
        // composited frame as well as once per client commit would be the
        // expense the native path exists to avoid, twice over.
        let (offered, _, _) = offering(
            &[drawn("term", false)],
            &["term"],
            HandOver::Sent { size: ANY_SIZE },
        );
        assert!(offered.is_empty());
    }

    #[test]
    fn every_window_that_left_is_handed_over_not_just_the_first() {
        // A stylesheet rule matches windows, not one window: a chrome that
        // blurs its inactive apps moves all of them at once.
        let (offered, _, _) = offering(
            &[
                drawn("term", false),
                drawn("editor", true),
                drawn("browser", false),
            ],
            &[],
            HandOver::Sent { size: ANY_SIZE },
        );
        assert_eq!(offered, vec!["term".to_string(), "browser".to_string()]);
    }

    #[test]
    fn a_refusal_asks_for_another_pass() {
        // The queue is one frame deep and a stylesheet rule moves windows in
        // batches, so all but the first are refused. Without this they wait on
        // something unrelated redrawing the desktop.
        let (_, _, refusals) = offering(
            &[drawn("term", false), drawn("editor", false)],
            &[],
            HandOver::Refused,
        );
        assert_eq!(refusals, Refusals::Some);
    }

    #[test]
    fn a_pass_that_handed_everything_over_asks_for_nothing() {
        let (_, _, refusals) = offering(
            &[drawn("term", false)],
            &[],
            HandOver::Sent { size: ANY_SIZE },
        );
        assert_eq!(refusals, Refusals::None);
    }

    #[test]
    fn a_window_with_nothing_to_send_does_not_ask_for_another_pass() {
        // Announced but never committed. Asking again would redraw the desktop
        // once per turn of the loop for a window that has never had a frame.
        let (_, _, refusals) = offering(&[drawn("term", false)], &[], HandOver::NothingToSend);
        assert_eq!(refusals, Refusals::None);
    }

    #[test]
    fn a_refused_frame_is_not_recorded_as_a_hand_over() {
        // The queue is one frame deep, so a chrome a single frame behind
        // refuses. Recording it anyway would leave that window a hole in the
        // page with nothing behind it — for good, if the client never drew
        // again, which is the case the hand-over exists for.
        let (offered, recorded, _) = offering(&[drawn("term", false)], &[], HandOver::Refused);
        assert_eq!(offered, vec!["term".to_string()]);
        assert!(recorded.is_empty(), "a dropped frame is not a hand-over");
    }

    #[test]
    fn a_window_with_nothing_to_send_is_not_recorded_either() {
        // Announced but never committed. Its first frame goes down the copy
        // path of its own accord, and recording it here would stop the
        // hand-over ever running for it.
        let (_, recorded, _) = offering(&[drawn("term", false)], &[], HandOver::NothingToSend);
        assert!(recorded.is_empty());
    }

    #[test]
    fn a_window_drawn_natively_is_still_assumed_to_hold_its_pixels() {
        // The chrome does not drop a canvas because a placement said `native`;
        // it drops it when the compositor says it has taken the window back,
        // which cannot happen until there is a frame to put in its place. A
        // window forgotten here would be handed over a second time the moment
        // it returned to the copy path, for pixels the chrome never lost.
        let (_, recorded, _) = offering(
            &[drawn("term", true)],
            &["term"],
            HandOver::Sent { size: ANY_SIZE },
        );
        assert_eq!(recorded, vec!["term".to_string()]);
    }

    #[test]
    fn the_submit_is_not_recorded_as_compositing() {
        // The defect this exists to prevent, seen in the wild: an idle nested
        // window reported `composite_ms=1434` over a five-second interval with
        // seven composites in it — ten seconds of work inside five seconds of
        // wall clock, which is not a number a stopwatch can produce. It was
        // timing `eglSwapBuffers` blocking until the compositor we are a client
        // of handed back a frame callback nobody was waiting for.
        //
        // Asserted on the recorded windows rather than on returned durations,
        // because those windows are what the log line prints and the original
        // bug was a caller putting the wrong span in the right one.
        let timings = Mutex::new(FrameTimings::default());

        record_present(&timings, Instant::now(), || {
            sleep(Duration::from_millis(50));
        });

        let mut timings = timings.lock().unwrap();
        assert_eq!(timings.composited, 1, "the frame is counted once");
        let composite = timings.composite.take().expect("a drawing was recorded");
        let submit = timings.submit.take().expect("a submit was recorded");
        assert!(
            submit.worst >= Duration::from_millis(50),
            "the submit's own time is the submit's: {:?}",
            submit.worst
        );
        assert!(
            composite.worst < Duration::from_millis(50),
            "the wait belongs to the submit, not to the drawing: {:?}",
            composite.worst
        );
    }
}
