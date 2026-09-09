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
//! GPU clients get a `zwp_linux_dmabuf_v1` global. Their buffer is submitted
//! to the engine as a viz surface, which the page embeds in its `<app>`
//! element — see `engine_session`. A `wl_shm` client has no dmabuf to submit
//! and its window stays blank, which `publish_frame` says once per client.
//!
//! What is intentionally missing here (it needs a GPU and a display): anything
//! about what the engine draws.

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
        protocol::{wl_buffer, wl_seat, wl_surface::WlSurface},
        Client, Display, DisplayHandle, Resource as _,
    },
};
use smithay::utils::{Serial, Transform, SERIAL_COUNTER};
use smithay::wayland::viewporter::{ViewportCachedState, ViewporterState};
use smithay::wayland::{
    buffer::BufferHandler,
    compositor::{
        with_states, BufferAssignment, CompositorClientState, CompositorHandler, CompositorState,
        Damage, SurfaceAttributes,
    },
    content_type::ContentTypeState,
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
    single_pixel_buffer::SinglePixelBufferState,
    socket::ListeningSocketSource,
    tablet_manager::TabletSeatHandler,
};
use smithay::{
    delegate_compositor, delegate_content_type, delegate_cursor_shape, delegate_data_device,
    delegate_dmabuf, delegate_output, delegate_seat, delegate_shm, delegate_single_pixel_buffer,
    delegate_viewporter, delegate_xdg_shell,
};
use tracing::{debug, info, warn};

mod coalesce;
mod dmabuf_descriptor;
mod dmabuf_import;
mod engine;
mod engine_buffers;
mod engine_session;
mod modifiers;
mod outbound;
mod scale;
mod screens;
mod timing_window;
mod viewport;

use crate::engine::{Bounds, Capture};
use crate::engine_buffers::Returned;
use crate::engine_session::EngineSession;

use crate::coalesce::last_of_burst;
use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_import::{headless_renderer, DmabufImporter};
use crate::modifiers::{Held, Modifiers};
use crate::outbound::{outbound, Outbound, OutboundReceiver, OutboundSender};
use crate::scale::{logical_size, output_scale};
use crate::screens::{Advertised, Screens, Slot};
use crate::timing_window::TimingWindow;
use crate::viewport::{surface_size, Viewport};
use domicile_config::{Config, ConfigError, ConfigStore};
use domicile_host::ipc::{apply_chrome_message, parse_chrome, to_line};
use domicile_host::Host;
use domicile_launch::arguments::arguments;
use domicile_launch::session::{publish, Session};
use domicile_protocol::{ChromeMessage, CursorShape, HostMessage, Shortcut};
use smithay::backend::renderer::gles::GlesRenderer;

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
/// Three of at least nine: `e2e-dmabuf.sh` greps for `toplevel mapped`,
/// `broadcast app frame`, `chrome client connected` and more, none of them
/// named or pinned, and so do several `tests/` files. Those predate this
/// change; these three are the ones it introduced or newly depended on.
mod grepped {
    /// Told a message it could not read.
    ///
    /// No script greps this any more — `e2e-hidpi.sh` was the last, and it is
    /// gone. **Nothing pins it at all**, which is a third shape: neither a row
    /// in `the_grepped_log_messages_are_what_the_scripts_expect`, nor
    /// [`DENSITY_REFUSED`]'s weaker arrangement of a Rust test that spells the
    /// string. There is nothing for either to hold, because the check that
    /// replaced that script speaks the protocol as types and a harness and a
    /// host cannot disagree about a wire they both derive. Kept because the
    /// compositor still logs it and an operator still reads it.
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
    /// `tests/desktop.rs::a_described_desktop_refuses_a_chromes_size`: the
    /// guarded return in `set_output_size`, and the same arrangement as
    /// [`DENSITY_REFUSED`] above for the same reason — a Rust test spelling
    /// the string, since no script greps it.
    pub const SIZE_REFUSED: &str = "a described desktop keeps its own size";
    /// `e2e-chrome-fills-a-window.sh`: the logical size and density an output
    /// was advertised at.
    ///
    /// **Nothing pins it any more**, which is [`UNPARSEABLE`]'s shape rather
    /// than [`DENSITY_REFUSED`]'s. The two scripts that grepped it —
    /// `e2e-chrome-fills-a-window.sh` and `e2e-a-dense-display.sh` — went with
    /// the presented path they were written for, and the pairing test that
    /// held them to this constant went with them, having no rows left.
    ///
    /// Kept because it is the line that says what size and density the desktop
    /// came up at, which is the first thing to read when a chrome is laid out
    /// for the wrong screen.
    pub const ADVERTISING: &str = "advertising output scale";
}

/// The renderer client buffers are imported on.
///
/// One renderer, and no longer a choice of where it lives: `--present` put it
/// in a winit window and drew there, and that path went with the flag. What is
/// left imports client dmabufs and reads shm buffers back so the frames can
/// reach the chrome — and, under the fork, so the engine can be handed the
/// client's own buffer.
struct Gpu {
    renderer: Box<GlesRenderer>,
    importer: DmabufImporter,
}

