//! `domicile-compositor`: the Wayland server for Domicile.
//!
//! The web engine renders the desktop, so this binary does no drawing of its
//! own. It serves the Wayland globals clients need, manages their surfaces and
//! buffers, and drives [`domicile_host::Host`]: a mapped toplevel calls
//! [`Host::app_appeared`] and a closed one calls [`Host::app_closed`].
//!
//! Client buffers reach the engine as viz surfaces (see `engine_session`).
//! `wl_shm` frames are first copied into a GPU buffer (see `uploads`). Design:
//! `docs/architecture/WINDOW-COMPOSITING.md`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;
use smithay::backend::input::{ButtonState, KeyState};
use smithay::input::{
    keyboard::{FilterResult, Keycode, XkbConfig},
    pointer::{ButtonEvent, CursorIcon, CursorImageStatus, MotionEvent},
    Seat, SeatHandler, SeatState,
};
use smithay::output::{Mode as OutputMode, Output, PhysicalProperties, Scale, Subpixel};
use smithay::reexports::{
    calloop::{
        channel::{channel, Event as ChannelEvent},
        generic::Generic,
        timer::{TimeoutAction, Timer},
        EventLoop, InsertError, Interest, LoopHandle, Mode, PostAction, RegistrationToken,
    },
    wayland_protocols::xdg::decoration::zv1::server::zxdg_toplevel_decoration_v1::Mode as XdgDecorationMode,
    wayland_protocols::xdg::shell::server::xdg_toplevel,
    wayland_protocols_misc::server_decoration::server::{
        org_kde_kwin_server_decoration::{Mode as KdeMode, OrgKdeKwinServerDecoration},
        org_kde_kwin_server_decoration_manager::Mode as KdeDefaultMode,
    },
    wayland_server::{
        backend::{ClientData, ClientId, DisconnectReason},
        protocol::{wl_buffer, wl_seat, wl_surface::WlSurface},
        Client, Display, DisplayHandle, Resource as _, WEnum,
    },
};
use smithay::utils::{Serial, Transform, SERIAL_COUNTER};
use smithay::wayland::viewporter::{ViewportCachedState, ViewporterState};
use smithay::wayland::{
    buffer::BufferHandler,
    compositor::{
        get_children, get_parent, get_role, with_states, BufferAssignment, CompositorClientState,
        CompositorHandler, CompositorState, Damage, SubsurfaceCachedState, SurfaceAttributes,
        SurfaceData,
    },
    content_type::ContentTypeState,
    cursor_shape::CursorShapeManagerState,
    dmabuf::{
        get_dmabuf, DmabufFeedbackBuilder, DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier,
    },
    fractional_scale::{
        with_fractional_scale, FractionalScaleHandler, FractionalScaleManagerState,
    },
    idle_inhibit::{IdleInhibitHandler, IdleInhibitManagerState},
    output::{OutputHandler, OutputManagerState},
    selection::data_device::{
        current_data_device_selection_userdata, request_data_device_client_selection,
        set_data_device_focus, set_data_device_selection, ClientDndGrabHandler, DataDeviceHandler,
        DataDeviceState, ServerDndGrabHandler,
    },
    selection::ext_data_control::{
        DataControlHandler as ExtDataControlHandler, DataControlState as ExtDataControlState,
    },
    selection::primary_selection::{
        request_primary_client_selection, set_primary_focus, set_primary_selection,
        PrimarySelectionHandler, PrimarySelectionState,
    },
    selection::wlr_data_control::{
        DataControlHandler as WlrDataControlHandler, DataControlState as WlrDataControlState,
    },
    selection::{SelectionHandler, SelectionSource, SelectionTarget},
    shell::kde::decoration::{KdeDecorationHandler, KdeDecorationState},
    shell::xdg::decoration::{XdgDecorationHandler, XdgDecorationState},
    shell::xdg::{
        PopupSurface, PositionerState, SurfaceCachedState, ToplevelSurface, XdgShellHandler,
        XdgShellState, XdgToplevelSurfaceData, XDG_POPUP_ROLE,
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
    delegate_compositor, delegate_content_type, delegate_cursor_shape, delegate_data_control,
    delegate_data_device, delegate_dmabuf, delegate_ext_data_control, delegate_fractional_scale,
    delegate_idle_inhibit, delegate_kde_decoration, delegate_output, delegate_primary_selection,
    delegate_seat, delegate_shm, delegate_single_pixel_buffer, delegate_viewporter,
    delegate_xdg_activation, delegate_xdg_decoration, delegate_xdg_shell,
};
use tracing::{debug, error, info, warn};

mod activation;
mod app_scope;
mod buffer_transform;
mod casting;
mod chrome_connection;
mod chrome_hub;
mod client_requests;
mod clipboard;
mod coalesce;
mod configure_answers;
mod dmabuf_descriptor;
mod dmabuf_import;
mod eis;
mod engine;
mod engine_buffers;
mod engine_damage;
mod engine_session;
mod engine_surfaces;
mod engine_waiting;
mod file_indexing;
mod frame_report;
mod gbm;
mod idle;
mod keymap;
mod latency;
mod lock;
mod modifiers;
mod notifications;
mod outbound;
mod pam;
mod peer_process;
mod pnp_ids;
mod portals;
mod reply;
mod restatement;
mod scale;
mod screencopy;
mod screens;
mod shell_config;
mod shm_upload;
mod timing_window;
mod tray;
mod uploads;
mod viewport;
mod which_engine;
mod window_geometry;
mod xdg_foreign;

use crate::buffer_transform::{crop_in_buffer, upright_size, Sampled};
use crate::dmabuf_descriptor::DmabufDescriptor;
use crate::engine::{Bounds, Capture, Clipboard, NEWEST_BOX};
use crate::engine_buffers::Returned;
use crate::engine_session::{EngineSession, Submission, Submitted};
use crate::gbm::Gbm;
use crate::latency::{Latency, Step as LatencyStep};
use crate::shm_upload::{render_modifiers, shm_shape, CopyError};
use crate::uploads::{UploadId, Uploads};

use crate::chrome_connection::{bind_chrome_socket, serve_chrome};
use crate::chrome_hub::{
    broadcast_closed, broadcast_focus_decision, broadcast_focus_request, serve_outbound, ChromeHub,
};
use crate::client_requests::ClientRequest;
use crate::coalesce::last_of_burst;
use crate::configure_answers::ConfigureAnswers;
use crate::dmabuf_descriptor::descriptor_from;
use crate::dmabuf_import::{headless_renderer, DmabufImporter};
use crate::eis::barriers::Zone;
use crate::file_indexing::{keep_the_index, kept_at, Heard};
use crate::idle::{announced, darkened, somebody_is_here, Blanking, Idle, StillThere};
use crate::keymap::compiled_keymap;
use crate::lock::{Lock, Offer, Refusal, Unlocking, Verdict};
use crate::modifiers::{Held, Modifiers};
use crate::peer_process::peer_pid;
use crate::portals::{shell_appearance, Selection, CURRENT_DESKTOP};
use crate::restatement::Restatement;
use crate::scale::{logical_size, output_scale};
use crate::screens::{Advertised, Screens, Slot};
use crate::viewport::{source_pixels, surface_size, Viewport};
use crate::which_engine::another_engine;
use domicile_config::{
    Config, ConfigError, ConfigStore, ExtensionsConfig, IdleConfig, KeyboardConfig, Omit, ThemeMode,
};
use domicile_host::clipboard::{text_mime, History, LONGEST_COPY, TEXT_MIMES};
use domicile_host::data_dirs::data_dirs;
use domicile_host::system::Environment;
use domicile_host::theme_turnover::{Step, Turnover, REPAINT_WITHIN};
use domicile_host::Host;
use domicile_launch::arguments::arguments;
use domicile_launch::handshake::{silence, Handshake, WAIT_FOR_A_PAGE};
use domicile_launch::session::{publish, Session};
use domicile_protocol::{ChromeMessage, CursorShape, HostMessage, Passphrase, Theme};
use smithay::backend::renderer::gles::GlesRenderer;
use zbus::zvariant::OwnedObjectPath;

/// Log messages that tests and operators search for by text.
///
/// Renaming one means updating the tests named on it. Not a complete list:
/// `scripts/e2e-dmabuf.sh` and `tests/` also match unnamed messages such as
/// `toplevel mapped`.
mod grepped {
    /// A chrome message that failed to parse.
    pub const UNPARSEABLE: &str = "unparseable chrome message";
    /// `set_output_scale` ignored a chrome's density on a described desktop.
    ///
    /// Waited on by `tests/desktop.rs`.
    pub const DENSITY_REFUSED: &str = "a described desktop keeps its own scale";
    /// `set_output_size` ignored a chrome's size on a described desktop.
    ///
    /// Waited on by `tests/desktop.rs`.
    pub const SIZE_REFUSED: &str = "a described desktop keeps its own size";
    /// The logical size and density an output was advertised at.
    ///
    /// Read this first when a chrome is laid out for the wrong screen.
    pub const ADVERTISING: &str = "advertising output scale";
    /// `spawn_client` forked a program. With [`ARRIVED`], it times a launch.
    ///
    /// Waited on by `tests/apps.rs`.
    pub const SPAWNING: &str = "spawning client";
    /// An app client connected to the socket.
    ///
    /// Waited on by `tests/apps.rs`.
    pub const ARRIVED: &str = "app client connected";
    /// [`retype_the_desktop`](crate::DomicileCompositor::retype_the_desktop)
    /// kept the old keymap because the new one did not compile.
    ///
    /// A refused reload sends no message, so this line is the only sign of it.
    /// Waited on by `tests/input.rs`.
    pub const KEYMAP_REFUSED: &str = "keeping the keymap the desktop is typing on";
    /// [`rebind_the_keys`](crate::DomicileCompositor::rebind_the_keys) kept
    /// the old keybindings because the new keyboard did not compile.
    ///
    /// A refused reload sends no message, so this line is the only sign of it.
    pub const KEYS_REFUSED: &str = "keeping the keys the shells were last told";
    /// [`activation::earned`](crate::activation::earned) dropped a focus
    /// request.
    ///
    /// A dropped request sends no message, so this line is the only sign of
    /// it. Waited on by `tests/focus.rs`.
    pub const FOCUS_REQUEST_DROPPED: &str = "focus request from before the keyboard last moved";
}

/// The renderer that imports client dmabufs and reads back shm buffers.
struct Gpu {
    renderer: Box<GlesRenderer>,
    importer: DmabufImporter,
    /// Allocates the buffers shm frames are copied into. `None` leaves shm
    /// clients blank; startup logs this once.
    gbm: Option<Gbm>,
}

impl Gpu {
    fn renderer(&mut self) -> &mut GlesRenderer {
        &mut self.renderer
    }
}

/// State threaded through the calloop event loop.
///
/// Holds the `Display` (not the Wayland source) so events queued by input
/// from other threads can be flushed.
struct CalloopData {
    display: Display<DomicileCompositor>,
    state: DomicileCompositor,
}

/// Log a request the lock refused.
///
/// Input at a locked desktop is normal (it wakes the screen), so that is debug.
/// A shell sending commands while locked has a bug, so that is a warning.
/// Neither line says what was asked.
fn say_what_the_lock_refused(refusal: Refusal) {
    match refusal {
        Refusal::Hand => {
            debug!("this desktop is locked; what the shell forwarded reaches no client")
        }
        Refusal::Command => {
            warn!("this desktop is locked; what the shell asked for is not done")
        }
    }
}

/// The compositor state: Wayland protocol globals and the shared hub.
struct DomicileCompositor {
    compositor_state: CompositorState,
    xdg_shell_state: XdgShellState,
    // Clients request focus through this. Not acted on directly; see
    // `XdgActivationHandler` below.
    xdg_activation_state: XdgActivationState,
    // Decoration negotiation. The shell always draws decorations; see
    // `XdgDecorationHandler` below.
    _xdg_decoration_state: XdgDecorationState,
    kde_decoration_state: KdeDecorationState,
    shm_state: ShmState,
    seat_state: SeatState<DomicileCompositor>,
    seat: Seat<DomicileCompositor>,
    /// Kept alive so the xdg-output manager global persists.
    #[allow(dead_code)]
    output_manager_state: OutputManagerState,
    /// Every advertised output, in the same order as [`Screens`].
    ///
    /// The order must match one to one, because [`Screens::entered_by`] returns
    /// a positional list zipped against this. `set_output` updates in place,
    /// and [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop)
    /// replaces both lists together.
    ///
    /// See
    /// [`enter_the_displays_each_window_is_on`](DomicileCompositor::enter_the_displays_each_window_is_on).
    outputs: Vec<LiveOutput>,
    /// The live config, and the last edit that failed to parse.
    ///
    /// A [`ConfigStore`] keeps the live config when an edit fails to parse. A
    /// reload applies every field, through
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) and
    /// [`adopt_the_rest_of_the_config`](DomicileCompositor::adopt_the_rest_of_the_config),
    /// so this is the config actually running. See [`crate::restatement`].
    ///
    /// A half-written save still parses. The watcher thread's coalescing
    /// handles that.
    config: ConfigStore,
    /// The outputs' layout, and whether the config or the chrome controls it.
    screens: Screens,
    /// The engine's last report of the monitors. Empty until it sends one.
    ///
    /// Always empty when nested: the engine does not watch displays then, since
    /// they would be the host's monitors.
    ///
    /// Kept so a config reload can be matched against the current monitors, not
    /// only a hotplug.
    engine_displays: Vec<engine::Display>,
    /// hwdata's `pnp.ids`, mapping EDID vendor codes to vendor names.
    ///
    /// Read once at startup; it cannot change between hotplugs. Empty if the
    /// machine has no copy, which is logged.
    vendors: pnp_ids::Vendors,
    /// The chrome's last reported `devicePixelRatio`.
    ///
    /// Used to convert the engine's device-pixel `<app>` bounds to logical
    /// units for a configure. See [`crate::scale::logical_box`]. Defaults to
    /// 1.0.
    device_pixel_ratio: f64,
    /// Drag-and-drop and the clipboard.
    ///
    /// Required: without `wl_data_device_manager`, an HTML5 drag in a page
    /// starts a Wayland drag that never completes, and the engine's nested loop
    /// freezes the chrome.
    data_device_state: DataDeviceState,
    /// The primary selection (middle-click clipboard).
    ///
    /// Separate from `wl_data_device`. Passed between clients and never read
    /// here, since it changes on every text selection and its history would be
    /// noise.
    primary_selection_state: PrimarySelectionState,
    /// `ext-data-control-v1`: clipboard managers, `wl-copy` and `wl-paste`
    /// read and set both selections with no window focused.
    ///
    /// Shares the seat's selections with `wl_data_device` and the primary
    /// selection, so its copies reach [`DomicileCompositor::clipboard`] through
    /// the same `SelectionHandler`.
    ext_data_control_state: ExtDataControlState,
    /// `zwlr_data_control_v1`, the same for clients that predate
    /// `ext-data-control-v1`.
    wlr_data_control_state: WlrDataControlState,
    /// Clipboard history, newest first.
    ///
    /// A Wayland clipboard disappears with the client that offered it. This
    /// history keeps copies after the client exits. The compositor holds it
    /// because `set_selection` arrives only here. Policy lives in
    /// `domicile_host::clipboard`.
    clipboard: History,
    /// The mime type to read from a new selection, one per clipboard.
    ///
    /// Read one dispatch later because Smithay calls `new_selection` before
    /// storing the selection on the seat.
    /// [`DomicileCompositor::read_what_was_copied`] uses it at the end of the
    /// dispatch, before the flush. `None` means no text, which is not recorded.
    ///
    /// One slot per clipboard because a client can set both in one dispatch.
    copying: [Option<String>; 2],
    /// The current text on each clipboard, whoever set it.
    ///
    /// Differs from the history: this is what a paste would produce now,
    /// including an old history entry the shell restored.
    ///
    /// Needed for the browser, which is not a Wayland client here and cannot be
    /// served by another client directly. It also serves Wayland clients
    /// pasting what the browser copied. See [`Clipboard`].
    holding: [Option<String>; 2],
    /// The display handle, for paths that do not start at the event loop:
    /// moving clipboard focus with the keyboard (a `SeatHandler` callback) and
    /// restoring a history entry (a chrome request).
    display_handle: DisplayHandle,
    /// Kept alive so the wp_cursor_shape_v1 global persists.
    #[allow(dead_code)]
    cursor_shape_state: CursorShapeManagerState,
    dmabuf_state: DmabufState,
    /// Kept alive so the zwp_linux_dmabuf_v1 global persists. `None` where EGL
    /// gave us no renderer, in which case the global was never advertised.
    #[allow(dead_code)]
    dmabuf_global: Option<DmabufGlobal>,
    /// The renderer client buffers are imported on.
    ///
    /// Present exactly when the dmabuf global is, so a committed dmabuf always
    /// has somewhere to go.
    gpu: Option<Gpu>,

    /// State shared with the chrome connection threads.
    hub: Arc<ChromeHub>,
    /// Whether clients start in their own systemd scopes; see
    /// [`crate::app_scope`].
    scope_clients: bool,
    /// Domicile's own apps, installed with every config's extensions; see
    /// [`domicile_launch::apps`].
    apps: Vec<PathBuf>,
    /// Mapped toplevels, paired with the host-assigned app id (Wayland-thread only).
    toplevels: Vec<(String, ToplevelSurface)>,
    /// Where the page last said each window is, in desktop logical units
    /// (`ChromeMessage::SetAppBounds`). Decides its displays and scale; see
    /// [`place_window`](DomicileCompositor::place_window).
    app_bounds: HashMap<String, domicile_scene::Bounds>,
    /// Every announced popup (menus), by its host-assigned id.
    ///
    /// The engine treats each as its own app, placed rather than laid out; see
    /// `HostMessage::PopupPlaced`. Announced once it has a buffer.
    popups: Vec<(String, PopupSurface)>,
    /// Popups holding a grab, outermost first.
    ///
    /// They have the keyboard while open. Focus moving anywhere but their
    /// window dismisses them all; see `ClientRequest::KeyboardFocus`.
    grabbing: Vec<PopupSurface>,
    /// Every announced bubble: a subsurface of a window or popup, placed as a
    /// popup is.
    ///
    /// Chromium draws its bubbles this way, extension popups among them.
    /// Announced once it has a buffer; see `place_the_bubbles`.
    bubbles: Vec<Bubble>,
    /// The app the pointer is currently over, so a `set_cursor` request can be
    /// attributed to the element the chrome should restyle.
    pointer_app: Option<String>,
    /// Pointer buttons the seat was told are down, in the order pressed.
    ///
    /// Smithay keeps this list too but does not expose it. See
    /// [`DomicileCompositor::let_go_of_lost_presses`].
    held_buttons: Vec<u32>,
    /// InputCapture sessions, which take input once the pointer reaches a
    /// barrier. Set when the Wayland loop starts serving EIS. See
    /// [`crate::eis`].
    captures: Option<eis::Captures>,
    /// For frame-callback timestamps.
    start: Instant,
    /// When the last buffer commit finished, to time the gap to the next. Not
    /// per app: it measures whether this thread was busy.
    last_commit: Option<Instant>,
    /// When the oldest unanswered keystroke was injected. Only the oldest is
    /// kept, matching the chrome: a burst answered by one frame feels as slow
    /// as its first key.
    pending_key: Option<Instant>,
    /// The keystroke-to-pixel measurement. `None` unless
    /// `DOMICILE_SPIKE_LATENCY` names a point.
    latency: Option<Latency>,
    /// The app being measured: the first to commit.
    latency_app: Option<String>,
    /// Whether the latency report was logged. Logged once, though the client
    /// keeps drawing.
    latency_reported: bool,
    /// The chrome's own toplevel, if it is our client.
    ///
    /// Kept apart from `toplevels` because it is the desktop, not an app: never
    /// announced, and the keyboard falls back to it.
    chrome_toplevel: Option<ToplevelSurface>,
    /// Clients whose shm frame could not be copied, already logged. Logged once
    /// per client, not per frame.
    shm_refused: HashSet<String>,
    /// GPU buffers that shm frames are copied into, so the engine gets a
    /// dmabuf. See [`crate::uploads`].
    uploads: Uploads<Dmabuf>,
    /// Each toplevel's numbered configures, so a commit is shown at the box
    /// it was drawn for. See [`crate::configure_answers`].
    configure_answers: HashMap<String, ConfigureAnswers<Serial>>,
    /// Each window's previous commit, if the engine shows it whole, so the
    /// next can carry only the client's damage. See [`crate::engine_damage`].
    shown: engine_damage::Shown,
    /// The size limits each window's chromes were last told, so a commit
    /// that keeps them does not lock the host.
    size_limits: HashMap<String, SizeLimits>,
    /// Every announced surface's app id and role, kept in step with
    /// `toplevels`, `popups` and `bubbles`, so a commit finds its window
    /// without searching them.
    by_surface: HashMap<WlSurface, (String, Role)>,

    /// Apps whose first frame the engine accepted, logged once each.
    ///
    /// Mapping, getting a sink and being configured do not mean a window drew
    /// anything.
    first_frame_logged: HashSet<String>,

    /// Temporary, part of the pixel probe. When the probe last ran.
    ///
    /// The probe blocks this thread on a viz readback. Running it per submit
    /// with two clients would starve the event loop and stop buffer releases.
    /// Guards poll for tens of seconds, so four runs a second is enough.
    last_probe: Option<Instant>,

    /// Temporary. Points the probe refused, logged once each.
    probe_refused: HashSet<(i32, i32)>,

    /// Temporary. Colors already reported absent, logged once each.
    probe_missing: HashSet<u32>,

    /// Temporary. Colors the probe could not read at all.
    ///
    /// Separate from `probe_missing` so "not on screen" and "nothing was read"
    /// do not hide each other.
    probe_unreadable: HashSet<u32>,

    /// Temporary. When the color search last ran. Throttled harder than the
    /// point probe because it reads back the whole window.
    last_find: Option<Instant>,

    /// Temporary. When the color search first ran; its budget counts from here.
    /// Not from startup, so waiting for a client does not spend the budget.
    find_since: Option<Instant>,

    /// Temporary. The last box logged for each color, so a box is logged
    /// whenever it moves. A window still painting is smaller than it will be.
    ///
    /// A color is present only while found.
    probe_boxes: HashMap<u32, Bounds>,

    /// Temporary. Whether the search is done: every color found and stable, or
    /// the budget spent. Stops the blocking readbacks.
    find_settled: bool,
    /// The chrome's last frame shape, so its log line is printed only on
    /// change.
    chrome_frame_shape: Option<((f64, f64), bool, bool)>,
    /// Which modifiers the chrome was last told are held.
    modifiers: Held,
    /// Set when the user closes the desktop window. The event loop reads it and
    /// stops.
    stop: Arc<AtomicBool>,
    /// The forked engine, when `--engine-socket` is given.
    ///
    /// `None` leaves no way to show windows, which startup logs. `Some` submits
    /// client dmabufs to viz and holds `wl_buffer.release` until viz is done;
    /// see [`engine_session::EngineSession`].
    engine: Option<EngineSession>,
    /// The registration watching the engine's fd.
    ///
    /// Kept so a replacement engine can be watched instead. The old fd is
    /// closed by the library, and a calloop source can only be removed by its
    /// token.
    engine_source: Option<RegistrationToken>,
    /// The browser process serving the last page that said hello.
    ///
    /// `None` until the first hello, which is always the engine dialed at
    /// startup. See [`crate::which_engine`].
    engine_process: Option<i32>,
    /// Idle tracking, for a desktop that blanks.
    ///
    /// `None` if the config sets no idle timeout. Replaced by
    /// [`reset_the_idle_clock`](DomicileCompositor::reset_the_idle_clock) when
    /// a reload changes `idle`.
    ///
    /// Inhibitors are held as their surfaces. An inhibitor counts only if its
    /// surface is [`StillThere`] and among
    /// [`surfaces_on_the_desktop`](DomicileCompositor::surfaces_on_the_desktop).
    idle: Option<Idle<WlSurface>>,
    /// Sends reloads to the file index thread. `None` without a home to index.
    ///
    /// Only `files.omit` changes go here. See
    /// [`omit_from_the_index`](DomicileCompositor::omit_from_the_index).
    index: Option<mpsc::Sender<Heard>>,
    /// The idle timer, if any.
    ///
    /// Kept so a reload can remove or replace it; a calloop source can only be
    /// removed by its token.
    idle_clock: Option<RegistrationToken>,
    /// The lock, for a desktop that can lock.
    ///
    /// `None` if the config sets neither `lock.passphrase` nor
    /// `lock.pam_service`. See [`crate::lock::chosen`].
    ///
    /// Not replaced on reload, unlike `idle`. Rebuilding it could unlock the
    /// desktop, or leave a locked one with no verifier. Verifier changes apply
    /// on the next run. See `ROADMAP.md`.
    lock: Option<Lock>,
    /// The theme change in progress, if any, and its current phase's deadline.
    turnover: Option<Turnover<usize>>,
    turnover_deadline: Option<RegistrationToken>,
    /// Window, monitor and region streams. See [`crate::casting`].
    casting: casting::Streams,
    /// Takes the shots Wayland capture clients copy. See [`crate::screencopy`].
    screen_copying: casting::Casting,
    /// When the next paced cast frame is sent, if one waits.
    cast_deadline: Option<RegistrationToken>,
    /// `DOMICILE_CAST_WINDOW`: the title of a window to cast as soon as it has
    /// it, and the handle to start the cast with. Taken when it starts.
    cast_on_title: Option<(String, casting::Casting)>,
    /// `DOMICILE_CAST_MONITOR`: a monitor's `wl_output` name or a region to
    /// cast (see [`casting::Source::desk`]), and the handle to start the cast
    /// with. Taken when it starts.
    cast_on_monitor: Option<(String, casting::Casting)>,
    /// `DOMICILE_CAST_TEST_PATTERN`: monitor and region casts draw one color
    /// when no engine captures the displays.
    cast_test_pattern: Option<casting::TestPattern>,
    /// The event loop handle, for adding sources after startup.
    ///
    /// Only the idle timer needs it: a reload may add a timeout the startup
    /// config did not have.
    loop_handle: LoopHandle<'static, CalloopData>,
}

