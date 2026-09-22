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
use std::os::fd::OwnedFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::process::{Command, ExitCode};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
        timer::{TimeoutAction, Timer},
        EventLoop, InsertError, Interest, LoopHandle, Mode, PostAction, RegistrationToken,
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
    idle_inhibit::{IdleInhibitHandler, IdleInhibitManagerState},
    output::{OutputHandler, OutputManagerState},
    selection::data_device::{
        request_data_device_client_selection, set_data_device_focus, set_data_device_selection,
        ClientDndGrabHandler, DataDeviceHandler, DataDeviceState, ServerDndGrabHandler,
    },
    selection::primary_selection::{
        set_primary_focus, PrimarySelectionHandler, PrimarySelectionState,
    },
    selection::{SelectionHandler, SelectionSource, SelectionTarget},
    shell::xdg::{
        PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
        XdgToplevelSurfaceData,
    },
    shm::with_buffer_contents,
    shm::{ShmHandler, ShmState},
    single_pixel_buffer::SinglePixelBufferState,
    socket::ListeningSocketSource,
    tablet_manager::TabletSeatHandler,
    xdg_activation::{
        XdgActivationHandler, XdgActivationState, XdgActivationToken, XdgActivationTokenData,
    },
};
use smithay::{
    delegate_compositor, delegate_content_type, delegate_cursor_shape, delegate_data_device,
    delegate_dmabuf, delegate_idle_inhibit, delegate_output, delegate_primary_selection,
    delegate_seat, delegate_shm, delegate_single_pixel_buffer, delegate_viewporter,
    delegate_xdg_activation, delegate_xdg_shell,
};
use tracing::{debug, error, info, warn};

mod clipboard;
mod coalesce;
mod dmabuf_descriptor;
mod dmabuf_import;
mod engine;
mod engine_buffers;
mod engine_session;
mod engine_surfaces;
mod idle;
mod keymap;
mod latency;
mod modifiers;
mod outbound;
mod peer_process;
mod pnp_ids;
mod restatement;
mod scale;
mod screens;
mod timing_window;
mod uevents;
mod viewport;
mod which_engine;

use crate::engine::{Bounds, Capture};
use crate::engine_buffers::Returned;
use crate::engine_session::EngineSession;
use crate::latency::{Latency, Step as LatencyStep};

use crate::coalesce::last_of_burst;
use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_import::{headless_renderer, DmabufImporter};
use crate::idle::{darkened, somebody_is_here, Blanking, Idle, StillThere};
use crate::keymap::compiled_keymap;
use crate::modifiers::{Held, Modifiers};
use crate::outbound::{outbound, Outbound, OutboundReceiver, OutboundSender};
use crate::peer_process::peer_pid;
use crate::restatement::Restatement;
use crate::scale::{logical_size, output_scale};
use crate::screens::{Advertised, Screens, Slot};
use crate::timing_window::TimingWindow;
use crate::viewport::{surface_size, Viewport};
use crate::which_engine::another_engine;
use domicile_config::{Config, ConfigError, ConfigStore, IdleConfig, KeyboardConfig};
use domicile_host::battery::{announces_a_power_supply, reading, Charge, RealPowerSupplies};
use domicile_host::clipboard::{text_mime, History, LONGEST_COPY, TEXT_MIMES};
use domicile_host::files::{listing, RealDirectory, DEEP_ROOTS};
use domicile_host::ipc::{apply_chrome_message, parse_chrome, to_line};
use domicile_host::Host;
use domicile_launch::arguments::arguments;
use domicile_launch::handshake::{silence, Handshake, WAIT_FOR_A_PAGE};
use domicile_launch::session::{publish, Session};
use domicile_protocol::{ChromeMessage, CursorShape, HostMessage};
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
    /// `tests/apps.rs::a_spawn_says_which_process_it_started`: the fork in
    /// `spawn_client`, and the first of the two lines a slow launch is read
    /// from.
    ///
    /// [`DENSITY_REFUSED`]'s arrangement — a Rust test that spells the string
    /// — rather than [`UNPARSEABLE`]'s nothing, because the test waits on it
    /// by text and a rename here would leave that wait timing out with a
    /// verdict against the compositor for a string that moved.
    pub const SPAWNING: &str = "spawning client";
    /// `tests/apps.rs::a_client_that_reaches_the_socket_is_said_to_have_arrived`:
    /// the accept callback in `run`, and the second of the two. Pinned the
    /// same way and for the same reason as [`SPAWNING`] above.
    pub const ARRIVED: &str = "app client connected";
    /// `tests/input.rs::a_keymap_the_reload_cannot_compile_leaves_the_desktop_typing`:
    /// the refusing arm of
    /// [`retype_the_desktop`](crate::DomicileCompositor::retype_the_desktop).
    ///
    /// [`DENSITY_REFUSED`]'s arrangement — a Rust test that spells the string
    /// — and load-bearing for the same reason: a reload that refuses a keymap
    /// sends no message, so this line is the only thing that distinguishes a
    /// desk that kept its layout deliberately from one where the save never
    /// arrived.
    pub const KEYMAP_REFUSED: &str = "keeping the keymap the desktop is typing on";
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
    /// The chrome reported its `devicePixelRatio`.
    ///
    /// Both halves of it, because they answer different questions. `scale` is
    /// what the output advertises, which Wayland can only say as an integer —
    /// see [`crate::scale::output_scale`]. `ratio` is the fraction it was
    /// rounded from, and the compositor keeps it because the *engine* states
    /// an `<app>`'s box in device pixels: converting one back into the logical
    /// units a configure is in needs the ratio and not the rounding of it.
    SetOutputScale {
        ratio: f64,
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
    /// A chrome's page said `hello`. Whatever it is, it holds no pixels yet.
    ///
    /// `served_by` is the process on the other end of the connection the hello
    /// came in on, as the kernel stamped it — the browser process, because the
    /// fork's `ControlChannel` lives there. It is how this compositor tells a
    /// page its own engine reloaded from a page a NEW engine is serving, which
    /// is the only notice it gets that the engine was replaced. See
    /// [`crate::which_engine`].
    ChromeHello {
        served_by: Option<i32>,
    },
    /// A client handed over what it had copied, read off the pipe it was given.
    ///
    /// Comes from the thread that did the reading rather than from a chrome —
    /// the one variant here that does — because a client's write is a
    /// stranger's work on a deadline and nothing on the Wayland thread may
    /// wait for it. See [`DomicileCompositor::read_what_was_copied`].
    ClipboardCopied {
        text: String,
    },
    /// The shell picked something out of the clipboard's history; put it back
    /// on the seat's clipboard.
    ///
    /// The selection this sets is the compositor's own, which is what makes a
    /// manager a manager: the entry outlives the client that first copied it,
    /// so a terminal closed an hour ago is still something this can paste.
    CopyClipboardEntry {
        entry: u32,
    },
}

/// One connected chrome: where to write to it, and which display its window
/// covers.
///
/// **THE SCREEN IS PER CONNECTION AND THE BRAIN IS NOT.** A desk of several
/// monitors is several windows -- one browser window cannot span two CRTCs --
/// each loading the same shell on a socket of its own. What differs between
/// them is which display they are, so it is held here, beside the writer it
/// belongs to, rather than on the one [`Host`] all of them drive.
///
/// `None` is a chrome that never said, which is a nested run and every chrome
/// there was before a window could be one display. It is told the whole
/// desktop, which is what it draws.
struct Chrome {
    writer: Arc<Mutex<UnixStream>>,
    screen: Option<String>,
}