impl Gpu {
    fn renderer(&mut self) -> &mut GlesRenderer {
        &mut self.renderer
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
    SetOutputScale {
        scale: i32,
    },
    /// The chrome's viewport changed; re-advertise the output at that size so
    /// a client asking how big the screen is gets the window the user has.
    SetOutputSize {
        logical: (i32, i32),
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
    /// A chrome's page said `hello`. Whatever it is, it holds no pixels yet.
    ChromeHello,
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
}

impl ChromeHub {
    fn new(
        request_tx: Sender<ClientRequest>,
        max_scale: u32,
        wayland_display: OsString,
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
    // Before the lock, and not a fast path for its own sake. This runs at the
    // end of *every* iteration of the read loop, and the whole high-volume
    // input path — `Key`, `PointerMotion`, `PointerButton`, `PointerAxis`,
    // `CloseApp`, `GrabShortcut` — answers with nothing. Taking the writer
    // lock to write zero bytes parks the reader behind `serve_outbound`, which
    // is blocked in `write_all` to a chrome that is not reading; the
    // compositor then stops reading *that chrome* and everything it says
    // afterwards is dropped on the floor. A chrome that only says things is
    // the ordinary case, so this was the ordinary case too.
    //
    // Guarded by `an_answer_with_nothing_in_it_does_not_wait_for_the_writer`
    // below, which says the invariant directly. `tests/stuck_keys.rs` also
    // fails without this, twelve runs of twelve — that is the evidence the bug
    // was real rather than the guard, since it needs a socket to fill up under
    // parallel load to say so.
    if responses.is_empty() {
        return true;
    }
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
    let fresh = hub.host.lock().unwrap().describe_desktop();
    // Said out loud because a chrome that lays its windows out on a screen
    // draws nothing at all until it has been given one, and "the page was told
    // about a client and embedded nothing" reads identically whether the page
    // ignored the host or simply had nowhere to put a window. This side is the
    // only one that can tell those apart, and a guard that cannot blames the
    // wrong end. The count is in the text so a reader — and `guard-shell.sh` —
    // can tell an empty desktop from a described one.
    //
    // THE HANDSHAKE, AND IT SAYS SO. `freshened` is on the response path, and
    // the only response carrying a desktop is the answer to a chrome's Hello;
    // the two runtime re-describes reach a chrome through `hub.broadcast`,
    // which does not come through here. A line claiming to cover those would
    // be wrong about a chrome that got its first display from one of them.
    let HostMessage::Displays { displays } = &fresh else {
        unreachable!("describe_desktop returns Displays and nothing else");
    };
    info!(
        "told the chrome about {} display(s) in its handshake",
        displays.len()
    );
    fresh
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
            report(&mut window, &hub);
            continue;
        };
        // Every item is one line now. Pixels used to follow a frame's header
        // as raw bytes; a client's buffer goes to the display compositor
        // instead and nothing on this socket is larger than its JSON.
        let Outbound::Message(message) = item;
        let line = to_line(&message);
        let mut chromes = hub.chromes.lock().unwrap();
        chromes.retain(|writer| {
            let mut stream = writer.lock().unwrap();
            stream
                .write_all(line.as_bytes())
                .and_then(|_| stream.flush())
                .is_ok()
        });
        drop(chromes);

        report(&mut window, &hub);
    }
}

/// Print one line, if the window that just closed saw anything.
fn report(window: &mut FrameWindow, hub: &Arc<ChromeHub>) {
    let Some(report) = window.due(hub) else {
        return;
    };
    info!(
        composited = report.composited,
        fps = report.fps,
        commit_ms = report.commit_ms,
        composite_ms = report.composite_ms,
        composite_worst_ms = report.composite_worst_ms,
        submit_ms = report.submit_ms,
        submit_worst_ms = report.submit_worst_ms,
        idle_ms = report.idle_ms,
        response_ms = report.response_ms,
        response_worst_ms = report.response_worst_ms,
        chromes = hub.chromes.lock().unwrap().len(),
        "frames"
    );
}

/// The Wayland thread's half of the frame path, recorded there and read by the
/// writer thread when it reports.
///
/// The writer thread already knows its own half — how many frames it sent and
/// how long the socket took — and that half alone cannot say why the rate is
/// what it is. A compositor spending every millisecond handling commits and
/// one sitting idle between a client's commits look identical from there.
#[derive(Default)]
struct FrameTimings {
    /// Time handling one commit end to end, on the Wayland thread.
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
}

/// When the writer thread last reported.
///
/// It used to carry a half of the numbers as well — frames sent, bytes
/// written, time in the sockets — because the frame path ran through it. No
/// pixels cross that socket now, so what it knows is the schedule and
/// [`FrameTimings`] has the rest.
#[derive(Default)]
struct FrameWindow {
    since: Option<Instant>,
}

/// One window's worth of numbers, rounded for reading.
struct FrameReport {
    /// Frames drawn into the window.
    composited: usize,
    fps: u32,
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
}

/// How often the writer thread reports. Long enough that the line is not noise,
/// short enough to watch while typing.
const REPORT_EVERY: Duration = Duration::from_secs(5);

impl FrameWindow {
    fn due(&mut self, hub: &ChromeHub) -> Option<FrameReport> {
        let since = *self.since.get_or_insert_with(Instant::now);
        let elapsed = since.elapsed();
        if elapsed < REPORT_EVERY {
            None
        } else {
            let mut timings = hub.timings.lock().unwrap();
            // Nothing to say when nothing is being composited; an idle desktop
            // should not fill the log.
            let composited = std::mem::take(&mut timings.composited);
            let report = (composited > 0).then(|| {
                // A path that recorded nothing reads as zero: "did not run" and
                // "took no time" are the same claim in a log line.
                let (commit, idle, response, composite) = (
                    timings.commit.take().unwrap_or_default(),
                    timings.idle.take().unwrap_or_default(),
                    timings.response.take().unwrap_or_default(),
                    timings.composite.take().unwrap_or_default(),
                );
                let submit = timings.submit.take().unwrap_or_default();
                FrameReport {
                    composited,
                    fps: (composited as f64 / elapsed.as_secs_f64()).round() as u32,
                    commit_ms: commit.average.as_millis() as u32,
                    idle_ms: idle.average.as_millis() as u32,
                    response_ms: response.average.as_millis() as u32,
                    response_worst_ms: response.worst.as_millis() as u32,
                    composite_ms: composite.average.as_millis() as u32,
                    composite_worst_ms: composite.worst.as_millis() as u32,
                    submit_ms: submit.average.as_millis() as u32,
                    submit_worst_ms: submit.worst.as_millis() as u32,
                }
            });
            drop(timings);
            *self = FrameWindow {
                since: Some(Instant::now()),
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
                // in `write_responses`. Nothing drives that interleaving
                // deterministically. The scoping is what prevents it, not a
                // check — which is why widening it has to stay a deliberate
                // decision rather than a tidy-up.
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
                    // two makes
                    // `a_chrome_that_connects_late_is_told_about_a_window_already_open`
                    // (`tests/apps.rs`) fail — but only once a delay is
                    // inserted between them to widen the window. The
                    // unmodified swap still passed 3 runs of
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
                hub.send_request(ClientRequest::SetOutputScale {
                    scale: output_scale(ratio, hub.max_scale),
                });
                Vec::new()
            }
            // THE DESKTOP IS THE CHROME'S WINDOW, and the compositor has no
            // other way to learn its size: the window belongs to the browser
            // and is never seen from here. Without this the desktop sits at
            // `compositor.nested_size` — a chrome laid out for 1280x800 in the
            // corner of whatever the user actually opened.
            //
            // Both this and the density above were guarded on `presenting`,
            // for the case where the window was the compositor's own and the
            // chrome would only be reporting back what it had been given.
            // There is no such window any more.
            Ok(ChromeMessage::SetDesktopSize { size }) => {
                hub.send_request(ClientRequest::SetOutputSize {
                    logical: (size[0].round() as i32, size[1].round() as i32),
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
            // THE BRAIN DECIDES AND THE SEAT FOLLOWS, in that order, and the
            // disagreement it settled is gone rather than fixed. The seat
            // looked for a *surface* and the scene for a *portal*, so a window
            // that had mapped but that the page had not placed had the first
            // and not the second: the keyboard went there while
            // `keyboard_target` still named the chrome, and the page drew that
            // window inactive while every key went into it.
            //
            // There is no placement now, so there is no second answer to
            // disagree with. `Host` refuses an app it does not know and
            // accepts every one it does, and the seat still follows what came
            // back — which is what `ClientRequest::KeyboardFocus` wants, and
            // is still the right shape if a second opinion ever returns.
            Ok(ChromeMessage::FocusApp { app_id }) => {
                let (out, holder) = {
                    let mut host = hub.host.lock().unwrap();
                    let out = apply_chrome_message(
                        &mut host,
                        &mut ready,
                        ChromeMessage::FocusApp {
                            app_id: app_id.clone(),
                        },
                    );
                    (out, host.focus_holder())
                };
                if holder.as_deref() != Some(app_id.as_str()) {
                    info!(app_id = %app_id, "keyboard focus -> a window this compositor does not know; the keyboard stays where it was");
                }
                hub.send_request(ClientRequest::KeyboardFocus { app_id: holder });
                out
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
    /// `toplevels` because it is not an app: it is never announced and never
    /// placed by a portal. It is the window the desktop is, and the keyboard
    /// falls back to it.
    chrome_toplevel: Option<ToplevelSurface>,
    /// Clients already told their shm buffer cannot be shown. A client commits
    /// at its frame rate and the refusal does not change, so it is said once
    /// each rather than once a frame.
    shm_refused: HashSet<String>,

    /// Apps whose first frame the engine has taken. A window that maps, is
    /// brokered a sink and is configured has still shown nothing until it
    /// commits a buffer the engine accepts, and those are three different
    /// facts. Said once per app rather than once a frame, so a two-window run
    /// says which of its windows ever drew.
    first_frame_logged: HashSet<String>,

    /// THROWAWAY, with the rest of the spike. When the pixel probe last ran.
    ///
    /// The probe forces a CopyOutputRequest and blocks this thread until viz
    /// answers, so running it per submit costs a full readback per client per
    /// frame. One client absorbed that; two did not — buffers stopped being
    /// released at all, because this thread was inside the probe instead of
    /// draining the engine's events. The guards poll for tens of seconds, so
    /// four times a second is plenty and the cost is bounded whatever the
    /// clients' frame rate.
    last_probe: Option<Instant>,

    /// THROWAWAY. Points the probe has already refused, so that saying so
    /// costs one line rather than one per submit.
    probe_refused: HashSet<(i32, i32)>,

    /// THROWAWAY. Colours already reported absent, so a guard that polls for
    /// ninety seconds gets one line rather than three hundred.
    probe_missing: HashSet<u32>,

    /// THROWAWAY. Colours the probe could not answer for at all. Separate from
    /// `probe_missing` because "not on screen" and "nothing was read" are the
    /// two answers the search exists to tell apart, and one set would let
    /// either silence the other.
    probe_unreadable: HashSet<u32>,

    /// THROWAWAY. When the colour search last ran. Its own clock, because it
    /// captures the whole window rather than a pixel and is throttled harder
    /// than the point probe beside it.
    last_find: Option<Instant>,

    /// THROWAWAY. When the colour search first ran, which is what its budget
    /// is measured from. Set on the first search rather than at startup: a
    /// desktop with no client yet is not searching for anything, and starting
    /// the clock then would spend the budget waiting.
    find_since: Option<Instant>,

    /// THROWAWAY. The last box logged for each colour, so a box is written
    /// down when it moves rather than once when it first appears. A window
    /// still painting is smaller than it will be, and how much of the page
    /// each one covers is what the two-window guard asserts — which is also
    /// why the guard waits for two consecutive readings that agree.
    ///
    /// Presence is what "found" means; a colour that goes absent is removed.
    probe_boxes: HashMap<u32, Bounds>,

    /// THROWAWAY. Whether the search is over — every colour found and none of
    /// them moving, or the budget spent. A whole-window readback is a blocking
    /// one, so a finished search stops paying for them.
    find_settled: bool,
    /// What the chrome's last frame looked like, so the line describing it is
    /// printed when it changes rather than sixty times a second.
    chrome_frame_shape: Option<((f64, f64), bool, bool)>,
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
    /// Set when the window is closed, which is the user closing the desktop.
    /// Read by the event loop, which is the only thing that can act on it.
    stop: Arc<AtomicBool>,
    /// The forked engine, when `--engine-socket` asked for one.
    ///
    /// `None` is a compositor with no path to a window at all — said at
    /// startup rather than left to be discovered. `Some` submits the client's
    /// own dmabuf to viz, and with it takes on holding `wl_buffer.release` until
    /// viz is done sampling — see [`engine_session::EngineSession`].
    engine: Option<EngineSession>,
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

    /// Say what shape the chrome's frame is, when it changes.
    ///
    /// The compositor does not draw it — the engine does — so nothing is kept.
    /// What this is for is the one line that says what the desktop is made of:
    /// which kind of buffer, at what size, and which way up.
    /// `e2e-chrome-fills-the-desktop.sh` reads the size out of it.
    fn publish_chrome_frame(
        &mut self,
        buffer: &wl_buffer::WlBuffer,
        buffer_scale: i32,
        viewport: Viewport,
    ) {
        let texture = committed_buffer(buffer)
            .and_then(|committed| self.texture_from(committed, buffer_scale, viewport));
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
        viewport: Viewport,
    ) -> Option<SurfaceTexture> {
        let (width, height) = committed.size();
        // The buffer's own logical size, which is what a source rectangle is
        // stated against — *not* the surface's, which a destination replaces.
        // Cropping against the destination would read the wrong part of the
        // buffer by exactly the ratio between them.
        let (buffer_width, buffer_height) = logical_size((width, height), buffer_scale);
        let _buffer_logical = (f64::from(buffer_width), f64::from(buffer_height));
        let (logical_width, logical_height) =
            surface_size((width, height), buffer_scale, viewport.destination);
        let logical_size = (f64::from(logical_width), f64::from(logical_height));
        match committed {
            CommittedBuffer::Gpu(dmabuf) => Some(SurfaceTexture {
                from_dmabuf: true,
                // A client that renders with GL hands the buffer over the way
                // GL made it, and says so on the buffer.
                y_inverted: dmabuf.y_inverted(),
                logical_size,
            }),
            CommittedBuffer::Pixels { .. } => Some(SurfaceTexture {
                from_dmabuf: false,
                // Shared memory is described the way it is laid out.
                y_inverted: false,
                logical_size,
            }),
        }
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
        // EVERY DISPLAY, FOR EVERY WINDOW, and that is a known gap rather than
        // a simplification. This asked the scene for a window's box and
        // narrowed the entered outputs to the displays it overlapped. The page
        // reported that box; it does not any more, because CSS positions the
        // layer and nothing else on this side needed the geometry — so the
        // narrowing has no input left and every surface takes the fallback.
        //
        // It costs nothing on the one output a desktop has today: `domicile`
        // starts the compositor with no `--config`, so there is a single
        // output following the browser window. On a two-screen desktop a
        // client would be told it is on both and would draw at the larger
        // scale of the two. Wiring that back wants the shell naming a screen
        // — `<Screen name="left">`, which ARCHITECTURE.md already calls the
        // seam — rather than this side inferring one from a rectangle.
        for (_, toplevel) in &self.toplevels {
            self.enter_only(toplevel.wl_surface(), None);
        }
        // A popup goes with its window, and that is the same answer now:
        // with no geometry on this side there is nothing to narrow either to.
        for popup in self.xdg_shell_state.popup_surfaces() {
            self.enter_only(popup.wl_surface(), None);
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

    /// The window this surface is, if it is one this compositor announced.
    fn app_id_of(&self, surface: &WlSurface) -> Option<String> {
        self.toplevels
            .iter()
            .find(|(_, toplevel)| toplevel.wl_surface() == surface)
            .map(|(app_id, _)| app_id.clone())
    }

    /// Turn a client's newly-attached buffer into pixels for the chrome,
    /// throttled to ~30fps per app.
    /// Runs the engine's pending work and acts on what it said.
    ///
    /// Called from the engine's calloop source and nowhere else: the ABI's
    /// callbacks fire inside `dispatch`, so this is the one place they land.
    fn pump_the_engine(&mut self) {
        let Some(session) = self.engine.as_mut() else {
            return;
        };
        let (events, releases) = session.dispatch();
        // Buffers viz has sat on past the deadline, taken back so the client
        // can draw. A single-buffered client with its one buffer outstanding
        // cannot draw at all, and a compositor that quietly stops a client is
        // worse than one that tears once and says why.
        let overdue = session.overdue(Instant::now());

        for release in releases.into_iter().chain(overdue) {
            match release.why {
                Returned::Released => {}
                // With the app id: "a buffer was never released" is a
                // different fact about one window of two than about both, and
                // a surface viz is not drawing at all is exactly the case
                // where only one window's holds expire.
                Returned::Expired => {
                    // Two messages rather than one with a made-up app id in
                    // it: every other `app_id` field in this binary carries an
                    // app id, the diagnostics grep these lines, and a sentence
                    // sitting in that field reads as an app literally called
                    // that. `window_gone` abandons every hold it had in the
                    // same call it forgets the app, so an expiry for a surface
                    // nothing claims really does mean the window went first.
                    match self
                        .engine
                        .as_ref()
                        .and_then(|session| session.app_for(release.surface))
                    {
                        Some(app_id) => tracing::error!(
                            app_id,
                            "the engine never released a client buffer; taking it back so the \
                             client can draw. Something in viz is holding a dmabuf it has \
                             finished with"
                        ),
                        None => tracing::error!(
                            "the engine never released a buffer belonging to a window that has \
                             since gone; taking it back"
                        ),
                    }
                }
                Returned::Abandoned => {
                    tracing::debug!("a held buffer came back because its window went away")
                }
            }
            release.buffer.release();
        }

        for event in events {
            match event {
                // xdg_toplevel.configure: the page's layout box changed, so the
                // client is told to draw at the new size.
                engine::Event::Configure {
                    surface,
                    width,
                    height,
                } => {
                    let app_id = self
                        .engine
                        .as_ref()
                        .and_then(|session| session.app_for(surface))
                        .map(str::to_owned);
                    let Some(app_id) = app_id else {
                        continue;
                    };
                    let Some(toplevel) = self.toplevel_for(&app_id) else {
                        tracing::debug!(%app_id, "the engine configured an app with no toplevel");
                        continue;
                    };
                    tracing::debug!(%app_id, width, height, "engine configure -> client");
                    toplevel.with_pending_state(|state| {
                        state.size = Some((width as i32, height as i32).into());
                    });
                    // Only sends when the size differs from the last configure
                    // the client acknowledged.
                    toplevel.send_pending_configure();
                }
                // wl_surface.frame is still sent at commit, as it always has
                // been. Driving it from viz instead changes how often every
                // client draws, which is not this change's to decide.
                engine::Event::Frame { .. } => {}
                // Handled above, where the buffer is.
                engine::Event::Released { .. } => {}
            }
        }
    }

    /// Show this app's frame, and say whether the engine took the buffer.
    ///
    /// `true` means viz is sampling the client's dmabuf and the caller must not
    /// release it — see the commit path, which is the only caller.
    ///
    /// One path: the buffer goes to the engine or the window does not draw.
    fn publish_frame(&mut self, app_id: &str, buffer: &wl_buffer::WlBuffer) -> bool {
        let Some(committed) = committed_buffer(buffer) else {
            return false;
        };
        let Some(session) = self.engine.as_mut() else {
            return false;
        };
        // Only a dmabuf can go. An shm client draws with the CPU into shared
        // memory and has no dmabuf to import, and the upload that would give it
        // one does not exist yet — see ENGINE-FORK.md, phase 2.
        //
        // It is said rather than shown, once per client. A blank window with
        // nothing in the log is the defect ERRORS.md is about; the regression
        // was accepted on the condition that it announces itself, and a client
        // commits at its frame rate, so once each is the difference between a
        // line and a flood.
        let CommittedBuffer::Gpu(dmabuf) = &committed else {
            if self.shm_refused.insert(app_id.to_string()) {
                warn!(
                    app_id,
                    "this client drew into shared memory rather than a dmabuf, and the engine \
                     can only take a dmabuf. Its window will be blank until the shm upload \
                     exists — see docs/architecture/ENGINE-FORK.md, phase 2"
                );
            }
            return false;
        };
        let descriptor = descriptor_from(dmabuf);
        // Whole-surface damage. The engine takes a rectangle and the client
        // reports one, but mapping between them is its own correctness question
        // — a wrong rectangle leaves stale pixels on screen.
        if !session.submit(app_id, buffer, &descriptor, (0, 0, 0, 0), Instant::now()) {
            return false;
        }
        // Tested before inserting: this is the submit path, at the client's
        // frame rate, and `insert` would allocate a String for every frame of
        // every window to answer a question it has already answered.
        if !self.first_frame_logged.contains(app_id) {
            self.first_frame_logged.insert(app_id.to_string());
            info!(app_id, "the engine took this app's first frame");
        }
        // THROWAWAY. The spike's assertion, and the only place it can be made:
        // the compositor holds the browser's invitation, so nothing else can
        // ask what viz drew. Logged rather than returned because the thing that
        // checks it is a shell script.
        // Throttled, and checked before the session is borrowed so that
        // updating it does not fight the borrow.
        const PROBE_EVERY: Duration = Duration::from_millis(250);
        // `match` rather than `is_none_or`, which is stable later than this
        // crate's MSRV, or `map_or(true, ..)`, which clippy rewrites into it.
        let due = match self.last_probe {
            None => true,
            Some(at) => at.elapsed() >= PROBE_EVERY,
        };
        if !due {
            return true;
        }
        self.last_probe = Some(Instant::now());
        let Some(session) = self.engine.as_ref() else {
            return true;
        };
        // Colours to find anywhere in the window, for a guard that cannot name
        // a point because the shell decides where its windows go — and, as it
        // turned out, because the coordinate space a named point is in is not
        // the one the browser was asked for.
        //
        // Searched until every wanted colour has been found AND none of their
        // boxes moved between two rounds. A box logged at first sight is a box
        // measured mid-paint: a window that is still filling in is smaller
        // than it will be, and the guard's assertion is about how much of the
        // page each window covers. Settling also means the two boxes agree
        // about one moment rather than being snapshots of different frames.
        //
        // Then it stops. The search captures the whole window and costs ~3 MB
        // and a blocking readback a time, and `HeldBuffers`' deadline is
        // 500ms — a search that runs forever is the compositor manufacturing
        // the "never released" errors the log is being read for.
        const FIND_EVERY: Duration = Duration::from_secs(2);
        // A wall clock, not a count of rounds. The guards' poll begins after
        // waiting for a broker socket, a compositor, a handshake and a client
        // to map, so no number of rounds here can be matched to it. Five
        // minutes is longer than any guard's whole run and still finite.
        const FIND_FOR: Duration = Duration::from_secs(300);
        let find_due = match self.last_find {
            None => true,
            Some(at) => at.elapsed() >= FIND_EVERY,
        };
        if find_due && !spike_find_colours().is_empty() && !self.find_settled {
            // The first search, which is the first frame a client committed
            // and the engine took: this whole block runs on the submit path.
            // So a desktop with no client yet is not searching for anything
            // and is not spending the budget waiting for one.
            let since = *self.find_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= FIND_FOR {
                // Once, on its own flag. Firing it from the loop condition
                // meant it could only be said on a round that happened to
                // straddle the budget, which is a few milliseconds out of
                // every two seconds — so it was never said, and a guard
                // reading "not found" could not tell that from "not
                // looked for".
                self.find_settled = true;
                warn!(
                    target: "domicile::engine::spike",
                    seconds = FIND_FOR.as_secs(),
                    "giving up looking for the colours that have not turned up; a whole-window \
                     readback is time this thread is not releasing the client's buffers, and it \
                     is not worth paying for a colour that was going to appear long ago"
                );
            } else {
                let mut every_colour_found = true;
                let mut nothing_moved = true;
                for &argb in spike_find_colours() {
                    match session.spike_find(argb) {
                        Some(Capture {
                            window: (w, h),
                            bounds: Some(bounds),
                        }) => {
                            // Logged when it changes, so a page that has
                            // settled says its geometry once and a page still
                            // painting says it as often as it moves.
                            if self.probe_boxes.insert(argb, bounds) != Some(bounds) {
                                nothing_moved = false;
                                let Bounds {
                                    height,
                                    width,
                                    x,
                                    y,
                                } = bounds;
                                tracing::info!(
                                    target: "domicile::engine::spike",
                                    "engine found #{argb:08X} over ({x},{y}) {width}x{height} \
                                     of the browser's {w}x{h} window"
                                );
                            }
                        }
                        // Once, and only the first time. The guard polls, so
                        // this is the state for most of a run and saying it
                        // every tick would bury the line that matters.
                        Some(Capture {
                            window: (w, h),
                            bounds: None,
                        }) => {
                            every_colour_found = false;
                            // Forgotten, not kept. A colour that is found,
                            // then absent, then found again would otherwise
                            // settle by matching a box measured two rounds
                            // earlier — which is not two consecutive readings
                            // of the same thing, which is the whole point.
                            self.probe_boxes.remove(&argb);
                            if self.probe_missing.insert(argb) {
                                tracing::info!(
                                    target: "domicile::engine::spike",
                                    "engine has not drawn #{argb:08X} anywhere in the browser's \
                                     {w}x{h} window yet"
                                );
                            }
                        }
                        // Its own set, not `probe_missing`. Sharing one would
                        // let a single transient unreadable capture silence
                        // the real "has not drawn" measurement for the rest of
                        // the run — and that line is what the negative
                        // controls grep for, so the two answers this split
                        // exists to separate would be merged again by the
                        // thing meant to keep them apart.
                        None => {
                            every_colour_found = false;
                            self.probe_boxes.remove(&argb);
                            if self.probe_unreadable.insert(argb) {
                                warn!(
                                    target: "domicile::engine::spike",
                                    "engine could not read the window at all looking for \
                                     #{argb:08X}, so nothing was measured about it — which is \
                                     not the same as the colour being absent"
                                );
                            }
                        }
                    }
                }
                // Said out loud, because the guards need it and cannot
                // derive it. A box is logged only when it *moves*, so "the
                // last line has not changed" is true whether the search ran
                // or not — a script watching the log is watching the log's
                // quiescence, not the page's. This is the compositor saying
                // it looked again and nothing had moved, which is the claim
                // a guard actually wants before it measures a width.
                if every_colour_found && nothing_moved {
                    self.find_settled = true;
                    tracing::info!(
                        target: "domicile::engine::spike",
                        "engine settled: every colour it was looking for held still"
                    );
                }
            }
            // Stamped after the captures, not before: the interval is meant to
            // be a gap between readbacks, and a capture longer than it would
            // otherwise run back to back with no gap at all.
            self.last_find = Some(Instant::now());
        }

        if spike_probe_points().is_empty() && spike_find_colours().is_empty() {
            if let Some(drawn) = session.spike_window_centre() {
                tracing::info!(
                    target: "domicile::engine::spike",
                    "engine drew #{drawn:08X} at the centre of the browser's window"
                );
            }
        } else {
            for &(x, y) in spike_probe_points() {
                match session.spike_pixel(x, y) {
                    Some(drawn) => tracing::info!(
                        target: "domicile::engine::spike",
                        "engine drew #{drawn:08X} at ({x},{y}) of the browser's window"
                    ),
                    // Said, not skipped, and this is the point. A probe that
                    // answers nothing and logs nothing is indistinguishable
                    // from a page that drew nothing, and the two have entirely
                    // different causes: the first is the symbol missing from
                    // the library or the point outside the window, the second
                    // is the seam. Once per point, because this is on the
                    // submit path.
                    None => {
                        if self.probe_refused.insert((x, y)) {
                            // Two things left, and the centre tells them
                            // apart. SamplePixel refuses both a point outside
                            // the window and a window that has not been drawn
                            // — the second returns an empty bitmap, which is
                            // "the browser is not compositing at all" and is a
                            // completely different problem. The centre is
                            // always inside a window that exists, so an answer
                            // from it means the bitmap is fine and this point
                            // is not, and no answer means there is no bitmap.
                            match session.spike_window_centre() {
                                Some(centre) => warn!(
                                    x,
                                    y,
                                    centre = format!("#{centre:08X}"),
                                    "the probe refused this point but answered for the \
                                     window's centre, so the browser is drawing and this \
                                     point is outside its window"
                                ),
                                None => warn!(
                                    x,
                                    y,
                                    "the probe refused this point AND the window's \
                                     centre, so the browser has drawn nothing at all — \
                                     which is not a probe fault and would also stop viz \
                                     ever releasing a client's buffer"
                                ),
                            }
                        }
                    }
                }
            }
        }
        true
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

    /// Advertise a new desktop size, because the chrome's window is the
    /// desktop and the chrome is the only thing that can see it.
    ///
    /// The mirror of `set_output_scale` above, and guarded the same way: a
    /// described desktop is the config's statement about the user's real
    /// screens, so dragging Domicile's window shows more or less of it rather
    /// than resizing it. Logged when refused for the reason that one is —
    /// otherwise "the desktop did not resize" and "the message never arrived"
    /// look identical from outside.
    ///
    /// The scale is carried through rather than recomputed: a mode is a size
    /// and a density together, and this half is not the one that moved.
    fn set_output_size(&mut self, logical: (i32, i32)) {
        if !self.screens.follows_the_window() {
            debug!(
                width = logical.0,
                height = logical.1,
                "{}",
                grepped::SIZE_REFUSED
            );
            return;
        }
        let scale = self
            .screens
            .outputs()
            .next()
            .expect("a window-following desktop advertises its one output")
            .scale;
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
        // The brain as well as the seat. Every route through *this* function —
        // the chrome's own window mapping, a window going away, alt-tabbing
        // into Domicile — and moving the seat without telling the brain leaves
        // `keyboard_target` naming a window the compositor is no longer typing
        // into, with the chrome still marking it active.
        //
        // Not a click on the desktop, which this said for a while: that is
        // `focus_pointed_at`, which broadcasts the same decision from its own
        // arm and never comes through here.
        broadcast_focus_decision(&self.hub, ChromeMessage::FocusChrome);
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
            // LOGGED AND NOTHING ELSE, DELIBERATELY. The compositor used to
            // keep the claim and take the chord's keys out of the stream; it
            // could, because `--present` gave it a window and the window gave
            // it the keyboard. Now the chrome holds the keyboard and forwards
            // every key here, so it has already matched its own chords before
            // the compositor sees anything — the claim has nothing left to do.
            //
            // The message stays because the chrome still sends it and the line
            // is what says a shortcut was claimed at all, which is worth
            // having when a chord does not fire.
            ClientRequest::GrabShortcut { shortcut } => {
                info!(key = shortcut.key, "the chrome claimed a shortcut");
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
                announce_open_apps(&self.hub);
            }
            ClientRequest::SetOutputScale { scale } => self.set_output_scale(scale),
            ClientRequest::SetOutputSize { logical } => self.set_output_size(logical),
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
                // Always forwarded. The compositor used to take a claimed
                // chord's keys out of the stream, which it could do because it
                // owned the input: `--present` gave it a window and the window
                // gave it the keyboard. It has neither now — the chrome holds
                // the keyboard and forwards each key here — so it sees every
                // key *after* the chrome has already had the chance to match
                // its own chords, and there is nothing left to intercept.
                |_, _, _| FilterResult::<()>::Forward,
            );
        }
        self.tell_the_chromes_the_modifiers();
    }
}

// ---- compositor + shm + dmabuf --------------------------------------------

/// What a client just attached: pixels we can already read (`wl_shm`), or a
/// GPU buffer that has to go through the renderer first (`zwp_linux_dmabuf`).
/// What a client's latest commit *is*, as far as the compositor needs to know:
/// where it came from, which way up, and how big. Not its pixels — those go to
/// the engine untouched.
struct SurfaceTexture {
    /// Whether the client handed over a GPU buffer or shared memory. Recorded
    /// for the log: it is the difference between a frame that cost nothing and
    /// one that cost an upload, and it is not visible in the picture.
    from_dmabuf: bool,
    /// A client that renders with GL hands the buffer over the way GL made it
    /// and says so on the buffer. Kept from where it said so.
    y_inverted: bool,
    /// The surface's own size in logical units. Not the output's: a client that has not answered a configure yet
    /// is still its old size, and stretching it to the output would hide that
    /// rather than show it.
    ///
    /// A `wp_viewport`'s destination is this, when it set one: a destination
    /// *is* the logical size, which is the whole point of sending it.
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

    use super::{damage_bounds, take_damage, Damage, Region};

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
    Pixels { width: u32, height: u32 },
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
        let (attached, callbacks, buffer_scale, viewport) = with_states(surface, |states| {
            // Beside the buffer and in the same borrow, because a viewport is
            // double-buffered too: what it says applies to the buffer it was
            // committed with, and reading it later reads the next frame's.
            let viewport = {
                let mut cached = states.cached_state.get::<ViewportCachedState>();
                let state = cached.current();
                Viewport {
                    destination: state.dst.map(|size| (size.w, size.h)),
                    source: state
                        .src
                        .map(|rect| (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h)),
                }
            };
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
            // stops saving anything.
            //
            // Nothing reads it any more — the engine takes whole-surface
            // damage — but the call stays, because clearing that vector is
            // what it was always for and dropping it would leak a rectangle
            // per commit for the life of every window.
            take_damage(&mut attrs.damage, attrs.buffer_scale);
            // How many buffer pixels the client drew per logical unit. Taken
            // here with the buffer rather than looked up later: it is the
            // scale *this* buffer was drawn at, and a client that is mid-way
            // through answering a scale change will commit the next one at a
            // different number.
            (attached, callbacks, attrs.buffer_scale, viewport)
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
            let engine_holds = match &committer {
                Committer::App(app_id) => self.publish_frame(app_id, &buffer),
                Committer::Chrome => {
                    self.publish_chrome_frame(&buffer, buffer_scale, viewport);
                    false
                }
            };
            // The client may redraw into this buffer the instant it is
            // released, so the release comes after the pixels are out of it —
            // and it happens even for a frame the throttle dropped, or a
            // single-buffered client never draws again.
            //
            // The one exception is a buffer the engine took: viz is sampling
            // that dmabuf directly, so releasing it here is the tear this path
            // exists to avoid. It comes back through the engine's own release
            // instead, and if that never arrives `EngineSession::overdue` takes
            // it back rather than leaving the client stopped. Everything else
            // still releases here — the chrome, a frame the throttle dropped,
            // and any app frame the engine would not take.
            if !engine_holds {
                buffer.release();
                tracing::debug!(?committer, "buffer released");
            }
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
    /// The client threw the buffer away. Drops the import behind it, so the
    /// browser lets go of its fds, and forgets any hold — no release will
    /// arrive for a buffer whose object is gone.
    fn buffer_destroyed(&mut self, buffer: &wl_buffer::WlBuffer) {
        if let Some(session) = self.engine.as_mut() {
            if session.buffer_destroyed(buffer).is_some() {
                tracing::debug!("a buffer the engine still held was destroyed by its client");
            }
        }
    }
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
delegate_viewporter!(DomicileCompositor);
delegate_single_pixel_buffer!(DomicileCompositor);
delegate_content_type!(DomicileCompositor);
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
        // The chrome draws the pointer itself: a client of ours asking for a
        // cursor is really asking the *chrome* for one, because the pointer the
        // user sees belongs to the web engine.
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
            // Anything the engine was holding for this window comes back now.
            // No release will ever arrive for a surface that is gone, and the
            // client may still be running.
            let abandoned = self
                .engine
                .as_mut()
                .map(|session| session.window_gone(&app_id))
                .unwrap_or_default();
            for release in abandoned {
                release.buffer.release();
            }
            self.last_frame.remove(&app_id);
            // The commit counter too, which was the one sibling map this
            // forgot. A stale entry could never be *read* — host ids are
            // monotonic, so no later window takes this name — but it would sit
            // there for the life of the process.
            self.content.remove(&app_id);
            // And nothing is owed to a canvas that no longer exists.
            // An app id can come back — a client that reconnects, a portal
            // re-created — and the window it names then is a different one.
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
        Err(_) => {
            shm_buffer_size(buffer).map(|(width, height)| CommittedBuffer::Pixels { width, height })
        }
    }
}

/// How big a `wl_shm` buffer says it is.
///
/// The size and nothing else: the engine takes a dmabuf, and an shm client's
/// window is refused rather than drawn — see `publish_frame`. What this
/// answers is which kind of buffer arrived, so that the refusal can say so.
fn shm_buffer_size(buffer: &wl_buffer::WlBuffer) -> Option<(u32, u32)> {
    with_buffer_contents(buffer, |_ptr, _len, data| {
        Some((data.width.max(0) as u32, data.height.max(0) as u32))
    })
    .ok()
    .flatten()
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
    // Delegated compositing: Chromium sends its layer tree as one subsurface
    // per quad, but only to a compositor that advertises what it asks for.
    // `wl_subcompositor` comes with `CompositorState`; these are the rest that
    // are standard. See `docs/architecture/WINDOW-COMPOSITING.md`.
    // Back, and only because it is honoured now. A global is a promise to
    // act on what a client then says through it, and Chromium reads this one
    // as permission to stop calling `wl_surface.set_buffer_scale` and to put
    // its logical size in `wp_viewport.set_destination` instead. Advertising
    // it while the commit path read the buffer and its scale and nothing else
    // made every surface on a dense display twice its true size, and every
    // portal and pointer coordinate with it. See `viewport`, which answers
    // the destination that sizes a surface and the source that crops it where
    // the compositor draws, and `e2e-a-dense-display.sh`, which is what says
    // so: with the destination ignored the chrome's surface reads 2560x1600
    // against a desktop of 1280x800, and that check goes red. Measured.
    ViewporterState::new::<DomicileCompositor>(&dh);
    SinglePixelBufferState::new::<DomicileCompositor>(&dh);
    ContentTypeState::new::<DomicileCompositor>(&dh);

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
    let (hub, outbound_rx) =
        ChromeHub::new(request_tx, config.output.max_scale, socket_name.clone());
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
    // HEADLESS, ALWAYS. `--present` opened a winit window and composited into
    // it with Smithay's GL renderer; it went because nothing ran it. It was
    // never reachable from `domicile` or the flake — only from three e2e
    // scripts, whose whole subject was that path — so what it had was tests
    // and no users.
    //
    // The renderer that stays is what imports client dmabufs and reads shm
    // buffers back for the chrome, which is how a client's frames reach the
    // engine at all.
    let mut gpu = match headless_renderer() {
        Ok((renderer, importer)) => Some(Gpu {
            importer,
            renderer: Box::new(renderer),
        }),
        Err(err) => {
            tracing::warn!(%err, "no EGL renderer: serving wl_shm clients only");
            None
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

    // The engine, when the shell asked for one. Loudly or not at all: a
    // compositor told to use the engine and unable to load it must say which
    // library and why, because the alternative is a desktop that comes up with
    // no windows on it and no reason given. `dlopen` is build hygiene — it
    // keeps `cargo build` from needing a Chromium checkout — and not a licence
    // to carry on without the library.
    //
    // **Without the flag there is no path to a window at all**, now that the
    // copy path is gone. That is a running configuration rather than a
    // mistake — every check in `scripts/` drives the chrome, input and
    // displays, none of which need a client's pixels, and none of them has a
    // Chromium build to point at. So it is allowed and it is *said*: a
    // compositor that shows no window has to give the reason, whether the
    // reason is a failure or a choice.
    let engine = match arguments.engine_socket.as_deref() {
        Some(socket) => Some(EngineSession::load(socket)?),
        None => {
            warn!(
                "no --engine-socket, so no client window will be shown: the engine is what puts \
                 one on the page and the copy path that used to draw them here is gone. The \
                 chrome, input and the desktop all work as before"
            );
            None
        }
    };

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
        content: HashMap::new(),
        toplevels: Vec::new(),
        pointer_app: None,
        start: Instant::now(),
        last_frame: HashMap::new(),
        last_commit: None,
        pending_key: None,
        shm_refused: HashSet::new(),
        first_frame_logged: HashSet::new(),
        last_probe: None,
        probe_refused: HashSet::new(),
        probe_missing: HashSet::new(),
        probe_unreadable: HashSet::new(),
        last_find: None,
        find_since: None,
        probe_boxes: HashMap::new(),
        find_settled: false,
        chrome_toplevel: None,
        chrome_frame_shape: None,
        screens,
        modifiers: Held::default(),
        stop: Arc::new(AtomicBool::new(false)),
        engine,
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

    // The engine's own fd, in the same loop as everything else. This is the
    // whole of why the ABI hands one out: mojo wants a task runner and the
    // compositor already has one, so the library does its work when told and
    // never on a thread this does not know about.
    if let Some(session) = data.state.engine.as_ref() {
        // Duplicated rather than borrowed: the source outlives this scope, and
        // the engine owns the original and closes it when it is dropped.
        let engine_fd =
            unsafe { std::os::fd::BorrowedFd::borrow_raw(session.fd()) }.try_clone_to_owned()?;
        handle.insert_source(
            Generic::new(engine_fd, Interest::READ, Mode::Level),
            |_, _, data: &mut CalloopData| {
                data.state.pump_the_engine();
                Ok(PostAction::Continue)
            },
        )?;
    }

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
                    // watched. It cost an afternoon; seven checks catch it coming
                    // back now, `tests/desktop.rs`'s reload and `tests/outputs.rs`'s
                    // among them — measured, by reproducing the capture.
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
        },
        &arguments.session,
    )?;

    // Flush after every loop iteration so events queued while handling input
    // (which arrives off the wayland fd) reach clients promptly.
    let stop = data.state.stop.clone();
    let signal = event_loop.get_signal();
    event_loop.run(None, &mut data, move |data| {
        let _ = data.display.flush_clients();
        if stop.load(Ordering::SeqCst) {
            signal.stop();
        }
    })?;
    Ok(())
}

/// THROWAWAY, with the rest of the spike. Where in the browser's window to
/// ask what viz drew, from `DOMICILE_SPIKE_PROBE` as `x,y;x,y`.
///
/// Empty -- the ordinary case -- means the window's centre, which is where a
/// one-`<app>` page puts its canvas. A page with two of them has no pixel
/// inside both, so the two-window guard names one point per canvas. Parsed
/// once: this is called from the submit path, at the client's frame rate.
///
/// A malformed entry is dropped with a warning rather than failing the run.
/// The guard checks for the colours it expects and reports their absence, so
/// a probe that silently sampled nothing still fails -- loudly, and in the
/// place that knows what it was looking for.
fn spike_probe_points() -> &'static [(i32, i32)] {
    static POINTS: std::sync::OnceLock<Vec<(i32, i32)>> = std::sync::OnceLock::new();
    POINTS.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_PROBE") else {
            return Vec::new();
        };
        raw.split(';')
            .filter(|entry| !entry.trim().is_empty())
            .filter_map(|entry| {
                let (x, y) = entry.split_once(',')?;
                match (x.trim().parse(), y.trim().parse()) {
                    (Ok(x), Ok(y)) => Some((x, y)),
                    _ => {
                        warn!(entry, "DOMICILE_SPIKE_PROBE: not an `x,y` point; ignored");
                        None
                    }
                }
            })
            .collect()
    })
}

/// THROWAWAY, with the rest of the spike. Colours to look for anywhere in the
/// browser's window, from `DOMICILE_SPIKE_FIND` as `RRGGBB;RRGGBB` or
/// `AARRGGBB;AARRGGBB`.
///
/// The shell guard's question rather than the spike pages'. Those pages put
/// their canvases where the harness can compute a point; a shell puts its
/// windows where its own layout decides, so a guard that named a pixel would
/// be asserting the shell's CSS. "This client's window is on the screen
/// somewhere" is the claim that survives the shell being rewritten.
///
/// Six hex digits are taken as fully opaque, because that is what a colour
/// written down in a guard means and `FF` in front of it is noise.
fn spike_find_colours() -> &'static [u32] {
    static COLOURS: std::sync::OnceLock<Vec<u32>> = std::sync::OnceLock::new();
    COLOURS.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_FIND") else {
            return Vec::new();
        };
        parse_find_colours(&raw)
    })
}

/// The parse [`spike_find_colours`] does, without the environment around it —
/// which is what makes it testable at all, since the variable is read once per
/// process.
///
/// A malformed entry is dropped with a warning rather than failing the run, on
/// the same reasoning as `DOMICILE_SPIKE_PROBE`: the guard checks for the
/// colour it expects and reports its absence, so a search that quietly looked
/// for nothing still fails, loudly, where it is known what was wanted.
fn parse_find_colours(raw: &str) -> Vec<u32> {
    raw.split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let digits = entry.strip_prefix('#').unwrap_or(entry);
            match (digits.len(), u32::from_str_radix(digits, 16)) {
                // Six digits are fully opaque, because that is what a colour
                // written down in a guard means and `FF` in front of it is
                // noise. The window's pixels are opaque, so a colour with no
                // alpha would match nothing at all.
                (6, Ok(rgb)) => Some(0xFF00_0000 | rgb),
                (8, Ok(argb)) => Some(argb),
                _ => {
                    warn!(
                        entry,
                        "DOMICILE_SPIKE_FIND: not an `RRGGBB` or `AARRGGBB` colour; ignored"
                    );
                    None
                }
            }
        })
        .collect()
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
        announce_open_apps, answers_keystroke, broadcast_closed, broadcast_focus_decision, channel,
        chrome_connection, client_command, cursor_shape, freshened, parse_find_colours, to_line,
        unmounts_the_element, write_responses, ChromeHub, ClientRequest, Committer, Outbound,
    };

    use std::sync::Arc;

    use domicile_protocol::{ChromeMessage, HostMessage};

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
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
    fn an_answer_with_nothing_in_it_does_not_wait_for_the_writer() {
        // The read loop calls this at the end of every iteration, and every
        // chrome message but `hello` answers with nothing — so waiting here
        // for a writer `serve_outbound` is holding stops the compositor
        // reading that chrome at all, and everything it says afterwards is
        // dropped. That was a real flake before the early return: one run in
        // twenty-four of the whole workspace.
        //
        // A unit test rather than the integration one that found it: the
        // behaviour is one sentence about this function, and the integration
        // failure needs a socket to fill up under parallel load to say it.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
        let (_page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));

        // `serve_outbound`, mid-`write_all` to a chrome that is not reading.
        //
        // Handshaked rather than slept past. A settle of "long enough, surely"
        // fails in the direction that hides the bug: if the main thread wins
        // the lock, the call it is timing never waits and a *mutated* build
        // passes. Waiting for the holder to say it has the lock removes the
        // race rather than making it unlikely — and lets the hold be a second
        // rather than two, since none of it is spent settling.
        let (took_it, holds) = channel();
        let held = writer.clone();
        let holder = thread::spawn(move || {
            let _guard = held.lock().unwrap();
            took_it.send(()).expect("the test is still listening");
            sleep(Duration::from_secs(1));
        });
        holds.recv().expect("the holder takes the lock and says so");

        let started = Instant::now();
        let answered = write_responses(&hub, &writer, Vec::new());
        let took = started.elapsed();
        holder.join().expect("the holder ends");

        assert!(
            answered,
            "an answer with nothing in it is not a failed write"
        );
        assert!(
            took < Duration::from_millis(500),
            "an empty answer waited {took:?} for a writer another thread was holding"
        );
    }

    #[test]
    fn the_answer_on_the_wire_carries_the_desktop_as_of_when_it_was_written() {
        // The whole point of `freshened`, at the seam where it is called. The
        // answers are built under `host` and written later under the writer
        // lock, so handing in answers built against an older desktop is the
        // interleaving — without having to win a race to produce it.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
        let (hub, outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
        //
        // One chrome is enough *here* because the queue is the seam: a focus
        // written back to the asker never reaches it, whatever is connected.
        // What one chrome cannot show is the other end — `serve_outbound`
        // writing each queued message to every entry in `chromes` rather than
        // to the first. `tests/desktop.rs` pins that in
        // `a_density_one_chrome_reports_is_described_to_the_others`, with two
        // chromes on the fan-out; its third is a latecomer, and a latecomer is
        // answered by `write_responses` rather than by the fan-out at all.
        //
        // `e2e-two-chromes.sh` existed to cover the pair at once and was
        // deleted for covering neither alone. A port of it was written and
        // both halves were mutated — `serve_outbound`'s `chromes.retain`
        // writing to the first chrome only, and `read_chrome_messages`'
        // `hub.broadcast(message)` after a chrome message written back to the
        // asking connection instead — and each was already killed there or
        // here. Named by statement rather than by line: both sites moved
        // within the change that wrote this comment.
        //
        // What went with the script is the *composition*, and it is worth
        // being plain about rather than implying it followed: the two halves
        // are pinned separately, and nothing now drives a `focus_changed`
        // over the fan-out to *two connected chromes*. The qualifier is the
        // claim: `tests/input.rs`'s
        // `a_focus_the_chrome_asked_for_comes_back_over_the_socket` does
        // assert a compositor's `focus_changed` reaching a real socket, with
        // one chrome — it took that over from `e2e-input.sh`, which is gone.
        // No check runs two chromes at once, so a first-chrome-only
        // fan-out would still write to the one that connected first.
        // Measured: every check that turns on a message reaching a chrome
        // *other than the first* is a `Displays` check.
        //
        // And a fan-out made type-aware — every message to everyone,
        // `FocusChanged` to the first chrome only — passes the Rust suite
        // (`cargo test --workspace`; the shell scripts were not run under it).
        // That is not a regression anyone writes by accident, which is why the
        // script still went; it is the shape of what nothing would now catch.
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
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
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
            let Outbound::Message(message) = item;
            seen.push(message);
        }
        seen
    }

    /// A hub with one placed app, ready to be focused.
    fn hub_with_an_app() -> (Arc<ChromeHub>, crate::outbound::OutboundReceiver, String) {
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
        let app_id = {
            let mut host = hub.host.lock().unwrap();
            let (app_id, _) = host.app_appeared(None, Some((100.0, 100.0)));
            host.handle_chrome_message(ChromeMessage::PlacePortal {
                app_id: app_id.clone(),
                corner_radius: 0.0,
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
        // backgrounded and brought back wears a still of itself for good.
        let hidden = |visible| ChromeMessage::PlacePortal {
            app_id: "term".to_string(),
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            size: [0.0, 0.0],
            z_index: 0,
            visible,
            corner_radius: 0.0,
            opacity: 1.0,
            shadow: None,
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

    /// Six digits mean opaque, because the window's pixels are and a colour
    /// with no alpha would match none of them.
    #[test]
    fn a_colour_with_no_alpha_is_opaque() {
        assert_eq!(parse_find_colours("19B36B"), vec![0xFF19_B36B]);
    }

    #[test]
    fn an_alpha_that_is_written_down_is_kept() {
        assert_eq!(parse_find_colours("8019B36B"), vec![0x8019_B36B]);
    }

    /// A guard writes colours the way CSS does, and the harness that passes
    /// them along should not have to strip anything.
    #[test]
    fn a_leading_hash_and_the_spaces_around_an_entry_are_not_part_of_the_colour() {
        assert_eq!(
            parse_find_colours(" #19B36B ; CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    /// The run continues on a malformed entry, so a typo costs the colour that
    /// was mistyped and not the ones beside it.
    #[test]
    fn an_entry_that_is_not_a_colour_is_dropped_and_the_rest_are_kept() {
        assert_eq!(
            parse_find_colours("19B36B;nonsense;CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    #[test]
    fn nothing_to_look_for_is_nothing_to_look_for() {
        assert!(parse_find_colours("").is_empty());
        assert!(parse_find_colours(";  ;").is_empty());
    }
}