/// Per-client state required by the compositor global.
#[derive(Default)]
struct ClientState {
    compositor_state: CompositorClientState,
    /// Whether this client connected on the chrome's socket, making it the
    /// engine rather than an app.
    ///
    /// The socket identifies it because clients cannot spoof it. An
    /// `xdg_toplevel` app id is client-set and may arrive after the toplevel.
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

impl eis::Compositor for CalloopData {
    fn desk(&self) -> eis::Desk {
        self.state.desk()
    }

    fn inject(&mut self, request: ClientRequest) {
        self.state.handle_client_request(request);
    }

    /// From the keysym table the shell's keybindings resolve against.
    fn keycode(&self, keysym: u32) -> Option<u32> {
        let name = smithay::input::keyboard::xkb::keysym_get_name(keysym.into());
        match self.state.hub.host.lock().unwrap().describe_shell_config() {
            Some(HostMessage::ShellConfig { keys }) => keys.get(&name).copied(),
            _ => None,
        }
    }
}

impl DomicileCompositor {
    /// The displays and windows, as EIS sees them.
    fn desk(&self) -> eis::Desk {
        let state = self;
        let focused = state.seat.get_keyboard().unwrap().current_focus();
        let windows = state
            .app_bounds
            .iter()
            .filter_map(|(app_id, bounds)| {
                state.toplevel_for(app_id).map(|toplevel| eis::Window {
                    app_id: app_id.clone(),
                    bounds: *bounds,
                    focused: focused.as_ref() == Some(toplevel.wl_surface()),
                })
            })
            .collect();
        eis::Desk::new(state.screens.outputs().cloned().collect(), windows)
    }
}

impl DomicileCompositor {
    fn toplevel_for(&self, app_id: &str) -> Option<ToplevelSurface> {
        self.toplevels
            .iter()
            .find(|(id, _)| id == app_id)
            .map(|(_, toplevel)| toplevel.clone())
    }

    /// The surface an app id names: a window, or a popup over one.
    fn surface_for(&self, app_id: &str) -> Option<WlSurface> {
        self.toplevel_for(app_id)
            .map(|toplevel| toplevel.wl_surface().clone())
            .or_else(|| {
                self.popups
                    .iter()
                    .find(|(id, _)| id == app_id)
                    .map(|(_, popup)| popup.wl_surface().clone())
            })
            .or_else(|| {
                self.bubbles
                    .iter()
                    .find(|bubble| bubble.app_id == app_id)
                    .map(|bubble| bubble.surface.clone())
            })
    }

    fn now_ms(&self) -> u32 {
        self.start.elapsed().as_millis() as u32
    }

    /// Who committed `surface`, and in which role. Roles differ only in where
    /// the buffer goes and the requested size.
    fn committer(&self, surface: &WlSurface) -> Option<(Committer, Role)> {
        if let Some(chrome) = &self.chrome_toplevel {
            if chrome.wl_surface() == surface {
                return Some((Committer::Chrome, Role::Toplevel(chrome.clone())));
            }
        }
        self.by_surface
            .get(surface)
            .map(|(app_id, role)| (Committer::App(app_id.clone()), role.clone()))
    }

    /// Announce a window's popup on its first buffer commit.
    ///
    /// A popup that never draws needs no placement. Popups over the chrome's
    /// own window belong to the engine and are ignored.
    fn announce_a_new_popup(&mut self, surface: &WlSurface) {
        if get_role(surface) != Some(XDG_POPUP_ROLE) || self.by_surface.contains_key(surface) {
            return;
        }
        let Some(popup) = self
            .xdg_shell_state
            .popup_surfaces()
            .iter()
            .find(|popup| popup.wl_surface() == surface)
            .cloned()
        else {
            return;
        };
        let has_a_buffer = with_states(surface, |states| {
            let mut attributes = states.cached_state.get::<SurfaceAttributes>();
            matches!(
                attributes.current().buffer,
                Some(BufferAssignment::NewBuffer(_))
            )
        });
        let Some(parent) = popup
            .get_parent_surface()
            .and_then(|parent| self.app_id_of(&parent))
        else {
            return;
        };
        if !has_a_buffer {
            return;
        }
        let geometry = popup.with_pending_state(|state| state.geometry);
        let placed = self.hub.host.lock().unwrap().popup_placed(
            &parent,
            (f64::from(geometry.loc.x), f64::from(geometry.loc.y)),
            (f64::from(geometry.size.w), f64::from(geometry.size.h)),
            self.grabbing.contains(&popup),
        );
        if let Some((app_id, message)) = placed {
            debug!(%app_id, %parent, "popup mapped -> Host::popup_placed");
            self.by_surface.insert(
                surface.clone(),
                (app_id.clone(), Role::Popup(popup.clone())),
            );
            self.popups.push((app_id, popup));
            self.hub.broadcast(message);
        }
    }

    /// Announce, move or forget the bubbles a commit of `surface` changes.
    ///
    /// That is `surface` itself, which may be a bubble, and the bubbles over
    /// it, since a parent's commit applies their positions.
    fn place_the_bubbles(&mut self, surface: &WlSurface) {
        let drawn = drawn_size(surface);
        let over_it = self
            .bubbles
            .iter()
            .filter(|bubble| bubble.parent == *surface)
            .map(|bubble| bubble.surface.clone());
        let children: Vec<WlSurface> = get_children(surface).into_iter().chain(over_it).collect();
        self.place_a_bubble(surface, drawn);
        for child in children {
            self.place_a_bubble(&child, None);
        }
    }

    /// Announce a subsurface of an app as a bubble once it has drawn, place it
    /// again when it moves or resizes, and forget it once it is no longer a
    /// subsurface.
    ///
    /// `drawn` is the size of a buffer it just committed. Chromium hides a
    /// bubble by destroying its `wl_subsurface` and keeping the surface.
    fn place_a_bubble(&mut self, surface: &WlSurface, drawn: Option<(f64, f64)>) {
        let tracked = self
            .bubbles
            .iter()
            .position(|bubble| bubble.surface == *surface);
        let parent = get_parent(surface)
            .and_then(|parent| self.app_id_of(&parent).map(|app_id| (parent, app_id)));
        match (tracked, parent) {
            (Some(at), None) => {
                let bubble = self.bubbles.remove(at);
                self.by_surface.remove(&bubble.surface);
                debug!(app_id = %bubble.app_id, "bubble hidden -> Host::app_closed");
                self.forget(&bubble.app_id);
            }
            (Some(at), Some((parent, _))) => {
                let bubble = &mut self.bubbles[at];
                let placed = (
                    bubble_position(surface, &parent),
                    drawn.unwrap_or(bubble.placed.1),
                );
                if placed == bubble.placed {
                    return;
                }
                bubble.placed = placed;
                let moved =
                    self.hub
                        .host
                        .lock()
                        .unwrap()
                        .popup_moved(&bubble.app_id, placed.0, placed.1);
                if let Some(message) = moved {
                    self.hub.broadcast(message);
                }
            }
            (None, Some((parent, parent_id))) => {
                let Some(size) = drawn else {
                    return;
                };
                let position = bubble_position(surface, &parent);
                let placed = self
                    .hub
                    .host
                    .lock()
                    .unwrap()
                    .popup_placed(&parent_id, position, size, false);
                if let Some((app_id, message)) = placed {
                    debug!(%app_id, parent = %parent_id, "bubble mapped -> Host::popup_placed");
                    self.by_surface
                        .insert(surface.clone(), (app_id.clone(), Role::Bubble));
                    self.bubbles.push(Bubble {
                        app_id,
                        surface: surface.clone(),
                        parent,
                        placed: (position, size),
                    });
                    self.hub.broadcast(message);
                }
            }
            (None, None) => {}
        }
    }