/// Shared between the Wayland thread (calloop) and the chrome-connection threads.
///
/// Holds the single [`Host`] brain both sides drive, the write-halves of
/// connected chrome sockets (to broadcast app lifecycle), and senders to push
/// forwarded input onto the Wayland thread and pixels onto the writer thread.
struct ChromeHub {
    host: Mutex<Host>,
    chromes: Mutex<Vec<Chrome>>,
    request_tx: Mutex<Sender<ClientRequest>>,
    outbound: OutboundSender,
    timings: Mutex<FrameTimings>,
    /// The highest output scale to advertise, whatever the chrome reports.
    ///
    /// Held here because it is the chrome connections that receive the density
    /// and have to bound it — and atomic because a reload changes it. The
    /// Wayland thread writes it while a connection thread reads it, and there
    /// is nothing for the two to agree about beyond the number itself: a
    /// density that crossed the wire before the edit landed is a density
    /// reported against the cap that was live when it was sent.
    max_scale: AtomicU32,
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
            max_scale: AtomicU32::new(max_scale),
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

/// Tell every chrome that a client asked for the keyboard, and move nothing.
///
/// The asymmetry with [`broadcast_focus_decision`] is the whole point: that
/// one applies a decision and reports where the seat went, this one reports a
/// question and leaves the seat alone. What answers it is a shell sending
/// `focus_app` back, or no shell answering at all — which is the desktop where
/// a window cannot interrupt what its user is typing into, and a policy no
/// shell could have written while the compositor granted these itself.
///
/// Broadcast for [`broadcast_focus_decision`]'s reason: a request reaches the
/// chrome that is showing the desktop, and the compositor does not know which
/// of the connected pages that is.
fn broadcast_focus_request(hub: &ChromeHub, app_id: &str) {
    let asked = hub.host.lock().unwrap().focus_requested(app_id);
    if let Some(message) = asked {
        hub.broadcast(message);
    }
}

/// Forget a client that went away, and tell every chrome what that changed.
///
/// Two things, in this order: that the app is gone, and — if it was the one
/// being typed into — that the keyboard came back. A chrome told only the
/// first would go on marking a window that no longer exists as active.
///
/// The order is also what lets a shell get in front of the second. Handing the
/// keyboard to the chrome is a fallback rather than a decision — the shell
/// usually asks for it back, but it does not have to, and a client that
/// crashed never got the chance — so a shell that would rather move to the
/// next window has already been told which window went by the time the
/// fallback arrives, and its answer is the last word.
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
    // `CloseApp` — answers with nothing. Taking the writer lock to write zero
    // bytes parks the reader behind `serve_outbound`, which is blocked in
    // `write_all` to a chrome that is not reading; the compositor then stops
    // reading *that chrome* and everything it says afterward is dropped on
    // the floor. A chrome that only says things is the ordinary case, so this
    // was the ordinary case too.
    //
    // Guarded by `an_answer_with_nothing_in_it_does_not_wait_for_the_writer`
    // below, which says the invariant directly. `tests/stuck_keys.rs` also
    // fails without this, twelve runs of twelve — that is the evidence the bug
    // was real rather than the guard, since it needs a socket to fill up under
    // parallel load to say so.
    if responses.is_empty() {
        return true;
    }
    // WHICH DISPLAY THIS CHROME'S WINDOW COVERS, read here and handed down,
    // because `freshened` re-reads the desktop and would otherwise hand back
    // the whole of it -- see there.
    //
    // Before the writer lock and not inside it. The broadcast path takes
    // `chromes` and then `writer`; taking the two in the other order here is
    // the inversion that deadlocks them against each other.
    //
    // `None` is an answer rather than a miss, twice over: a chrome that has
    // not agreed the protocol is not on that list at all -- and the response
    // being written to it is its `welcome` -- and one that has agreed may not
    // have said which window it is yet. Neither has a display to read the desk
    // from, and the desktop in its own coordinates is what both should get.
    let screen = hub
        .chromes
        .lock()
        .unwrap()
        .iter()
        .find(|held| Arc::ptr_eq(&held.writer, writer))
        .and_then(|held| held.screen.clone());
    let mut writer = writer.lock().unwrap();
    for message in responses {
        let message = freshened(hub, message, screen.as_deref());
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
/// Writing the handshake's own copy afterward would put the desktop that is
/// gone last on the socket, where latest-wins leaves it — and on a desktop
/// nobody is resizing again there is no next message to correct it.
///
/// What makes the last `displays` on a socket the last one described is not
/// this function alone. It is that [`DomicileCompositor::set_output`] describes
/// and then broadcasts *that* desktop, on the one Wayland thread, into a queue
/// one writer thread drains in order — so a line carrying a desktop that has
/// since been replaced always has the newer one queued behind it. A broadcast
/// is serialized before the writer lock is taken, so the writer lock is not
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
///
/// **AND IT IS MOVED AGAIN, WHICH IS NOT OPTIONAL.** Re-reading the desktop
/// throws away whatever the caller had already made of it, and one caller had
/// made something: the answer to `set_screen` is the desk seen from the
/// display that window covers, that one at the origin with
/// `fills_the_window` set. This used to take the fresh desktop and return it,
/// so that answer went out unmoved and with the flag false -- every window
/// laying its regions out in the desktop's coordinates, and a page drawing its
/// logical box at logical size in the corner of a monitor rather than scaled
/// over the whole of it.
///
/// So the move is applied here rather than only at the call site, which is
/// also what makes this agree with [`desk_from_the_window`] on the broadcast
/// path: both go through `as_seen_from`, keyed on the same `Chrome::screen`.
fn freshened(hub: &ChromeHub, message: HostMessage, screen: Option<&str>) -> HostMessage {
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
    let HostMessage::Displays { displays } = fresh else {
        unreachable!("describe_desktop returns Displays and nothing else");
    };
    // TWO RESPONSES CARRY A DESKTOP, not one: a chrome's Hello, and its
    // `set_screen`. The runtime re-describes reach a chrome through
    // `hub.broadcast` instead, which does not come through here -- so a line
    // naming the handshake alone would be wrong about the second of these, and
    // it used to be.
    let displays = match screen {
        None => displays,
        Some(name) => domicile_host::as_seen_from(&displays, name),
    };
    match screen {
        None => info!("told the chrome about {} display(s)", displays.len()),
        Some(name) => info!(
            screen = %name,
            "told the chrome about {} display(s), from the window it named",
            displays.len()
        ),
    }
    HostMessage::Displays { displays }
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
        // Encoded once for everyone who gets the same thing, which is every
        // message but one and every chrome that has not said which window it
        // is.
        let line = to_line(&message);
        let mut chromes = hub.chromes.lock().unwrap();
        chromes.retain(|chrome| {
            // THE ONE MESSAGE THAT DIFFERS PER CONNECTION. A desk of several
            // monitors is several windows, and each is told that desk from
            // where its own display stands -- see `as_seen_from`. Encoded
            // inside the loop only for those, because re-encoding the desktop
            // per chrome is the cost of the feature and re-encoding a pointer
            // motion per chrome would be the cost of nothing.
            let own = desk_from_the_window(&message, chrome.screen.as_deref());
            let bytes = own.as_ref().map_or(line.as_str(), String::as_str);
            let mut stream = chrome.writer.lock().unwrap();
            stream
                .write_all(bytes.as_bytes())
                .and_then(|_| stream.flush())
                .is_ok()
        });
        drop(chromes);

        report(&mut window, &hub);
    }
}

/// This chrome's own copy of a desktop description, or `None` where there is
/// nothing to move.
///
/// `None` for every message that is not a desktop, and for a chrome that never
/// said which window it is -- both of which get the line encoded once for
/// everyone. A window that DID say is told the desk with its own display at
/// the origin and the whole of it, because a window is its display and a page
/// lays out in the coordinates it is given.
fn desk_from_the_window(message: &HostMessage, screen: Option<&str>) -> Option<String> {
    let (HostMessage::Displays { displays }, Some(name)) = (message, screen) else {
        return None;
    };
    Some(to_line(&HostMessage::Displays {
        displays: domicile_host::as_seen_from(displays, name),
    }))
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
    /// the legend in `docs/DEVELOPING.md`; `record_present` is what keeps them
    /// apart.
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
    /// including the submit — see `submit_ms`, and the legend in
    /// `docs/DEVELOPING.md` for how to read the two together.
    composite_ms: u32,
    composite_worst_ms: u32,
    /// The submit, which on a nested window blocks for a frame callback.
    submit_ms: u32,
    submit_worst_ms: u32,
}

/// How often the battery is read when nothing has said it changed.
///
/// A BACKSTOP RATHER THAN THE MECHANISM, which is the whole difference from
/// the ten-second poll this replaced. The kernel announces a charge that moves
/// — see `uevents.rs` — so a lead going in reaches the bar in the time it
/// takes to read four small files. What this covers is a driver that does not
/// call `power_supply_changed()` on every capacity step, which some do not:
/// without it the figure on the bar could sit still for an afternoon while the
/// battery drained under it. Two minutes because a percent takes minutes to
/// move even on a machine running flat, so anything shorter would be the poll
/// again under another name.
const BATTERY_BACKSTOP: Duration = Duration::from_secs(120);

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

fn serve_chrome(hub: Arc<ChromeHub>, listener: UnixListener, handshake: Arc<Handshake>) {
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
        handshake.connected();
        let hub = hub.clone();
        let handshake = handshake.clone();
        thread::spawn(move || chrome_connection(hub, stream, writer, handshake));
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
fn chrome_connection(
    hub: Arc<ChromeHub>,
    stream: UnixStream,
    writer: Arc<Mutex<UnixStream>>,
    handshake: Arc<Handshake>,
) {
    read_chrome_messages(&hub, stream, &writer, &handshake);
    hub.chromes
        .lock()
        .unwrap()
        .retain(|held| !Arc::ptr_eq(&held.writer, &writer));
    info!("chrome client disconnected");
}

fn read_chrome_messages(
    hub: &Arc<ChromeHub>,
    stream: UnixStream,
    writer: &Arc<Mutex<UnixStream>>,
    handshake: &Arc<Handshake>,
) {
    // BEFORE THE STREAM GOES INTO THE READER, which takes it. Read once per
    // connection rather than per hello: `SO_PEERCRED` is stamped at
    // `connect(2)` and cannot change under a connection, and the answer is
    // what says whether a later hello is a new engine's — see
    // [`crate::which_engine`].
    let served_by = peer_pid(&stream);
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
                    // The one moment that says this compositor has a desktop
                    // rather than a socket: a page connected and agreed the
                    // protocol. Counted so that the thread watching for the
                    // absence of this can tell "no page came" from "a page
                    // came and we refused its version".
                    handshake.agreed();
                    // Joined here rather than at accept. A broadcast is
                    // written in *this* build's protocol, so sending one to a
                    // page that has not said it speaks that is a guess — and
                    // sending one to a page that has just been told it does
                    // not is worse. A refused chrome gets its `welcome`
                    // naming the disagreement, on its own socket, and nothing
                    // else.
                    if !joined {
                        hub.chromes.lock().unwrap().push(Chrome {
                            screen: None,
                            writer: writer.clone(),
                        });
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
                    hub.send_request(ClientRequest::ChromeHello { served_by });
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
                        .retain(|held| !Arc::ptr_eq(&held.writer, writer));
                    joined = false;
                    info!("chrome took its protocol agreement back; it no longer gets the desktop");
                }
                responses
            }
            Ok(ChromeMessage::Spawn { command }) => {
                spawn_client(&command, &hub.wayland_display);
                Vec::new()
            }
            // Compositor-level, like the spawn above: the clipboard is the
            // seat's and the history is the compositor's, so the brain has
            // nothing to say about either. Answered with nothing — what a
            // shell sees of this is the `clipboard` broadcast that the next
            // copy produces, and the paste it can now make.
            Ok(ChromeMessage::CopyClipboardEntry { entry }) => {
                hub.send_request(ClientRequest::CopyClipboardEntry { entry });
                Vec::new()
            }
            // The one message here the compositor answers rather than acts on.
            // A shell's launcher is a page and a page has no filesystem, so the
            // walk is the compositor's -- and it can be, safely, because
            // `list_files` names no path: what is read is decided here and
            // nowhere a document can reach. `domicile_host::files` is the walk
            // itself, which is why there is almost nothing of it in this arm.
            Ok(ChromeMessage::ListFiles) => match home_directory() {
                Some(home) => match listing(&home, DEEP_ROOTS, &RealDirectory) {
                    Ok(files) => vec![HostMessage::Files { files }],
                    // Answered with nothing rather than with an empty list. A
                    // home directory that will not open is a broken desktop,
                    // and "you have no files" is that breakage wearing the face
                    // of an ordinary answer -- a shell told it would draw an
                    // empty launcher and nobody would ever find this line. Left
                    // unanswered, the launcher still opens and still takes a
                    // path, a URL or a query; what it has not got is a list.
                    Err(err) => {
                        tracing::error!(%err, home = %home.display(), "the home directory could not be read");
                        Vec::new()
                    }
                },
                None => {
                    tracing::error!("no HOME in the environment, so there is no home to list");
                    Vec::new()
                }
            },
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
                    ratio,
                    scale: output_scale(ratio, hub.max_scale.load(Ordering::Relaxed)),
                });
                Vec::new()
            }
            // THE DESKTOP IS THE CHROME'S WINDOW, and the compositor has no
            // other way to learn its size: the window belongs to the browser
            // and is never seen from here. Without this the desktop sits at the
            // compositor's startup placeholder — a chrome laid out for 1280x800
            // in the corner of whatever the user actually opened.
            //
            // Both this and the density above were guarded on `presenting`,
            // for the case where the window was the compositor's own and the
            // chrome would only be reporting back what it had been given.
            // There is no such window any more.
            // WHICH WINDOW THIS IS. A desk of several monitors is several
            // windows, each loading the same shell on a socket of its own, and
            // this is the one thing that differs between them. Recorded beside
            // this connection's writer -- not on the brain, which they share --
            // and answered straight back with the desk read from it, so the
            // page is laying out on its own display from its first paint
            // rather than from the next time the desktop changes.
            //
            // The handshake that came before this one carried the WHOLE
            // desktop, because a chrome says which window it is after agreeing
            // the protocol rather than before. That is one description the
            // page may lay out against and then replace, which the protocol
            // already allows for -- latest wins -- and which costs a frame on
            // a desk that is about to be told something better.
            Ok(ChromeMessage::SetScreen { name }) => {
                let recorded = {
                    let mut chromes = hub.chromes.lock().unwrap();
                    match chromes
                        .iter_mut()
                        .find(|held| Arc::ptr_eq(&held.writer, writer))
                    {
                        Some(held) => {
                            held.screen = Some(name.clone());
                            true
                        }
                        None => false,
                    }
                };
                if recorded {
                    info!(screen = %name, "a chrome says which display its window covers");
                    // NOT MOVED HERE, and the desktop in it is not the one
                    // that goes out: `freshened` re-reads the desktop under
                    // the writer lock and reads it from the screen just
                    // recorded, so anything built here is overwritten.
                    //
                    // A `Displays` all the same, because that is what makes
                    // `freshened` act at all -- every other message passes
                    // through it untouched. Narrowing it twice would be two
                    // sources of one truth, and the one here is the one that
                    // is discarded.
                    vec![hub.host.lock().unwrap().describe_desktop()]
                } else {
                    // Said rather than dropped: a chrome that names its window
                    // before agreeing the protocol is not in the list yet, and
                    // the symptom -- a monitor showing the whole desktop --
                    // looks exactly like a shell that never named one.
                    warn!(
                        screen = %name,
                        "a chrome named its window before it agreed the protocol"
                    );
                    Vec::new()
                }
            }
            Ok(ChromeMessage::SetDesktopSize { size }) => {
                hub.send_request(ClientRequest::SetOutputSize {
                    logical: (size[0].round() as i32, size[1].round() as i32),
                });
                Vec::new()
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
    // The global a client asks for the keyboard through. Held rather than
    // acted on: see `XdgActivationHandler` below.
    xdg_activation_state: XdgActivationState,
    shm_state: ShmState,
    seat_state: SeatState<DomicileCompositor>,
    seat: Seat<DomicileCompositor>,
    /// Kept alive so the xdg-output manager global persists.
    #[allow(dead_code)]
    output_manager_state: OutputManagerState,
    /// Every advertised output, in the order [`Screens`] lists them.
    ///
    /// **In that order, and one for one.** Built from `screens.outputs()` at
    /// startup. Two things change it afterward and neither can break the
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
    /// reimplement.
    ///
    /// Live in both directions: what is read back off this is the config the
    /// desktop is actually running, because a reload acts on every field —
    /// the display list through
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) and the
    /// rest through
    /// [`adopt_the_rest_of_the_config`](DomicileCompositor::adopt_the_rest_of_the_config).
    /// [`crate::restatement`] is the field-by-field account.
    ///
    /// Note what this does *not* cover: a save caught half-written parses
    /// perfectly, it just says less. Keeping that from reaching the desktop is
    /// the coalescing on the watcher thread, not the store.
    config: ConfigStore,
    /// What the outputs above are, and who gets to change them.
    screens: Screens,
    /// The engine's last reading of the monitors, empty until it sends one.
    ///
    /// Empty forever on a nested run, because a nested engine is not asked to
    /// watch displays at all -- its screens are the *host's* monitors, and a
    /// desktop built from those would be taken away from the window that
    /// defines it.
    ///
    /// Held rather than consumed because two things are matched against it and
    /// only one of them is the event that brings it: a hotplug is the
    /// monitors changing under one config, and a reload is the config changing
    /// over one set of monitors. Without this the second could not be
    /// answered, and a profile would take effect only when a monitor was next
    /// unplugged.
    engine_displays: Vec<engine::Display>,
    /// hwdata's `pnp.ids`, which is what turns the three letters an EDID names
    /// a maker with into the vendor's own name.
    ///
    /// Read once, at startup, because it is a file the machine ships rather
    /// than anything about this desk: it cannot change between hotplugs, and
    /// re-reading it per monitor would be two and a half thousand lines parsed
    /// every time somebody plugged a cable in. Empty on a machine that has no
    /// copy, which [`pnp_ids::read_the_table`]'s caller says out loud.
    vendors: pnp_ids::Vendors,
    /// The chrome's `devicePixelRatio`, as it last reported it.
    ///
    /// Only one thing reads it, and it is not the output's density: Blink lays
    /// out in device pixels, so the box the engine states for an `<app>` is
    /// this many times the CSS box the page drew. A configure is in logical
    /// units, so it has to come back down — see [`crate::scale::logical_box`].
    ///
    /// 1.0 until a chrome says otherwise, which is the display that needs no
    /// conversion and the answer a desktop with no chrome yet would want.
    device_pixel_ratio: f64,
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
    /// The middle-click clipboard.
    ///
    /// **A second clipboard, not a second name for the first.** Selecting a
    /// word fills this one and the middle button pastes out of it, while
    /// Ctrl-C and Ctrl-V go through `wl_data_device` above — which is why
    /// `zwp_primary_selection_device_manager_v1` is its own global with its
    /// own device, and why a desktop can carry one of the two and not the
    /// other. This one is passed between clients and never read here: it
    /// changes on every drag over a word, so a history of it would be a
    /// history of what the pointer brushed past.
    primary_selection_state: PrimarySelectionState,
    /// What has been copied on this desktop, newest first.
    ///
    /// **A Wayland clipboard is the client that offered it**, so closing the
    /// terminal you copied out of empties it. This is the desktop's own hold
    /// on what crossed the clipboard, and the compositor is where it has to
    /// live because `set_selection` arrives here and nowhere else.
    /// `domicile_host::clipboard` is the whole of the policy.
    clipboard: History,
    /// The mime type to ask the new selection for, on the turn after a client
    /// set one.
    ///
    /// **A turn late, and it has to be.** Smithay calls `new_selection` before
    /// it stores the selection on the seat, so a read taken there would be a
    /// read of the copy *before* this one. What is kept is the spelling to ask
    /// for — `None` for a selection with no text in it, which is not recorded
    /// at all — and [`DomicileCompositor::read_what_was_copied`] spends it at
    /// the end of the dispatch, before the flush that carries the request to
    /// the client.
    copying: Option<String>,
    /// The display, for the two paths that have to reach clients from
    /// somewhere other than a request of their own: handing the clipboard's
    /// focus to whoever has the keyboard, and putting an entry from the
    /// history back on the seat.
    ///
    /// Every other path is handed a `&DisplayHandle` by its caller, because
    /// every other path starts at the event loop, which has the `Display`
    /// itself. These two start at a `SeatHandler` callback and at a message
    /// from a chrome thread, and neither carries one.
    display_handle: DisplayHandle,
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
    /// The keystroke-to-pixel run, once an app has committed something to
    /// measure. `None` when `DOMICILE_SPIKE_LATENCY` names no point, which is
    /// every run that is not the measurement.
    latency: Option<Latency>,
    /// Which app the run is watching. The first to commit, and then that one
    /// for the whole run.
    latency_app: Option<String>,
    /// Whether the report has been said. It is said once: the driver keeps
    /// being called for as long as the client keeps drawing.
    latency_reported: bool,
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

    /// THROWAWAY. Colors already reported absent, so a guard that polls for
    /// ninety seconds gets one line rather than three hundred.
    probe_missing: HashSet<u32>,

    /// THROWAWAY. Colors the probe could not answer for at all. Separate from
    /// `probe_missing` because "not on screen" and "nothing was read" are the
    /// two answers the search exists to tell apart, and one set would let
    /// either silence the other.
    probe_unreadable: HashSet<u32>,

    /// THROWAWAY. When the color search last ran. Its own clock, because it
    /// captures the whole window rather than a pixel and is throttled harder
    /// than the point probe beside it.
    last_find: Option<Instant>,

    /// THROWAWAY. When the color search first ran, which is what its budget
    /// is measured from. Set on the first search rather than at startup: a
    /// desktop with no client yet is not searching for anything, and starting
    /// the clock then would spend the budget waiting.
    find_since: Option<Instant>,

    /// THROWAWAY. The last box logged for each color, so a box is written
    /// down when it moves rather than once when it first appears. A window
    /// still painting is smaller than it will be, and how much of the page
    /// each one covers is what the two-window guard asserts — which is also
    /// why the guard waits for two consecutive readings that agree.
    ///
    /// Presence is what "found" means; a color that goes absent is removed.
    probe_boxes: HashMap<u32, Bounds>,

    /// THROWAWAY. Whether the search is over — every color found and none of
    /// them moving, or the budget spent. A whole-window readback is a blocking
    /// one, so a finished search stops paying for them.
    find_settled: bool,
    /// What the chrome's last frame looked like, so the line describing it is
    /// printed when it changes rather than sixty times a second.
    chrome_frame_shape: Option<((f64, f64), bool, bool)>,
    /// Which modifiers the chrome was last told are held.
    modifiers: Held,
    /// What the chromes were last told about the battery.
    ///
    /// Polled rather than delivered: nothing signals a percent, so the timer
    /// below reads `/sys/class/power_supply` and this is what decides which of
    /// those readings is news. See `domicile_host::battery`, and the message's
    /// own docs in `domicile_protocol` for why the page cannot read it itself.
    charge: Charge,
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
    /// The registration the engine's fd is watched under.
    ///
    /// Held so that an engine which replaced another can be watched instead:
    /// the fd belongs to the `DomicileEngine` whose queue it is, and a source
    /// left on the old one is a source on a descriptor the library closed. A
    /// calloop source is removed by the registration it was inserted under and
    /// by nothing else, which is the same reason `idle_clock` is kept below.
    engine_source: Option<RegistrationToken>,
    /// The process serving the last page that said hello, which is the browser
    /// this desktop is drawing through.
    ///
    /// `None` until one has: the first page of a run is served by the engine
    /// this compositor dialed at startup, so there is nothing to compare it
    /// against and nothing to rejoin. See [`crate::which_engine`].
    engine_process: Option<i32>,
    /// Whether anybody is at this desktop, for a desktop that blanks.
    ///
    /// `None` is one that never does, which is what a config saying nothing
    /// about idle means — and then nothing here has a timer either. Replaced
    /// when a reload changes `[idle]`, which is
    /// [`reset_the_idle_clock`](DomicileCompositor::reset_the_idle_clock).
    ///
    /// What it holds its inhibitors as is the surface each was taken on, which
    /// is what `zwp_idle_inhibit_manager_v1` hands over in both directions —
    /// and what [`StillThere`] asks about, because a surface of a client that
    /// is gone is not alive.
    idle: Option<Idle<WlSurface>>,
    /// The timer that asks the clock, where there is a clock to ask.
    ///
    /// Held so a reload can take it away again: a desk whose timeout is
    /// removed must stop waking for it, and one whose timeout changed wants
    /// the new duration rather than whatever the old source was counting
    /// down. Without the token neither is reachable — a calloop source is
    /// removed by the registration it was inserted under, and by nothing
    /// else.
    idle_clock: Option<RegistrationToken>,
    /// The loop this compositor is dispatched by, so that it can arm a source
    /// of its own after startup.
    ///
    /// Only one thing does: the idle clock, which a reload may have to insert
    /// where the startup config stated no timeout and so left no timer at
    /// all. Everything else this compositor listens to is known when `run`
    /// builds the loop.
    loop_handle: LoopHandle<'static, CalloopData>,
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
        // It costs nothing on a desktop with one output, which is what a run
        // with no `--config` still is: a single output following the browser
        // window. `domicile --config` can now hand one over, so a desk that
        // writes its monitors down is no longer that -- and this is the gap
        // that widens when it does. On a two-screen desktop a
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
    ///
    /// `dh` is here for one of those events: a display list rearranges the
    /// desktop, and creating a `wl_output` needs the display to create it on.
    fn pump_the_engine(&mut self, dh: &DisplayHandle) {
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
                    // THE ENGINE COUNTS IN DEVICE PIXELS AND A CONFIGURE IS
                    // IN LOGICAL ONES. Sent as it arrives, a window on a 1.2x
                    // display is told to lay out 1.2x the content its box
                    // holds and draws every bit of it 1.2x too small.
                    let (width, height) =
                        crate::scale::logical_box((width, height), self.device_pixel_ratio);
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
                // The engine holds DRM master, so on a tty its reading of the
                // screens is the only one there is. `replugged_into` is what
                // decides whether this desktop is the engine's to define, and
                // `adopt_the_desktop` is a no-op for a list that says what the
                // last one said -- which is what a hotplug the modeset driver
                // caused reports.
                engine::Event::Displays(displays) => {
                    // Kept, because a config reload has to be matched against
                    // the monitors that are plugged in and the event carrying
                    // them is long gone by then. The whole list every time,
                    // which is what the engine sends: what is absent from it
                    // has been unplugged.
                    self.engine_displays = displays.clone();
                    match self.screens.replugged_into(
                        &displays,
                        &self.config.current().output,
                        &self.vendors,
                    ) {
                        // A desktop the config describes outright, which DRM
                        // does not overrule -- but a monitor that arrives
                        // while the screens are dark arrives LIT, and this is
                        // the arm where nothing else would say otherwise.
                        Ok(None) => self.keep_the_screens_dark(),
                        // `adopt_the_desktop` states the connectors itself,
                        // dark ones included.
                        Ok(Some(screens)) => self.adopt_the_desktop(dh, screens),
                        // A profile that matched these monitors and cannot be
                        // applied to them. The desktop that is up keeps
                        // working -- the same bargain `ConfigStore` makes for
                        // an edit that does not parse -- and the complaint
                        // names what is wrong with the config, which is the
                        // only place this can be fixed.
                        Err(err) => {
                            tracing::warn!(
                                %err,
                                "the profile these monitors matched cannot be applied to them; \
                                 keeping the desktop that is up"
                            );
                            // And keeping it dark, if it was: the monitor that
                            // could not be placed is still a monitor that came
                            // up lit.
                            self.keep_the_screens_dark();
                        }
                    }
                }
            }
        }
    }

    /// Put one key into the seat, and let the focus it already has deliver it.
    ///
    /// Shared by the chrome's keys and the latency run's, because a
    /// measurement that went in by a different door would be measuring a
    /// different door.
    fn inject_key(&mut self, keycode: u32, pressed: bool) {
        let keyboard = self.seat.get_keyboard().unwrap();
        let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
        let state = if pressed {
            KeyState::Pressed
        } else {
            KeyState::Released
        };
        // wl keymaps use X keycodes (evdev + 8); callers speak evdev.
        let key: Keycode = (keycode + 8).into();
        keyboard.input::<(), _>(self, key, state, serial, time, |_, _, _| {
            FilterResult::Forward
        });
    }

    /// Drive the keystroke-to-pixel run, if one is going, on this app's frame.
    ///
    /// **On the commit path, and that is the only place it can be.** A round
    /// is bounded by two things this compositor sees and nothing else does:
    /// the client's answering commit, which arrives here, and what the engine
    /// then draws, which only `EngineSession` can be asked. See `latency.rs`
    /// for what the numbers are and why they are three.
    ///
    /// THIS BLOCKS THE WAYLAND THREAD, and the worst case is worth knowing
    /// before turning it on. `spike_pixel` is a `CopyOutputRequest` that waits
    /// for the browser to answer, and the loop below spends one per ask.
    ///
    /// One invocation is either a whole floor or at most one round — the
    /// `Press` arm breaks. A settling floor is `Budget::floor_samples` asks
    /// plus the priming one that is not timed, about **1.0 s** at 60Hz. A
    /// floor that keeps being restarted is `Budget::max_floor_asks`, about
    /// **6.7 s**, and a round the client never answers is `Budget::max_polls`,
    /// about **3.3 s**. For every one of
    /// those there is no client dispatch and no frame callbacks: nothing on
    /// this desktop is served. It is a spike instrument, off unless
    /// `DOMICILE_SPIKE_LATENCY` names a point, and that is the trade.
    ///
    /// **The screen at that point has to hold still, and providing that is the
    /// caller's job.** A client repainting on its own — a terminal blinking
    /// its cursor over the probe point — restarts the floor faster than the
    /// floor completes, so the run spends its whole budget and reports
    /// `NeverSettled` having measured nothing. That is a legible failure
    /// rather than a hang, which is what the budgets buy, but it is still a
    /// run wasted: a guard driving this wants a client whose cursor does not
    /// blink.
    ///
    /// It does not deadlock against the engine: `SamplePixel` parks on a
    /// `WaitableEvent` while the engine's own thread runs a nested run loop,
    /// so the reply does not need this thread back.
    fn drive_latency(&mut self, app_id: &str, committed: Instant, held: bool) {
        let (Some(_), Some(budget)) = (spike_latency_point(), spike_latency_budget()) else {
            return;
        };
        // Only a frame the engine took can answer a keystroke, and waiting for
        // one is also what keeps the run from starting before there is
        // anything to read. Started on the client's first commit instead, the
        // probe refuses — no engine yet, or a browser window that has not
        // painted — and a refusal costs no time at all, so the floor spends
        // its whole run of them inside that one callback and the run is over
        // as `ProbeWentDark` before the desktop has finished starting.
        if !held {
            return;
        }
        // The first app to commit is the one measured, and it keeps the run
        // for the whole of it: a second window appearing partway would
        // otherwise contribute commits to rounds its keys never caused.
        if self.latency_app.get_or_insert_with(|| app_id.to_string()) != app_id {
            return;
        }
        // Taken out and put back, because a run dropped here starts over from
        // an empty floor on the next commit.
        let frame = self.display_interval();
        let mut run = self
            .latency
            .take()
            .unwrap_or_else(|| Latency::new(budget, frame));
        // The caller's stamp, from before `publish_frame` ran. The import and
        // the submit are this design's cost and belong in `commit_to_pixel`;
        // stamping here would have put them in the client's half instead.
        run.committed(committed);
        self.latency = Some(run);
        // AND NOTHING ELSE. This used to drive the whole run from here, in a
        // loop that sampled until the color changed. See `step_the_latency`.
    }

    /// One step of the latency run, and then back to the event loop.
    ///
    /// **One.** This was a loop, and the loop is the bug it exists to not be.
    ///
    /// Everything in this compositor runs on one calloop thread: the clients'
    /// fd, the engine's fd, and the commit callback this used to be driven
    /// from. A poll loop inside that callback holds the thread, so for as long
    /// as it spins, `pump_the_engine` cannot run and no `wl_buffer.release`
    /// reaches anybody, and `dispatch_clients` cannot run and no frame
    /// callback is flushed. The client is frozen.
    ///
    /// Which makes the wait unwinnable whenever the color needs a *second*
    /// commit — a toolkit that renders on `wl_surface.frame`, or one that
    /// needs its buffer back first, which is most of them. The run spent its
    /// whole poll budget and recorded the round as "abandoned by the client".
    /// The client had done nothing wrong: it was starved by the compositor
    /// waiting on it, and the accusation was backward.
    ///
    /// Four of sixty rounds on the run that found this, and two before #246 —
    /// which made it worse exactly as this predicts, by making a release
    /// something the client has to be handed rather than something it got
    /// early from a bug. `key_to_commit` had all sixty samples and
    /// `commit_to_pixel` fifty-six: every round got its *first* commit, which
    /// is the one that arrives while the thread is still free.
    ///
    /// So: one step, then return, and let the loop serve the client in
    /// between. The timer in `main` is what brings us back.
    ///
    /// Returns whether the run wants another step immediately.
    fn step_the_latency(&mut self) -> bool {
        let (Some(point), Some(_)) = (spike_latency_point(), spike_latency_budget()) else {
            return false;
        };
        let Some(mut run) = self.latency.take() else {
            return false;
        };
        let app_id = self.latency_app.clone();
        let wants_more = match run.next(Instant::now()) {
            LatencyStep::Sample => {
                match self.engine.as_mut().and_then(|engine| match point {
                    LatencyPoint::Center => engine.spike_window_center(),
                    LatencyPoint::At(x, y) => engine.spike_pixel(x, y),
                }) {
                    Some(argb) => run.sampled(Instant::now(), argb),
                    None => run.unreadable(),
                }
                true
            }
            LatencyStep::Press => {
                // Focused every round rather than once: the keyboard is one
                // seat's and anything else that moved it would send the rest
                // of the run somewhere the probe is not looking.
                match app_id
                    .as_deref()
                    .and_then(|app_id| self.surface_for(app_id))
                {
                    Some(surface) => {
                        let keyboard = self.seat.get_keyboard().unwrap();
                        let serial = SERIAL_COUNTER.next_serial();
                        keyboard.set_focus(self, Some(surface), serial);
                        self.inject_key(LATENCY_KEY, true);
                        self.inject_key(LATENCY_KEY, false);
                    }
                    // Never silently, and never merely logged: `next` has
                    // already started this round, and the only way out of a
                    // started round is a commit answering the key we just
                    // failed to send. A client that does not redraw on its own
                    // would leave the run there for ever with no report —
                    // which is the shape of every other bug in this file. The
                    // round is given up instead.
                    None => {
                        warn!(
                            ?app_id,
                            "the latency run has no surface to press a key into; \
                             giving the round up"
                        );
                        run.press_went_nowhere();
                    }
                }
                // The client has to redraw before there is anything to look
                // at, and it cannot do that while we are here.
                false
            }
            LatencyStep::Wait => false,
        };
        self.latency = Some(run);
        self.report_latency();
        wants_more
    }

    /// One display frame, as the latency run assumes it.
    ///
    /// **Assumed, not viz's own.** The number the latency run is divided by
    /// ought to be the browser's display-frame interval, and nothing here can
    /// ask viz for it — `css_parity.cc` can, because it runs inside the
    /// browser, and reads it off `BeginFrameArgs`. 60Hz on the one machine
    /// this runs on, and the floor is reported beside every other number so a
    /// reader can calibrate against what the probe actually cost rather than
    /// trusting this.
    fn display_interval(&self) -> Duration {
        Duration::from_secs_f64(1000.0 / f64::from(SPIKE_REFRESH_MHZ))
    }

    /// Say what the run measured, once, in the shape the guard reads.
    fn report_latency(&mut self) {
        if self.latency_reported {
            return;
        }
        let Some(report) = self.latency.as_ref().and_then(Latency::report) else {
            return;
        };
        self.latency_reported = true;
        let interval = self.display_interval();
        // The text is `Spread::line`'s and is tested there, because the guard
        // greps it.
        let say = |what: &str, spread: Option<&latency::Spread>| match spread {
            Some(spread) => tracing::info!(
                target: "domicile::engine::spike",
                "{}", spread.line(what, interval)
            ),
            // Named rather than skipped: a missing line and a fast one must
            // not look alike to whoever reads this log.
            None => tracing::info!(
                target: "domicile::engine::spike",
                "latency {what}: nothing measured"
            ),
        };
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: the display frame is {:.2} ms",
            interval.as_secs_f64() * 1000.0
        );
        say("floor", report.floor.as_ref());
        say("key to commit", report.key_to_commit.as_ref());
        say("commit to pixel", report.commit_to_pixel.as_ref());
        say("key to pixel", report.key_to_pixel.as_ref());
        // How it ended and what the client did are two different accusations,
        // so they are two lines. A run that never settled has no floor and no
        // rounds, and "0 abandoned" on its own would read like a clean sheet.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) abandoned by the client",
            report.abandoned
        );
        // The third thing a round can be, and the one the client is blameless
        // for: the probe point changed color while the key was still on its
        // way to being answered, so a frame from before the press reached the
        // screen and the round is not a measurement. Said always, because a
        // run that gave up rounds this way reports a median over the ones it
        // did not.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose pixel moved before the client answered",
            report.moved_before_commit
        );
        // The fourth, and the one that reads as a measurement right up until
        // you look at the size of it: the client committed, in order, and the
        // pixel followed — just far too long after the key for the key to have
        // caused it. Said always, for the reason the one above is.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose commit came too late to be the key's answer",
            report.answered_too_late
        );
        // The near end of that same wait, and its own line rather than more of
        // the one above. A commit 0.82 ms after the key is not a slow answer;
        // it is a frame the client already had in flight, and folding the two
        // counts together would send whoever read it looking for a slow
        // client. Said always, for the reason the one above is.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose commit came too soon to be the key's answer",
            report.answered_too_soon
        );
        // What the client did with the key, as opposed to whether it answered
        // at all. A round counted here answered with more than one frame, and
        // its `commit to pixel` is timed from the first of them — so a run
        // with a high count here is reporting some of the client's own second
        // draw as ours. Said always, so that qualification is never missing
        // from a number somebody is about to compare against a floor.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) where the client drew again while polling",
            report.redrew_while_polling
        );
        // Said always, and separately from the line above. A key we never
        // delivered is this compositor's failure and not the client's, and
        // folding the two together is the wrong-end report this instrument has
        // had to be talked out of three times.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose key was never delivered",
            report.undelivered
        );
        match report.ended {
            latency::Ended::Completed => tracing::info!(
                target: "domicile::engine::spike",
                "latency: the run completed"
            ),
            latency::Ended::NeverSettled => tracing::info!(
                target: "domicile::engine::spike",
                "latency: the run gave up — the screen at the probe point never held \
                 still, so the probe could not be priced against it"
            ),
            latency::Ended::ProbeWentDark => tracing::info!(
                target: "domicile::engine::spike",
                "latency: the run gave up — the probe stopped answering"
            ),
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
        // Colors to find anywhere in the window, for a guard that cannot name
        // a point because the shell decides where its windows go — and, as it
        // turned out, because the coordinate space a named point is in is not
        // the one the browser was asked for.
        //
        // Searched until every wanted color has been found AND none of their
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
        if find_due && !spike_find_colors().is_empty() && !self.find_settled {
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
                    "giving up looking for the colors that have not turned up; a whole-window \
                     readback is time this thread is not releasing the client's buffers, and it \
                     is not worth paying for a color that was going to appear long ago"
                );
            } else {
                let mut every_color_found = true;
                let mut nothing_moved = true;
                for &argb in spike_find_colors() {
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
                            every_color_found = false;
                            // Forgotten, not kept. A color that is found,
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
                            every_color_found = false;
                            self.probe_boxes.remove(&argb);
                            if self.probe_unreadable.insert(argb) {
                                warn!(
                                    target: "domicile::engine::spike",
                                    "engine could not read the window at all looking for \
                                     #{argb:08X}, so nothing was measured about it — which is \
                                     not the same as the color being absent"
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
                if every_color_found && nothing_moved {
                    self.find_settled = true;
                    tracing::info!(
                        target: "domicile::engine::spike",
                        "engine settled: every color it was looking for held still"
                    );
                }
            }
            // Stamped after the captures, not before: the interval is meant to
            // be a gap between readbacks, and a capture longer than it would
            // otherwise run back to back with no gap at all.
            self.last_find = Some(Instant::now());
        }

        // Not while a latency run is going, and this is not tidiness. This
        // capture is a `CopyOutputRequest` that forces a draw and waits, and it
        // runs on the submit path — inside the window `commit_to_pixel` is
        // timed over, which starts before `publish_frame`. The floor is one
        // capture and this would make every round two, so the ratio the guard
        // asserts would sit on its own threshold and fail, blaming the product
        // for the instrument's own readback.
        if spike_probe_points().is_empty()
            && spike_find_colors().is_empty()
            && spike_latency_point().is_none()
        {
            if let Some(drawn) = session.spike_window_center() {
                tracing::info!(
                    target: "domicile::engine::spike",
                    "engine drew #{drawn:08X} at the center of the browser's window"
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
                            // Two things left, and the center tells them
                            // apart. SamplePixel refuses both a point outside
                            // the window and a window that has not been drawn
                            // — the second returns an empty bitmap, which is
                            // "the browser is not compositing at all" and is a
                            // completely different problem. The center is
                            // always inside a window that exists, so an answer
                            // from it means the bitmap is fine and this point
                            // is not, and no answer means there is no bitmap.
                            match session.spike_window_center() {
                                Some(center) => warn!(
                                    x,
                                    y,
                                    center = format!("#{center:08X}"),
                                    "the probe refused this point but answered for the \
                                     window's center, so the browser is drawing and this \
                                     point is outside its window"
                                ),
                                None => warn!(
                                    x,
                                    y,
                                    "the probe refused this point AND the window's \
                                     center, so the browser has drawn nothing at all — \
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
            .wl_output_scale();
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
        if self.screens.size() == logical && advertised.wl_output_scale() == scale {
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
        let mode = current_mode(
            self.screens
                .outputs()
                .next()
                .expect("a window-following desktop advertises its one output"),
        );
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
    /// The display list is the only thing *this* acts on, and no longer the
    /// only thing a reload does: the rest of the file is
    /// [`adopt_the_rest_of_the_config`](DomicileCompositor::adopt_the_rest_of_the_config)'s,
    /// which the same callback calls straight after this.
    /// [`crate::restatement`] carries the table of which field takes which
    /// path, and is the one place to read — or to add to.
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
        // WHAT THE CONNECTORS BEHIND THOSE OUTPUTS HAVE TO BE DOING, which is
        // the engine's to do because the engine is the process holding DRM
        // master. Everything above is the desktop this compositor advertises;
        // this is the glass, and a profile that turns a panel off is not a
        // desktop with one fewer display on it unless something turns the
        // panel off.
        //
        // Sent on every adoption, empty list included, for the reason
        // `Screens::scanout` gives: an empty one is what undoes a profile
        // whose displays are no longer plugged in.
        //
        // Through `state_the_connectors` rather than straight at the session,
        // because a desktop that is blanked has to stay blanked through a
        // reload and a hotplug: stating the desktop's own list here would
        // light the screens back up behind the idle clock's back, and the
        // person who walked away would come back to a lit desk because a
        // monitor was plugged in.
        self.state_the_connectors();
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

    /// Join the engine that replaced the one this compositor was submitting
    /// to, and put back everything the old one knew.
    ///
    /// **THE COMPOSITOR OUTLIVES ITS ENGINE, and this is the whole of why it
    /// can.** `domicile-launch` starts another engine under a compositor that
    /// is still serving (`domicile_launch::restart`), so the clients on this
    /// desktop keep the `wl_display` they are connected to and their windows
    /// are still theirs. What they cannot keep is anything the old browser
    /// minted: [`EngineSession::reconnect`] says which of it there is and what
    /// is done with each piece.
    ///
    /// Nothing happens for a page that is the engine already joined reloading
    /// — a `domicile load-shell` — which is what
    /// [`EngineSession::another_engine_is_there`] is for.
    ///
    /// **A DIAL THAT FAILS IS SAID AND THE SESSION IS KEPT.** The buffers
    /// still come back either way, because a client owed a release that cannot
    /// arrive has stopped drawing forever, and the next page to reach this
    /// compositor asks again. What is not done is carrying on quietly: a
    /// desktop whose windows have gone blank has to say why.
    fn rejoin_the_engine(&mut self, served_by: Option<i32>) {
        let replaced = another_engine(self.engine_process, served_by);
        // Whether or not anything is rejoined: this is now the process serving
        // this desktop's pages, and the one a later hello is compared against.
        // `or` rather than an assignment, because a credential the kernel
        // would not give is an attribution lost rather than an engine that
        // has stopped existing.
        self.engine_process = served_by.or(self.engine_process);
        if !replaced || self.engine.is_none() {
            return;
        }
        warn!(
            served_by,
            "the engine this desktop was drawing through has been replaced; rejoining it"
        );
        let session = self
            .engine
            .as_mut()
            .expect("a desktop with no engine has nothing to rejoin, and said so above");
        // The fds are the `wl_buffer`'s rather than this clone's: a Smithay
        // `Dmabuf` is reference-counted and the client's buffer holds the
        // original, which the session holds for as long as it holds the
        // buffer. Same reading `publish_frame` takes of the same buffer.
        let rejoined = session.reconnect(
            &|buffer| match committed_buffer(buffer) {
                Some(CommittedBuffer::Gpu(dmabuf)) => Some(descriptor_from(&dmabuf)),
                Some(CommittedBuffer::Pixels { .. }) | None => None,
            },
            Instant::now(),
        );
        match &rejoined.dialed {
            Ok(()) => {
                self.watch_the_engines_fd();
                // The new engine read the hardware for itself and will send
                // its own display list, but it has no memory of a profile:
                // `Screens::replugged_into` answers a list that says what the
                // last one said with "nothing to do", so a connector this
                // desktop's config turned off would come back lit.
                self.state_the_connectors();
                info!(
                    shown = rejoined.shown.len(),
                    blank = rejoined.blank.len(),
                    returned = rejoined.releases.len(),
                    "rejoined the engine and restated this desktop to it"
                );
            }
            Err(err) => error!(
                %err,
                "there is a new engine at the broker socket and this compositor could not \
                 join it; every window on this desktop will be blank until one it can join \
                 arrives"
            ),
        }
        for app_id in &rejoined.blank {
            error!(
                app_id,
                "this window's last frame could not be put back on the new engine, so it is \
                 on the page with nothing in it until its client draws again"
            );
        }
        // Every buffer the old engine was holding, whether or not the new one
        // was joined. A release that cannot arrive is a client that never
        // draws again.
        for release in rejoined.releases {
            release.buffer.release();
        }
    }

    /// Watch the fd of whichever engine is joined now, and stop watching the
    /// one before it.
    ///
    /// A source on an old engine's fd is a source on a descriptor the library
    /// closed with it, so the removal is not tidying — it is the difference
    /// between a loop that wakes for this engine and one that spins on a
    /// closed fd.
    fn watch_the_engines_fd(&mut self) {
        if let Some(watching) = self.engine_source.take() {
            self.loop_handle.remove(watching);
        }
        let Some(session) = self.engine.as_ref() else {
            return;
        };
        match poll_the_engine(&self.loop_handle, session.fd()) {
            Ok(watching) => self.engine_source = Some(watching),
            // Nothing arrives from an engine nothing is polling: no configure,
            // no release, no display list. The desktop is up and deaf, which
            // is not a state to discover from the symptoms.
            //
            // SAID RATHER THAN FATAL, and that is the recovery: a descriptor
            // that could not be duplicated is not a reason to end every client
            // on this desktop, which is the one thing the compositor
            // outliving its engine exists to prevent. The run this leaves is
            // one a person can stop, and it has the reason on the terminal.
            Err(err) => error!(
                %err,
                "the engine's fd could not be watched, so nothing it says will be heard; \
                 this desktop is still serving its clients and has to be restarted to draw"
            ),
        }
    }

    /// Tell the engine what the connectors have to be doing, now.
    ///
    /// Two answers and one place that gives them, because they are the same
    /// sentence: a desktop somebody is at wants the list it has always
    /// wanted — [`Screens::scanout`], which is a profile's connectors or the
    /// empty "no opinion" every other desktop has — and a desktop nobody is at
    /// wants none of them lit.
    ///
    /// Blanking is NOT that empty list, which would light everything: it is
    /// every connector the engine reported, turned off. See
    /// [`crate::idle::darkened`], including why an empty answer from it is one
    /// this must not send.
    fn state_the_connectors(&self) {
        let Some(session) = self.engine.as_ref() else {
            return;
        };
        if self.the_screens_are_dark() {
            let dark = darkened(&self.engine_displays);
            if !dark.is_empty() {
                session.configure_displays(&dark);
            }
        } else {
            session.configure_displays(self.screens.scanout());
        }
    }

    /// Whether this desktop's screens are off because nobody is here.
    fn the_screens_are_dark(&self) -> bool {
        self.idle.as_ref().is_some_and(Idle::dark)
    }

    /// Keep a blanked desktop blanked through something that lit it.
    ///
    /// A hotplug is the one event that hands this compositor glass it never
    /// turned off: the monitor arrives lit, off the engine's own modeset. On
    /// a desktop the config describes outright — or one whose reloaded profile
    /// cannot be applied — nothing else states the connectors at all, so
    /// without this a monitor plugged in beside a dark desk lights it.
    ///
    /// Only the dark case. An awake desktop wants exactly what the engine has
    /// just done on its own, and restating it would be a modeset per hotplug
    /// for nothing.
    fn keep_the_screens_dark(&self) {
        if self.the_screens_are_dark() {
            self.state_the_connectors();
        }
    }

    /// Note a request that is a person, and light the screens back up if they
    /// had gone dark.
    ///
    /// The page owns the input on this system and forwards it, so every hand
    /// on this desktop arrives here — which is what makes one honest answer
    /// possible. Which requests are a person is
    /// [`crate::idle::somebody_is_here`].
    fn keep_the_desktop_awake(&mut self, request: &ClientRequest) {
        if !somebody_is_here(request) {
            return;
        }
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        if idle.stirred(Instant::now()) == Some(Blanking::ComeBack) {
            info!("somebody is at this desktop again; its screens come back on");
            self.state_the_connectors();
        }
    }

    /// A client asked that this desktop stay awake for as long as it holds an
    /// inhibitor.
    ///
    /// A desk that states no timeout has no clock to veto, so there is nothing
    /// here to keep: it never blanks, which is what the client was asking for.
    fn hold_the_screens_on(&mut self, surface: WlSurface) {
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.inhibited_by(surface, Instant::now());
        self.the_inhibitors_changed(edge, "a client is holding this desktop awake");
    }

    /// A client let one go, which is the only half of this that a client says.
    fn let_the_screens_go(&mut self, surface: &WlSurface) {
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.uninhibited_by(surface, Instant::now());
        self.the_inhibitors_changed(edge, "nothing is holding this desktop awake now");
    }

    /// Let go of the inhibitors of clients that are gone.
    ///
    /// **A CLIENT THAT DIED SAYS NOTHING**, so this is asked after every turn
    /// of the clients rather than waited for: the destroy that would have
    /// released an inhibitor is the one request a crash does not send, and an
    /// inhibitor nobody is left to hold is a desktop that never blanks again
    /// with nothing anywhere saying why.
    ///
    /// Here rather than on a `destroyed` hook because smithay's own object
    /// data is what carries the surface an inhibitor was taken on, and it
    /// hands that back on the request alone. Cheap enough to ask every time:
    /// it is a liveness check over the handful of things holding this desktop
    /// awake, and it states the connectors only when the answer *changed* —
    /// which, for every client that was holding nothing, it did not.
    ///
    /// The clock is the backstop rather than the mechanism. It would find the
    /// same dead inhibitor the next time it came round, but "the next time"
    /// is a whole timeout, which on the desk this is for is ten minutes of
    /// glass lit for a player that is not running.
    fn let_go_of_what_the_dead_were_holding(&mut self) {
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.the_dead_let_go(Instant::now());
        self.the_inhibitors_changed(edge, "the client holding this desktop awake is gone");
    }

    /// Act on an answer that the inhibitors changed, saying why.
    ///
    /// One place for all three, because they are one sentence with a different
    /// reason in front of it — and because the edge is the whole rule: a
    /// desktop states its connectors when the answer *changed* and at no other
    /// time, whether what changed it was a hand, a clock or a film.
    fn the_inhibitors_changed(&mut self, edge: Option<Blanking>, why: &str) {
        let Some(edge) = edge else {
            return;
        };
        match edge {
            Blanking::GoDark => info!("{why}; this desktop's screens go dark"),
            Blanking::ComeBack => info!("{why}; this desktop's screens come back on"),
        }
        self.state_the_connectors();
    }

    /// The idle clock came round. Answers with when to ask again.
    ///
    /// A timer rather than a thread, and one whose next wake this decides:
    /// an untouched desktop is asked once at the moment it would blank, and a
    /// blanked one once a timeout after that — see [`Idle::next_check`].
    fn the_idle_clock_came_round(&mut self) -> Duration {
        let now = Instant::now();
        let idle = self
            .idle
            .as_mut()
            .expect("the idle clock is armed only where a timeout was stated");
        let going_dark = idle.elapsed(now);
        // Before the edge is acted on, because acting on it borrows the rest
        // of this compositor.
        let next = idle.next_check(now);
        if going_dark == Some(Blanking::GoDark) {
            info!(
                connectors = self.engine_displays.len(),
                "nobody is at this desktop; its screens go dark"
            );
            self.state_the_connectors();
        }
        next
    }

    /// Take up everything in a reloaded config that is not the display list.
    ///
    /// The other half of a reload, beside
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop): that one
    /// is the desktop the file describes, this is the rest of what the file
    /// says. What has to move is decided before anything moves — see
    /// [`Restatement`] — so the question "what did this edit change" is
    /// answered by arithmetic over two configs rather than by this function
    /// restating everything and hoping the ends below it deduplicate.
    ///
    /// That matters for the same reason `adopt_the_desktop`'s early return
    /// does: a config file is rewritten for all sorts of reasons, and an edit
    /// to the display list must not hand every client a keymap it already has.
    fn adopt_the_rest_of_the_config(&mut self, restated: &Restatement) {
        if let Some(keyboard) = &restated.keyboard {
            self.retype_the_desktop(keyboard);
        }
        if let Some(max_scale) = restated.max_scale {
            self.cap_the_scale_at(max_scale);
        }
        if let Some(idle) = &restated.idle {
            self.reset_the_idle_clock(idle);
        }
    }

    /// Take up a new `[idle]`: when a desktop nobody is at turns its screens
    /// off.
    ///
    /// The clock starts again from now rather than carrying the old one's
    /// count: a config written is not a hand on the desk, but it is the moment
    /// this desktop's answer changed, and counting a new timeout from an
    /// instant that belonged to the old one is arithmetic nobody asked for.
    ///
    /// **A DARK DESKTOP COMES BACK ON.** The clock is replaced, and the one
    /// being replaced is the only thing that knew the screens were off —
    /// [`Idle::after`] builds a desk that has just been stirred, so a
    /// compositor keeping the old `dark` would be one believing the screens
    /// are on while they are off. Nothing would then relight them: a hand on
    /// the desk asks [`Idle::stirred`], which answers
    /// [`Blanking::ComeBack`] only on the edge out of dark, and this clock has
    /// no such edge left to give. So the glass is put back where the state
    /// says it is, and the desk blanks again a fresh timeout later.
    fn reset_the_idle_clock(&mut self, idle: &IdleConfig) {
        let was_dark = self.the_screens_are_dark();
        // Carrying over whatever is holding the screens on, which is the one
        // thing here that is the clients' rather than the config's — see
        // [`Idle::takes_over_from`].
        self.idle = match (
            Idle::after(idle.blank_after(), Instant::now()),
            self.idle.as_mut(),
        ) {
            (Some(clock), Some(previous)) => Some(clock.takes_over_from(previous)),
            (clock, _) => clock,
        };
        // A failed insert is not fatal here, which is the difference between
        // this and the same call at startup. What is lost is the blanking —
        // the desk runs on, lit, exactly as one that never stated a timeout —
        // and a reload that took the desktop down to report a timer is the
        // trade `retype_the_desktop` refuses for the keymap, for the same
        // reason. The line names what was lost so it is not a silence.
        if let Err(why) = self.arm_the_idle_clock(idle.blank_after()) {
            error!(
                %why,
                "no clock for the reloaded idle timeout, so this desktop's screens \
                 will not blank until it is restarted"
            );
        }
        if was_dark {
            info!("the idle timeout changed while the screens were off; they come back on");
            self.state_the_connectors();
        }
    }

    /// Arm the timer that asks the idle clock, replacing whatever was armed.
    ///
    /// `None` is a desktop that never blanks, and it leaves no timer at all —
    /// the rule `run` states when it arms this the first time, kept here
    /// because a reload can turn a blanking desktop back into one. A timer
    /// that fires for a clock that is gone would find `the_idle_clock_came_round`
    /// with nothing to ask.
    ///
    /// The old registration is removed rather than left beside the new one:
    /// two timers for one clock is two wakes per timeout, and every reload
    /// would add another.
    fn arm_the_idle_clock(&mut self, after: Option<Duration>) -> Result<(), InsertError<Timer>> {
        if let Some(armed) = self.idle_clock.take() {
            self.loop_handle.remove(armed);
        }
        if let Some(after) = after {
            self.idle_clock = Some(self.loop_handle.insert_source(
                Timer::from_duration(after),
                |_, _, data: &mut CalloopData| {
                    TimeoutAction::ToDuration(data.state.the_idle_clock_came_round())
                },
            )?);
        }
        Ok(())
    }

    /// Take up a new `output.max_scale`: the cap on how dense a display the
    /// desktop will be advertised at.
    ///
    /// Two ends, because the cap is applied in two places and an edit that
    /// reached one of them would be half a reload. The hub's copy is what
    /// bounds the *next* density a chrome reports, on the connection thread
    /// that receives it; the restatement below is the desktop that is already
    /// up, which nothing else would revisit — a person who turns scaling down
    /// does it because the desk in front of them is too slow now.
    ///
    /// The density is the chrome's last reported one rather than the advertised
    /// scale, because the cap and the ratio are different facts and only the
    /// cap moved: a desk capped back up to 2 in front of a 2x window goes back
    /// to 2, and one whose window was never dense stays where it is.
    ///
    /// Nothing happens where the cap does not change any output's scale, and
    /// that is [`set_output`](DomicileCompositor::set_output)'s own staleness
    /// check rather than a second one here — a described desktop refuses this
    /// outright, for the reason
    /// [`set_output_scale`](DomicileCompositor::set_output_scale) gives.
    fn cap_the_scale_at(&mut self, max_scale: u32) {
        self.hub.max_scale.store(max_scale, Ordering::Relaxed);
        self.set_output_scale(output_scale(self.device_pixel_ratio, max_scale));
    }

    /// Compile the config's keyboard and give it to everything that types.
    ///
    /// Three ends and one compilation, which is the point: the seat hands
    /// every Wayland client a `wl_keyboard.keymap` fd, the browser process
    /// drawing the desktop is handed the same text over the chrome socket
    /// because it has no fd to take, and a chrome connecting later is handed
    /// the retained copy. Two compilations would be two readings of one file
    /// with nothing comparing them — see [`crate::keymap`].
    ///
    /// **A KEYMAP THAT WILL NOT COMPILE IS REFUSED, NOT FATAL.** At startup it
    /// is fatal: `run` takes the `?`, because a desktop that came up on
    /// whatever libxkbcommon fell back to would be typing in a layout nobody
    /// chose and nothing would say so. Here there is a desktop already, with
    /// windows on it, and taking it down over a typo in a file somebody is
    /// editing costs them everything that was open to fix nothing. So the live
    /// keymap stays live — which is the last one that compiled, never xkb's
    /// own fallback — and the refusal is said out loud, because the alternative
    /// is a save that looks applied and a keyboard that did not change.
    fn retype_the_desktop(&mut self, keyboard: &KeyboardConfig) {
        match compiled_keymap(keyboard) {
            Err(why) => warn!(%why, "{}", grepped::KEYMAP_REFUSED),
            Ok(keymap) => {
                info!(
                    layout = %keyboard.xkb_layout,
                    variant = %keyboard.xkb_variant,
                    "the desktop types on the keyboard the config now names"
                );
                // The seat first, which is every Wayland client: Smithay
                // writes the text into the keymap file behind the handle and
                // sends the new fd to each bound `wl_keyboard`, so the clients
                // are restated by this one call.
                //
                // From the text rather than from the `XkbConfig`, so the seat
                // and the chrome are handed the same bytes. `set_xkb_config`
                // would compile the names a second time, and a second
                // compilation is the thing `keymap`'s own doc comment is about.
                let typing = self
                    .seat
                    .get_keyboard()
                    .expect("the seat was given a keyboard at startup");
                typing
                    .set_keymap_from_string(self, keymap.clone())
                    .expect("xkb reads back the keymap text it has just written");
                // And the browser process. Retained and then broadcast, in
                // that order, for the reason `set_output` gives about the
                // desktop: the chrome that connects next has to be told the
                // keymap this desk types on rather than the one it started on.
                let told = {
                    let mut host = self.hub.host.lock().unwrap();
                    host.set_keymap(keymap);
                    host.describe_keymap()
                };
                self.hub.broadcast(
                    told.expect("a host that has just been given a keymap has one to state"),
                );
            }
        }
    }

    /// Give the chrome the keyboard.
    ///
    /// There is one seat, and the chrome and the apps take turns on it: the
    /// chrome holds the keyboard until it says a window has been focused, and
    /// gets it back when it says one has not. A second seat for the chrome
    /// would let both hold a focus at once, but a client does not have to bind
    /// more than one — GTK asserts on a second — so the desktop cannot depend
    /// on it.
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

    /// Tell every chrome the charge, when it has moved far enough to draw.
    ///
    /// The one broadcast on a clock rather than on an event, because a battery
    /// has no event: the kernel publishes files and nothing knocks. Read here
    /// and not in the page — `navigator.getBattery` answers through UPower
    /// over D-Bus, which a desktop on a bare tty has not got, and Chromium
    /// then resolves with a default of *charging, and full* that no page can
    /// tell from the truth. `domicile_host::battery` says the rest.
    fn tell_the_chromes_the_charge(&mut self) {
        if let Some(read) = self.charge.moved_to(reading(&RealPowerSupplies)) {
            self.hub.broadcast(HostMessage::Battery {
                charge: read.charge,
                charging: read.charging,
            });
        }
    }

    /// The charge again, for a chrome that has only just connected.
    ///
    /// Not a change, so it cannot go through the teller above: on a settled
    /// machine the next change is minutes away, and a page that has just
    /// reloaded would carry a gap where the meter goes for all of it.
    fn tell_a_new_chrome_the_charge(&self) {
        if let Some(read) = self.charge.again() {
            self.hub.broadcast(HostMessage::Battery {
                charge: read.charge,
                charging: read.charging,
            });
        }
    }

    /// Tell every chrome what is on the clipboard.
    ///
    /// The whole list every time rather than the row that changed: a copy
    /// re-orders the history as often as it adds to it, and a page
    /// reconciling deltas could be wrong about the order forever after
    /// missing one. Thirty-two previews is a small message.
    ///
    /// The same call catches a chrome up on connecting, unlike the battery's
    /// pair — an empty clipboard is a real answer here, so there is no reading
    /// that has to exist before this can be said.
    fn tell_the_chromes_the_clipboard(&self) {
        self.hub.broadcast(HostMessage::Clipboard {
            entries: self.clipboard.entries(),
        });
    }

    /// Read what a client copied, now that the seat is holding its selection.
    ///
    /// **At the end of the dispatch, and both halves of that matter.** After,
    /// because Smithay calls `new_selection` before it stores the selection —
    /// so this is the first moment the seat can be asked. Before the flush,
    /// because asking is a `wl_data_source.send` event, and the client cannot
    /// write into the pipe until that event reaches it.
    ///
    /// The reading itself is a thread's: what it waits for is a stranger's
    /// `write`, and nothing the desktop's every window is behind may wait for
    /// that. It comes back as [`ClientRequest::ClipboardCopied`].
    fn read_what_was_copied(&mut self) {
        let Some(mime) = self.copying.take() else {
            return;
        };
        let (ours, theirs) = match clipboard::pipe() {
            Ok(ends) => ends,
            Err(err) => {
                warn!(%err, "no pipe to read a copy over, so it is not in the history");
                return;
            }
        };
        // The compositor's own selection answers this with
        // `ServerSideSelection`, which is the right answer and not a failure:
        // it is what a client copying is not, and what is on the clipboard
        // then is already a row.
        if let Err(err) = request_data_device_client_selection(&self.seat, mime.clone(), theirs) {
            debug!(%err, %mime, "nothing to read this copy from");
        } else {
            let hub = self.hub.clone();
            thread::spawn(move || {
                match clipboard::read_copy(ours, LONGEST_COPY, clipboard::PATIENCE) {
                    Ok(copied) => match String::from_utf8(copied) {
                        Ok(text) => hub.send_request(ClientRequest::ClipboardCopied { text }),
                        // A client that offered `text/plain;charset=utf-8` and
                        // wrote something else. Said rather than repaired:
                        // what a repair would put in the history is not what
                        // was copied, and pasting it back would corrupt it.
                        Err(err) => {
                            warn!(%err, "a client offered text that is not UTF-8, so it is not a row")
                        }
                    },
                    Err(err) => {
                        warn!(%err, "a client offered the clipboard and did not hand it over")
                    }
                }
            });
        }
    }

    /// Inject a forwarded input event into the appropriate client via the seat.
    fn handle_client_request(&mut self, event: ClientRequest) {
        // First, and for every request: this is the whole of what the
        // compositor knows about somebody being at the desk.
        self.keep_the_desktop_awake(&event);
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
                self.inject_key(keycode, pressed);
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
                        // because nothing afterward takes it back.
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
            ClientRequest::ClipboardCopied { text } => {
                if self.clipboard.record(text) {
                    self.tell_the_chromes_the_clipboard();
                }
            }
            // The one thing a shell can do to the clipboard, and it names a
            // row rather than carrying text: a page that could put arbitrary
            // bytes on the seat would be writing the desktop's clipboard
            // rather than choosing among what is already on it.
            ClientRequest::CopyClipboardEntry { entry } => match self.clipboard.text(entry) {
                Some(_) => set_data_device_selection(
                    &self.display_handle,
                    &self.seat,
                    TEXT_MIMES.iter().map(|mime| (*mime).to_string()).collect(),
                    entry,
                ),
                // An id the shell was told about and the history has since
                // dropped, which is the one way one goes stale. Nothing is
                // set: putting the newest entry on the clipboard instead
                // would be this desktop deciding a person meant something
                // else by what they clicked.
                None => warn!(
                    entry,
                    "the shell asked for a clipboard entry this desktop no longer holds"
                ),
            },
            ClientRequest::ChromeHello { served_by } => {
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
                // A PAGE SAYING HELLO IS HOW THIS COMPOSITOR HEARS THAT THE
                // ENGINE WAS REPLACED. Nothing in the C ABI says a browser
                // went away — `crate::broker_socket` holds why, and why the
                // socket's own inode is what tells a new engine from the same
                // engine reloading its page. Before the announcement below,
                // so that by the time the page is told which windows are open
                // each of them has a frame sink again.
                self.rejoin_the_engine(served_by);
                // Nothing is held and nothing is owed. The windows a chrome
                // needs are re-supplied by the hand-over pass in `present`,
                announce_open_apps(&self.hub);
                // And the charge, which no pass re-supplies: it is broadcast
                // when it moves, and a page that connected between two moves
                // has never been told one.
                self.tell_a_new_chrome_the_charge();
                // The clipboard for the same reason, and with no second
                // method for it: a history of nothing is a message this one
                // can send, where a battery that has not been read is not.
                self.tell_the_chromes_the_clipboard();
            }
            ClientRequest::SetOutputScale { ratio, scale } => {
                // Kept whether or not the scale below is taken up. A described
                // desktop refuses the chrome's density — that is the config's
                // statement about the user's screens — but the ratio is a fact
                // about the *page's* coordinate system, which the engine
                // reports boxes in either way.
                self.device_pixel_ratio = ratio;
                self.set_output_scale(scale);
            }
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
    /// windows opened afterward, until Domicile is restarted.
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
                Committer::App(app_id) => {
                    let held = self.publish_frame(app_id, &buffer);
                    // Driven after the submit, because the polling needs
                    // something submitted to find — but timed from `started`,
                    // which is before it. The import and the submit are ours,
                    // and a round's second half is meant to contain them.
                    self.drive_latency(app_id, started, held);
                    held
                }
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

// ---- idle inhibit ---------------------------------------------------------

/// A client's `zwp_idle_inhibitor_v1`, reaching the clock that would blank the
/// screens.
///
/// Smithay hands over the surface in both directions and nothing else, which
/// is why that is what `Idle` holds. `uninhibit` is the client saying so —
/// and only that; the inhibitors of clients that never will are let go of by
/// [`DomicileCompositor::let_go_of_what_the_dead_were_holding`].
impl IdleInhibitHandler for DomicileCompositor {
    fn inhibit(&mut self, surface: WlSurface) {
        self.hold_the_screens_on(surface);
    }

    fn uninhibit(&mut self, surface: WlSurface) {
        self.let_the_screens_go(&surface);
    }
}

delegate_idle_inhibit!(DomicileCompositor);

/// An inhibitor is held for exactly as long as the surface it was taken on
/// exists.
///
/// Which is the answer to the client that died holding one: every object of a
/// gone client stops being alive when this compositor finishes with its
/// connection, so the inhibitor it never destroyed holds nothing from that
/// moment on — see [`StillThere`], which says why waiting for the destroy is
/// not an option.
impl StillThere for WlSurface {
    fn still_there(&self) -> bool {
        self.is_alive()
    }
}

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

    /// Both clipboards go where the keyboard goes.
    ///
    /// **Without this nothing can paste.** A selection is offered to the
    /// client holding the data device's focus and to no other, so a
    /// compositor that never sets one has a clipboard every client can write
    /// and none can read. It is set from the keyboard's own focus because
    /// that is the rule `wl_data_device` is written around — a client may set
    /// the selection only while it is being typed into, and it is offered the
    /// selection on the same terms.
    ///
    /// `None` is the seat between windows rather than the chrome: the chrome
    /// is a client with a surface of its own and holds the keyboard as one,
    /// so it is offered the clipboard through this like anything else.
    fn focus_changed(&mut self, seat: &Seat<Self>, focused: Option<&WlSurface>) {
        let client = focused.and_then(|on| on.client());
        set_data_device_focus(&self.display_handle, seat, client.clone());
        // Both, and on the same terms. The middle-click selection is offered
        // to whoever holds the keyboard exactly as the clipboard is — a client
        // that was given one and not the other would be one where half of
        // paste does nothing, which is what this desktop had before it had a
        // primary selection at all.
        set_primary_focus(&self.display_handle, seat, client);
    }
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
        None => Screens::nested(),
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
            // The panel's own millimeters on a tty, and
            // `screens::UNKNOWN_PHYSICAL_MM` — zero, which is `wl_output`'s
            // word for a screen with no such number — everywhere else. A described desktop is a config's
            // arithmetic and a nested one is a window, and neither is
            // millimeters of glass; the engine's displays are monitors it read
            // off their EDID while holding DRM master, which this process has
            // no card node to do for itself.
            //
            // Never recomputed here, and that is the point: `Advertised`
            // carries what the display said, so the one output that has a real
            // size gets it and the ones that do not get zero rather than a
            // number invented on their behalf. This said `(300, 200)` on every
            // display, whatever the config described, which made a 3840x2160
            // screen 325 DPI and a 1280x800 one 108 — neither a fact about
            // anything, and both something a toolkit would scale and size
            // fonts from.
            size: advertised.physical_mm.into(),
            subpixel: Subpixel::Unknown,
            make: "Domicile".into(),
            // THE PANEL'S OWN NAME, where there is one. `wl_output.geometry`
            // carries a make and a model as strings for exactly this, and it
            // is what a client showing "which monitor is this" reads.
            //
            // It reaches `xdg_output.description` too, and only this way:
            // Smithay builds that once, as "{make} - {model} - {name}", and
            // offers no setter for it (`output.rs:264`). So the model is where
            // a description goes on this version.
            //
            // "Virtual" for the desktops that are not panels -- a config's
            // arithmetic, a host's window -- which is what every output here
            // used to say.
            model: if advertised.description.is_empty() {
                "Virtual".into()
            } else {
                advertised.description.clone()
            },
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
///
/// Not the physical size, which `Output` fixes at construction and which a
/// kept output cannot have changed: [`Slot::Kept`] matches on the name, an
/// engine display's name is its EDID-derived id, and the millimeters are a
/// property of the panel that id names. An output whose name did not survive
/// is a new one and goes through [`advertise_output`] instead.
fn restate_output(output: &Output, advertised: &Advertised) {
    let mode = current_mode(advertised);
    output.change_current_state(
        Some(mode),
        Some(as_wl_transform(advertised.transform)),
        // Fractional, so `xdg_output` reports the logical size the density
        // actually makes: Smithay divides the mode by this and rounds the
        // `wl_output.scale` it sends clients *up* from it, which is the split
        // a 1.2 display needs. `Scale::Integer` here advertised a 3200-wide
        // monitor as 3840 logical and laid the chrome out against a desktop
        // nothing was the size of.
        Some(Scale::Fractional(advertised.scale)),
        Some(advertised.position.into()),
    );
    output.set_preferred(mode);
}

/// The one mode a display is on, in the shape `wl_output` states it.
///
/// One function rather than a construction at each of the two places that
/// restate a mode — here and `set_output`, the window-following desktop's own
/// path — because the two differ only in where the `Advertised` comes from,
/// and a client told one thing on startup and another on a density change is a
/// screen that appears to have changed hardware.
fn current_mode(advertised: &Advertised) -> OutputMode {
    OutputMode {
        size: advertised.mode.into(),
        refresh: advertised.refresh_mhz,
    }
}

/// A configured transform as the `wl_output` one Smithay states.
///
/// Two spellings of one thing, and neither package is going to adopt the
/// other's: `screens.rs` is kept clear of Smithay so that it can be tested
/// without a `wl_display`, and `domicile-config` is pure logic with serde and
/// nothing else. Rotations only, because that is all a profile can ask for.
fn as_wl_transform(transform: domicile_config::Transform) -> Transform {
    match transform {
        domicile_config::Transform::Normal => Transform::Normal,
        domicile_config::Transform::Rotate90 => Transform::_90,
        domicile_config::Transform::Rotate180 => Transform::_180,
        domicile_config::Transform::Rotate270 => Transform::_270,
    }
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
    /// afterward, so there is never a name to announce. A terminal renames
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

// ---- xdg-activation: a client asking for the keyboard ---------------------

impl XdgActivationHandler for DomicileCompositor {
    fn activation_state(&mut self) -> &mut XdgActivationState {
        &mut self.xdg_activation_state
    }

    /// A client asked for a window to be activated. Nothing here activates it.
    ///
    /// This is the request every desktop calls "focus stealing" when it goes
    /// wrong and "open the link in the browser I already have running" when it
    /// goes right, and which of those it is depends entirely on what the user
    /// was doing — which the compositor does not know and the shell does. So
    /// it is forwarded as `focus_requested` and the seat stays where it is; a
    /// shell that decided to grant it says so with `focus_app`, exactly as it
    /// would for a click.
    ///
    /// Deliberately without the checks a compositor usually makes here — how
    /// old the token is, whether the client that asked is the one the user was
    /// last in — because each of those is the policy this hands over. A shell
    /// that wants them writes them.
    fn request_activation(
        &mut self,
        token: XdgActivationToken,
        _token_data: XdgActivationTokenData,
        surface: WlSurface,
    ) {
        // Spent either way. The pool is keyed by token and nothing else prunes
        // it, so a token left in it after the request it was minted for is a
        // client's way of growing this process without bound.
        self.xdg_activation_state.remove_token(&token);
        if let Some(app_id) = self.app_id_of(&surface) {
            broadcast_focus_request(&self.hub, &app_id);
        }
    }
}

delegate_xdg_activation!(DomicileCompositor);

// ---- data device: drag-and-drop, and the clipboard ------------------------

impl SelectionHandler for DomicileCompositor {
    /// Which entry of the history the compositor is offering.
    ///
    /// Carried by Smithay from the moment the selection is set to the moment a
    /// client asks to read it, which is exactly the hand-over
    /// [`SelectionHandler::send_selection`] needs and saves the compositor
    /// holding a second copy of "what is on the clipboard" that could disagree
    /// with the seat.
    type SelectionUserData = u32;

    /// A client copied something. Nothing is read here — see
    /// [`DomicileCompositor::copying`] for why this can only write down what
    /// to ask for.
    ///
    /// The middle-click clipboard is passed between clients and is not kept:
    /// it changes on every drag over a word, so a history of it would be a
    /// history of what the pointer brushed past. Nothing is written down for
    /// it here, which is what leaves it where Smithay already carries it —
    /// from the client that selected to the client that pastes.
    fn new_selection(
        &mut self,
        target: SelectionTarget,
        source: Option<SelectionSource>,
        _seat: Seat<Self>,
    ) {
        match target {
            // `None` is a selection being cleared, and a selection whose mime
            // types hold no text is an image or a file drag. Neither is a row,
            // and both leave whatever was copied before where it is.
            SelectionTarget::Clipboard => {
                self.copying = source
                    .as_ref()
                    .and_then(|offered| text_mime(&offered.mime_types()));
            }
            SelectionTarget::Primary => {}
        }
    }

    /// A client is pasting something this compositor put on the clipboard.
    ///
    /// **On a thread, because the client sets the pace.** A paste is this
    /// process writing into a pipe the client reads, and a client that asks
    /// for the selection and then stops reading would otherwise park the
    /// Wayland thread — which is every window on the desktop — for as long as
    /// it liked. The deadline in `crate::clipboard` bounds the thread instead.
    ///
    /// An entry that is gone is a client pasting a selection the compositor
    /// took back, which the history's bound makes possible: the fd is dropped,
    /// the client reads end-of-file and pastes nothing.
    fn send_selection(
        &mut self,
        _target: SelectionTarget,
        _mime_type: String,
        fd: OwnedFd,
        _seat: Seat<Self>,
        entry: &u32,
    ) {
        match self.clipboard.text(*entry) {
            Some(text) => {
                let copy = text.to_owned();
                thread::spawn(move || {
                    if let Err(err) =
                        clipboard::write_copy(fd, copy.as_bytes(), clipboard::PATIENCE)
                    {
                        warn!(%err, "a client asked for the clipboard and did not take it");
                    }
                });
            }
            None => warn!(
                entry,
                "a client is pasting an entry this desktop no longer holds, so it gets nothing"
            ),
        }
    }
}

impl PrimarySelectionHandler for DomicileCompositor {
    fn primary_selection_state(&self) -> &PrimarySelectionState {
        &self.primary_selection_state
    }
}

delegate_primary_selection!(DomicileCompositor);

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
    match child.spawn() {
        Ok(mut child) => {
            // After the fork rather than before it, because the line carries
            // the pid and there is none until then. That pid is the whole
            // reason the line moved: it is what an `app client connected`
            // says back, and without it a launcher opening three windows
            // produces three spawns and three arrivals that cannot be paired.
            // See `peer_process` for what the pair is for.
            info!(
                pid = child.id(),
                ?command,
                ?wayland_display,
                "{}",
                grepped::SPAWNING
            );
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(err) => tracing::error!(%err, ?command, "failed to spawn client"),
    }
}

/// The home directory whose files a launcher is offered.
///
/// **The one thing this compositor reads from its environment that is not
/// instrumentation.** Everything a desktop is *configured* with arrives on the
/// command line, because a program writes it; a home directory is not a
/// setting but a fact about the user this process is running as, and it is the
/// same one [`spawn_client`] hands every client it starts. Taking it on a flag
/// would be asking the supervisor to tell us which user we are.
fn home_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

/// The command a spawned client runs under.
///
/// `WAYLAND_DISPLAY` is set on the child rather than left to the compositor's
/// own environment. When Domicile presents to a window it is itself a client of
/// the session it was started from, so it must keep that session's
/// `WAYLAND_DISPLAY` to reach it — and a client that inherited it would open on
/// the host desktop instead of on Domicile. `DISPLAY` is removed so a toolkit
/// with both backends prefers Wayland over any outer X server.
///
/// `DOMICILE_SOCK` is the other way round and is deliberately *not* named
/// here: the launcher puts this desktop's control socket in the compositor's
/// environment (`domicile_launch::spawn::compositor`), which is the desktop
/// the compositor belongs to, so inheriting it is inheriting the right one. It
/// is `WAYLAND_DISPLAY` that is the special case — the compositor's own is the
/// host's rather than this desktop's, and nothing else it was started with is.
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
/// Put the engine's fd in the loop, so that [`DomicileCompositor::pump_the_engine`]
/// runs when the engine has something to say and at no other time.
///
/// Here rather than inline because an engine that replaced another brings a
/// new one: the fd is its event queue's, and the queue belongs to the
/// `DomicileEngine` that made it. A source still watching the old fd is a
/// source watching a descriptor the library closed.
fn poll_the_engine(
    handle: &LoopHandle<'static, CalloopData>,
    fd: std::os::fd::RawFd,
) -> Result<RegistrationToken, Box<dyn std::error::Error>> {
    // Duplicated rather than borrowed: the source outlives this call, and the
    // engine owns the original and closes it when it is dropped.
    //
    // SAFETY: the fd is the live engine's, which the caller has just asked for
    // and which is valid until that engine is destroyed; it is duplicated
    // before this returns and never used as a borrow afterward.
    let owned = unsafe { std::os::fd::BorrowedFd::borrow_raw(fd) }.try_clone_to_owned()?;
    Ok(handle.insert_source(
        Generic::new(owned, Interest::READ, Mode::Level),
        |_, _, data: &mut CalloopData| {
            let dh = data.display.handle();
            data.state.pump_the_engine(&dh);
            Ok(PostAction::Continue)
        },
    )?)
}

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
/// `wp_cursor_shape_v1` is modeled on the CSS cursor keywords, so almost every
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

/// Run one compositor, and say in a sentence why if it will not start.
///
/// NOT `main() -> Result<_, _>`, WHICH IS WHAT THIS WAS. Rust's own
/// `Termination` prints that error with `Debug`, and a startup failure here is
/// the only thing a desk that will not come up has to go on: `domicile` starts
/// a desktop five times and says each time that the compositor "said why
/// above". What was above, for a config with a section one release too old,
/// was `Error: Parse("TOML parse error at line 1, column 2\n  |\n1 | ...")` —
/// the variant name wrapped around it and the span toml had underlined escaped
/// into one unreadable line, in the middle of Chromium's startup log.
///
/// `Display` is what every error this can return is written for, so printing
/// it is the whole of the fix. `bin/domicile.rs` has done it this way all
/// along; this is the other half of the same terminal.
fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("domicile-compositor: {why}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // Color only on a terminal. A desktop is nearly always started with its
    // output going to a file — that is how anybody gets a log to read
    // afterward — and `tracing_subscriber` colors regardless of where it is
    // writing, so what lands there is a field name wrapped in escapes on
    // every line. `grep pid=1234` finds nothing in it, which is the one thing
    // a person reading a slow launch wants to do. Interactively nothing
    // changes.
    let colored = std::io::IsTerminal::is_terminal(&std::io::stdout());
    match tracing_subscriber::EnvFilter::try_from_default_env() {
        Ok(filter) => tracing_subscriber::fmt()
            .with_ansi(colored)
            .with_env_filter(filter)
            .init(),
        Err(_) => tracing_subscriber::fmt().with_ansi(colored).init(),
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
    // Back, and only because it is honored now. A global is a promise to
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
    // Advertised on every desktop, including one that states no timeout and so
    // never blanks: a client asking that desk to stay awake is asking for
    // something already true, and a global that came and went with a reloaded
    // config would be one a running player had bound and lost.
    IdleInhibitManagerState::new::<DomicileCompositor>(&dh);

    let mut seat_state = SeatState::new();
    let data_device_state = DataDeviceState::new::<DomicileCompositor>(&dh);
    let primary_selection_state = PrimarySelectionState::new::<DomicileCompositor>(&dh);
    // Advertise a keyboard and pointer; a real compositor would track hotplug.
    let mut seat: Seat<DomicileCompositor> = seat_state.new_wl_seat(&dh, "domicile");
    // The keymap the seat compiles is what every Wayland client is handed, so
    // the config's keyboard section lands here and nowhere else. A keymap xkb
    // cannot compile (a layout or variant that does not exist) fails the boot
    // rather than silently handing clients a keymap they did not ask for.
    //
    // At boot, which is the whole of the difference between this and a
    // reload: there is no desktop to lose yet, so the strict answer costs
    // nothing. `retype_the_desktop` refuses the same keymap instead, because
    // by then there are windows open on the layout that did compile.
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
    // The same keymap as text, for the chrome's browser process, which has a
    // keyboard layout engine of its own and no fd to hand it. Compiled here
    // rather than read back off the seat because Smithay only lends the
    // keymap through the compositor state, and that value does not exist until
    // long after the chrome socket is accepting connections. See `keymap`.
    let keymap = compiled_keymap(keyboard)?;
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
    {
        let mut host = hub.host.lock().unwrap();
        host.describe_displays(screens.outputs().map(Advertised::described).collect());
        // And the keymap, which rides with the same handshake for the same
        // reason one layer down: the browser process reading that socket
        // decodes every key the shell is typed with, and off ChromeOS nothing
        // else in Chromium ever hands its layout engine one. See `keymap`.
        host.set_keymap(keymap);
    }
    // Bound here rather than in the serving thread, so that a socket that
    // cannot be bound ends the run rather than a thread. The shell is waiting
    // on the session document, which is published long after this — so nothing
    // can arrive before the listener exists, whatever order the rest takes.
    let chrome_listener = bind_chrome_socket(&arguments.chrome_socket)?;
    // NOTHING HERE WAITS FOR A PAGE, AND UNTIL THIS EXISTED NOTHING SAID SO.
    // A compositor with no chrome on it is a running desktop nobody can see:
    // the window is blank, every log line here is about a socket that is fine,
    // and the engine has nothing to report because from its side nothing
    // failed. This end is the only one that can tell the difference between a
    // page that has not arrived yet and one that is never coming, so it is the
    // end that says it. See `domicile_launch::handshake`.
    //
    // AND IT IS ONLY A WATCHDOG WHERE A PAGE IS DUE, which is what
    // `--expect-a-page` says. The engine spike's harnesses run this compositor
    // as a producer for a browser that has its own file:// page, so nothing
    // can dial this socket and the sentence below was printed on every one of
    // their runs, green ones included. See `domicile_launch::handshake`'s
    // `Expected`.
    let handshake = Arc::new(Handshake::new());
    {
        let handshake = handshake.clone();
        let socket = arguments.chrome_socket.clone();
        let expected = arguments.expect_a_page;
        thread::spawn(move || {
            thread::sleep(WAIT_FOR_A_PAGE);
            if let Some(said) = silence(expected, handshake.heard(), &socket, WAIT_FOR_A_PAGE) {
                tracing::error!("{said}");
            }
        });
    }
    {
        let hub = hub.clone();
        let handshake = handshake.clone();
        thread::spawn(move || serve_chrome(hub, chrome_listener, handshake));
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
    // keeps `cargo build` from needing a Chromium checkout — and not a license
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

    // The table a monitor's maker is spelled out of. A machine without one
    // names its monitors the way their firmware does, which is what every
    // desktop here did before this table was read at all and is a perfectly
    // usable desk — but it is also invisible from the outside, so the reason
    // is said once, here, rather than left to be noticed by somebody wondering
    // why their monitor is called `DEL`.
    let vendors = match pnp_ids::read_the_table() {
        Ok(vendors) => vendors,
        Err(why) => {
            warn!(
                %why,
                "monitors will be named the way their EDID spells them — `DEL DELL U3219Q \
                 2ZLS413` rather than `Dell Inc. DELL U3219Q 2ZLS413`. An output.profiles \
                 entry matches either spelling, so a profile written against either one \
                 still applies; set DOMICILE_PNP_IDS to a copy of hwdata's table to get the \
                 longer one back"
            );
            pnp_ids::Vendors::none()
        }
    };

    let state = DomicileCompositor {
        compositor_state: CompositorState::new::<DomicileCompositor>(&dh),
        xdg_shell_state: XdgShellState::new::<DomicileCompositor>(&dh),
        xdg_activation_state: XdgActivationState::new::<DomicileCompositor>(&dh),
        shm_state: ShmState::new::<DomicileCompositor>(&dh, vec![]),
        seat_state,
        data_device_state,
        primary_selection_state,
        clipboard: History::default(),
        copying: None,
        display_handle: dh.clone(),
        seat,
        output_manager_state,
        outputs,
        config: ConfigStore::new(config.clone()),
        engine_displays: Vec::new(),
        vendors,
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
        latency: None,
        latency_app: None,
        latency_reported: false,
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
        device_pixel_ratio: 1.0,
        modifiers: Held::default(),
        charge: Charge::default(),
        stop: Arc::new(AtomicBool::new(false)),
        engine,
        // Armed below rather than here, and re-armed on every engine that
        // replaces another — see `rejoin_the_engine`.
        engine_source: None,
        // Learned from the first page that says hello, which is the first
        // moment anything on this side knows which process is serving one.
        engine_process: None,
        idle: Idle::after(config.idle.blank_after(), Instant::now()),
        // Armed below rather than here, through the one path a reload uses
        // too — see `arm_the_idle_clock`.
        idle_clock: None,
        loop_handle: event_loop.handle(),
    };

    let mut data = CalloopData { display, state };

    // Start accepting on the sockets bound above.
    let handle = event_loop.handle();
    handle.insert_source(source, move |stream, _, data: &mut CalloopData| {
        // The answer to `spawning client`, and the only line between a spawn
        // and the `toplevel mapped` seconds later that says which of the two
        // the wait was. Before `insert_client`, which takes the stream.
        info!(pid = ?peer_pid(&stream), "{}", grepped::ARRIVED);
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
            // After the dispatch, because that is when a client that went away
            // stops being alive — and an inhibitor it never destroyed stops
            // holding the screens on. See
            // `let_go_of_what_the_dead_were_holding`.
            data.state.let_go_of_what_the_dead_were_holding();
            data.display.flush_clients().unwrap();
            Ok(PostAction::Continue)
        },
    )?;

    // The engine's own fd, in the same loop as everything else. This is the
    // whole of why the ABI hands one out: mojo wants a task runner and the
    // compositor already has one, so the library does its work when told and
    // never on a thread this does not know about.
    if let Some(session) = data.state.engine.as_ref() {
        data.state.engine_source = Some(poll_the_engine(&handle, session.fd())?);
    }

    // The latency run's own turn of the loop.
    //
    // A source rather than a loop inside the commit callback, and that is the
    // whole point: see `step_the_latency`. Sampling from the callback held
    // this thread, so the client whose redraw the run was waiting for could
    // be handed neither a buffer release nor a frame callback, and the run
    // blamed it for not answering.
    //
    // Only when a run is asked for. `--domicile-latency-*` is the guard's, and
    // a desktop nobody is measuring should not have a timer at all.
    if spike_latency_point().is_some() {
        handle.insert_source(Timer::immediate(), |_, _, data: &mut CalloopData| {
            // Immediate again while the run has work: calloop dispatches every
            // ready source each turn, so an immediate re-arm still gives the
            // clients' fd and the engine's their turn — which is exactly what
            // was missing. Idling at a millisecond rather than immediately
            // when it has none, so a compositor between rounds is not a
            // spinning one.
            if data.state.step_the_latency() {
                TimeoutAction::ToInstant(Instant::now())
            } else {
                TimeoutAction::ToDuration(Duration::from_millis(1))
            }
        })?;
    }

    // The battery, off the kernel's own announcement of it.
    //
    // THE CHARGE WAS POLLED AND SHOULD NOT HAVE BEEN. Everything else a chrome
    // is told arrives from somewhere — a client maps, a key goes down, a
    // monitor is plugged in — and so does this: `power_supply_changed()` in a
    // driver is a uevent, sent the moment the lead moves. A ten-second timer
    // in its place bought a bolt that lit up to ten seconds late and a CPU
    // woken six times a minute to learn nothing.
    //
    // Level-triggered and drained on each turn, because one lead moving is
    // two events — the charger and the battery — and a source that took one
    // datagram per turn would read `/sys` twice for it.
    //
    // A FAILED SUBSCRIBE IS NOT FATAL, which is a departure from how this
    // compositor treats the console it cannot take. What is lost is the
    // promptness and not the reading: the backstop below still runs, so the
    // bar is a couple of minutes stale rather than absent, and a desktop that
    // refused to start over its own battery meter would be the worse answer.
    // The line names what was lost so it is not a silence.
    match uevents::subscribe() {
        Ok(socket) => {
            handle.insert_source(
                Generic::new(socket, Interest::READ, Mode::Level),
                |_, socket, data: &mut CalloopData| {
                    if uevents::drain(socket, announces_a_power_supply) {
                        data.state.tell_the_chromes_the_charge();
                    }
                    Ok(PostAction::Continue)
                },
            )?;
        }
        Err(err) => error!(
            %err,
            "no netlink socket for device changes, so the charge will only \
             update on its backstop rather than when a lead moves"
        ),
    }

    // And the backstop, which is also what takes the first reading.
    //
    // Armed on every desktop rather than only on a laptop: a machine with no
    // battery reads `/sys/class/power_supply`, finds no cell, and says
    // nothing — see `domicile_host::battery::reading` — and a desktop that
    // decided at startup would be wrong about a battery plugged in later.
    handle.insert_source(Timer::immediate(), |_, _, data: &mut CalloopData| {
        data.state.tell_the_chromes_the_charge();
        TimeoutAction::ToDuration(BATTERY_BACKSTOP)
    })?;

    // A desktop nobody is at, and the one thing this can already do about it:
    // turn the screens off, and turn them back on at the next input.
    //
    // Only where a timeout was stated. A desktop that never blanks should not
    // have a timer at all — the same rule the latency run's source follows
    // above — and `Idle::after` and this are two readings of one `Option`, so
    // a compositor with a clock always has something for it to ask.
    //
    // The re-arm is the clock's own answer rather than a fixed tick: see
    // `Idle::next_check`.
    //
    // Through the compositor rather than on `handle` directly, because a
    // reload arms exactly this and there should be one place that knows how.
    // A failure here is still fatal, which is what startup and a reload
    // differ on: nothing is running yet to lose.
    data.state.arm_the_idle_clock(config.idle.blank_after())?;

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
    // stay as they are, which is exactly the behavior this replaces, and it is
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
                    // The config that is about to stop being live, kept so the
                    // edit can be read as a difference rather than as a file.
                    // Everything but the display list is restated only where
                    // it moved — see `Restatement` — and this is the only
                    // moment the old values still exist to compare against.
                    let was = data.state.config.current().clone();
                    // Through the store, which is what keeps a half-written save
                    // from taking the desktop down: a config that does not parse
                    // leaves the live one in place and is remembered as the last
                    // error rather than applied.
                    if let Err(err) = data.state.config.apply_watch(parsed) {
                        tracing::warn!(%err, "keeping the last config that parsed");
                        return;
                    }
                    let restated = Restatement::between(&was, data.state.config.current());
                    let rebuilt = data.state.screens.reloaded_into(
                        &data.state.config.current().output,
                        &data.state.engine_displays,
                        &data.state.vendors,
                    );
                    match rebuilt {
                        // Nothing to say about the desktop: an undescribed
                        // config with no monitors read, where the window is
                        // the authority and rebuilding from the file would
                        // undo the density it negotiated.
                        Ok(None) => {}
                        Ok(Some(screens)) => {
                            let dh = data.display.handle();
                            data.state.adopt_the_desktop(&dh, screens);
                        }
                        // An edit whose profile matches the monitors that are
                        // plugged in and cannot be applied to them. It parsed,
                        // so the store has taken it; what it cannot do is
                        // describe a desktop, and the one that is up keeps
                        // working while the user fixes it.
                        Err(err) => tracing::warn!(
                            %err,
                            "keeping the desktop that is up; the reloaded profile does not \
                             describe one these monitors can make"
                        ),
                    }
                    // And the rest of the file, whatever the display list did.
                    // After the desktop rather than before it, because a
                    // window-following desktop's scale is advertised against
                    // the outputs the lines above have just settled — and
                    // unconditionally, because a profile that describes no
                    // desktop these monitors can make is still an edit that
                    // may have changed the keyboard.
                    data.state.adopt_the_rest_of_the_config(&restated);
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
        // Before the flush, because asking a client for what it copied is an
        // event that has to reach it — see `read_what_was_copied`, which is
        // also why this is here rather than in the handler that hears about
        // the copy.
        data.state.read_what_was_copied();
        let _ = data.display.flush_clients();
        if stop.load(Ordering::SeqCst) {
            signal.stop();
        }
    })?;
    Ok(())
}

/// What the latency run takes a display frame to be, in mHz.
///
/// The divisor that turns the run's milliseconds into frames, and an
/// assumption rather than a reading: nothing here can ask viz what its display
/// interval is — `css_parity.cc` can, because it runs inside the browser, and
/// reads it off `BeginFrameArgs`. Not what `wl_output` says, which is the
/// display's own rate where the engine read one and
/// [`UNKNOWN_REFRESH_MHZ`](crate::screens::UNKNOWN_REFRESH_MHZ) where nobody
/// did: a number a client must not act on is not a number a measurement may
/// quietly act on either, so the assumption is named here where the report
/// that rests on it is.
const SPIKE_REFRESH_MHZ: i32 = 60_000;

/// THROWAWAY, with the rest of the spike. Which key the latency run presses.
///
/// Enter, because what has to happen is that the client draws something
/// different, and a line-buffered program on the other end of a terminal is
/// the least exotic way to make one do that on demand.
const LATENCY_KEY: u32 = 28;

/// THROWAWAY, with the rest of the spike. Where the latency run watches for
/// the client's answer, from `DOMICILE_SPIKE_LATENCY`.
///
/// `center` — the browser window's middle, which is what a guard wants: a page
/// with one `<app>` on it has the client's window under the center, so nothing
/// has to name a coordinate that would go stale the moment the page's CSS
/// changed. `guard-client-window.sh` reads the drawn color the same way and
/// for the same reason.
///
/// `x,y` — a point, for a page where the center is not over the client.
///
/// Unset means no run, which is every guard but one: the measurement presses
/// keys into whatever has focus and would be a strange thing to do by default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LatencyPoint {
    Center,
    At(i32, i32),
}

fn spike_latency_point() -> Option<LatencyPoint> {
    static POINT: std::sync::OnceLock<Option<LatencyPoint>> = std::sync::OnceLock::new();
    *POINT.get_or_init(|| {
        let raw = std::env::var("DOMICILE_SPIKE_LATENCY").ok()?;
        let raw = raw.trim();
        if raw.eq_ignore_ascii_case("center") {
            return Some(LatencyPoint::Center);
        }
        match parse_point(raw) {
            Some((x, y)) => Some(LatencyPoint::At(x, y)),
            None => {
                warn!(
                    raw,
                    "DOMICILE_SPIKE_LATENCY: not `center` or an `x,y` point; no latency run"
                );
                None
            }
        }
    })
}

/// THROWAWAY, with the rest of the spike. What a latency run may spend, from
/// `DOMICILE_SPIKE_LATENCY_BUDGET` as `rounds,floor_samples,max_polls`.
///
/// Unset is the real measurement's sixty and sixty. A guard's negative control
/// sets it small, because what a control proves — that a client answering no
/// keys makes the guard fail — needs three rounds rather than sixty, and each
/// abandoning round spends its whole poll budget a display frame at a time.
///
/// It is minutes of a *slow* control now rather than minutes of a blocked
/// desktop: the run steps from a timer and gives the loop its turn between
/// samples, so the clients keep being served throughout. See
/// `step_the_latency`.
///
/// A value the run could not use is refused with a warning and no run, rather
/// than clamped: see `Budget::parse`.
fn spike_latency_budget() -> Option<latency::Budget> {
    static BUDGET: std::sync::OnceLock<Option<latency::Budget>> = std::sync::OnceLock::new();
    *BUDGET.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_LATENCY_BUDGET") else {
            return Some(latency::Budget::default());
        };
        let parsed = latency::Budget::parse(raw.trim());
        if parsed.is_none() {
            warn!(
                raw,
                "DOMICILE_SPIKE_LATENCY_BUDGET: not `rounds,floor,polls`, or nothing \
                 a run could measure with; no latency run"
            );
        }
        parsed
    })
}

/// `x,y`, and nothing else. Shared with `DOMICILE_SPIKE_PROBE`'s parse so the
/// two knobs cannot drift into spelling a point differently.
fn parse_point(entry: &str) -> Option<(i32, i32)> {
    let (x, y) = entry.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// THROWAWAY, with the rest of the spike. Where in the browser's window to
/// ask what viz drew, from `DOMICILE_SPIKE_PROBE` as `x,y;x,y`.
///
/// Empty -- the ordinary case -- means the window's center, which is where a
/// one-`<app>` page puts its canvas. A page with two of them has no pixel
/// inside both, so the two-window guard names one point per canvas. Parsed
/// once: this is called from the submit path, at the client's frame rate.
///
/// A malformed entry is dropped with a warning rather than failing the run.
/// The guard checks for the colors it expects and reports their absence, so
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
                let point = parse_point(entry.trim());
                if point.is_none() {
                    warn!(entry, "DOMICILE_SPIKE_PROBE: not an `x,y` point; ignored");
                }
                point
            })
            .collect()
    })
}

/// THROWAWAY, with the rest of the spike. Colors to look for anywhere in the
/// browser's window, from `DOMICILE_SPIKE_FIND` as `RRGGBB;RRGGBB` or
/// `AARRGGBB;AARRGGBB`.
///
/// The shell guard's question rather than the spike pages'. Those pages put
/// their canvases where the harness can compute a point; a shell puts its
/// windows where its own layout decides, so a guard that named a pixel would
/// be asserting the shell's CSS. "This client's window is on the screen
/// somewhere" is the claim that survives the shell being rewritten.
///
/// Six hex digits are taken as fully opaque, because that is what a color
/// written down in a guard means and `FF` in front of it is noise.
fn spike_find_colors() -> &'static [u32] {
    static COLORS: std::sync::OnceLock<Vec<u32>> = std::sync::OnceLock::new();
    COLORS.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_FIND") else {
            return Vec::new();
        };
        parse_find_colors(&raw)
    })
}