    /// Log the chrome frame's shape when it changes.
    ///
    /// The engine draws it, so nothing is kept.
    /// `e2e-chrome-fills-the-desktop.sh` reads the size from this line.
    fn publish_chrome_frame(
        &mut self,
        buffer: &wl_buffer::WlBuffer,
        buffer_scale: i32,
        viewport: Viewport,
    ) {
        let texture = committed_buffer(buffer)
            .and_then(|committed| self.texture_from(committed, buffer_scale, viewport));
        // Log on change. The buffer type, size and orientation explain a frame
        // that is the wrong size or upside down.
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
                Some(((width, height), y_inverted, from_dmabuf)) => debug!(
                    width,
                    height,
                    y_inverted,
                    dmabuf = from_dmabuf,
                    scale = buffer_scale,
                    "the chrome committed a frame"
                ),
                None => debug!("the chrome's frame could not be made into a texture"),
            }
        }
    }

    /// Tell the chromes a window's size limits, if they changed.
    ///
    /// Checked on every commit because xdg-shell double-buffers them; they
    /// usually arrive on the first, bufferless commit.
    fn tell_the_size_limits(&mut self, app_id: &str, surface: &WlSurface) {
        let limits = with_states(surface, |states| {
            let mut cached = states.cached_state.get::<SurfaceCachedState>();
            let state = cached.current();
            (
                (state.min_size.w, state.min_size.h),
                (state.max_size.w, state.max_size.h),
            )
        });
        if self.size_limits.get(app_id) == Some(&limits) {
            return;
        }
        self.size_limits.insert(app_id.to_owned(), limits);
        let (min, max) = limits;
        // Collected so the host is unlocked before broadcasting. See
        // `title_changed`.
        let told: Vec<HostMessage> = {
            let mut host = self.hub.host.lock().unwrap();
            let smallest = host.app_min_size(app_id, (f64::from(min.0), f64::from(min.1)));
            let largest = host.app_max_size(app_id, (f64::from(max.0), f64::from(max.1)));
            smallest.into_iter().chain(largest).collect()
        };
        for told in told {
            self.hub.broadcast(told);
        }
    }

    /// Describe a committed buffer, dmabuf or shm.
    fn texture_from(
        &mut self,
        committed: CommittedBuffer,
        buffer_scale: i32,
        viewport: Viewport,
    ) -> Option<SurfaceTexture> {
        let (width, height) = committed.size();
        // The buffer's logical size, which a viewport source rectangle is
        // relative to. Not the surface size, which a viewport destination
        // replaces.
        let (buffer_width, buffer_height) = logical_size((width, height), buffer_scale);
        let _buffer_logical = (f64::from(buffer_width), f64::from(buffer_height));
        let (logical_width, logical_height) =
            surface_size((width, height), buffer_scale, viewport.destination);
        let logical_size = (f64::from(logical_width), f64::from(logical_height));
        match committed {
            CommittedBuffer::Gpu(dmabuf) => Some(SurfaceTexture {
                from_dmabuf: true,
                // GL clients flag a flipped buffer on the dmabuf.
                y_inverted: dmabuf.y_inverted(),
                logical_size,
            }),
            CommittedBuffer::Pixels { .. } => Some(SurfaceTexture {
                from_dmabuf: false,
                // Shm is laid out top-down.
                y_inverted: false,
                logical_size,
            }),
        }
    }

    /// Tell every client which displays its windows and popups are on, and
    /// the scale to draw at.
    ///
    /// Runs when the displays or their scales change. A window the page moves
    /// (`ChromeMessage::SetAppBounds`) and a new popup are placed alone with
    /// [`place_window`](Self::place_window). Smithay only sends
    /// `enter`/`leave` and the preferred scale when they change.
    ///
    /// The chrome's own toplevel only gets its scale here. It belongs on every
    /// output, which `new_toplevel` and
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) enter.
    fn enter_the_displays_each_window_is_on(&self) {
        for (app_id, toplevel) in &self.toplevels {
            self.place_window(toplevel.wl_surface(), self.app_bounds.get(app_id).copied());
        }
        // Known gap: popups are on every display, at the densest scale. The
        // page reports no bounds for them, and they do not follow their
        // parent window's.
        for popup in self.xdg_shell_state.popup_surfaces() {
            self.place_window(popup.wl_surface(), None);
        }
        // The chrome covers every display, so it draws for the densest.
        if let Some(chrome) = &self.chrome_toplevel {
            self.prefer_scale(chrome.wl_surface(), None);
        }
    }

    /// Put `surface` on the displays `bounds` overlaps, at the scale of the one
    /// holding most of it. `None` is every display, at the densest scale.
    fn place_window(&self, surface: &WlSurface, bounds: Option<domicile_scene::Bounds>) {
        self.enter_only(surface, bounds);
        self.prefer_scale(surface, bounds);
    }

    /// Send `wp_fractional_scale_v1.preferred_scale` for a window in `bounds`.
    /// See [`Screens::scale_for`].
    fn prefer_scale(&self, surface: &WlSurface, bounds: Option<domicile_scene::Bounds>) {
        let scale = self.screens.scale_for(bounds);
        with_states(surface, |states| {
            with_fractional_scale(states, |fractional| fractional.set_preferred_scale(scale));
        });
    }

    /// Where the page last put the window `surface` is, if it has said.
    fn bounds_of(&self, surface: &WlSurface) -> Option<domicile_scene::Bounds> {
        match self.by_surface.get(surface) {
            Some((app_id, Role::Toplevel(_))) => self.app_bounds.get(app_id).copied(),
            Some((_, Role::Popup(_) | Role::Bubble)) | None => None,
        }
    }

    /// Enter `surface` on the displays `bounds` reaches and leave the rest.
    ///
    /// Zips outputs positionally with [`Screens::entered_by`]; see the
    /// `outputs` field for why that is safe.
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
        self.by_surface
            .get(surface)
            .map(|(app_id, _)| app_id.clone())
    }

    /// Release everything held for an app (window or popup) and tell the
    /// chromes it is gone.
    /// Starts the `DOMICILE_CAST_WINDOW` cast once a window takes its title.
    ///
    /// For checking the producer without the ScreenCast portal; see
    /// `docs/COMPOSITOR-DEBUGGING.md`. The stream's events are only logged.
    fn cast_if_asked(&mut self, app_id: &str, title: Option<&str>) {
        if self
            .cast_on_title
            .as_ref()
            .is_some_and(|(wanted, _)| Some(wanted.as_str()) == title)
        {
            let (_, casting) = self.cast_on_title.take().expect("checked above");
            info!(%app_id, "casting the window DOMICILE_CAST_WINDOW names");
            casting.start(
                casting::Source::Window(app_id.to_string()),
                casting::CursorMode::Embedded,
                |_| Box::new(|event| info!(?event, "DOMICILE_CAST_WINDOW cast")),
            );
        }
    }

    /// A cast request, from any thread.
    fn cast_requested(&mut self, request: casting::Request) {
        let open = self.cast_candidates();
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
        self.casting.request(request, || open, renderer, capturer);
    }

    /// The windows that can be cast, in the order they opened, then the
    /// monitors.
    fn cast_candidates(&self) -> Vec<casting::Candidate> {
        let host = self.hub.host.lock().unwrap();
        let windows = self.toplevels.iter().map(|(id, toplevel)| {
            let app_id = with_states(toplevel.wl_surface(), |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .and_then(|data| data.lock().unwrap().app_id.clone())
            });
            casting::Candidate {
                source: casting::Source::Window(id.clone()),
                title: host
                    .app(id)
                    .and_then(|app| app.title.clone())
                    .unwrap_or_default(),
                app_id: app_id.unwrap_or_default(),
                bounds: self.app_bounds.get(id).map(|bounds| casting::Region {
                    position: (bounds.min.x.round() as i32, bounds.min.y.round() as i32),
                    size: (
                        (bounds.max.x - bounds.min.x).round() as i32,
                        (bounds.max.y - bounds.min.y).round() as i32,
                    ),
                }),
            }
        });
        windows.chain(self.screens.cast_monitors()).collect()
    }

    /// News from the PipeWire thread.
    fn cast_news(&mut self, news: casting::ToWayland) {
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
        let due = self.casting.news(news, renderer, capturer, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// The pointer moved over `at`'s window box, or left every window.
    fn cast_pointer(&mut self, at: Option<(String, (f64, f64))>) {
        // The same point on the desktop, for monitor and region streams. The
        // compositor knows the pointer only over a window.
        let desk = at.as_ref().and_then(|(app_id, (x, y))| {
            let bounds = self.app_bounds.get(app_id)?;
            Some((bounds.min.x + x, bounds.min.y + y))
        });
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let due = self.casting.pointer(at, desk, renderer, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// The engine captured a frame of a display, for monitor and region
    /// streams.
    fn cast_captured(
        &mut self,
        capture: engine::CaptureId,
        frame: u64,
        captured: Result<engine::CapturedFrame, String>,
    ) {
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let Some(session) = self.engine.as_mut() else {
            return;
        };
        let due =
            self.casting
                .captured(capture, frame, captured, renderer, session, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// A test pattern frame for each running capture, when no engine
    /// captures the displays.
    fn cast_the_test_pattern(&mut self) {
        let frames = match (&self.engine, self.cast_test_pattern.as_mut()) {
            (None, Some(pattern)) => pattern.frames(),
            _ => return,
        };
        for (capture, frame, captured) in frames {
            let renderer = self.gpu.as_mut().map(Gpu::renderer);
            let pattern = self.cast_test_pattern.as_mut().expect("checked above");
            let due = self.casting.captured(
                capture,
                frame,
                Ok(captured),
                renderer,
                pattern,
                Instant::now(),
            );
            self.arm_the_cast_deadline(due);
        }
    }

    /// The monitors changed, so monitor and region streams follow.
    fn tell_the_casts_the_screens(&mut self) {
        let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
        self.casting.screens(self.screens.cast_screens(), capturer);
        self.cast_the_monitor_if_asked();
    }

    /// Starts the `DOMICILE_CAST_MONITOR` cast once that monitor is plugged
    /// in, or at once for a region.
    ///
    /// For checking monitor and region casts without the ScreenCast portal;
    /// see `docs/COMPOSITOR-DEBUGGING.md`. The stream's events are only
    /// logged.
    fn cast_the_monitor_if_asked(&mut self) {
        let ready = self.cast_on_monitor.as_ref().is_some_and(|(spec, _)| {
            match casting::Source::desk(spec) {
                casting::Source::Monitor(name) => {
                    self.screens.outputs().any(|output| output.name == name)
                }
                _ => true,
            }
        });
        if ready {
            let (spec, casting) = self.cast_on_monitor.take().expect("checked above");
            info!(%spec, "casting what DOMICILE_CAST_MONITOR names");
            casting.start(
                casting::Source::desk(&spec),
                casting::CursorMode::Embedded,
                |_| Box::new(|event| info!(?event, "DOMICILE_CAST_MONITOR cast")),
            );
        }
    }

    /// Hands a window's committed frame to its casts. `crop` is the engine's:
    /// `(0, 0, 0, 0)` is the whole buffer.
    fn cast_frame(
        &mut self,
        app_id: &str,
        buffer: &wl_buffer::WlBuffer,
        crop: (i32, i32, i32, i32),
        scale: i32,
        damage: Option<Region>,
    ) {
        let crop = match (crop, committed_buffer(buffer)) {
            ((_, _, 0, 0), Some(committed)) => {
                let (width, height) = committed.size();
                (0, 0, width as i32, height as i32)
            }
            (crop, _) => crop,
        };
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let due = self.casting.committed(
            casting::Committed {
                app_id,
                buffer,
                crop,
                scale,
                damage: damage.map(|region| {
                    (
                        region.x as i32,
                        region.y as i32,
                        region.width as i32,
                        region.height as i32,
                    )
                }),
            },
            renderer,
            Instant::now(),
        );
        self.arm_the_cast_deadline(due);
    }

    /// Wakes the loop when a paced cast frame is due, unless a wake is armed.
    fn arm_the_cast_deadline(&mut self, due: Option<Instant>) {
        let Some(due) = due else {
            return;
        };
        if self.cast_deadline.is_some() {
            return;
        }
        let armed = self
            .loop_handle
            .insert_source(Timer::from_deadline(due), |_, _, data: &mut CalloopData| {
                let state = &mut data.state;
                state.cast_deadline = None;
                let due = state.casting.tick(Instant::now());
                state.arm_the_cast_deadline(due);
                TimeoutAction::Drop
            })
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
        self.cast_deadline = Some(armed);
    }

    fn forget(&mut self, app_id: &str) {
        // Take back the engine's held buffers now. No release will come for a
        // gone surface, and the client may still be running.
        let abandoned = self
            .engine
            .as_mut()
            .map(|session| session.window_gone(app_id))
            .unwrap_or_default();
        for release in abandoned {
            self.returned(release.buffer);
        }
        // All of viz's buffers came back above, so the uploads can go.
        self.uploads.forget(app_id);
        self.configure_answers.remove(app_id);
        self.shown.missed(app_id);
        self.size_limits.remove(app_id);
        self.app_bounds.remove(app_id);
        self.casting.window_gone(app_id);
        // An app id can return (a reconnecting client), but it then names a
        // different window.
        if self.pointer_app.as_deref() == Some(app_id) {
            self.pointer_app = None;
        }
        debug!(%app_id, "gone -> Host::app_closed");
        broadcast_closed(&self.hub, app_id);
    }

    /// The window a popup is over, however many popups deep: the app id of
    /// the toplevel at the bottom of its chain.
    fn window_under(&self, popup: &PopupSurface) -> Option<String> {
        let mut parent = popup.get_parent_surface()?;
        loop {
            match self
                .popups
                .iter()
                .find(|(_, popup)| *popup.wl_surface() == parent)
            {
                Some((_, popup)) => parent = popup.get_parent_surface()?,
                None => return self.app_id_of(&parent),
            }
        }
    }

    /// Release the buttons held over another window before a press over this
    /// one.
    ///
    /// The page forwards a release only over the window's own element, so a
    /// button let go over the shell never reaches the seat. Smithay keeps the
    /// pointer on the pressed surface until every button is up, and keeps
    /// counting the button after that surface is gone, so the next press
    /// anywhere would hold the pointer for good.
    fn let_go_of_lost_presses(&mut self) {
        let pointer = self.seat.get_pointer().unwrap();
        let holder = pointer
            .grab_start_data()
            .and_then(|grab| grab.focus)
            .map(|(surface, _)| surface);
        let target = self
            .pointer_app
            .as_deref()
            .and_then(|app_id| self.surface_for(app_id));
        if self.held_buttons.is_empty() || holder == target {
            return;
        }
        debug!(buttons = ?self.held_buttons, "a press elsewhere -> releasing lost presses");
        for button in std::mem::take(&mut self.held_buttons) {
            self.pointer_button(button, ButtonState::Released);
        }
        // The grab kept the pointer on the holder, so enter the window the
        // press is over. The location is already local to it; see
        // `ClientRequest::PointerMotion`.
        let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
        let location = pointer.current_location();
        pointer.motion(
            self,
            target.map(|surface| (surface, (0.0, 0.0).into())),
            &MotionEvent {
                location,
                serial,
                time,
            },
        );
        pointer.frame(self);
    }

    /// Send one pointer button change to the seat.
    fn pointer_button(&mut self, button: u32, state: ButtonState) {
        let pointer = self.seat.get_pointer().unwrap();
        let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
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

    /// Every grabbing popup dismissed, innermost first, as xdg-shell wants.
    fn dismiss_the_menus(&mut self) {
        for menu in self.grabbing.drain(..).rev() {
            menu.send_popup_done();
        }
    }

    /// A buffer the engine let go of goes back to whoever owns it: the client,
    /// as a `wl_buffer.release`, or the pool of the compositor's own.
    fn returned(&mut self, buffer: Submitted) {
        match buffer {
            Submitted::Client(buffer) => buffer.release(),
            Submitted::Upload(id) => self.uploads.give_back(id),
        }
    }

    /// Run the engine's pending work and act on its events.
    ///
    /// Called only from the engine's calloop source, because the ABI's
    /// callbacks fire inside `dispatch`. `dh` is needed to create `wl_output`s
    /// when a display list rearranges the desktop.
    fn pump_the_engine(&mut self, dh: &DisplayHandle) {
        let Some(session) = self.engine.as_mut() else {
            return;
        };
        let (events, releases) = session.dispatch();
        // Take back buffers viz held past the deadline. A single-buffered
        // client cannot draw otherwise; tearing once and logging it is better
        // than freezing it.
        let overdue = session.overdue(Instant::now());

        for release in releases.into_iter().chain(overdue) {
            match release.why {
                Returned::Released => {}
                // Include the app id: if only one window's buffers expire, viz
                // is probably not drawing that surface.
                Returned::Expired => {
                    // Separate messages so `app_id` only ever holds an app id.
                    // `window_gone` drops all holds when it forgets an app, so
                    // an unclaimed expiry means the window went first.
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
            self.returned(release.buffer);
        }

        for event in events {
            match event {
                // The page's layout box changed. Send `xdg_toplevel.configure`
                // with the new size.
                engine::Event::Configure {
                    surface,
                    width,
                    height,
                    scale,
                    number,
                } => {
                    let app_id = self
                        .engine
                        .as_ref()
                        .and_then(|session| session.app_for(surface))
                        .map(str::to_owned);
                    let Some(app_id) = app_id else {
                        continue;
                    };
                    // Now embedded, so a frame committed earlier can be shown.
                    // Often a popup's only frame.
                    let waited = self
                        .engine
                        .as_mut()
                        .map(|session| session.show_what_was_waiting(surface, Instant::now()));
                    match waited {
                        Some(Ok(true)) => self.frame_shown(&app_id),
                        Some(Err(refused)) => {
                            warn!(%app_id, "the engine would not take the frame that waited for this window");
                            self.returned(refused.buffer);
                        }
                        Some(Ok(false)) | None => {}
                    }
                    // A popup's size comes from its positioner, not the page.
                    if self.popups.iter().any(|(id, _)| *id == app_id) {
                        continue;
                    }
                    let Some(toplevel) = self.toplevel_for(&app_id) else {
                        tracing::debug!(%app_id, "the engine configured an app with no toplevel");
                        continue;
                    };
                    // The engine sends device pixels; a configure is logical.
                    // Unconverted, a window on a 1.2x display draws 1.2x too
                    // small.
                    //
                    // Use the scale the engine sends with the box. The reported
                    // ratio is a fallback for older engines.
                    let device_size = (width, height);
                    let (width, height) = crate::scale::logical_box(
                        device_size,
                        scale.unwrap_or(self.device_pixel_ratio),
                    );
                    tracing::debug!(%app_id, width, height, "engine configure -> client");
                    toplevel.with_pending_state(|state| {
                        state.size = Some((width as i32, height as i32).into());
                    });
                    match number {
                        // Sent even at an unchanged size, so the client's
                        // commit names the new box and the page stops waiting
                        // for it.
                        Some(number) => {
                            let serial = toplevel.send_configure();
                            self.configure_answers
                                .entry(app_id)
                                .or_insert_with(ConfigureAnswers::new)
                                .sent(serial, number, device_size);
                        }
                        // Sends only if the size differs from the last
                        // acknowledged configure.
                        None => {
                            toplevel.send_pending_configure();
                        }
                    }
                }
                // `wl_surface.frame` is sent at commit. Driving it from viz
                // would change every client's frame rate.
                engine::Event::Frame { .. } => {}
                // Handled above, with the buffers.
                engine::Event::Released { .. } => {}
                engine::Event::Captured {
                    capture,
                    frame,
                    captured,
                } => self.cast_captured(capture, frame, captured),
                engine::Event::CaptureEnded { capture } => {
                    let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
                    self.casting.capture_ended(capture, capturer);
                }
                // A copy in a page or browser window. The browser is not our
                // Wayland client, so this is how its copies reach the seat and
                // the desktop has one clipboard.
                //
                // The engine is not told back; it already has the copy.
                engine::Event::Copied { clipboard, text } => {
                    self.took_a_copy(clipboard, text);
                    // Set the seat's selection, so Wayland clients can paste
                    // it.
                    match clipboard {
                        Clipboard::Copy => {
                            set_data_device_selection(
                                &self.display_handle,
                                &self.seat,
                                text_mimes(),
                                Holder::Desk(clipboard),
                            );
                            self.hub.portals.selection_changed(text_mimes(), None);
                        }
                        Clipboard::Primary => set_primary_selection(
                            &self.display_handle,
                            &self.seat,
                            text_mimes(),
                            Holder::Desk(clipboard),
                        ),
                    }
                }
                // The engine holds DRM master, so on a tty this is the only
                // monitor report. `replugged_into` decides whether the engine
                // defines the desktop. `adopt_the_desktop` does nothing for an
                // unchanged list, which a modeset-triggered hotplug reports.
                engine::Event::Displays(displays) => {
                    // Kept so a config reload can match against the plugged-in
                    // monitors. Always the full list; anything absent is
                    // unplugged.
                    self.engine_displays = displays.clone();
                    match self.screens.replugged_into(
                        &displays,
                        &self.config.current().output,
                        &self.vendors,
                    ) {
                        // The config describes the desktop and DRM does not
                        // override it. A monitor that arrives while the screens
                        // are dark comes up lit, so darken it again.
                        Ok(None) => self.keep_the_screens_dark(),
                        // `adopt_the_desktop` sets every connector's power,
                        // dark ones included.
                        Ok(Some(screens)) => self.adopt_the_desktop(dh, screens),
                        // A matching profile cannot be applied. Keep the
                        // current desktop, as `ConfigStore` does for an
                        // unparseable edit, and name the config problem.
                        Err(err) => {
                            tracing::warn!(
                                %err,
                                "the profile these monitors matched cannot be applied to them; \
                                 keeping the desktop that is up"
                            );
                            // Keep it dark too; the unplaced monitor came up
                            // lit.
                            self.keep_the_screens_dark();
                        }
                    }
                }
            }
        }
    }

    /// Send one key through the seat to the focused client.
    ///
    /// Shared by chrome keys and the latency run, so the measurement uses the
    /// real input path.
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
        // Drop releases for keys the seat does not hold. With several monitors,
        // every page forwards every release it hears, since the release may
        // reach a different page than the press.
        if !pressed && !keyboard.pressed_keys().contains(&key) {
            return;
        }
        keyboard.input::<(), _>(self, key, state, serial, time, |_, _, _| {
            FilterResult::Forward
        });
    }

    /// Record a commit for the keystroke-to-pixel run, if one is going.
    ///
    /// Called on the commit path because a round ends with the client's
    /// answering commit, which only arrives here. See `latency.rs` for the
    /// measurements. Off unless `DOMICILE_SPIKE_LATENCY` is set.
    fn drive_latency(&mut self, app_id: &str, committed: Instant, held: bool) {
        let (Some(_), Some(budget)) = (spike_latency_point(), spike_latency_budget()) else {
            return;
        };
        // Start only once the engine has taken a frame. Before that the probe
        // refuses instantly, and the floor would spend its budget in one
        // callback and end as `ProbeWentDark`.
        if !held {
            return;
        }
        // Measure only the first app to commit, so a second window does not add
        // commits to rounds its keys did not cause.
        if self.latency_app.get_or_insert_with(|| app_id.to_string()) != app_id {
            return;
        }
        // Taken out and put back; a dropped run restarts from an empty floor.
        let frame = self.display_interval();
        let mut run = self
            .latency
            .take()
            .unwrap_or_else(|| Latency::new(budget, frame));
        // Use the caller's timestamp from before `publish_frame`, so the import
        // and submit count in `commit_to_pixel`, not the client's time.
        run.committed(committed);
        self.latency = Some(run);
        // Sampling happens in `step_the_latency`, not here.
    }

    /// Run one step of the latency run, then return to the event loop.
    ///
    /// Must not loop. Everything runs on one calloop thread, so a polling loop
    /// here would block engine releases and frame callbacks, and a client that
    /// needs a second commit could never answer. The round would be wrongly
    /// blamed on the client. A timer in `main` calls this again.
    ///
    /// Each `Sample` step blocks this thread for one `CopyOutputRequest`
    /// readback. It cannot deadlock: `SamplePixel` waits while the engine's
    /// thread runs a nested loop.
    ///
    /// The probe point must not repaint by itself (e.g. a blinking cursor), or
    /// the floor never settles and the run ends `NeverSettled`.
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
                // Focus every round, in case something else moved the keyboard.
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
                    // `next` already started this round, and only a commit
                    // answering the key can end it. Give the round up instead
                    // of waiting forever with no report.
                    None => {
                        warn!(
                            ?app_id,
                            "the latency run has no surface to press a key into; \
                             giving the round up"
                        );
                        run.press_went_nowhere();
                    }
                }
                // Return so the client can redraw.
                false
            }
            LatencyStep::Wait => false,
        };
        self.latency = Some(run);
        self.report_latency();
        wants_more
    }

    /// The display frame interval the latency run assumes.
    ///
    /// Assumed 60Hz; viz's real interval is not reachable from here. The
    /// measured floor is reported alongside, for calibration.
    fn display_interval(&self) -> Duration {
        Duration::from_secs_f64(1000.0 / f64::from(SPIKE_REFRESH_MHZ))
    }

    /// Log the run's results once, in the format the guard reads.
    fn report_latency(&mut self) {
        if self.latency_reported {
            return;
        }
        let Some(report) = self.latency.as_ref().and_then(Latency::report) else {
            return;
        };
        self.latency_reported = true;
        let interval = self.display_interval();
        // Text comes from `Spread::line`, tested there because the guard greps
        // it.
        let say = |what: &str, spread: Option<&latency::Spread>| match spread {
            Some(spread) => tracing::info!(
                target: "domicile::engine::spike",
                "{}", spread.line(what, interval)
            ),
            // Log missing data explicitly, so it cannot be mistaken for a fast
            // result.
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
        // Separate from how the run ended: a run that never settled has no
        // rounds, and "0 abandoned" alone would look clean.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) abandoned by the client",
            report.abandoned
        );
        // Rounds discarded because the probe pixel changed before the client
        // answered: an older frame reached the screen. Always logged, since the
        // median excludes them.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose pixel moved before the client answered",
            report.moved_before_commit
        );
        // Rounds where the commit came too long after the key to be its answer.
        // Always logged.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose commit came too late to be the key's answer",
            report.answered_too_late
        );
        // Commits too soon after the key to answer it (a frame already in
        // flight). The round keeps waiting, so these count commits, not rounds.
        // Always logged.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} commit(s) passed over for coming too soon to be the key's answer",
            report.answered_too_soon
        );
        // Rounds the client answered with more than one frame. `commit to
        // pixel` is timed from the first, so a high count means some of the
        // client's own redraw is counted as ours. Always logged.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) where the client drew again while polling",
            report.redrew_while_polling
        );
        // Keys we failed to deliver. Kept separate from client failures so the
        // fault is attributed correctly.
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

    /// Show this app's frame and report what happened to the client's buffer.
    ///
    /// [`Published::Held`] means viz is sampling the client's dmabuf and the
    /// caller must not release it. Otherwise the caller releases it.
    ///
    /// Every frame reaches the engine as a dmabuf; shm frames are copied first
    /// (see [`crate::uploads`]).
    fn publish_frame(&mut self, app_id: &str, commit: &Commit) -> Published {
        let Some(committed) = committed_buffer(commit.buffer) else {
            return Published::NotShown;
        };
        if self.engine.is_none() {
            return Published::NotShown;
        }
        let damage = self.shown.damage(
            app_id,
            engine_damage::Next {
                damage: commit.damage,
                at_box: commit.at_box,
                box_size: commit.box_size,
                crop: commit.sampled.crop,
                buffer: committed.size(),
            },
        );
        let published = match &committed {
            CommittedBuffer::Gpu(dmabuf) => {
                let published = self.submit_to_the_engine(
                    app_id,
                    Submitted::Client(commit.buffer.clone()),
                    &descriptor_from(dmabuf),
                    commit,
                    damage,
                    Published::Held,
                );
                if published != Published::NotShown {
                    self.casting.shown(
                        app_id,
                        casting::Shown {
                            dmabuf: dmabuf.clone(),
                            crop: commit.sampled.crop,
                        },
                    );
                }
                published
            }
            CommittedBuffer::Pixels { .. } => self.publish_shm_frame(app_id, commit, damage),
        };
        if matches!(published, Published::Held | Published::Copied { .. }) {
            self.frame_shown(app_id);
        }
        published
    }

    /// Submit `submitted` as `app_id`'s frame, damaging `damage` (see
    /// [`crate::engine_damage`]). Returns `shown` if the engine took it,
    /// [`Published::NotShown`] if not.
    fn submit_to_the_engine(
        &mut self,
        app_id: &str,
        submitted: Submitted,
        descriptor: &DmabufDescriptor,
        commit: &Commit,
        damage: (i32, i32, i32, i32),
        shown: Published,
    ) -> Published {
        let Some(session) = self.engine.as_mut() else {
            return Published::NotShown;
        };
        match session.submit(
            app_id,
            submitted,
            descriptor,
            commit.sampled,
            damage,
            commit.at_box,
            Instant::now(),
        ) {
            Submission::Taken => shown,
            Submission::Waiting { replaced } => {
                if let Some(buffer) = replaced {
                    self.returned(buffer);
                }
                Published::Waiting {
                    held: shown == Published::Held,
                }
            }
            Submission::Refused => Published::NotShown,
        }
    }

    /// Copy an shm client's frame into a compositor buffer and submit that.
    ///
    /// Never [`Published::Held`]: the client's buffer is free once copied. A
    /// failed copy is logged once per client, so a blank window always has an
    /// explanation.
    fn publish_shm_frame(
        &mut self,
        app_id: &str,
        commit: &Commit,
        damage: (i32, i32, i32, i32),
    ) -> Published {
        let copied = match self.copy_shm_frame(app_id, commit) {
            Ok(copied) => copied,
            Err(why) => {
                if self.shm_refused.insert(app_id.to_string()) {
                    warn!(app_id, %why, "this client's window will be blank");
                }
                return Published::NotShown;
            }
        };
        let published = self.submit_to_the_engine(
            app_id,
            Submitted::Upload(copied.id),
            &copied.descriptor,
            commit,
            damage,
            Published::Copied {
                fourcc: copied.fourcc,
            },
        );
        if published == Published::NotShown {
            // Never reached viz, so nothing will release it.
            self.uploads.give_back(copied.id);
        } else {
            let dmabuf = self
                .uploads
                .get(copied.id)
                .expect("a buffer the engine holds is there")
                .clone();
            self.casting.shown(
                app_id,
                casting::Shown {
                    dmabuf,
                    crop: commit.sampled.crop,
                },
            );
        }
        published
    }

    /// Copy the commit's buffer into a free buffer of `app_id`'s.
    ///
    /// The client's pixels reach the GPU through a texture kept on the
    /// surface, so only the damage is uploaded while it holds the previous
    /// commit.
    ///
    /// The buffer comes back taken; the caller gives it back if the engine
    /// does not take it.
    fn copy_shm_frame(&mut self, app_id: &str, commit: &Commit) -> Result<CopiedFrame, ShmRefused> {
        let gpu = self.gpu.as_mut().ok_or(ShmRefused::NoRenderer)?;
        let gbm = gpu.gbm.as_ref().ok_or(ShmRefused::NoAllocator)?;
        let shape = shm_shape(commit.buffer).ok_or(ShmRefused::Unreadable)?;
        let modifiers = render_modifiers(&gpu.renderer, shape.fourcc);
        let taken = self
            .uploads
            .take(app_id, shape, |shape| gbm.allocate(shape, &modifiers))?;
        if let Some(session) = self.engine.as_mut() {
            for dropped in &taken.dropped {
                session.upload_dropped(*dropped);
            }
        }
        let target = self
            .uploads
            .get_mut(taken.id)
            .expect("a buffer just taken is there");
        let size = (shape.width as i32, shape.height as i32).into();
        let damage = shm_upload::uploaded(
            commit.damage,
            self.shown.texture_is_current(app_id, shape.fourcc),
            (shape.width, shape.height),
        );
        let copied = with_states(commit.surface, |states| {
            shm_upload::import(&mut gpu.renderer, commit.buffer, states, shape, &damage)
        })
        .map_err(CopyError::from)
        .and_then(|texture| shm_upload::copy(&mut gpu.renderer, &texture, target, size));
        match copied {
            Ok(()) => Ok(CopiedFrame {
                id: taken.id,
                descriptor: descriptor_from(target),
                fourcc: shape.fourcc,
            }),
            Err(err) => {
                self.uploads.give_back(taken.id);
                Err(ShmRefused::Copy(err))
            }
        }
    }

    /// Run after the engine takes a frame: log the first frame, and run the
    /// spike probes.
    fn frame_shown(&mut self, app_id: &str) {
        // Check before inserting, to avoid allocating a `String` every frame.
        if !self.first_frame_logged.contains(app_id) {
            self.first_frame_logged.insert(app_id.to_string());
            debug!(app_id, "the engine took this app's first frame");
        }
        // Temporary spike probes. Only the compositor can ask viz what it drew.
        // Results are logged because shell scripts check them.
        //
        // Throttled, and checked before borrowing the session.
        const PROBE_EVERY: Duration = Duration::from_millis(250);
        // `match` rather than `is_none_or`, which is newer than this crate's
        // MSRV, or `map_or(true, ..)`, which clippy rewrites into it.
        let due = match self.last_probe {
            None => true,
            Some(at) => at.elapsed() >= PROBE_EVERY,
        };
        if !due {
            return;
        }
        self.last_probe = Some(Instant::now());
        let Some(session) = self.engine.as_ref() else {
            return;
        };
        // Find colors anywhere in the window, for guards that cannot name a
        // point because the shell places windows.
        //
        // Search until every color is found and no box moved between two
        // rounds. A window still painting is smaller than it will be, and the
        // guard measures coverage.
        //
        // Then stop. Each search is a ~3 MB blocking readback, longer than
        // `HeldBuffers`' 500ms deadline, so searching forever would expire
        // held buffers.
        const FIND_EVERY: Duration = Duration::from_secs(2);
        // Wall-clock budget, since guards start polling after an unpredictable
        // setup. Longer than any guard's run.
        const FIND_FOR: Duration = Duration::from_secs(300);
        let find_due = match self.last_find {
            None => true,
            Some(at) => at.elapsed() >= FIND_EVERY,
        };
        if find_due && !spike_find_colors().is_empty() && !self.find_settled {
            // Starts at the first search, which is the first engine-accepted
            // client frame. Waiting for a client does not spend the budget.
            let since = *self.find_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= FIND_FOR {
                // Logged once, so a guard can tell "not found" from "stopped
                // looking".
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
                            // Logged when it changes, so a still-painting page
                            // logs each move.
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
                        // Logged once; this is the usual state for most of a
                        // run.
                        Some(Capture {
                            window: (w, h),
                            bounds: None,
                        }) => {
                            every_color_found = false;
                            // Forget the box, so found-absent-found cannot
                            // settle against a reading two rounds old.
                            self.probe_boxes.remove(&argb);
                            if self.probe_missing.insert(argb) {
                                tracing::info!(
                                    target: "domicile::engine::spike",
                                    "engine has not drawn #{argb:08X} anywhere in the browser's \
                                     {w}x{h} window yet"
                                );
                            }
                        }
                        // Separate from `probe_missing`, so a transient
                        // unreadable capture cannot silence the "has not drawn"
                        // line that negative controls grep for.
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
                // Logged because guards cannot infer it: boxes are logged only
                // when they move, so a quiet log does not prove the search ran.
                if every_color_found && nothing_moved {
                    self.find_settled = true;
                    tracing::info!(
                        target: "domicile::engine::spike",
                        "engine settled: every color it was looking for held still"
                    );
                }
            }
            // Stamp after capturing, so the interval is a gap between readbacks
            // even when a capture is slow.
            self.last_find = Some(Instant::now());
        }

        // Skipped during a latency run. This capture forces a draw and waits on
        // the submit path, inside the `commit_to_pixel` window. It would double
        // each round's cost and fail the guard's ratio.
        if spike_center_probe()
            && spike_probe_points().is_empty()
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
                    // Logged once per point. A silent probe looks the same as a
                    // page that drew nothing, but the causes differ (missing
                    // symbol or out-of-window point, versus the seam).
                    None => {
                        if self.probe_refused.insert((x, y)) {
                            // Probe the center to tell the causes apart.
                            // `SamplePixel` refuses both a point outside the
                            // window and an undrawn window (empty bitmap). The
                            // center is always inside, so an answer there means
                            // the point is out of bounds.
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
    }

    /// Advertise a new output scale, so clients redraw at the screen's
    /// resolution.
    ///
    /// Applies only to a window-following desktop; a described desktop sets its
    /// own scale.
    fn set_output_scale(&mut self, scale: i32) {
        if !self.screens.follows_the_window() {
            // Logged because the refusal is otherwise invisible, to users and
            // to tests.
            debug!(scale, "{}", grepped::DENSITY_REFUSED);
            return;
        }
        let logical = self.screens.size();
        self.set_output(logical, scale);
    }

    /// Advertise a new desktop size reported by the chrome.
    ///
    /// Like `set_output_scale`, refused (and logged) on a described desktop:
    /// resizing Domicile's window then shows more or less of the configured
    /// screens. The scale is kept.
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

    /// Advertise the desktop's size and scale together, since a mode is both.
    ///
    /// Only for a window-following desktop, which has one output. On a
    /// described desktop it would leave `self.screens` and `self.outputs`
    /// disagreeing. Callers guard this and it is asserted.
    fn set_output(&mut self, logical: (i32, i32), scale: i32) {
        assert!(
            self.screens.follows_the_window(),
            "a described desktop is the config's, not this function's to replace"
        );
        // Read both from `Screens`, the single source for size and scale.
        let advertised = self
            .screens
            .outputs()
            .next()
            .expect("a window-following desktop advertises its one output");
        if self.screens.size() == logical && advertised.wl_output_scale() == scale {
            return;
        }
        debug!(
            width = logical.0,
            height = logical.1,
            scale,
            "{}",
            grepped::ADVERTISING
        );
        self.screens = Screens::following_the_window(logical, scale);
        self.tell_the_casts_the_screens();
        // The mode is in physical pixels, so it grows with the scale to keep
        // the logical size. Read from the new `Screens`.
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
        // Clients that draw at a fractional scale read it from here, not from
        // the output.
        self.enter_the_displays_each_window_is_on();
        // Re-send the existing configure to prompt clients to redraw at the new
        // scale.
        for (_, toplevel) in &self.toplevels {
            toplevel.send_configure();
        }
        // The chrome covers the desktop, so it must be resized with it.
        if let Some(chrome) = self.chrome_toplevel.clone() {
            chrome.with_pending_state(|state| {
                state.size = Some(logical.into());
            });
            chrome.send_configure();
        }
        // Update the display list the chrome lays out against (`<Screen>`
        // positions). Store it for chromes that connect later and broadcast it
        // to connected ones.
        //
        // Describe then broadcast, on this thread. [`freshened`] relies on that
        // order.
        let desktop = {
            let mut host = self.hub.host.lock().unwrap();
            host.describe_displays(self.screens.outputs().map(Advertised::described).collect());
            host.describe_desktop()
        };
        self.hub.broadcast(desktop);
        self.hub
            .portals
            .displays(self.screens.outputs().map(Zone::from).collect());
    }

    /// Apply a desktop the config now describes, keeping displays that stayed.
    ///
    /// The only path that can add or remove displays. Works for either kind of
    /// desktop, including a config that stopped describing one.
    ///
    /// Does nothing if the desktop is unchanged, since config files are
    /// rewritten often and editors' atomic saves fire several events.
    ///
    /// Only handles displays.
    /// [`adopt_the_rest_of_the_config`](DomicileCompositor::adopt_the_rest_of_the_config)
    /// runs right after for the rest; [`crate::restatement`] lists which field
    /// takes which path.
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
        // Move all old outputs out first; the new list takes those it keeps,
        // and the rest are retired.
        let mut had: Vec<Option<LiveOutput>> = self.outputs.drain(..).map(Some).collect();
        let outputs: Vec<LiveOutput> = plan
            .slots
            .iter()
            .zip(screens.outputs())
            .map(|(slot, advertised)| match slot {
                Slot::Kept(index) => {
                    // Unreachable: display names are unique
                    // (`OutputConfig::validate`), and `rearranged_into` matches
                    // by name. Asserted so one `wl_output` is never advertised
                    // as two displays.
                    let live = had[*index]
                        .take()
                        .expect("no two displays share one output");
                    restate_output(&live.output, advertised);
                    live
                }
                Slot::New => advertise_output(dh, advertised),
            })
            .collect();
        // `retired` holds exactly the indices no slot kept, so loop order does
        // not matter.
        for retired in plan.retired {
            let live = had[retired]
                .take()
                .expect("a retired output is one no slot kept");
            // Remove the global. Dropping only the `Output` would leave it
            // advertised for the rest of the run.
            dh.remove_global::<DomicileCompositor>(live.global);
        }
        self.outputs = outputs;
        self.screens = screens;
        self.tell_the_casts_the_screens();
        // Tell the engine, which holds DRM master, which connectors to light. A
        // profile that turns a panel off needs the panel actually turned off.
        //
        // Sent on every adoption, even an empty list, which undoes a profile
        // whose displays are unplugged (see `Screens::scanout`).
        //
        // Through `state_the_connectors` so a blanked desktop stays blanked
        // through reloads and hotplugs.
        self.state_the_connectors();
        // The chrome is on every display, so tell it about new ones. Toolkits
        // pick their density from this.
        if let Some(chrome) = self.chrome_toplevel.clone() {
            for live in &self.outputs {
                live.output.enter(chrome.wl_surface());
            }
            // Resize it to the new desktop. Always sent, because the desktop
            // can change (a rename, a scale) without its bounding box changing.
            // A repeated configure is a no-op.
            chrome.with_pending_state(|state| {
                state.size = Some(self.screens.size().into());
            });
            chrome.send_configure();
        }
        // Displays may have moved under windows that did not.
        self.enter_the_displays_each_window_is_on();
        // Prompt clients to redraw at any new scale.
        for (_, toplevel) in &self.toplevels {
            toplevel.send_configure();
        }
        // Describe then broadcast on this thread, as in `set_output`.
        let desktop = {
            let mut host = self.hub.host.lock().unwrap();
            host.describe_displays(self.screens.outputs().map(Advertised::described).collect());
            host.describe_desktop()
        };
        self.hub.broadcast(desktop);
        self.hub
            .portals
            .displays(self.screens.outputs().map(Zone::from).collect());
    }

    /// Join an engine that replaced the current one, and restore what the old
    /// one knew.
    ///
    /// The compositor outlives its engine: `domicile-launch` can start a new
    /// engine under a running compositor (`domicile_launch::restart`), and
    /// clients keep their connection and windows. [`EngineSession::reconnect`]
    /// handles what the old browser created.
    ///
    /// Does nothing when the same engine's page reloads (`domicile
    /// load-shell`); see [`another_engine`].
    ///
    /// If the dial fails, it is logged and the session is kept. Held buffers
    /// are returned either way, and the next page hello retries.
    fn rejoin_the_engine(&mut self, served_by: Option<i32>) {
        let replaced = another_engine(self.engine_process, served_by);
        // Record the serving process for later hellos. Keep the old one if the
        // kernel gave no credential.
        self.engine_process = served_by.or(self.engine_process);
        if !replaced || self.engine.is_none() {
            return;
        }
        warn!(
            served_by,
            "the engine this desktop was drawing through has been replaced; rejoining it"
        );
        // The old engine's captures are gone with it.
        self.casting.engine_replaced();
        let session = self
            .engine
            .as_mut()
            .expect("a desktop with no engine has nothing to rejoin, and said so above");
        // The dmabuf is reference-counted, and the session holds the client's
        // buffer, so its fds are still valid. shm windows resubmit their
        // compositor-owned copy.
        let uploads = &self.uploads;
        let rejoined = session.reconnect(
            &|submitted| match submitted {
                Submitted::Client(buffer) => match committed_buffer(buffer) {
                    Some(CommittedBuffer::Gpu(dmabuf)) => Some(descriptor_from(&dmabuf)),
                    Some(CommittedBuffer::Pixels { .. }) | None => None,
                },
                Submitted::Upload(id) => uploads.get(*id).map(descriptor_from),
            },
            Instant::now(),
        );
        match &rejoined.dialed {
            Ok(()) => {
                self.watch_the_engines_fd();
                // The new engine numbers its boxes afresh, and shows none of
                // the old one's frames.
                self.configure_answers.clear();
                self.shown.clear();
                // The new engine does not know the profile, and
                // `Screens::replugged_into` ignores an unchanged list, so
                // restate the connectors or disabled ones come back lit.
                self.state_the_connectors();
                // The new browser starts with empty clipboards, so restore
                // them.
                self.tell_the_engine_the_copies();
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
        // Return every buffer the old engine held, joined or not. A client owed
        // a release never draws again.
        for release in rejoined.releases {
            self.returned(release.buffer);
        }
    }

    /// Watch the current engine's fd, and stop watching the previous one.
    ///
    /// The old fd is closed with its engine, and a source left on it would
    /// spin.
    fn watch_the_engines_fd(&mut self) {
        if let Some(watching) = self.engine_source.take() {
            self.loop_handle.remove(watching);
        }
        let Some(session) = self.engine.as_ref() else {
            return;
        };
        match poll_the_engine(&self.loop_handle, session.fd()) {
            Ok(watching) => self.engine_source = Some(watching),
            // Logged, not fatal. Without the watch nothing from the engine is
            // heard, but ending every client over it would defeat the
            // compositor outliving its engine.
            Err(err) => error!(
                %err,
                "the engine's fd could not be watched, so nothing it says will be heard; \
                 this desktop is still serving its clients and has to be restarted to draw"
            ),
        }
    }

    /// Tell the engine which connectors to light.
    ///
    /// Awake: [`Screens::scanout`] (a profile's connectors, or empty for no
    /// opinion). Dark: every reported connector, turned off. An empty list
    /// would light everything, so an empty [`crate::idle::darkened`] is not
    /// sent.
    fn state_the_connectors(&self) {
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
    fn the_screens_are_dark(&self) -> bool {
        self.idle.as_ref().is_some_and(Idle::dark)
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
    fn tell_the_chromes_whether_anybody_is_here(&self) {
        self.hub.broadcast(announced(self.the_screens_are_dark()));
    }

    /// Tell a new chrome whether the desktop is idle.
    ///
    /// Silent if the desktop never blanks, so the shell does not show idle UI
    /// that can never trigger. A blanking desktop sends `false` even when
    /// active.
    fn tell_a_new_chrome_whether_anybody_is_here(&self) {
        if self.idle.is_some() {
            self.tell_the_chromes_whether_anybody_is_here();
        }
    }

    /// Whether the desktop is locked. Checked by
    /// [`handle_client_request`](DomicileCompositor::handle_client_request)
    /// before input reaches the seat.
    ///
    /// A desktop that cannot lock is never locked.
    fn the_desk_is_locked(&self) -> bool {
        self.lock.as_ref().is_some_and(Lock::locked)
    }

    /// Tell every chrome whether the desktop is locked.
    ///
    /// Sends the current state, read from this compositor. See
    /// [`crate::lock::announced`].
    fn tell_the_chromes_whether_the_desk_is_locked(&self) {
        self.hub
            .broadcast(crate::lock::announced(self.the_desk_is_locked()));
        self.tell_the_portal_about_the_screensaver();
    }

    /// Tell applications watching the session whether the screens are blanked
    /// or locked. The portal signals only a change.
    fn tell_the_portal_about_the_screensaver(&self) {
        self.hub
            .portals
            .screensaver(self.the_screens_are_dark() || self.the_desk_is_locked());
    }

    /// Tell a new chrome whether the desktop is locked.
    ///
    /// Essential: a reloaded page missed the original lock broadcast and would
    /// otherwise show an unlocked desktop.
    ///
    /// Silent if the desktop cannot lock, like
    /// [`tell_a_new_chrome_whether_anybody_is_here`](DomicileCompositor::tell_a_new_chrome_whether_anybody_is_here).
    fn tell_a_new_chrome_whether_the_desk_is_locked(&self) {
        if self.lock.is_some() {
            self.tell_the_chromes_whether_the_desk_is_locked();
        }
    }

    /// Lock the desktop, logging `why`.
    ///
    /// Called when the screens go idle or on `ClientRequest::Lock`. Announces
    /// only on the transition to locked, so a repeat does not reset a lock
    /// screen mid-passphrase.
    fn shut_the_desk(&mut self, why: &str) {
        let Some(lock) = self.lock.as_mut() else {
            return;
        };
        if lock.shut() {
            debug!("{why}");
            // Release held keys. Input is dropped while locked, including
            // releases, so a key pressed before locking would stay down. With
            // `Caps_Lock`, xkb clears the lock only on that release. Held
            // modifiers are the common case: they do not repeat, so they do not
            // wake the desktop.
            self.release_pressed_keys();
            self.tell_the_chromes_whether_the_desk_is_locked();
        }
    }

    /// A passphrase typed at the lock screen.
    ///
    /// Checked off this thread, because PAM deliberately sleeps on a wrong
    /// password. The answer arrives in
    /// [`heard_the_verdict`](DomicileCompositor::heard_the_verdict). See
    /// [`Lock::offered`].
    ///
    /// The result goes to every chrome as [`HostMessage::Locked`], never only
    /// to the page that asked. A page that unlocked itself could be opened from
    /// devtools.
    fn offered_the_passphrase(&mut self, passphrase: &Passphrase) {
        let Some(lock) = self.lock.as_mut() else {
            warn!("a chrome offered a passphrase to a desktop that has no lock");
            return;
        };
        match lock.offered(passphrase) {
            Offer::Checking => debug!("checking a passphrase; the desk stays locked meanwhile"),
            Offer::StillChecking => warn!(
                "a chrome offered a passphrase while another was being checked; this one was \
                 dropped unchecked"
            ),
            Offer::NothingToOpen => {
                warn!("a chrome offered a passphrase to a desktop that is not locked")
            }
        }
    }

    /// Handle the verifier's result for a passphrase.
    ///
    /// Every result is broadcast. A refusal re-sends `locked: true`, which is
    /// how the waiting shell learns of it.
    ///
    /// Refusals and verifier failures are logged without the passphrase;
    /// [`Unlocking`] does not hold it.
    fn heard_the_verdict(&mut self, verdict: Verdict) {
        let lock = self
            .lock
            .as_mut()
            .expect("a verdict comes only from this desk's own lock");
        match lock.answered(verdict) {
            Unlocking::Opened => debug!("the passphrase opened this desktop"),
            Unlocking::Refused => {
                warn!("a passphrase this desktop did not take; it stays locked")
            }
            Unlocking::Unverifiable(why) => error!(
                %why,
                "this desktop could not check a passphrase, so it stays locked"
            ),
        }
        self.tell_the_chromes_whether_the_desk_is_locked();
    }

    /// Keep a blanked desktop dark after a hotplug.
    ///
    /// A hotplugged monitor arrives lit, and on a described desktop (or an
    /// unappliable profile) nothing else sets the connectors. Only acts when
    /// dark, to avoid a needless modeset.
    fn keep_the_screens_dark(&self) {
        if self.the_screens_are_dark() {
            self.state_the_connectors();
        }
    }

    /// Record user activity, and wake the screens if they were dark.
    ///
    /// All input passes through the page and arrives here.
    /// [`crate::idle::somebody_is_here`] decides which requests count.
    fn keep_the_desktop_awake(&mut self, request: &ClientRequest) {
        if !somebody_is_here(request) {
            return;
        }
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        if idle.stirred(Instant::now()) == Some(Blanking::ComeBack) {
            debug!("somebody is at this desktop again; its screens come back on");
            self.tell_the_chromes_whether_anybody_is_here();
            self.state_the_connectors();
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
    fn held_awake_by_the_portal(&mut self, held: bool) {
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
    fn let_go_of_what_the_dead_were_holding(&mut self) {
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
    fn the_windows_changed(&mut self, why: &str) {
        let on_the_desktop = self.surfaces_on_the_desktop();
        let Some(idle) = self.idle.as_mut() else {
            return;
        };
        let edge = idle.the_desktop_changed(Instant::now(), &on_the_desktop);
        self.the_inhibitors_changed(edge, why);
    }

    /// Act on an inhibitor state change, logging `why`.
    ///
    /// Sets the connectors only when the state changed.
    fn the_inhibitors_changed(&mut self, edge: Option<Blanking>, why: &str) {
        let Some(edge) = edge else {
            return;
        };
        match edge {
            Blanking::GoDark => debug!("{why}; this desktop's screens go dark"),
            Blanking::ComeBack => debug!("{why}; this desktop's screens come back on"),
        }
        self.state_the_connectors();
    }

    /// Handle the idle timer. Returns when to fire next; see
    /// [`Idle::next_check`].
    fn the_idle_clock_came_round(&mut self) -> Duration {
        let now = Instant::now();
        let on_the_desktop = self.surfaces_on_the_desktop();
        let idle = self
            .idle
            .as_mut()
            .expect("the idle clock is armed only where a timeout was stated");
        let going_dark = idle.elapsed(now, &on_the_desktop);
        // Before acting on the change, which borrows `self`.
        let next = idle.next_check(now);
        if going_dark == Some(Blanking::GoDark) {
            debug!(
                connectors = self.engine_displays.len(),
                "nobody is at this desktop; its screens go dark"
            );
            self.tell_the_chromes_whether_anybody_is_here();
            // Lock too, before the modeset, so the lock screen is up before the
            // screen lights. Input wakes the screens but only the passphrase
            // unlocks.
            self.shut_the_desk("nobody is at this desktop; it locks itself");
            self.state_the_connectors();
        }
        next
    }

    /// Every toplevel surface on the desktop. See [`desktop_surfaces`].
    fn surfaces_on_the_desktop(&self) -> Vec<WlSurface> {
        desktop_surfaces(&self.toplevels)
    }

    /// Apply everything in a reloaded config except the display list.
    ///
    /// [`Restatement`] computes what changed beforehand, so an unrelated edit
    /// does not resend the keymap to every client. See
    /// [`adopt_the_desktop`](DomicileCompositor::adopt_the_desktop) for
    /// displays.
    fn adopt_the_rest_of_the_config(&mut self, restated: &Restatement) {
        if let Some(keyboard) = &restated.keyboard {
            self.retype_the_desktop(keyboard);
        }
        // After the keyboard, whose layout chords are resolved on.
        if restated.shell_config {
            self.rebind_the_keys();
        }
        if let Some(max_scale) = restated.max_scale {
            self.cap_the_scale_at(max_scale);
        }
        if let Some(idle) = &restated.idle {
            self.reset_the_idle_clock(idle);
        }
        if let Some(omit) = &restated.omit {
            self.omit_from_the_index(omit);
        }
        if let Some(extensions) = &restated.extensions {
            // Store then broadcast, so the next chrome to connect gets the new
            // list.
            let told = {
                let mut host = self.hub.host.lock().unwrap();
                hand_over_the_extensions(&mut host, extensions, &self.apps);
                host.describe_extensions()
            };
            self.hub.broadcast(
                told.expect("a host that has just been given extensions has them to state"),
            );
        }
        if let Some(lockdown) = &restated.lockdown {
            self.hub.portals.lock_down(lockdown.clone());
        }
        if let Some(theme) = restated.theme {
            // The config overrides the shell's toggle. The toggle writes
            // nothing back because the config is generated, so a `theme` edit
            // is the source of truth.
            self.hub.take_up_the_theme(theme_on_the_wire(theme));
        }
        if let Some(theme) = &restated.appearance {
            self.hub.portals.restyle(theme);
            if let Some(tray) = self.hub.tray.get() {
                tray.retheme(theme.icon_theme.clone());
            }
            if let Some(server) = self.hub.notifications.get() {
                server.retheme(theme.icon_theme.clone());
            }
            // Release the host before broadcasting.
            let told = self
                .hub
                .host
                .lock()
                .unwrap()
                .set_appearance(shell_appearance(theme));
            if let Some(message) = told {
                self.hub.broadcast(message);
            }
        }
    }

    /// Apply a new `files.omit`.
    ///
    /// The index thread re-walks the home, which both drops newly omitted paths
    /// and finds newly included ones. The launcher keeps its results until
    /// then.
    fn omit_from_the_index(&self, omit: &Omit) {
        match &self.index {
            Some(index) => {
                if index.send(Heard::Omitting(omit.clone())).is_err() {
                    // The thread has exited, after logging why (unreadable
                    // home, or a watch failed to start).
                    warn!(
                        "the file index is no longer kept, so `files.omit` \
                         reaches it at the next start"
                    );
                }
            }
            None => debug!("no home is indexed, so `files.omit` has nothing to change"),
        }
    }

    /// Apply a new `idle` timeout.
    ///
    /// The clock restarts from now.
    ///
    /// A dark desktop is woken. The new clock starts awake ([`Idle::after`]),
    /// so it can never report [`Blanking::ComeBack`] for screens the old clock
    /// turned off. Relight them now; the desktop blanks again after the new
    /// timeout.
    fn reset_the_idle_clock(&mut self, idle: &IdleConfig) {
        let was_dark = self.the_screens_are_dark();
        // Keep client inhibitors; see [`Idle::takes_over_from`].
        self.idle = match (
            Idle::after(idle.blank_after(), Instant::now()),
            self.idle.as_mut(),
        ) {
            (Some(clock), Some(previous)) => Some(clock.takes_over_from(previous)),
            (clock, _) => clock,
        };
        // Not fatal on reload, unlike at startup: the desktop just stops
        // blanking. Logged so it is not silent.
        if let Err(why) = self.arm_the_idle_clock(idle.blank_after()) {
            error!(
                %why,
                "no clock for the reloaded idle timeout, so this desktop's screens \
                 will not blank until it is restarted"
            );
        }
        if was_dark {
            debug!("the idle timeout changed while the screens were off; they come back on");
            // Tell the shells. They were told the desktop is idle, and the
            // clock that would announce waking is gone. A shell would otherwise
            // stay in its idle state over a lit desktop. Unguarded, so this
            // works even if the timeout was removed.
            self.tell_the_chromes_whether_anybody_is_here();
            self.state_the_connectors();
        }
    }

    /// Do what the theme turnover says next.
    fn follow_the_turnover(&mut self, step: Step) {
        match (step, &mut self.turnover) {
            (Step::Wait, _) | (_, None) => {}
            (Step::Announce, Some(turnover)) => {
                self.hub.portals.announce(turnover.theme());
                let windows = self.toplevels.iter().map(|(app_id, _)| app_id.clone());
                let step = turnover.announced(windows.collect::<Vec<_>>());
                self.arm_the_turnover_deadline(REPAINT_WITHIN, Turnover::repaint_deadline);
                self.follow_the_turnover(step);
            }
            (Step::Turned, Some(turnover)) => {
                let theme = turnover.theme();
                self.turnover = None;
                if let Some(armed) = self.turnover_deadline.take() {
                    self.loop_handle.remove(armed);
                }
                let told = self.hub.host.lock().unwrap().set_windows_theme(theme);
                if let Some(message) = told {
                    self.hub.broadcast(message);
                }
            }
        }
    }

    /// Arm the deadline for the turnover's current phase, replacing the last
    /// phase's. `ends` is the phase's own deadline, which does nothing if the
    /// turnover has moved on.
    fn arm_the_turnover_deadline(
        &mut self,
        after: Duration,
        ends: fn(&mut Turnover<usize>) -> Step,
    ) {
        if let Some(armed) = self.turnover_deadline.take() {
            self.loop_handle.remove(armed);
        }
        let armed = self
            .loop_handle
            .insert_source(
                Timer::from_duration(after),
                move |_, _, data: &mut CalloopData| {
                    let state = &mut data.state;
                    state.turnover_deadline = None;
                    if let Some(turnover) = &mut state.turnover {
                        let step = ends(turnover);
                        state.follow_the_turnover(step);
                    }
                    TimeoutAction::Drop
                },
            )
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
        self.turnover_deadline = Some(armed);
    }

    /// Arm the idle timer, replacing any existing one.
    ///
    /// `None` (never blank) leaves no timer. Removing the old one keeps reloads
    /// from piling up timers.
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

    /// Apply a new `output.max_scale`.
    ///
    /// Updates the hub's copy, which bounds future chrome densities, and
    /// re-applies the cap to the current desktop using the chrome's last
    /// reported ratio.
    ///
    /// [`set_output`](DomicileCompositor::set_output) skips unchanged outputs,
    /// and a described desktop refuses this (see
    /// [`set_output_scale`](DomicileCompositor::set_output_scale)).
    fn cap_the_scale_at(&mut self, max_scale: u32) {
        self.hub.max_scale.store(max_scale, Ordering::Relaxed);
        self.set_output_scale(output_scale(self.device_pixel_ratio, max_scale));
    }

    /// Compile the config's keymap and send it to every consumer.
    ///
    /// One compilation feeds the seat (each client's `wl_keyboard.keymap`), the
    /// browser process (over the chrome socket), and later chromes (stored
    /// copy). See [`crate::keymap`].
    ///
    /// A keymap that fails to compile is refused and logged, not fatal. At
    /// startup it is fatal so the desktop never runs on xkb's fallback. On
    /// reload the last good keymap stays.
    fn retype_the_desktop(&mut self, keyboard: &KeyboardConfig) {
        match compiled_keymap(keyboard) {
            Err(why) => warn!(%why, "{}", grepped::KEYMAP_REFUSED),
            Ok(keymap) => {
                info!(
                    layout = %keyboard.xkb_layout,
                    variant = %keyboard.xkb_variant,
                    "the desktop types on the keyboard the config now names"
                );
                // The seat first: Smithay writes the keymap and sends the new
                // fd to each bound `wl_keyboard`.
                //
                // From the text, not `XkbConfig`, so the seat and the chrome
                // get the same bytes from one compilation.
                let typing = self
                    .seat
                    .get_keyboard()
                    .expect("the seat was given a keyboard at startup");
                typing
                    .set_keymap_from_string(self, keymap.clone())
                    .expect("xkb reads back the keymap text it has just written");
                // Then the browser process. Store then broadcast, so the next
                // chrome to connect gets the new keymap.
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

    /// Resolve the reloaded config's keybindings and send them and the shell
    /// settings to every chrome.
    ///
    /// A keysym the keymap cannot type is refused and logged, not fatal, as in
    /// [`retype_the_desktop`]. The host keeps the last good keys for new
    /// chromes. A keymap that does not compile is refused here too.
    ///
    /// [`retype_the_desktop`]: DomicileCompositor::retype_the_desktop
    fn rebind_the_keys(&mut self) {
        match shell_config::keys(self.config.current()) {
            Err(why) => warn!(%why, "{}", grepped::KEYS_REFUSED),
            Ok(resolved) => {
                // Store then broadcast, as in `retype_the_desktop`.
                let told = {
                    let mut host = self.hub.host.lock().unwrap();
                    hand_over_the_keys(&mut host, resolved);
                    host.describe_shell_config()
                };
                self.hub.broadcast(
                    told.expect("a host that has just been given keys has them to state"),
                );
            }
        }
    }

    /// Give the chrome keyboard focus.
    ///
    /// There is one seat, shared by turns: the chrome holds the keyboard until
    /// it focuses a window. A second seat is not an option because clients need
    /// not bind more than one (GTK asserts on a second).
    ///
    /// Also called when the window is focused, not only when the chrome maps,
    /// in case the client had not bound its keyboard the first time and missed
    /// the enter.
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
        debug!("the chrome has the window's keyboard");
        let serial = SERIAL_COUNTER.next_serial();
        keyboard.set_focus(self, Some(surface), serial);
        // Update `Host` too, or `keyboard_target` would name a window that no
        // longer has the keyboard. Clicks on the desktop go through
        // `focus_pointed_at`, not here.
        broadcast_focus_decision(&self.hub, ChromeMessage::FocusChrome);
    }

    /// Tell every chrome which modifiers are held, if that changed.
    ///
    /// Reads the seat because keys reach it three ways (the desktop keyboard,
    /// keys injected by a chrome, and releases for a dead chrome's keys), and
    /// only one runs a filter.
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

    /// Send every chrome the clipboard history.
    ///
    /// The whole list each time, since copies reorder it and a page applying
    /// deltas could drift. Also used to catch up a new chrome; an empty history
    /// is a valid answer.
    fn tell_the_chromes_the_clipboard(&self) {
        self.hub.broadcast(HostMessage::Clipboard {
            entries: self.clipboard.entries(),
        });
    }

    /// Record a copy from a Wayland client or the browser.
    ///
    /// Callers handle the difference: a browser copy must be put on the seat, a
    /// client's is already there.
    ///
    /// Only the regular clipboard has history. The primary selection changes on
    /// every text selection.
    fn took_a_copy(&mut self, clipboard: Clipboard, text: String) {
        if clipboard == Clipboard::Copy && self.clipboard.record(text.clone()) {
            self.tell_the_chromes_the_clipboard();
        }
        self.holding[at(clipboard)] = Some(text);
    }

    /// Tell the browser what is on one clipboard.
    ///
    /// Without an engine, nothing to do: a new one gets both clipboards via
    /// [`DomicileCompositor::tell_the_engine_the_copies`]. An empty clipboard
    /// is sent as an empty string, so the browser does not keep offering an old
    /// value.
    fn tell_the_engine_a_clipboard(&self, clipboard: Clipboard) {
        if let Some(session) = self.engine.as_ref() {
            session.set_clipboard(
                clipboard,
                self.holding[at(clipboard)].as_deref().unwrap_or_default(),
            );
        }
    }

    /// Tell a newly connected browser what is on both clipboards, so earlier
    /// copies can be pasted into it.
    fn tell_the_engine_the_copies(&self) {
        for clipboard in BOTH {
            self.tell_the_engine_a_clipboard(clipboard);
        }
    }

    /// Read what a client copied, now that the seat holds the selection.
    ///
    /// Runs at the end of the dispatch: after, because Smithay calls
    /// `new_selection` before storing the selection; before the flush, because
    /// the client cannot write until it receives `wl_data_source.send`.
    ///
    /// Reading happens on a thread, since a client may write slowly. The result
    /// arrives as [`ClientRequest::ClipboardCopied`].
    fn read_what_was_copied(&mut self) {
        for clipboard in BOTH {
            let Some(mime) = self.copying[at(clipboard)].take() else {
                continue;
            };
            self.read_one_clipboard(clipboard, mime);
        }
    }

    /// Ask the client holding one clipboard for its contents.
    fn read_one_clipboard(&mut self, clipboard: Clipboard, mime: String) {
        let (ours, theirs) = match clipboard::pipe() {
            Ok(ends) => ends,
            Err(err) => {
                warn!(%err, "no pipe to read a copy over, so nothing is told what was copied");
                return;
            }
        };
        // `ServerSideSelection` is expected when the compositor owns the
        // selection; this process already has the text.
        //
        // The two Smithay modules have separate error types with the same
        // cases, so both are converted to strings.
        let asked = match clipboard {
            Clipboard::Copy => {
                request_data_device_client_selection(&self.seat, mime.clone(), theirs)
                    .map_err(|err| err.to_string())
            }
            Clipboard::Primary => {
                request_primary_client_selection(&self.seat, mime.clone(), theirs)
                    .map_err(|err| err.to_string())
            }
        };
        if let Err(err) = asked {
            debug!(%err, %mime, "nothing to read this copy from");
        } else {
            let hub = self.hub.clone();
            thread::spawn(move || {
                match clipboard::read_copy(ours, LONGEST_COPY, clipboard::PATIENCE) {
                    Ok(copied) => match String::from_utf8(copied) {
                        Ok(text) => {
                            hub.send_request(ClientRequest::ClipboardCopied { clipboard, text });
                        }
                        // The client offered UTF-8 text and sent something
                        // else. Logged, not repaired: a repaired copy would
                        // differ from what was copied.
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

    /// Release every key the seat still has down.
    ///
    /// A key comes up only when told. A reloaded or crashed page sends no
    /// `keyup`, but the seat outlives it, so the key stays down for the
    /// session.
    ///
    /// For a lock key this is unrecoverable: xkb unlocks only on the release of
    /// the press that locked it. The default `caps:swapescape` puts `Caps_Lock`
    /// on Escape, so one lost release means typing in capitals until restart.
    ///
    /// Releasing a key the user still holds only costs its repeat; the real
    /// release later finds nothing down.
    fn release_pressed_keys(&mut self) {
        let keyboard = self.seat.get_keyboard().unwrap();
        let pressed = keyboard.pressed_keys();
        if !pressed.is_empty() {
            debug!(
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
                // Always forwarded. The chrome matches its own chords before
                // forwarding keys, so there is nothing to intercept here.
                |_, _, _| FilterResult::<()>::Forward,
            );
        }
        self.tell_the_chromes_the_modifiers();
    }
}

// ---- compositor + shm + dmabuf --------------------------------------------

/// What the compositor needs to know about a client's latest commit: source,
/// orientation and size. The pixels go to the engine untouched.
struct SurfaceTexture {
    /// Whether the buffer was a dmabuf or shm. Logged, since an shm frame costs
    /// an upload.
    from_dmabuf: bool,
    /// Whether the buffer is flipped, as GL clients flag on the dmabuf.
    y_inverted: bool,
    /// The surface's own logical size, or its `wp_viewport` destination if set.
    ///
    /// Not the output's: a client that has not answered a configure is still
    /// its old size, and stretching it would hide that.
    logical_size: (f64, f64),
}

/// Identifies a chrome in a theme turnover: the address of its writer, as
/// `ChromeHub::chromes` uses. Only compared, never dereferenced.
fn chrome_key(writer: &Arc<Mutex<UnixStream>>) -> usize {
    Arc::as_ptr(writer) as usize
}

/// The role a surface committed in, for the steps of a commit that differ.
#[derive(Clone)]
enum Role {
    Toplevel(ToplevelSurface),
    Popup(PopupSurface),
    Bubble,
}

/// An announced bubble. See `DomicileCompositor::bubbles`.
struct Bubble {
    app_id: String,
    surface: WlSurface,
    /// The surface it was announced over. Kept because a hidden bubble is
    /// no longer its child.
    parent: WlSurface,
    /// Its position and size as the chrome was last told them, logical.
    placed: ((f64, f64), (f64, f64)),
}

/// Which of the two kinds of client committed a buffer.
#[derive(Debug)]
enum Committer {
    /// A window on the desktop, named by the id the host gave it.
    App(String),
    /// The engine drawing the desktop itself.
    Chrome,
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

/// A window's smallest and largest size, `(width, height)` each, as
/// `xdg_toplevel` states them. Zero is no limit.
type SizeLimits = ((i32, i32), (i32, i32));

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

/// The bounds of a client's damage since the last commit, clearing it.
///
/// Must take, not borrow: Smithay accumulates damage in the current state until
/// cleared, so reading it would return every rectangle ever reported and the
/// box would grow to the whole window. `pending_damage` tracks damage owed
/// across dropped frames.
fn take_damage(damage: &mut Vec<Damage>, buffer_scale: i32) -> Option<Region> {
    damage_bounds(&std::mem::take(damage), buffer_scale)
}

/// The bounding box of a client's damage.
///
/// A box is enough to avoid redrawing a whole window for a cursor blink.
///
/// `Surface` damage is logical and is scaled; `Buffer` damage is already in
/// buffer pixels. Mixing them up leaves stale bands on a HiDPI window.
fn damage_bounds(damage: &[Damage], buffer_scale: i32) -> Option<Region> {
    let scale = buffer_scale.max(1);
    damage
        .iter()
        .map(|reported| match reported {
            // Saturate: clients often send `(0, 0, i32::MAX, i32::MAX)` for
            // "everything". Overflow would panic the Wayland thread in debug
            // builds, or wrap negative and be dropped in release. The result is
            // clamped to the buffer later.
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
            // Clip negative offsets; that part is off the buffer.
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
        // Smithay accumulates damage until cleared. Without taking it, the box
        // only grows to the whole window.
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
        // Surface damage is logical; unscaled, a HiDPI window keeps a stale
        // band at the right and bottom.
        assert_eq!(
            damage_bounds(&[surface(3, 4, 5, 6)], 2),
            Some(Region::new(6, 8, 10, 12))
        );
    }

    #[test]
    fn a_client_claiming_everything_is_not_multiplied_into_nothing() {
        // `(0, 0, i32::MAX, i32::MAX)` means "everything changed". Scaling it
        // must not overflow: debug builds would panic, release builds would
        // wrap negative and drop it.
        let bounds = damage_bounds(&[surface(0, 0, i32::MAX, i32::MAX)], 2);

        // Saturates at `i32::MAX`. The exact value does not matter; it is
        // clamped to the buffer later.
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
        // Covers the scaled location, which the two tests above do not (one is
        // at scale 1, the other at the origin).
        //
        // Wrapping would put the far rectangle behind the near one, so the box
        // would stop short and leave stale pixels.
        let bounds = damage_bounds(&[surface(0, 0, 4, 4), surface(2_000_000_000, 0, 8, 8)], 2);

        assert_eq!(bounds, Some(Region::new(0, 0, i32::MAX as u32, 16)));
    }

    #[test]
    fn buffer_damage_is_already_in_buffer_pixels() {
        // Most clients use `damage_buffer` (preferred since `wl_compositor`
        // v4). Scaling it would over-damage HiDPI windows.
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

/// Whether this commit can answer a forwarded keystroke.
///
/// Only app windows can. The chrome repaints for its own reasons (a ticking
/// clock), and counting those would misreport the wait.
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

/// What became of a committed app frame. See
/// [`DomicileCompositor::publish_frame`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Published {
    /// The engine did not take it; the window keeps its previous frame.
    NotShown,
    /// The engine samples the client's dmabuf directly, so viz owns it until
    /// released.
    Held,
    /// The engine took a copy, uploaded as `fourcc`, so the client's buffer
    /// is already free.
    Copied { fourcc: u32 },
    /// No page has embedded the window yet; the frame waits (see
    /// `engine_waiting`). `held` is as in [`Published::Held`].
    Waiting { held: bool },
}

/// An shm frame in one of the compositor's buffers, ready to submit.
struct CopiedFrame {
    id: UploadId,
    descriptor: DmabufDescriptor,
    /// The format the surface's texture now holds it in.
    fourcc: u32,
}

/// An app's commit with a buffer, as [`DomicileCompositor::publish_frame`]
/// shows it.
struct Commit<'a> {
    surface: &'a WlSurface,
    buffer: &'a wl_buffer::WlBuffer,
    sampled: Sampled,
    /// The box to show it at. See [`crate::configure_answers`].
    at_box: u64,
    /// That box's size in device pixels, if the compositor knows it.
    box_size: Option<(u32, u32)>,
    /// The client's damage in buffer pixels, `(x, y, width, height)`. `None`
    /// when unknown or not exact.
    damage: Option<(i32, i32, i32, i32)>,
}

/// Why an shm client's frame could not be shown. Logged once per client.
#[derive(Debug, thiserror::Error)]
enum ShmRefused {
    #[error(
        "this client drew into shared memory, and there is no EGL renderer to copy its \
         frames to the GPU with"
    )]
    NoRenderer,
    #[error(
        "this client drew into shared memory, and there is no libgbm device to allocate the \
         GPU buffers its frames are copied into — the startup log says why"
    )]
    NoAllocator,
    #[error(
        "this client's shared-memory buffer could not be read, or is in a format with no DRM \
         equivalent"
    )]
    Unreadable,
    #[error("could not allocate a GPU buffer to copy this client's frame into: {0}")]
    Allocation(#[from] gbm::AllocationError),
    #[error("could not copy this client's frame to the GPU: {0}")]
    Copy(#[from] CopyError),
}

impl CommittedBuffer {
    /// The buffer's size, known without reading pixels.
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
        self.announce_a_new_popup(surface);
        self.place_the_bubbles(surface);
        let Some((committer, role)) = self.committer(surface) else {
            return;
        };
        // Send the initial configure once, so the client can map. A popup's was
        // sent in `new_popup`.
        if let Role::Toplevel(toplevel) = &role {
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

        if let Committer::App(app_id) = &committer {
            self.tell_the_size_limits(app_id, surface);
        }

        // Take the new buffer and the frame callbacks. Taking the buffer gives
        // us its release; otherwise Smithay holds it until the next buffer,
        // which the client may need the release to draw.
        let (attached, callbacks, buffer_scale, buffer_transform, viewport, geometry, damage) =
            with_states(surface, |states| {
                // Read with the buffer: the viewport is double-buffered and
                // applies to this commit.
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
                    Some(BufferAssignment::NewBuffer(buffer)) => (Some(buffer), false),
                    Some(BufferAssignment::Removed) => (None, true),
                    None => (None, false),
                };
                let callbacks = std::mem::take(&mut attrs.frame_callbacks);
                // Clear the accumulated damage, or it grows by a rectangle per
                // commit for the window's life.
                let damage = take_damage(&mut attrs.damage, attrs.buffer_scale);
                // The scale this buffer was drawn at. Read now; a client
                // mid-scale-change may commit the next one differently.
                let scale = attrs.buffer_scale;
                let transform = Transform::from(attrs.buffer_transform);
                drop(guard);
                // Double-buffered too; see `crate::window_geometry`.
                (
                    attached,
                    callbacks,
                    scale,
                    transform,
                    viewport,
                    window_geometry(states),
                    damage,
                )
            });
        // Whether the client took its buffer away, unmapping the window.
        let (attached, unmapped) = attached;

        // Ask the client to draw its next frame (keeps it animating).
        let time = self.start.elapsed().as_millis() as u32;
        for callback in callbacks {
            callback.done(time);
        }

        // A theme turnover waits for each window to draw a new frame.
        if let (Some(_), Committer::App(app_id), Some(turnover)) =
            (&attached, &committer, &mut self.turnover)
        {
            let step = turnover.repainted(app_id);
            self.follow_the_turnover(step);
        }

        // Damage without a new buffer changes pixels the engine does not show,
        // and a window mapped again starts from nothing.
        if let (None, Committer::App(app_id)) = (&attached, &committer) {
            if damage.is_some() || unmapped {
                self.shown.missed(app_id);
            }
        }

        if let Some(buffer) = attached {
            // The gap since the last commit is time spent waiting on clients or
            // the throttle.
            let started = Instant::now();
            let waited = self.last_commit.map(|done| started.duration_since(done));
            // Only app commits after a keystroke count as responses.
            // Unprompted redraws (a blinking cursor) and chrome commits would
            // skew it.
            let responded = answers_keystroke(&committer)
                .then(|| self.pending_key.take())
                .flatten()
                .map(|keyed| started.duration_since(keyed));
            let engine_holds = match &committer {
                Committer::App(app_id) => {
                    // The size this commit was drawn for, and the engine's box
                    // at that size. See `crop` and `crate::configure_answers`.
                    let (configured, (at_box, box_size)) = match &role {
                        Role::Toplevel(toplevel) => {
                            let acked = with_states(surface, |states| {
                                states
                                    .data_map
                                    .get::<XdgToplevelSurfaceData>()
                                    .unwrap()
                                    .lock()
                                    .unwrap()
                                    .current_serial
                            });
                            (
                                toplevel.current_state().size.map(|size| (size.w, size.h)),
                                self.configure_answers.get_mut(app_id).map_or(
                                    (crate::engine::LAST_SHOWN_BOX, None),
                                    |answers| {
                                        let at_box = answers.answered(acked);
                                        (at_box, answers.box_size(at_box))
                                    },
                                ),
                            )
                        }
                        // The positioner's size, which the shell places.
                        Role::Popup(popup) => (
                            popup.with_pending_state(|state| {
                                Some((state.geometry.size.w, state.geometry.size.h))
                            }),
                            (NEWEST_BOX, None),
                        ),
                        // Sized by its own buffer.
                        Role::Bubble => (None, (NEWEST_BOX, None)),
                    };
                    // Measured on the upright buffer, then mapped back into
                    // the buffer the engine samples.
                    let buffer_size = committed_buffer(&buffer).map(|committed| committed.size());
                    let crop = buffer_size.map_or((0, 0, 0, 0), |buffer_size| {
                        let size = upright_size(buffer_size, buffer_transform);
                        crop_in_buffer(
                            crate::window_geometry::crop(
                                geometry,
                                configured,
                                surface_size(size, buffer_scale, viewport.destination),
                                size,
                                source_pixels(size, buffer_scale, viewport.source),
                            ),
                            size,
                            buffer_transform,
                        )
                    });
                    self.cast_frame(app_id, &buffer, crop, buffer_scale, damage);
                    // Surface damage maps to buffer pixels by the scale alone
                    // only when nothing turns or scales the buffer.
                    let upright =
                        buffer_transform == Transform::Normal && viewport == Viewport::default();
                    let commit = Commit {
                        surface,
                        buffer: &buffer,
                        sampled: Sampled {
                            crop,
                            transform: buffer_transform,
                        },
                        at_box,
                        box_size,
                        damage: damage.filter(|_| upright).map(|region| {
                            (
                                region.x as i32,
                                region.y as i32,
                                region.width as i32,
                                region.height as i32,
                            )
                        }),
                    };
                    let published = self.publish_frame(app_id, &commit);
                    match published {
                        Published::Held | Published::Copied { .. } => self.shown.shown(
                            app_id,
                            engine_damage::Frame {
                                at_box,
                                crop,
                                buffer: buffer_size.expect("a shown frame has a buffer"),
                                upright,
                                texture: match published {
                                    Published::Copied { fourcc } => Some(fourcc),
                                    _ => None,
                                },
                            },
                        ),
                        Published::Waiting { .. } | Published::NotShown => {
                            self.shown.missed(app_id)
                        }
                    }
                    // After the submit, so there is something to sample, but
                    // timed from `started` so the import and submit count as
                    // ours.
                    self.drive_latency(
                        app_id,
                        started,
                        matches!(published, Published::Held | Published::Copied { .. }),
                    );
                    matches!(
                        published,
                        Published::Held | Published::Waiting { held: true }
                    )
                }
                Committer::Chrome => {
                    self.publish_chrome_frame(&buffer, buffer_scale, viewport);
                    false
                }
            };
            // Release after the pixels are out, since the client may redraw
            // into it immediately. Always release, or a single-buffered client
            // stops drawing.
            //
            // Except a buffer the engine holds: viz samples it directly, so
            // releasing it would tear. The engine releases it, or
            // `EngineSession::overdue` takes it back.
            if !engine_holds {
                buffer.release();
                tracing::trace!(?committer, "buffer released");
            }
            let done = Instant::now();
            {
                let mut timings = self.hub.timings.lock().unwrap();
                if let Some(waited) = waited {
                    timings.idle.record(waited);
                }
                if let Some(responded) = responded {
                    timings.response.record(responded);
                }
                timings.commit.record(done - started);
            }
            self.last_commit = Some(done);
        }
    }

    /// A destroyed bubble goes at once: no commit will come to notice it.
    fn destroyed(&mut self, surface: &WlSurface) {
        if let Some(at) = self
            .bubbles
            .iter()
            .position(|bubble| bubble.surface == *surface)
        {
            let bubble = self.bubbles.remove(at);
            self.by_surface.remove(&bubble.surface);
            debug!(app_id = %bubble.app_id, "bubble destroyed -> Host::app_closed");
            self.forget(&bubble.app_id);
        }
    }
}

impl BufferHandler for DomicileCompositor {
    /// The client destroyed a buffer. Drop its import so the browser releases
    /// the fds, and forget any hold.
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

    // Validate a client's dmabuf by importing it. This also warms the
    // renderer's cache for the following commit.
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

impl FractionalScaleHandler for DomicileCompositor {
    /// A client asked for its surface's scale, often before the surface has a
    /// role.
    fn new_fractional_scale(&mut self, surface: WlSurface) {
        self.prefer_scale(&surface, self.bounds_of(&surface));
    }
}
delegate_fractional_scale!(DomicileCompositor);
delegate_single_pixel_buffer!(DomicileCompositor);
delegate_content_type!(DomicileCompositor);
delegate_shm!(DomicileCompositor);
delegate_dmabuf!(DomicileCompositor);

// ---- idle inhibit ---------------------------------------------------------

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

// ---- seat (required by xdg-shell delegation) ------------------------------

impl SeatHandler for DomicileCompositor {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<DomicileCompositor> {
        &mut self.seat_state
    }

    // The web engine draws the pointer, so forward a client's cursor request to
    // the chrome as a CSS cursor for the element under the pointer.
    fn cursor_image(&mut self, _seat: &Seat<Self>, image: CursorImageStatus) {
        if let Some(app_id) = self.pointer_app.clone() {
            let cursor = match image {
                CursorImageStatus::Hidden => CursorShape::None,
                CursorImageStatus::Named(icon) => cursor_shape(icon),
                // A client-drawn cursor surface needs native compositing (see
                // `docs/architecture/WINDOW-COMPOSITING.md`). Use the default
                // arrow until then.
                CursorImageStatus::Surface(_) => CursorShape::Default,
            };
            self.hub
                .broadcast(HostMessage::AppCursor { app_id, cursor });
        }
    }

    /// Both clipboards follow keyboard focus.
    ///
    /// Required for pasting: a selection is offered only to the client with
    /// data device focus. `wl_data_device` ties that to keyboard focus.
    ///
    /// `None` means no surface is focused. The chrome is an ordinary client
    /// here and gets the clipboard the same way.
    fn focus_changed(&mut self, seat: &Seat<Self>, focused: Option<&WlSurface>) {
        let client = focused.and_then(|on| on.client());
        set_data_device_focus(&self.display_handle, seat, client.clone());
        // The primary selection follows the same rule, so both pastes work in
        // the same client.
        set_primary_focus(&self.display_handle, seat, client);
        self.activate(focused);
        self.report_running_apps(focused);
    }
}

impl DomicileCompositor {
    /// Mark the window with keyboard focus as activated, and no other.
    ///
    /// Chromium treats `activated` as page focus. Without it, Electron windows
    /// accept typed characters but ignore Backspace and shortcuts.
    ///
    /// A menu with the keyboard activates its window; toolkits close menus when
    /// their window deactivates.
    fn activate(&self, focused: Option<&WlSurface>) {
        let window = focused.map(|on| self.window_under_menus(on));
        for (_, toplevel) in &self.toplevels {
            let active = window.as_ref() == Some(toplevel.wl_surface());
            toplevel.with_pending_state(|state| {
                if active {
                    state.states.set(xdg_toplevel::State::Activated);
                } else {
                    state.states.unset(xdg_toplevel::State::Activated);
                }
            });
            // Before the first configure, that configure carries it.
            if toplevel.is_initial_configure_sent() {
                toplevel.send_pending_configure();
            }
        }
    }

    /// Tell the Background portal each window's application and whether it
    /// has the keyboard (`focused`).
    fn report_running_apps(&self, focused: Option<&WlSurface>) {
        let window = focused.map(|on| self.window_under_menus(on));
        self.hub
            .portals
            .running(self.toplevels.iter().map(|(_, toplevel)| {
                let app_id = with_states(toplevel.wl_surface(), |states| {
                    states
                        .data_map
                        .get::<XdgToplevelSurfaceData>()
                        .unwrap()
                        .lock()
                        .unwrap()
                        .app_id
                        .clone()
                });
                (
                    app_id.unwrap_or_default(),
                    window.as_ref() == Some(toplevel.wl_surface()),
                )
            }));
    }

    /// The running applications as the keyboard stands, for a window that
    /// came, went or renamed its application.
    fn the_running_apps_changed(&self) {
        let focused = self.seat.get_keyboard().unwrap().current_focus();
        self.report_running_apps(focused.as_ref());
    }

    /// The window a menu (or nested menu) was opened over, or `surface` itself
    /// if it is not a menu.
    ///
    /// Asks the shell, not `popups`, because a menu grabs the keyboard before
    /// it has drawn.
    fn window_under_menus(&self, surface: &WlSurface) -> WlSurface {
        self.xdg_shell_state
            .popup_surfaces()
            .iter()
            .find(|popup| popup.wl_surface() == surface)
            .and_then(|popup| popup.get_parent_surface())
            .map_or_else(
                || surface.clone(),
                |parent| self.window_under_menus(&parent),
            )
    }
}

impl TabletSeatHandler for DomicileCompositor {}

delegate_seat!(DomicileCompositor);
delegate_cursor_shape!(DomicileCompositor);

// ---- output (clients wait for a wl_output before mapping) -----------------

/// The desktop a config describes, at startup.
///
/// Reloads use [`Screens::reloaded_into`], which may keep the current desktop.
/// At startup nothing has been negotiated yet.
fn screens_at_startup(config: &Config) -> Screens {
    match config.output.desktop() {
        Some(desktop) => Screens::described(&desktop),
        None => Screens::nested(),
    }
}

/// An advertised `wl_output` and its global.
///
/// The global id is kept for removal: `DisplayHandle::remove_global` is how
/// clients learn a display is gone. Dropping the `Output` alone leaves it
/// advertised.
struct LiveOutput {
    output: Output,
    global: smithay::reexports::wayland_server::backend::GlobalId,
}

/// Advertise `advertised` as a new `wl_output`.
///
/// The only place outputs are created, so startup and reload advertise the same
/// thing.
fn advertise_output(dh: &DisplayHandle, advertised: &Advertised) -> LiveOutput {
    let output = Output::new(
        advertised.name.clone(),
        PhysicalProperties {
            // Real millimeters on a tty, from the engine's EDID read. Otherwise
            // `screens::UNKNOWN_PHYSICAL_MM` (zero, `wl_output`'s "unknown"): a
            // described desktop or nested window has no physical size. Not
            // invented here, because toolkits size fonts from it.
            size: advertised.physical_mm.into(),
            subpixel: Subpixel::Unknown,
            make: "Domicile".into(),
            // The panel's name, if known. Clients read it to identify monitors.
            //
            // It also reaches `xdg_output.description`: Smithay builds that
            // once as "{make} - {model} - {name}" with no setter
            // (`output.rs:264`).
            //
            // "Virtual" for outputs that are not panels.
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

/// Update an existing output's mode, transform, scale and position.
///
/// A display that only changed shape keeps its `wl_output`; see [`Slot::Kept`].
///
/// Physical size is fixed at construction and cannot change for a kept output:
/// it is matched by name, which comes from the EDID. A renamed output goes
/// through [`advertise_output`].
fn restate_output(output: &Output, advertised: &Advertised) {
    let mode = current_mode(advertised);
    output.change_current_state(
        Some(mode),
        Some(as_wl_transform(advertised.transform)),
        // Fractional, so `xdg_output` reports the true logical size. Smithay
        // rounds the `wl_output.scale` it sends up from this, which a 1.2x
        // display needs.
        Some(Scale::Fractional(advertised.scale)),
        Some(advertised.position.into()),
    );
    output.set_preferred(mode);
}

/// A display's current mode as a `wl_output` mode.
///
/// Shared by startup and `set_output`, so a density change does not look like
/// new hardware.
fn current_mode(advertised: &Advertised) -> OutputMode {
    OutputMode {
        size: advertised.mode.into(),
        refresh: advertised.refresh_mhz,
    }
}

/// Convert a config transform to Smithay's.
///
/// `screens.rs` avoids Smithay for testability and `domicile-config` has no
/// Smithay dependency, so the conversion lives here. Rotations only.
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

// ---- xdg-shell: windows reported to the host ------------------------------

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

        // Register a new window with `Host` (which assigns an app id) and
        // announce it to every chrome.
        //
        // No size yet: a client states its size by drawing, which arrives as
        // `app_resized` after its first commit. No title yet: `set_title` comes
        // after the toplevel, in `title_changed`.
        let announce = {
            let mut host = self.hub.host.lock().unwrap();
            let (app_id, announce) = host.app_appeared(None, None);
            debug!(%app_id, "toplevel mapped -> Host::app_appeared");
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
            self.toplevels.push((app_id, surface));
            announce
        };
        self.the_running_apps_changed();
        self.hub.broadcast(announce);
        // An inhibitor taken before the window mapped starts holding now (see
        // `crate::idle::holds`), which may wake a dark desktop.
        self.the_windows_changed("a window appeared under an inhibitor");
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
        //
        // The positioner's geometry is used as given, without constraining it
        // to the output.
        surface.with_pending_state(|state| {
            state.geometry = positioner.get_geometry();
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

// ---- xdg-activation: a client asking for the keyboard ---------------------

impl XdgActivationHandler for DomicileCompositor {
    fn activation_state(&mut self) -> &mut XdgActivationState {
        &mut self.xdg_activation_state
    }

    /// A client asked for a window to be activated. Forwarded, not granted.
    ///
    /// A token made before the keyboard last moved is dropped (see
    /// [`activation::earned`]): the window is asking on its own, not for the
    /// user. The rest are broadcast as `focus_requested`; a shell grants one
    /// with `focus_app`.
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
        let asked = token_data.serial.map(|(serial, _)| serial);
        if !activation::earned(asked, last_enter) {
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

// The shell draws every window's frame, so both decoration protocols always
// answer "server side". Clients may still draw their own (GTK4 does); see
// `window_geometry.rs`.

impl XdgDecorationHandler for DomicileCompositor {
    fn new_decoration(&mut self, toplevel: ToplevelSurface) {
        shell_draws_the_frame(&toplevel);
    }

    fn request_mode(&mut self, toplevel: ToplevelSurface, _: XdgDecorationMode) {
        shell_draws_the_frame(&toplevel);
    }

    fn unset_mode(&mut self, toplevel: ToplevelSurface) {
        shell_draws_the_frame(&toplevel);
    }
}
delegate_xdg_decoration!(DomicileCompositor);

/// Tell `toplevel` the shell draws its frame.
///
/// Before the first configure, the mode rides on the initial configure from
/// `commit`, as the protocol requires.
fn shell_draws_the_frame(toplevel: &ToplevelSurface) {
    toplevel.with_pending_state(|state| {
        state.decoration_mode = Some(XdgDecorationMode::ServerSide);
    });
    if toplevel.is_initial_configure_sent() {
        toplevel.send_pending_configure();
    }
}

impl KdeDecorationHandler for DomicileCompositor {
    fn kde_decoration_state(&self) -> &KdeDecorationState {
        &self.kde_decoration_state
    }

    fn request_mode(
        &mut self,
        _: &WlSurface,
        decoration: &OrgKdeKwinServerDecoration,
        _: WEnum<KdeMode>,
    ) {
        decoration.mode(KdeMode::Server);
    }
}
delegate_kde_decoration!(DomicileCompositor);

// ---- data device: drag-and-drop, and the clipboard ------------------------

/// The mime types offered for compositor-owned selections.
///
/// All of [`TEXT_MIMES`], since clients differ: GTK asks for
/// `text/plain;charset=utf-8`, X11 bridges for `STRING`.
fn text_mimes() -> Vec<String> {
    TEXT_MIMES.iter().map(|mime| (*mime).to_string()).collect()
}

/// Both clipboards, in slot order.
const BOTH: [Clipboard; 2] = [Clipboard::Copy, Clipboard::Primary];

/// Map a Smithay selection target to the engine's clipboard type. A function so
/// it can be tested; swapped, Ctrl-C would land on the primary selection.
fn clipboard_of(target: SelectionTarget) -> Clipboard {
    match target {
        SelectionTarget::Clipboard => Clipboard::Copy,
        SelectionTarget::Primary => Clipboard::Primary,
    }
}

/// The slot index for `clipboard` in per-clipboard arrays.
fn at(clipboard: Clipboard) -> usize {
    match clipboard {
        Clipboard::Copy => 0,
        Clipboard::Primary => 1,
    }
}

/// Who serves a selection the compositor set.
#[derive(Debug, Clone)]
enum Holder {
    /// A restored history entry, or anything copied in the browser (not our
    /// Wayland client), on this clipboard. Served from
    /// [`DomicileCompositor::holding`].
    Desk(Clipboard),
    /// A RemoteDesktop session's offer, which its application writes. See
    /// `crate::portals`.
    Portal(OwnedObjectPath),
}

impl DomicileCompositor {
    /// Whether an InputCapture session took `event` from the seat.
    fn captured(&self, event: &ClientRequest) -> bool {
        let input = matches!(
            event,
            ClientRequest::Key { .. }
                | ClientRequest::PointerMotion { .. }
                | ClientRequest::PointerLeave
                | ClientRequest::PointerButton { .. }
                | ClientRequest::PointerAxis { .. }
        );
        input
            && self
                .captures
                .as_ref()
                .is_some_and(|captures| captures.divert(event, &self.desk()))
    }

    /// Do what the Clipboard portal asked of the seat's clipboard.
    fn select_for_a_portal(&mut self, selection: Selection) {
        match selection {
            Selection::Offer {
                session,
                mime_types,
            } => {
                set_data_device_selection(
                    &self.display_handle,
                    &self.seat,
                    mime_types.clone(),
                    Holder::Portal(session.clone()),
                );
                self.hub
                    .portals
                    .selection_changed(mime_types, Some(session));
            }
            Selection::Read { mime_type, into } => {
                let held =
                    current_data_device_selection_userdata(&self.seat).map(|held| held.clone());
                match held {
                    Some(held) => self.serve_a_selection(&held, mime_type, into),
                    None => {
                        if let Err(err) =
                            request_data_device_client_selection(&self.seat, mime_type, into)
                        {
                            debug!(%err, "a portal session read a clipboard nobody holds");
                        }
                    }
                }
            }
        }
    }

    /// Write a selection the compositor set into `fd`.
    ///
    /// Written on a thread, since a client that stops reading would otherwise
    /// block the Wayland thread. The deadline in `crate::clipboard` bounds the
    /// thread. A portal session's offer is written by its application.
    ///
    /// If nothing is held, the fd is dropped and the client reads EOF.
    fn serve_a_selection(&self, held: &Holder, mime_type: String, fd: OwnedFd) {
        match held {
            Holder::Desk(clipboard) => match self.holding[at(*clipboard)].as_deref() {
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
                    ?clipboard,
                    "a client is pasting something this desktop no longer holds, so it gets nothing"
                ),
            },
            Holder::Portal(session) => self.hub.portals.transfer(session.clone(), mime_type, fd),
        }
    }
}

impl SelectionHandler for DomicileCompositor {
    type SelectionUserData = Holder;

    /// A client set a selection. Only records the mime type to read; see
    /// [`DomicileCompositor::copying`].
    ///
    /// Both clipboards are read; the primary only so the browser can paste it.
    /// It gets no history.
    fn new_selection(
        &mut self,
        target: SelectionTarget,
        source: Option<SelectionSource>,
        _seat: Seat<Self>,
    ) {
        // A cleared selection (`None`) or one with no text (an image, a file)
        // is not read; the previous copy stays.
        self.copying[at(clipboard_of(target))] = source
            .as_ref()
            .and_then(|offered| text_mime(&offered.mime_types()));
        if target == SelectionTarget::Clipboard {
            let offered = source
                .as_ref()
                .map(SelectionSource::mime_types)
                .unwrap_or_default();
            self.hub.portals.selection_changed(offered, None);
        }
    }

    /// A client is pasting a compositor-owned selection. See
    /// [`DomicileCompositor::serve_a_selection`].
    fn send_selection(
        &mut self,
        _target: SelectionTarget,
        mime_type: String,
        fd: OwnedFd,
        _seat: Seat<Self>,
        held: &Holder,
    ) {
        self.serve_a_selection(held, mime_type, fd);
    }
}

impl PrimarySelectionHandler for DomicileCompositor {
    fn primary_selection_state(&self) -> &PrimarySelectionState {
        &self.primary_selection_state
    }
}

delegate_primary_selection!(DomicileCompositor);

impl ExtDataControlHandler for DomicileCompositor {
    fn data_control_state(&self) -> &ExtDataControlState {
        &self.ext_data_control_state
    }
}

delegate_ext_data_control!(DomicileCompositor);

impl WlrDataControlHandler for DomicileCompositor {
    fn data_control_state(&self) -> &WlrDataControlState {
        &self.wlr_data_control_state
    }
}

delegate_data_control!(DomicileCompositor);

impl ClientDndGrabHandler for DomicileCompositor {}
impl ServerDndGrabHandler for DomicileCompositor {}

impl DataDeviceHandler for DomicileCompositor {
    fn data_device_state(&self) -> &DataDeviceState {
        &self.data_device_state
    }
}

delegate_data_device!(DomicileCompositor);

// ---- boot -----------------------------------------------------------------

/// The chrome's Wayland display name, derived from ours.
///
/// A separate socket, so the compositor knows which client is the chrome rather
/// than trusting a claim.
fn chrome_display(socket_name: &OsStr) -> String {
    format!("{}-chrome", socket_name.to_string_lossy())
}

/// Spawn a client process onto Domicile's display.
///
/// A reaper thread waits on the child so it doesn't become a zombie.
/// `scoped` starts it in its own systemd scope; see [`crate::app_scope`].
fn spawn_client(command: &[String], wayland_display: &OsStr, scoped: bool) {
    let Some(mut child) = client_command(
        command,
        wayland_display,
        std::env::var_os("LD_LIBRARY_PATH").as_deref(),
        scoped.then(app_scope::random),
    ) else {
        return;
    };
    match child.spawn() {
        Ok(mut child) => {
            // Logged after the fork for the pid, which pairs this line with
            // `app client connected`. See `peer_process`.
            debug!(
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
        Err(err) => tracing::error!(
            %err,
            program = ?child.get_program(),
            ?command,
            "failed to spawn client"
        ),
    }
}

/// Convert a config theme to the protocol's.
///
/// Kept as two enums because `domicile-protocol` depends only on serde, like
/// `DisplayTransform` and `domicile_config::Transform`.
/// `scripts/test-themes-agree.sh` keeps them in sync.
fn theme_on_the_wire(mode: ThemeMode) -> Theme {
    match mode {
        ThemeMode::Dark => Theme::Dark,
        ThemeMode::Light => Theme::Light,
    }
}

/// Give the host the config's `extensions` and Domicile's own `apps`, for
/// chromes that connect later.
///
/// Config paths came from JSON, so they are UTF-8 and `display` is lossless.
/// App paths are under the installation's `libexec`.
fn hand_over_the_extensions(host: &mut Host, extensions: &ExtensionsConfig, apps: &[PathBuf]) {
    host.set_extensions(
        extensions.web_store.clone(),
        extensions
            .unpacked
            .iter()
            .chain(apps)
            .map(|path| path.display().to_string())
            .collect(),
    );
}

/// Give the host the resolved shell keybindings, for chromes that connect
/// later.
fn hand_over_the_keys(host: &mut Host, keys: BTreeMap<String, u32>) {
    host.set_shell_config(keys);
}

/// The user's home directory, which the file index covers.
///
/// Read from the environment because it is a fact about the running user, not a
/// setting; configuration arrives on the command line. Spawned clients inherit
/// the same `HOME`, and `domicile_config` uses it to expand `~`.
fn home_directory() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

/// Build the command for a spawned client.
///
/// - `WAYLAND_DISPLAY` is set to ours. Our own may be the host session's, and a
///   client inheriting it would open there.
/// - `DISPLAY` is removed so dual-backend toolkits choose Wayland.
/// - There is no Xwayland, so X11-only defaults would fail;
///   [`WAYLAND_PREFERENCE`] overrides them.
/// - `LD_LIBRARY_PATH` loses the engine's directory; see
///   [`without_the_engine`].
///
/// `DOMICILE_SOCK` is inherited unchanged: the launcher sets it to this
/// desktop's control socket.
///
/// With a `scope`, the client starts in its own systemd scope; see
/// [`app_scope::scoped`].
fn client_command(
    command: &[String],
    wayland_display: &OsStr,
    library_path: Option<&OsStr>,
    scope: Option<u64>,
) -> Option<Command> {
    let (program, args) = command.split_first()?;
    let words = match scope {
        Some(random) => app_scope::scoped(program, args, random),
        None => command.to_vec(),
    };
    let (program, args) = words.split_first().expect("both start with a program");
    let mut child = Command::new(program);
    child.args(args);
    for (name, value) in desktop_environment(wayland_display, library_path) {
        match value {
            Some(value) => child.env(name, value),
            None => child.env_remove(name),
        };
    }
    Some(child)
}

/// The variables [`client_command`] sets, or with `None` removes, so a process
/// runs in this desktop rather than the one the compositor was started from.
///
/// Also what the shell's processes run with; see `domicile_host::system`.
fn desktop_environment(wayland_display: &OsStr, library_path: Option<&OsStr>) -> Environment {
    [
        ("WAYLAND_DISPLAY", Some(wayland_display.to_os_string())),
        // For `OnlyShowIn` in `.desktop` files and for toolkits. Portal routing
        // uses the frontend's environment instead; see
        // `portals::say_which_desktop`.
        ("XDG_CURRENT_DESKTOP", Some(CURRENT_DESKTOP.into())),
        ("DISPLAY", None),
        ("LD_LIBRARY_PATH", library_path.and_then(without_the_engine)),
    ]
    .into_iter()
    .chain(
        WAYLAND_PREFERENCE
            .iter()
            .map(|&(name, value)| (name, Some(value.into()))),
    )
    .map(|(name, value)| (name.into(), value))
    .collect()
}

/// `path` without any directory containing the engine, or `None` if nothing is
/// left.
///
/// The engine's directory is Chromium's and holds its own `libvulkan.so.1`,
/// built without Xlib surfaces. A client that loads it fails, for example:
///
///   libgtk-4.so.1: undefined symbol: vkCreateXlibSurfaceKHR
///
/// Detected by contents rather than a flag, so a hand-started compositor with a
/// Chromium `out` directory on its path is covered.
fn without_the_engine(path: &OsStr) -> Option<OsString> {
    let kept: Vec<_> = std::env::split_paths(path)
        .filter(|directory| !directory.join(engine::LIBRARY).exists())
        .collect();
    (!kept.is_empty())
        .then(|| std::env::join_paths(kept).expect("split on the separator it is joined with"))
}

/// What each toolkit reads to choose Wayland over X11; see [`client_command`].
///
/// - `XDG_SESSION_TYPE`: what `--ozone-platform=auto` (Electron 38 and later,
///   and Chromium), Qt and GLFW look at when nothing more specific is set.
/// - `ELECTRON_OZONE_PLATFORM_HINT`: Electron 28 through 37, which otherwise
///   default to X11 (`element-desktop`, VS Code, Slack).
/// - `NIXOS_OZONE_WL`: nixpkgs' Electron and Chromium wrappers, which add the
///   Wayland flags only when it is set.
/// - `QT_QPA_PLATFORM`, `SDL_VIDEODRIVER`: Qt5 and SDL2, both X11 by default.
/// - `MOZ_ENABLE_WAYLAND`: Firefox before 121.
const WAYLAND_PREFERENCE: [(&str, &str); 6] = [
    ("XDG_SESSION_TYPE", "wayland"),
    ("ELECTRON_OZONE_PLATFORM_HINT", "wayland"),
    ("NIXOS_OZONE_WL", "1"),
    ("QT_QPA_PLATFORM", "wayland"),
    ("SDL_VIDEODRIVER", "wayland"),
    ("MOZ_ENABLE_WAYLAND", "1"),
];

/// Advertise `zwp_linux_dmabuf_v1`, with feedback when the DRM node is known.
///
/// Feedback (v4) tells clients which device to allocate on. Without `wl_drm`,
/// Mesa has no other source and never allocates against a v3 global. v3 remains
/// for software rendering, which has no node.
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
    debug!(
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

/// Watch the engine's fd, so [`DomicileCompositor::pump_the_engine`] runs when
/// the engine has events.
///
/// Separate because a replacement engine brings a new fd.
/// What captures the displays for monitor and region casts: the engine,
/// else the test pattern when it is on.
fn capturer<'a>(
    engine: &'a mut Option<EngineSession>,
    pattern: &'a mut Option<casting::TestPattern>,
) -> Option<&'a mut (dyn casting::Capturer + 'static)> {
    match engine {
        Some(session) => Some(session),
        None => pattern
            .as_mut()
            .map(|pattern| pattern as &mut dyn casting::Capturer),
    }
}

fn poll_the_engine(
    handle: &LoopHandle<'static, CalloopData>,
    fd: std::os::fd::RawFd,
) -> Result<RegistrationToken, Box<dyn std::error::Error>> {
    // Duplicate the fd: the source outlives this call, and the engine closes
    // the original when dropped.
    //
    // SAFETY: the fd belongs to the live engine and is valid until it is
    // destroyed. It is duplicated before this returns and never used as a
    // borrow afterward.
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

/// The libgbm device on the renderer's GPU, for copying shm frames.
///
/// `None` is logged once here, since it blanks every shm window.
fn shm_allocator(importer: &DmabufImporter) -> Option<Gbm> {
    let Some(node) = importer.node() else {
        warn!(
            "EGL renders on no DRM node — a software rasterizer — so there is no GPU to copy \
             shared-memory clients' frames onto; their windows will be blank"
        );
        return None;
    };
    match Gbm::open(gbm::LIBRARY, node) {
        Ok(gbm) => Some(gbm),
        Err(err) => {
            warn!(%err, "shared-memory clients' windows will be blank");
            None
        }
    }
}

/// The logical size of the buffer `surface` is committing, or `None` if it
/// commits none.
fn drawn_size(surface: &WlSurface) -> Option<(f64, f64)> {
    with_states(surface, |states| {
        let destination = states
            .cached_state
            .get::<ViewportCachedState>()
            .current()
            .dst
            .map(|size| (size.w, size.h));
        let mut attributes = states.cached_state.get::<SurfaceAttributes>();
        let attributes = attributes.current();
        let Some(BufferAssignment::NewBuffer(buffer)) = &attributes.buffer else {
            return None;
        };
        let (width, height) = surface_size(
            upright_size(
                committed_buffer(buffer)?.size(),
                Transform::from(attributes.buffer_transform),
            ),
            attributes.buffer_scale,
            destination,
        );
        Some((f64::from(width), f64::from(height)))
    })
}

/// Where a bubble is over `parent`, logical: its subsurface position from
/// the corner of the parent's window geometry, as a popup's is.
fn bubble_position(surface: &WlSurface, parent: &WlSurface) -> (f64, f64) {
    let location = with_states(surface, |states| {
        states
            .cached_state
            .get::<SubsurfaceCachedState>()
            .current()
            .location
    });
    let (x, y) = with_states(parent, window_geometry).map_or((0, 0), |(x, y, _, _)| (x, y));
    (f64::from(location.x - x), f64::from(location.y - y))
}

/// The surface's committed `xdg_surface.set_window_geometry`, as `(x, y, width,
/// height)` in logical units.
fn window_geometry(states: &SurfaceData) -> Option<(i32, i32, i32, i32)> {
    states
        .cached_state
        .get::<SurfaceCachedState>()
        .current()
        .geometry
        .map(|rect| (rect.loc.x, rect.loc.y, rect.size.w, rect.size.h))
}

/// Classify a committed buffer: a dmabuf if one is attached as user data,
/// otherwise shm.
fn committed_buffer(buffer: &wl_buffer::WlBuffer) -> Option<CommittedBuffer> {
    match get_dmabuf(buffer) {
        Ok(dmabuf) => Some(CommittedBuffer::Gpu(dmabuf.clone())),
        Err(_) => {
            shm_buffer_size(buffer).map(|(width, height)| CommittedBuffer::Pixels { width, height })
        }
    }
}

/// The size of a `wl_shm` buffer.
fn shm_buffer_size(buffer: &wl_buffer::WlBuffer) -> Option<(u32, u32)> {
    with_buffer_contents(buffer, |_ptr, _len, data| {
        Some((data.width.max(0) as u32, data.height.max(0) as u32))
    })
    .ok()
    .flatten()
}

/// Map a client's cursor request to the CSS keyword the chrome sets on its
/// `<app>` element.
///
/// `wp_cursor_shape_v1` mirrors the CSS keywords, so most map by name. Others,
/// including future additions, fall back to the nearest keyword.
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

/// Run the compositor, printing a readable error if it fails to start.
///
/// Not `main() -> Result`, because `Termination` prints errors with `Debug`,
/// which escapes newlines and wraps the variant name. Startup errors are what a
/// user reads when the desktop will not come up, so print them with `Display`,
/// as `bin/domicile.rs` does.
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
    // Color only on a terminal. Logs usually go to a file, where escape codes
    // break searches like `grep pid=1234`.
    let colored = std::io::IsTerminal::is_terminal(&std::io::stdout());
    match tracing_subscriber::EnvFilter::try_from_default_env() {
        Ok(filter) => tracing_subscriber::fmt()
            .with_ansi(colored)
            .with_env_filter(filter)
            .init(),
        Err(_) => tracing_subscriber::fmt().with_ansi(colored).init(),
    }

    // Parse arguments before binding anything. Another program writes them, so
    // an error is a bug and should not be buried in the startup log.
    let arguments = arguments(std::env::args_os().skip(1))?;

    // A config that will not load is fatal. Shells generate it, so a bad one
    // means a broken shell, and falling back to defaults would hide that.
    let config = match &arguments.config {
        Some(path) => Config::load(path)?,
        None => Config::default(),
    };
    // Unreadable apps are fatal for the same reason: `domicile` names the
    // directory only when it exists.
    let apps = match &arguments.apps {
        Some(directory) => domicile_launch::apps::apps_in(directory).map_err(|why| {
            format!(
                "cannot list Domicile's apps in {}: {why}",
                directory.display()
            )
        })?,
        None => Vec::new(),
    };

    let mut event_loop: EventLoop<CalloopData> = EventLoop::try_new()?;
    let display: Display<DomicileCompositor> = Display::new()?;
    let dh = display.handle();
    // Delegated compositing: Chromium sends one subsurface per quad, but only
    // to a compositor that advertises these. `wl_subcompositor` comes with
    // `CompositorState`. See `docs/architecture/WINDOW-COMPOSITING.md`.
    //
    // Advertising `wp_viewporter` commits to honoring it: Chromium then sets
    // its logical size through `wp_viewport.set_destination` instead of a
    // buffer scale. If ignored, every surface on a dense display is twice its
    // size. See `viewport`.
    ViewporterState::new::<DomicileCompositor>(&dh);
    // A window's exact scale, which `wl_output.scale` rounds up. Clients that
    // use it draw through `wp_viewporter`. See `place_window`.
    FractionalScaleManagerState::new::<DomicileCompositor>(&dh);
    SinglePixelBufferState::new::<DomicileCompositor>(&dh);
    ContentTypeState::new::<DomicileCompositor>(&dh);
    // Always advertised, even without an idle timeout, so a reload never
    // removes a global a client has bound.
    IdleInhibitManagerState::new::<DomicileCompositor>(&dh);
    // `parent_window` handles for portal dialogs.
    xdg_foreign::advertise(&dh);
    // Screenshot and recording tools such as `grim` and `wf-recorder`.
    screencopy::advertise(&dh);

    let mut seat_state = SeatState::new();
    let data_device_state = DataDeviceState::new::<DomicileCompositor>(&dh);
    let primary_selection_state = PrimarySelectionState::new::<DomicileCompositor>(&dh);
    // Every client sees both, as a clipboard manager is an ordinary client.
    let ext_data_control_state = ExtDataControlState::new::<DomicileCompositor, _>(
        &dh,
        Some(&primary_selection_state),
        |_| true,
    );
    let wlr_data_control_state = WlrDataControlState::new::<DomicileCompositor, _>(
        &dh,
        Some(&primary_selection_state),
        |_| true,
    );
    // Advertise a keyboard and pointer.
    let mut seat: Seat<DomicileCompositor> = seat_state.new_wl_seat(&dh, "domicile");
    // The seat's keymap is what every client receives. A keymap xkb cannot
    // compile is fatal at startup rather than silently replaced. On reload,
    // `retype_the_desktop` refuses it instead, since windows are open.
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
    // The same keymap as text, for the browser process, which has its own
    // layout engine and no fd. Compiled here because Smithay only exposes the
    // seat's keymap later, after the chrome socket accepts connections. See
    // `keymap`.
    let keymap = compiled_keymap(keyboard)?;
    // Resolve keybindings on it. Fatal at startup like the keymap, so no
    // binding silently does nothing. A reload refuses instead; see
    // `rebind_the_keys`.
    let keys = shell_config::keys(&config)?;
    seat.add_pointer();

    // Advertise an output per described display, or one following Domicile's
    // window. Some clients (e.g. weston-terminal) wait for a `wl_output` before
    // mapping, so do this before opening the socket.
    let output_manager_state = OutputManagerState::new_with_xdg_output::<DomicileCompositor>(&dh);
    let screens = screens_at_startup(&config);
    let cast_screens = screens.cast_screens();
    let outputs: Vec<LiveOutput> = screens
        .outputs()
        .map(|advertised| advertise_output(&dh, advertised))
        .collect();

    // Bind the Wayland socket before anything can spawn a client. A chrome may
    // send `spawn` as soon as it connects, and the client needs our display
    // name. The event loop source is added later.
    let source = ListeningSocketSource::new_auto()?;
    let socket_name = source.socket_name().to_os_string();
    // A second socket for the chrome, which identifies it; see
    // `ClientState::is_chrome`.
    let chrome_socket_name = chrome_display(&socket_name);
    let chrome_source = ListeningSocketSource::with_name(&chrome_socket_name)?;
    // One line each, so scripts can match each display separately.
    info!(
        display = ?socket_name,
        "domicile-compositor: apps connect here (WAYLAND_DISPLAY)"
    );
    info!(
        display = ?chrome_socket_name,
        "domicile-compositor: the chrome connects here (WAYLAND_DISPLAY)"
    );

    // Chrome requests to the Wayland thread.
    let (request_tx, request_rx) = channel::<ClientRequest>();
    // Cast and shot requests from any thread, such as the portals'.
    let (cast_requests, heard_cast_requests) = channel::<casting::Request>();
    // Passphrase verdicts from the checking thread.
    let (verdicts, heard_verdicts) = channel::<Verdict>();

    // Notifications, from the bus and from the portal. Published once the hub
    // exists. See `notifications`.
    let notification_server = notifications::serve(
        data_dirs(
            std::env::var_os("XDG_DATA_HOME"),
            std::env::var_os("XDG_DATA_DIRS"),
            home_directory().as_deref(),
        ),
        config.theme.icon_theme.clone(),
    );
    // State shared by the Wayland thread and chrome connections.
    let (hub, outbound_rx) = ChromeHub::new(
        request_tx,
        config.output.max_scale,
        socket_name.clone(),
        // Start before any client is spawned: an app asking for a color scheme
        // before the bus name is taken would get another backend's answer and
        // never ask again.
        portals::serve(
            theme_on_the_wire(config.theme.mode),
            &config.theme,
            config.lockdown.clone(),
            &socket_name.to_string_lossy(),
            std::env::var_os("WAYLAND_DISPLAY").as_deref(),
            notification_server.clone(),
            {
                let display = socket_name.clone();
                let scoped = arguments.scope_clients;
                move |command| spawn_client(command, &display, scoped)
            },
            portals::ScreenCasting {
                casting: casting::Casting::new(cast_requests.clone()),
                grants: domicile_launch::profile_path::state_directory(&|key| {
                    std::env::var(key).ok()
                })
                .map(|directory| directory.join("screen-cast-grants.v2.json")),
            },
        ),
    );
    // Before any chrome connects, so the handshake carries the desktop.
    {
        let mut host = hub.host.lock().unwrap();
        host.describe_displays(screens.outputs().map(Advertised::described).collect());
        hub.portals
            .displays(screens.outputs().map(Zone::from).collect());
        // The keymap, for the browser process to decode keys. Outside ChromeOS
        // nothing else gives Chromium's layout engine one. See `keymap`.
        host.set_keymap(keymap);
        // Keybindings, so a reloaded page gets them again.
        hand_over_the_keys(&mut host, keys);
        // Extensions, which the browser process installs. See
        // `docs/architecture/EXTENSIONS.md`.
        hand_over_the_extensions(&mut host, &config.extensions, &apps);
        // The theme, so the page paints correctly the first time. Set, not
        // `take_up_the_theme`, since there is nobody to broadcast to yet.
        host.set_theme(theme_on_the_wire(config.theme.mode));
        host.set_windows_theme(theme_on_the_wire(config.theme.mode));
        // The rest of the config's look, which the shell follows as the
        // settings portal's clients do.
        host.set_appearance(shell_appearance(&config.theme));
    }
    // The system tray, published through the hub. Start with an empty tray so a
    // desktop without a session bus still reports one. See `tray`.
    hub.host.lock().unwrap().set_tray(Vec::new());
    let publishing = Arc::clone(&hub);
    let _ = hub.tray.set(tray::serve(
        data_dirs(
            std::env::var_os("XDG_DATA_HOME"),
            std::env::var_os("XDG_DATA_DIRS"),
            home_directory().as_deref(),
        ),
        config.theme.icon_theme.clone(),
        move |items| {
            // Release the host before broadcasting.
            let told = publishing.host.lock().unwrap().set_tray(items);
            if let Some(message) = told {
                publishing.broadcast(message);
            }
        },
    ));
    // Notifications, published like the tray. Listening publishes the current
    // list. See `notifications`.
    let publishing = Arc::clone(&hub);
    notification_server.listen(move |items| {
        let told = publishing.host.lock().unwrap().set_notifications(items);
        if let Some(message) = told {
            publishing.broadcast(message);
        }
    });
    let _ = hub.notifications.set(notification_server);
    // Portal dialogs, published like notifications, starting empty. A dialog
    // asked for while no chrome is connected is refused; its `parent_window`
    // resolves through the `xdg_foreign` exports. See `portals`.
    hub.host
        .lock()
        .unwrap()
        .set_portal_requests(Vec::new(), Vec::new());
    let publishing = Arc::clone(&hub);
    let asking = Arc::clone(&hub);
    let resolving = Arc::clone(&hub);
    hub.portals.listen(
        move |items, capturing| {
            let told = publishing
                .host
                .lock()
                .unwrap()
                .set_portal_requests(items, capturing);
            if let Some(message) = told {
                publishing.broadcast(message);
            }
        },
        move || !asking.chromes.lock().unwrap().is_empty(),
        move |parent_window| {
            resolving
                .host
                .lock()
                .unwrap()
                .exports()
                .parent_window_app(parent_window)
        },
    );
    // Portal idle inhibitors, to the Wayland thread's idle clock.
    let waking = Arc::clone(&hub);
    hub.portals.hold_idle_through(move |held| {
        waking.send_request(ClientRequest::HeldAwakeByThePortal { held });
    });
    // The chords applications hold, which ride on the portal requests.
    let publishing = Arc::clone(&hub);
    hub.portals.listen_for_shortcuts(move |shortcuts| {
        let told = publishing
            .host
            .lock()
            .unwrap()
            .set_global_shortcuts(shortcuts);
        if let Some(message) = told {
            publishing.broadcast(message);
        }
    });
    // The Wallpaper portal's pictures ride with the dialogs. See `portals`.
    let showing = Arc::clone(&hub);
    hub.portals.show_wallpaper(move |wallpaper| {
        let told = showing.host.lock().unwrap().set_portal_wallpaper(wallpaper);
        if let Some(message) = told {
            showing.broadcast(message);
        }
    });
    // Bind here so a failure ends the run. Nothing can connect yet: the shell
    // waits for the session document, published much later.
    let chrome_listener = bind_chrome_socket(&arguments.chrome_socket)?;
    // Warn if no page connects. Otherwise a desktop with no chrome is just a
    // blank window with healthy-looking logs. Only this side can tell "not yet"
    // from "never". See `domicile_launch::handshake`.
    //
    // Only when `--expect-a-page` is set. Engine spike harnesses use their own
    // `file://` page and never connect here.
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

    // Without an EGL renderer (a container, no DRM device), the dmabuf global
    // is not advertised and clients fall back to `wl_shm`.
    //
    // The renderer imports client dmabufs and reads back shm buffers, which is
    // how client frames reach the engine.
    let mut gpu = match headless_renderer() {
        Ok((renderer, importer)) => Some(Gpu {
            gbm: shm_allocator(&importer),
            importer,
            renderer: Box::new(renderer),
        }),
        Err(err) => {
            tracing::warn!(%err, "no EGL renderer: serving wl_shm clients only");
            None
        }
    };

    // Casts allocate dmabufs on the render node, through their own libgbm.
    let casting_gpu = gpu.as_ref().and_then(|gpu| {
        gpu.gbm.as_ref()?;
        let node = gpu.importer.node()?.to_path_buf();
        Some(casting::Gpu::new(node, |fourcc| {
            render_modifiers(&gpu.renderer, fourcc)
        }))
    });
    // News from the PipeWire thread.
    let (cast_news, heard_cast_news) = channel::<casting::ToWayland>();

    let mut dmabuf_state = DmabufState::new();
    let dmabuf_global = gpu.as_mut().map(|gpu| {
        let importer_device = gpu.importer.main_device();
        let formats: Vec<_> = DmabufImporter::formats(gpu.renderer())
            .into_iter()
            .collect();
        advertise_dmabuf(&mut dmabuf_state, &dh, importer_device, formats)
    });

    // Load the engine if asked. Failure is fatal and names the library:
    // `dlopen` only keeps `cargo build` from needing Chromium, not a license to
    // run without it.
    //
    // Without `--engine-socket` no client window can be shown. That is valid
    // (the `scripts/` checks drive the chrome, input and displays without a
    // Chromium build), but it is logged.
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

    // Vendor names for monitors. Without the table, monitors use their EDID
    // codes (`DEL`), which works but is logged once so the short names are
    // explained.
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

    // If the config asks for PAM and it is unavailable, fail with the service
    // name. Running without the configured lock would contradict the config.
    // See `crate::lock::chosen`.
    //
    // Verdicts come back to this loop; see `heard_the_verdict`.
    let lock = lock::chosen(config.lock.verifier(), Path::new(pam::SERVICES))?.map(|verifier| {
        Lock::held_by(verifier, move |verdict| {
            verdicts
                .send(verdict)
                .expect("the loop that hears a verdict outlives the lock that asked for one")
        })
    });
    // Give chrome connections the lock state (see `answer_on_the_connection`).
    // Safe to set after connections start: the desktop starts unlocked, and
    // nothing can lock it before the event loop runs.
    if let Some(lock) = &lock {
        hub.lock
            .set(lock.seen())
            .expect("the lock is handed to the hub once, at startup");
    }

    let state = DomicileCompositor {
        compositor_state: CompositorState::new::<DomicileCompositor>(&dh),
        xdg_shell_state: XdgShellState::new::<DomicileCompositor>(&dh),
        xdg_activation_state: XdgActivationState::new::<DomicileCompositor>(&dh),
        _xdg_decoration_state: XdgDecorationState::new::<DomicileCompositor>(&dh),
        kde_decoration_state: KdeDecorationState::new::<DomicileCompositor>(
            &dh,
            KdeDefaultMode::Server,
        ),
        shm_state: ShmState::new::<DomicileCompositor>(&dh, vec![]),
        seat_state,
        data_device_state,
        primary_selection_state,
        ext_data_control_state,
        wlr_data_control_state,
        clipboard: History::default(),
        copying: [None, None],
        holding: [None, None],
        display_handle: dh.clone(),
        seat,
        output_manager_state,
        outputs,
        config: ConfigStore::new(config.clone()),
        engine_displays: Vec::new(),
        vendors,
        // Toolkits request cursors by name here, which map onto CSS cursor
        // keywords.
        cursor_shape_state: CursorShapeManagerState::new::<DomicileCompositor>(&dh),
        dmabuf_state,
        dmabuf_global,
        gpu,
        hub,
        scope_clients: arguments.scope_clients,
        apps,
        toplevels: Vec::new(),
        app_bounds: HashMap::new(),
        popups: Vec::new(),
        grabbing: Vec::new(),
        bubbles: Vec::new(),
        pointer_app: None,
        held_buttons: Vec::new(),
        captures: None,
        start: Instant::now(),
        last_commit: None,
        pending_key: None,
        latency: None,
        latency_app: None,
        latency_reported: false,
        shm_refused: HashSet::new(),
        uploads: Uploads::default(),
        configure_answers: HashMap::new(),
        shown: engine_damage::Shown::default(),
        size_limits: HashMap::new(),
        by_surface: HashMap::new(),
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
        stop: Arc::new(AtomicBool::new(false)),
        engine,
        // Armed below, and re-armed by `rejoin_the_engine`.
        engine_source: None,
        // Set by the first page hello.
        engine_process: None,
        idle: Idle::after(config.idle.blank_after(), Instant::now()),
        // Started below, after the event loop's sources.
        index: None,
        // Armed below by `arm_the_idle_clock`, the same path a reload uses.
        idle_clock: None,
        // Starts unlocked. Built once, never on reload; see the field.
        lock,
        turnover: None,
        turnover_deadline: None,
        casting: {
            let mut streams = casting::Streams::new(cast_news, casting_gpu);
            streams.screens(cast_screens, None);
            streams
        },
        cast_deadline: None,
        screen_copying: casting::Casting::new(cast_requests.clone()),
        cast_on_title: std::env::var("DOMICILE_CAST_WINDOW")
            .ok()
            .map(|title| (title, casting::Casting::new(cast_requests.clone()))),
        cast_on_monitor: std::env::var("DOMICILE_CAST_MONITOR")
            .ok()
            .map(|name| (name, casting::Casting::new(cast_requests))),
        cast_test_pattern: std::env::var_os("DOMICILE_CAST_TEST_PATTERN")
            .map(|_| casting::TestPattern::default()),
        loop_handle: event_loop.handle(),
    };

    let mut data = CalloopData { display, state };
    data.state.cast_the_monitor_if_asked();

    // Accept on the sockets bound above.
    let handle = event_loop.handle();
    handle.insert_source(source, move |stream, _, data: &mut CalloopData| {
        // Pairs with `spawning client` to time a launch. Before
        // `insert_client`, which takes the stream.
        debug!(pid = ?peer_pid(&stream), "{}", grepped::ARRIVED);
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

    // Dispatch Wayland clients from the event loop, then flush.
    let poll_fd = data.display.backend().poll_fd().try_clone_to_owned()?;
    handle.insert_source(
        Generic::new(poll_fd, Interest::READ, Mode::Level),
        |_, _, data: &mut CalloopData| {
            data.display.dispatch_clients(&mut data.state).unwrap();
            // After the dispatch, when dead clients' objects stop being alive.
            // See `let_go_of_what_the_dead_were_holding`.
            data.state.let_go_of_what_the_dead_were_holding();
            data.display.flush_clients().unwrap();
            Ok(PostAction::Continue)
        },
    )?;

    // The engine's fd, in this loop: the library does its work when dispatched,
    // never on its own threads.
    if let Some(session) = data.state.engine.as_ref() {
        data.state.engine_source = Some(poll_the_engine(&handle, session.fd())?);
    }

    // Test pattern frames, ten a second. See `cast_the_test_pattern`.
    if data.state.cast_test_pattern.is_some() {
        handle.insert_source(Timer::immediate(), |_, _, data: &mut CalloopData| {
            data.state.cast_the_test_pattern();
            TimeoutAction::ToDuration(Duration::from_millis(100))
        })?;
    }

    // The latency run's timer.
    //
    // A loop source, not a loop in the commit callback, so clients get releases
    // and frame callbacks between steps. See `step_the_latency`. Only installed
    // when a run is configured.
    if spike_latency_point().is_some() {
        handle.insert_source(Timer::immediate(), |_, _, data: &mut CalloopData| {
            // Re-arm immediately while there is work; calloop still dispatches
            // the other ready sources each turn. Otherwise wait 1 ms to avoid
            // spinning.
            if data.state.step_the_latency() {
                TimeoutAction::ToInstant(Instant::now())
            } else {
                TimeoutAction::ToDuration(Duration::from_millis(1))
            }
        })?;
    }

    // Build the file index from the home directory on a thread at startup, then
    // keep it updated by a watch.
    //
    // Without `HOME`, `search_files` answers nothing.
    match home_directory() {
        Some(home) => {
            let hub = data.state.hub.clone();
            let omit = config.files.omit.clone();
            let (told, heard) = mpsc::channel();
            data.state.index = Some(told.clone());
            thread::spawn(move || {
                keep_the_index(home, kept_at(), omit, (told, heard), |offered| {
                    // Published only for `search_files`; pages get query
                    // results, never the index.
                    *hub.offered.lock().unwrap() = Some(Arc::new(offered));
                });
            });
        }
        None => error!("no HOME in the environment, so there is no home to index"),
    }

    // The idle timer, only if a timeout is configured. The re-arm interval
    // comes from `Idle::next_check`. Shares `arm_the_idle_clock` with reloads,
    // but a failure here is fatal since nothing is running yet.
    data.state.arm_the_idle_clock(config.idle.blank_after())?;

    // Emulated input, served on this thread like the engine's, and handed to
    // the portals that take it.
    let (eis, captures) = eis::serve(&handle)?;
    data.state.captures = Some(captures);
    // The Clipboard portal's requests, handled where the seat lives.
    let (selections, heard_selections) = channel::<Selection>();
    handle.insert_source(heard_selections, |event, _, data: &mut CalloopData| {
        if let ChannelEvent::Msg(selection) = event {
            data.state.select_for_a_portal(selection);
        }
    })?;
    let selections = move |selection| {
        // Fails only once the loop has stopped.
        let _ = selections.send(selection);
    };
    data.state.hub.portals.attach(eis.clone(), selections);
    data.state
        .hub
        .eis
        .set(eis)
        .unwrap_or_else(|_| unreachable!("EIS is served once, at startup"));

    // Chrome requests, handled on the Wayland thread.
    handle.insert_source(request_rx, |event, _, data: &mut CalloopData| {
        if let ChannelEvent::Msg(input) = event {
            data.state.handle_client_request(input);
        }
    })?;

    // Casts, routed and filled on the thread that has the windows.
    handle.insert_source(heard_cast_requests, |event, _, data: &mut CalloopData| {
        if let ChannelEvent::Msg(request) = event {
            data.state.cast_requested(request);
        }
    })?;
    handle.insert_source(heard_cast_news, |event, _, data: &mut CalloopData| {
        if let ChannelEvent::Msg(news) = event {
            data.state.cast_news(news);
        }
    })?;

    // Passphrase verdicts, handled on the seat's thread where the lock can
    // open.
    handle.insert_source(heard_verdicts, |event, _, data: &mut CalloopData| {
        if let ChannelEvent::Msg(verdict) = event {
            data.state.heard_the_verdict(verdict);
        }
    })?;

    // How long the config must stay unchanged before a reload applies. Covers a
    // save's own writes while feeling immediate.
    const SETTLE: Duration = Duration::from_millis(150);
    // The longest a burst is coalesced. Without it, a directory written faster
    // than `SETTLE` would never reload.
    const BURST: Duration = Duration::from_secs(2);

    // Watch the config file for reloads.
    //
    // `domicile_config::watch` delivers on a std `mpsc` channel from the notify
    // thread; a forwarding thread moves results onto a calloop channel, since
    // the desktop can only change on this thread.
    //
    // A watcher that fails to start is logged and the config stays fixed. No
    // config file means nothing to watch.
    match arguments.config.as_ref() {
        None => debug!("no config file, so the desktop is fixed for this run"),
        Some(path) => match domicile_config::watch(path) {
            Ok(watcher) => {
                let (reload_tx, reload_rx) = channel::<Result<Config, ConfigError>>();
                thread::spawn(move || {
                    // Bind the whole watcher so the closure captures it.
                    // Edition 2021 closures capture only the fields used, so
                    // naming just `watcher.rx` would drop the OS watcher, close
                    // the channel and silently stop reloads. Tested by
                    // `tests/desktop.rs` and `tests/outputs.rs`, among others.
                    let watcher = watcher;
                    // Ends when the watcher is dropped or the event loop is
                    // gone.
                    while let Ok(first) = watcher.rx.recv() {
                        // One save is several events, and mid-save the file may
                        // be truncated. A truncated config still parses (no
                        // displays means "follow the window"), so every client
                        // would see its monitor vanish and return. Take only
                        // the last parse of a burst.
                        //
                        // Bounded by a deadline on the whole burst:
                        // `recv_timeout(SETTLE)` alone restarts on every event,
                        // and the watch is on the config's directory (to catch
                        // atomic renames), which also holds the chrome socket
                        // and session document.
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
                    // The outgoing config, to compute what changed; see
                    // `Restatement`.
                    let was = data.state.config.current().clone();
                    // A config that fails to parse keeps the live one and is
                    // recorded as the last error.
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
                        // No change: an undescribed config with no monitors
                        // read. The window controls the desktop, and rebuilding
                        // would undo its negotiated density.
                        Ok(None) => {}
                        Ok(Some(screens)) => {
                            let dh = data.display.handle();
                            data.state.adopt_the_desktop(&dh, screens);
                        }
                        // A profile matches the plugged-in monitors but cannot
                        // be applied. The config is accepted; the current
                        // desktop stays.
                        Err(err) => tracing::warn!(
                            %err,
                            "keeping the desktop that is up; the reloaded profile does not \
                             describe one these monitors can make"
                        ),
                    }
                    // Then the rest of the config, after the desktop so scale
                    // is advertised against the settled outputs. Always runs:
                    // even a failed profile may come with keyboard changes.
                    data.state.adopt_the_rest_of_the_config(&restated);
                })?;
            }
            Err(err) => {
                tracing::warn!(%err, "not watching the config; its displays are fixed for this run");
            }
        },
    }

    // Publish the session document last. The shell waits for it and treats it
    // as "everything is live", so nothing that can fail may come after it.
    //
    // The sockets were bound earlier, so they are listening when the chrome
    // connects.
    publish(
        &Session {
            protocol: domicile_protocol::PROTOCOL_VERSION,
            chrome_socket: arguments.chrome_socket.clone(),
            wayland_display: socket_name.to_string_lossy().into_owned(),
            chrome_wayland_display: chrome_socket_name.clone(),
        },
        &arguments.session,
    )?;
    // Startup commands, once the desktop is live. Not run on reload; see
    // `StartupConfig`.
    for command in &config.startup.commands {
        spawn_client(command, &socket_name, arguments.scope_clients);
    }

    // Flush after every loop iteration so events queued while handling input
    // reach clients promptly.
    let stop = data.state.stop.clone();
    let signal = event_loop.get_signal();
    event_loop.run(None, &mut data, move |data| {
        // Before the flush, which delivers the request to the copying client.
        // See `read_what_was_copied`.
        data.state.read_what_was_copied();
        let _ = data.display.flush_clients();
        if stop.load(Ordering::SeqCst) {
            signal.stop();
        }
    })?;
    Ok(())
}

/// The display refresh rate the latency run assumes, in mHz.
///
/// An assumption: viz's real interval is not reachable from here. `wl_output`'s
/// rate is not used, since it may be
/// [`UNKNOWN_REFRESH_MHZ`](crate::screens::UNKNOWN_REFRESH_MHZ).
const SPIKE_REFRESH_MHZ: i32 = 60_000;

/// Temporary, part of the spike. The key the latency run presses.
///
/// Enter, since a line-buffered program in a terminal reliably redraws on it.
const LATENCY_KEY: u32 = 28;

/// Temporary, part of the spike. Where the latency run watches for the client's
/// answer, from `DOMICILE_SPIKE_LATENCY`.
///
/// - `center`: the middle of the browser window, over the client on a
///   one-`<app>` page, so guards need no coordinates. `guard-client-window.sh`
///   does the same.
/// - `x,y`: a point, when the center is not over the client.
///
/// Unset means no run. The run presses keys into whatever has focus.
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

/// Temporary, part of the spike. The latency run's budget, from
/// `DOMICILE_SPIKE_LATENCY_BUDGET` as `rounds,floor_samples,max_polls`.
///
/// Unset uses the real measurement's defaults. Negative controls set it small,
/// since each abandoned round spends its whole poll budget. Clients stay served
/// throughout; see `step_the_latency`.
///
/// An unusable value logs a warning and disables the run instead of clamping;
/// see `Budget::parse`.
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

/// Parse `x,y`. Shared by the latency and probe settings so they agree.
fn parse_point(entry: &str) -> Option<(i32, i32)> {
    let (x, y) = entry.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// Temporary, part of the spike. Whether to sample what viz drew at the browser
/// window's center. Set by `DOMICILE_SPIKE_CENTER`.
///
/// Opt-in because each readback forces a draw and blocks the submit path.
fn spike_center_probe() -> bool {
    static CENTER: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CENTER.get_or_init(|| std::env::var_os("DOMICILE_SPIKE_CENTER").is_some())
}

/// Temporary, part of the spike. Points in the browser window to sample, from
/// `DOMICILE_SPIKE_PROBE` as `x,y;x,y`.
///
/// Empty by default. The two-window guard names one point per canvas. Parsed
/// once, since it is read at the client's frame rate.
///
/// Malformed entries are dropped with a warning; the guard still fails on
/// missing colors.
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

/// Temporary, part of the spike. Colors to find anywhere in the browser window,
/// from `DOMICILE_SPIKE_FIND` as `RRGGBB;RRGGBB` or `AARRGGBB;AARRGGBB`.
///
/// For shell guards, which cannot name a pixel because the shell lays out
/// windows. Six digits mean fully opaque.
fn spike_find_colors() -> &'static [u32] {
    static COLORS: std::sync::OnceLock<Vec<u32>> = std::sync::OnceLock::new();
    COLORS.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_FIND") else {
            return Vec::new();
        };
        parse_find_colors(&raw)
    })
}

/// Parse a [`spike_find_colors`] value. Separate from the env read so it can be
/// tested.
///
/// Malformed entries are dropped with a warning; the guard still fails on
/// missing colors.
fn parse_find_colors(raw: &str) -> Vec<u32> {
    raw.split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let digits = entry.strip_prefix('#').unwrap_or(entry);
            match (digits.len(), u32::from_str_radix(digits, 16)) {
                // Six digits are fully opaque. Window pixels are opaque, so a
                // zero alpha would match nothing.
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

    use smithay::input::pointer::CursorIcon;

    use domicile_protocol::CursorShape;

    use super::{
        answers_keystroke, at, client_command, clipboard_of, cursor_shape,
        hand_over_the_extensions, parse_find_colors, Clipboard, Committer, SelectionTarget, BOTH,
    };

    use domicile_protocol::HostMessage;

    /// The value `client_command` sets for `name`; `None` means cleared.
    fn child_env(command: &[String], display: &str, name: &str) -> Option<OsString> {
        child_env_from(command, display, None, name)
    }

    /// [`child_env`], for a compositor with `library_path` as its
    /// `LD_LIBRARY_PATH`.
    fn child_env_from(
        command: &[String],
        display: &str,
        library_path: Option<&OsStr>,
        name: &str,
    ) -> Option<OsString> {
        client_command(command, OsStr::new(display), library_path, None)
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
        // The compositor's own `WAYLAND_DISPLAY` may be the host's. A child
        // inheriting it would open on the host desktop.
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
    fn a_spawned_client_is_told_to_speak_wayland() {
        // No Xwayland, so X11-default toolkits (Electron, SDL2) would fail to
        // start. Inherited X settings are overridden.
        for (name, value) in [
            ("XDG_SESSION_TYPE", "wayland"),
            ("ELECTRON_OZONE_PLATFORM_HINT", "wayland"),
            ("NIXOS_OZONE_WL", "1"),
            ("QT_QPA_PLATFORM", "wayland"),
            ("SDL_VIDEODRIVER", "wayland"),
            ("MOZ_ENABLE_WAYLAND", "1"),
        ] {
            assert_eq!(
                child_env(&kitty(), "wayland-7", name),
                Some(OsString::from(value)),
                "{name}",
            );
        }
    }

    #[test]
    fn a_spawned_client_is_told_which_desktop_it_is_on() {
        // `xdg-desktop-portal` matches this against `UseIn=` in `.portal`
        // files, routing color scheme queries to our settings backend.
        assert_eq!(
            child_env(&kitty(), "wayland-7", "XDG_CURRENT_DESKTOP"),
            Some(OsString::from("domicile")),
        );
    }

    /// A directory with a stand-in engine library, as the launcher puts on
    /// `LD_LIBRARY_PATH`.
    fn engine_directory() -> tempfile::TempDir {
        let directory = tempfile::tempdir().expect("a temporary directory");
        std::fs::write(directory.path().join(crate::engine::LIBRARY), b"")
            .expect("the stand-in is written");
        directory
    }

    #[test]
    fn a_spawned_client_does_not_load_the_engines_libraries() {
        // The engine's directory holds Chromium's `libvulkan.so.1`, built
        // without Xlib surfaces. GTK 4 loaded it and failed:
        //
        //   libgtk-4.so.1: undefined symbol: vkCreateXlibSurfaceKHR
        let engine = engine_directory();
        let ours = std::env::join_paths([engine.path(), std::path::Path::new("/opt/lib")])
            .expect("joinable");
        assert_eq!(
            child_env_from(&kitty(), "wayland-7", Some(&ours), "LD_LIBRARY_PATH"),
            Some(OsString::from("/opt/lib")),
        );
    }

    #[test]
    fn a_spawned_client_of_a_compositor_that_only_had_the_engine_gets_no_library_path() {
        let engine = engine_directory();
        assert_eq!(
            child_env_from(
                &kitty(),
                "wayland-7",
                Some(engine.path().as_os_str()),
                "LD_LIBRARY_PATH"
            ),
            None,
        );
    }

    #[test]
    fn a_window_can_be_the_answer_to_a_keystroke() {
        assert!(answers_keystroke(&Committer::App("term".to_string())));
    }

    #[test]
    fn the_chromes_own_repaint_is_not_an_answer_to_a_keystroke() {
        // The chrome repaints for its own reasons; counting those would
        // misreport the wait.
        assert!(!answers_keystroke(&Committer::Chrome));
    }

    #[test]
    fn an_empty_command_spawns_nothing() {
        assert!(client_command(&[], OsStr::new("wayland-7"), None, None).is_none());
    }

    #[test]
    fn a_scoped_client_keeps_the_desktops_environment() {
        // `systemd-run --scope` execs the client with its own environment.
        let child = client_command(&kitty(), OsStr::new("wayland-7"), None, Some(7))
            .expect("a command with a program builds");
        assert_eq!(child.get_program(), "systemd-run");
        assert!(
            child
                .get_envs()
                .any(|pair| pair == (OsStr::new("WAYLAND_DISPLAY"), Some(OsStr::new("wayland-7")))),
            "{child:?}"
        );
    }

    #[test]
    fn an_unscoped_client_starts_itself() {
        let child = client_command(&kitty(), OsStr::new("wayland-7"), None, None)
            .expect("a command with a program builds");
        assert_eq!(child.get_program(), "kitty");
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
        // Shapes with no CSS keyword must still map to something the chrome can
        // use.
        assert_eq!(cursor_shape(CursorIcon::DndAsk), CursorShape::Default);
        assert_eq!(cursor_shape(CursorIcon::AllResize), CursorShape::Move);
    }

    /// Six digits mean opaque; window pixels are opaque, so no alpha would
    /// match nothing.
    #[test]
    fn a_color_with_no_alpha_is_opaque() {
        assert_eq!(parse_find_colors("19B36B"), vec![0xFF19_B36B]);
    }

    #[test]
    fn an_alpha_that_is_written_down_is_kept() {
        assert_eq!(parse_find_colors("8019B36B"), vec![0x8019_B36B]);
    }

    /// Guards write colors CSS-style, so `#` and spaces are accepted.
    #[test]
    fn a_leading_hash_and_the_spaces_around_an_entry_are_not_part_of_the_color() {
        assert_eq!(
            parse_find_colors(" #19B36B ; CC6633"),
            vec![0xFF19_B36B, 0xFFCC_6633]
        );
    }

    /// A typo drops only the mistyped color.
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

    /// Domicile's own apps go to the engine as unpacked extensions after the
    /// config's, so editing the config never uninstalls them.
    #[test]
    fn domicile_s_own_apps_are_installed_with_the_configs_extensions() {
        let mut host = domicile_host::Host::new();
        hand_over_the_extensions(
            &mut host,
            &domicile_config::ExtensionsConfig {
                web_store: vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".to_string()],
                unpacked: vec![std::path::PathBuf::from("/home/u/my-extension")],
            },
            &[std::path::PathBuf::from("/d/libexec/domicile/apps/history")],
        );
        assert_eq!(
            host.describe_extensions(),
            Some(HostMessage::Extensions {
                web_store: vec!["ddkjiahejlhfcafbddmgiahcphecmpfh".to_string()],
                unpacked: vec![
                    "/home/u/my-extension".to_string(),
                    "/d/libexec/domicile/apps/history".to_string(),
                ],
            })
        );
    }

    /// Smithay's selection targets map to the matching engine clipboards. A
    /// swap would be silent: Ctrl-C would land on the primary selection.
    #[test]
    fn each_clipboard_is_the_same_clipboard_in_both_vocabularies() {
        assert_eq!(clipboard_of(SelectionTarget::Clipboard), Clipboard::Copy);
        assert_eq!(clipboard_of(SelectionTarget::Primary), Clipboard::Primary);
    }

    /// Each clipboard has its own slot; a shared slot would read the wrong
    /// clipboard.
    #[test]
    fn the_two_clipboards_have_a_slot_each() {
        assert_ne!(at(Clipboard::Copy), at(Clipboard::Primary));
        assert!(at(Clipboard::Copy) < BOTH.len());
        assert!(at(Clipboard::Primary) < BOTH.len());
        assert_eq!(BOTH[at(Clipboard::Copy)], Clipboard::Copy);
        assert_eq!(BOTH[at(Clipboard::Primary)], Clipboard::Primary);
    }
}