/// The parse [`spike_find_colors`] does, without the environment around it —
/// which is what makes it testable at all, since the variable is read once per
/// process.
///
/// A malformed entry is dropped with a warning rather than failing the run, on
/// the same reasoning as `DOMICILE_SPIKE_PROBE`: the guard checks for the
/// color it expects and reports its absence, so a search that quietly looked
/// for nothing still fails, loudly, where it is known what was wanted.
fn parse_find_colors(raw: &str) -> Vec<u32> {
    raw.split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let digits = entry.strip_prefix('#').unwrap_or(entry);
            match (digits.len(), u32::from_str_radix(digits, 16)) {
                // Six digits are fully opaque, because that is what a color
                // written down in a guard means and `FF` in front of it is
                // noise. The window's pixels are opaque, so a color with no
                // alpha would match nothing at all.
                (6, Ok(rgb)) => Some(0xFF00_0000 | rgb),
                (8, Ok(argb)) => Some(argb),
                _ => {
                    warn!(
                        entry,
                        "DOMICILE_SPIKE_FIND: not an `RRGGBB` or `AARRGGBB` color; ignored"
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
        announce_open_apps, answers_keystroke, broadcast_closed, broadcast_focus_decision,
        broadcast_focus_request, channel, chrome_connection, client_command, cursor_shape,
        desk_from_the_window, freshened, parse_find_colors, to_line, write_responses, Chrome,
        ChromeHub, ClientRequest, Committer, Handshake, Outbound,
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
        hub.chromes.lock().unwrap().push(Chrome {
            screen: None,
            writer: writer.clone(),
        });

        let serving = {
            let hub = hub.clone();
            thread::spawn(move || {
                chrome_connection(hub, compositor, writer, Arc::new(Handshake::new()))
            })
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
        // reading that chrome at all, and everything it says afterward is
        // dropped. That was a real flake before the early return: one run in
        // twenty-four of the whole workspace.
        //
        // A unit test rather than the integration one that found it: the
        // behavior is one sentence about this function, and the integration
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

        let booted = vec![window_following("domicile-0", [1280, 800], 1)];
        hub.host.lock().unwrap().describe_displays(booted);
        let answers = vec![
            HostMessage::Welcome {
                protocol_version: domicile_protocol::PROTOCOL_VERSION,
            },
            hub.host.lock().unwrap().describe_desktop(),
        ];

        // And now the desktop changes, after the answers were built and before
        // they are written — which is `set_output` landing in the gap.
        let now = vec![window_following("domicile-0", [1280, 800], 2)];
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
        let described = vec![window_following("domicile-0", [1280, 800], 2)];
        hub.host
            .lock()
            .unwrap()
            .describe_displays(described.clone());

        let built_earlier = HostMessage::Displays {
            displays: vec![window_following("domicile-0", [1280, 800], 1)],
        };

        assert_eq!(
            freshened(&hub, built_earlier, None),
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
            freshened(&hub, welcome.clone(), None),
            welcome,
            "a message that is not the desktop passes through untouched"
        );
    }

    /// The one display a desktop that follows Domicile's own window has: its
    /// logical size is the window's, so the mode is that size and nothing is
    /// turned.
    fn window_following(name: &str, size: [u32; 2], scale: u32) -> domicile_protocol::DisplayInfo {
        domicile_protocol::DisplayInfo {
            name: name.to_string(),
            position: [0, 0],
            size,
            scale,
            mode: size,
            transform: domicile_protocol::DisplayTransform::Normal,
            fills_the_window: false,
        }
    }

    /// Two 4K monitors on their sides, side by side, as the desktop describes
    /// them to a chrome that has not said which window it is.
    ///
    /// Turned, because a chrome that DID say which window it is has to be told
    /// the turn as well as the corner -- and a desk of monitors lying down
    /// would pass either way.
    fn two_screens() -> HostMessage {
        let sideways = |name: &str, x: i32| domicile_protocol::DisplayInfo {
            name: name.to_string(),
            position: [x, 0],
            scale: 2,
            size: [1800, 3200],
            mode: [3840, 2160],
            transform: domicile_protocol::DisplayTransform::Rotate270,
            fills_the_window: false,
        };
        HostMessage::Displays {
            displays: vec![sideways("drm-1", 0), sideways("drm-2", 1800)],
        }
    }

    #[test]
    fn a_chrome_that_named_its_window_gets_that_display_at_the_origin() {
        // The window on the right monitor is told its own display starts at
        // zero -- because within that window it does -- and the left one a
        // screen to the left of it. Left where the desk put them, both regions
        // would be drawn on the right monitor, which is what every window did
        // before this existed.
        let own = desk_from_the_window(&two_screens(), Some("drm-2")).expect("it is moved");

        assert!(own.contains(r#""name":"drm-2","position":[0,0]"#), "{own}");
        assert!(own.contains(r#""name":"drm-1","position":[-1800,0]"#), "{own}");
    }

    #[test]
    fn each_chrome_is_answered_with_the_window_it_named_and_not_another_one() {
        // A DESK OF TWO MONITORS IS TWO CONNECTIONS, and the answer is written
        // to one of them -- so what picks the screen has to be *this*
        // connection's entry rather than whichever is first or was recorded
        // last. Both of those pass every other check here, because every other
        // check connects one chrome; what they cost is the left monitor's
        // desktop drawn on the right monitor, which is the whole thing the
        // move exists to prevent.
        //
        // `desk_from_the_window` next door is the same claim on the broadcast
        // path. This is the response path, where the lookup lives.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
        let HostMessage::Displays { displays } = two_screens() else {
            unreachable!("two_screens is a desktop");
        };
        hub.host.lock().unwrap().describe_displays(displays);

        let connected = |screen: &str| {
            let (page, compositor) = UnixStream::pair().expect("a socket pair");
            let writer = Arc::new(Mutex::new(
                compositor.try_clone().expect("the stream clones"),
            ));
            hub.chromes.lock().unwrap().push(Chrome {
                screen: Some(screen.to_string()),
                writer: writer.clone(),
            });
            (page, writer)
        };
        // The left one first, so an answer that takes the head of the list
        // reaches for `drm-1` while the right one is being written to.
        let (_left_page, _left) = connected("drm-1");
        let (right_page, right) = connected("drm-2");

        assert!(
            write_responses(&hub, &right, vec![two_screens()]),
            "the peer is reading, so the write lands"
        );

        let mut answer = String::new();
        BufReader::new(right_page)
            .read_line(&mut answer)
            .expect("the answer is one line");
        assert!(
            answer.contains(r#""name":"drm-2","position":[0,0]"#),
            "the window on the right monitor is told the right monitor: {answer}"
        );
        assert!(
            answer.contains(r#""name":"drm-1","position":[-1800,0]"#),
            "and where the rest of the desk is from there: {answer}"
        );
    }

    #[test]
    fn a_chrome_that_named_no_window_is_told_the_whole_desktop() {
        // A nested run, and every chrome there was before a window could be
        // one display. `None` is what has the caller send the line it encoded
        // once for everybody.
        assert!(desk_from_the_window(&two_screens(), None).is_none());
    }

    #[test]
    fn nothing_but_the_desktop_is_moved() {
        // A pointer motion is the same event on every screen, and re-encoding
        // one per chrome would be the cost of the feature paid on the traffic
        // that has none of its benefit.
        let welcome = HostMessage::Welcome {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
        };

        assert!(desk_from_the_window(&welcome, Some("drm-2")).is_none());
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
        hub.chromes.lock().unwrap().push(Chrome {
            screen: None,
            writer: writer.clone(),
        });
        let serving = {
            let hub = hub.clone();
            thread::spawn(move || {
                chrome_connection(hub, compositor, writer, Arc::new(Handshake::new()))
            })
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
            thread::spawn(move || {
                chrome_connection(hub, compositor, writer, Arc::new(Handshake::new()))
            })
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
                [
                    ClientRequest::ChromeHello { .. },
                    ClientRequest::CloseApp { app_id }
                ] if app_id == "term"
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

    /// A hub with one app on it, ready to be focused.
    ///
    /// Appearing is the whole setup now. `focus_app` used to refuse an app the
    /// chrome had not placed, so this had to place one; the gate is the host's
    /// own map of apps since placement went, and appearing is what puts an app
    /// in it.
    fn hub_with_an_app() -> (Arc<ChromeHub>, crate::outbound::OutboundReceiver, String) {
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, outbound) = ChromeHub::new(request_tx, 1, OsString::from("wayland-1"));
        let app_id = {
            let mut host = hub.host.lock().unwrap();
            let (app_id, _) = host.app_appeared(None, Some((100.0, 100.0)));
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
    fn a_client_asking_for_the_keyboard_reaches_every_chrome_and_moves_nothing() {
        // `xdg-activation` is a client saying it wants the keyboard, and the
        // compositor honoring that itself would be deciding a policy that
        // belongs to the shell — there would be no way to write a desktop
        // where a background window cannot take what its user is typing into.
        // So it is broadcast as a question and the seat stays where it is.
        let (hub, outbound, app_id) = hub_with_an_app();
        broadcast_focus_decision(&hub, ChromeMessage::FocusChrome);
        let _ = queued(&outbound);

        broadcast_focus_request(&hub, &app_id);

        assert_eq!(
            queued(&outbound),
            vec![HostMessage::FocusRequested {
                app_id: app_id.clone()
            }],
            "the request goes out, and no `focus_changed` with it"
        );
        assert_eq!(
            hub.host.lock().unwrap().focus_holder(),
            None,
            "the keyboard is where it was"
        );
    }

    #[test]
    fn a_request_from_a_window_this_compositor_never_announced_goes_nowhere() {
        // A shell has no element for it and could not answer if it wanted to.
        let (hub, outbound, _) = hub_with_an_app();

        broadcast_focus_request(&hub, "app-404");

        assert_eq!(queued(&outbound), vec![]);
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

    /// Six digits mean opaque, because the window's pixels are and a color
    /// with no alpha would match none of them.
    #[test]
    fn a_color_with_no_alpha_is_opaque() {
        assert_eq!(parse_find_colors("19B36B"), vec![0xFF19_B36B]);
    }

    #[test]
    fn an_alpha_that_is_written_down_is_kept() {
        assert_eq!(parse_find_colors("8019B36B"), vec![0x8019_B36B]);
    }

    /// A guard writes colors the way CSS does, and the harness that passes
    /// them along should not have to strip anything.
    #[test]
    fn a_leading_hash_and_the_spaces_around_an_entry_are_not_part_of_the_color() {
        assert_eq!(
            parse_find_colors(" #19B36B ; CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    /// The run continues on a malformed entry, so a typo costs the color that
    /// was mistyped and not the ones beside it.
    #[test]
    fn an_entry_that_is_not_a_color_is_dropped_and_the_rest_are_kept() {
        assert_eq!(
            parse_find_colors("19B36B;nonsense;CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    #[test]
    fn nothing_to_look_for_is_nothing_to_look_for() {
        assert!(parse_find_colors("").is_empty());
        assert!(parse_find_colors(";  ;").is_empty());
    }
}
