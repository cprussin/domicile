//! The wire contract between the Domicile host and the in-page bridge client.
//!
//! The chrome runs a small JS bridge that mirrors these types. Messages are
//! exchanged as JSON. Keep this crate dependency-light (serde only) so it stays
//! a clean, portable description of the protocol; the host maps these onto its
//! internal scene model, and the JS side mirrors them by hand.

use serde::{Deserialize, Serialize};

/// The protocol version this build speaks.
///
/// v17 added `app_titled`: a client names its window with `set_title` after it
/// has one, so the name was never in the announcement and nothing carried it
/// afterwards. Every window was nameless to a chrome that shows names.
///
/// A bump although the message is new rather than changed, for the reason v13
/// and v14 give: what a host that does not send it looks like from a chrome is
/// silence. A v17 chrome would sit with every tab reading `app-1` and nothing
/// anywhere saying why. `negotiate` matching exactly is what turns that into a
/// chrome that refuses to start and names the two versions that disagreed.
///
/// v16 made `app_appeared`'s `size` optional, because a client that has just
/// mapped has not said one. It was `[0.0, 0.0]`, which is a size rather than
/// the absence of one — and a chrome that read it as the client's answer
/// opened a window with no box: never composited, because a zero-sized element
/// reports itself invisible, and never configured to a size to redraw at. A
/// v15 chrome would read `null` where it expects two numbers, so the versions
/// are not interchangeable.
///
/// v15 added `declare_bands` and `render_band`: the chrome names the depths it
/// draws at, and the compositor asks for one of them at a time — taking the
/// page's next commit as the answer, because a page cannot label its own
/// frames — so a window can be drawn between two of them.
///
/// A bump although the default is benign. A chrome that declares nothing is
/// drawn as one layer over every window, which is what every chrome did before
/// this existed, so a v14 chrome loses nothing against a v15 host. The other
/// direction is what needs the version: a v15 chrome declares its depths, a
/// v14 host does not know what was asked of it, and the chrome is drawn the
/// only way that host can draw it — so a window the shell placed between two
/// bands comes out under all of them. Nothing anywhere says so. `declare_bands`
/// is not acknowledged, because the asking *is* the acknowledgement, so a
/// declaration that fell on the floor and one that has simply not been acted on
/// yet look identical from the page. `negotiate` matching exactly is what turns
/// that into a chrome that refuses to start and names the two versions that
/// disagreed, rather than a desktop whose windows are stacked wrongly with no
/// way to find out why.
///
/// v14 is the same shape as v13 and a different promise: the host answers
/// every `hello` with `displays`, and re-sends it whenever the desktop
/// changes. v12 added the message and nothing sent it; a v13 host is still one
/// that may never describe a desktop at all.
///
/// A bump although no message changed. What separates a host that keeps this
/// promise from one that does not is host behaviour with no message of its
/// own, so it reaches the chrome only as silence: it waits for a `displays`
/// that is not coming, and nothing anywhere says why. `negotiate` matching
/// exactly is what lets the version carry that difference — turning the
/// silence into a chrome that refuses to start and says so, which is the
/// difference between a shell laying out `<Screen>`s against a host that has
/// not described the desktop *yet* and one that never will.
///
/// This entry argues only its own bump. Earlier attempts to justify it from
/// what some set of other bumps had in common were each false about an entry
/// below, and no property other bumps share is what justifies this one.
///
/// v13 added `close_app`: the chrome can ask a client to close its window, so
/// a native window's tab gets the same X button a chrome's own window has.
///
/// A bump although a v12 host would merely ignore the message, because that is
/// precisely what it does — silently. The button would be on screen and do
/// nothing, with no way for the page to tell that the host it is talking to
/// has no answer for it; `negotiate` matching exactly is what turns that into
/// a chrome that says why it did not start.
///
/// v12 added `displays`: the desktop is a list of displays the shell lays out
/// against, rather than one screen it can only assume. The chrome is one page
/// spanning all of them and puts things on one by position, so without this it
/// has nothing to position against.
///
/// A bump although nothing a v11 chrome sends changes, for the reason v11 had:
/// `negotiate` matches exactly, so a new host message is observable to an older
/// chrome as silence — and a chrome that never hears `displays` cannot tell a
/// single-display desktop from a host too old to describe one.
///
/// The bump made room for the message; it did not make the promise. No v12 or
/// v13 host ever answered `hello` with `displays` — that is v14.
///
/// v11 added `focus_changed`: the chrome is told who holds the keyboard, which
/// it could not work out for itself once a click or a closing window moved
/// focus without it asking.
///
/// A bump although nothing a v10 chrome sends changes, because `negotiate`
/// matches exactly and a new *host* message is observable to an older chrome
/// as silence. Left unbumped, a v10 chrome would start, mark whichever window
/// it last asked for as active, and be wrong from the first click onwards —
/// with nothing anywhere to say why.
///
/// v10 added `region` to `app_frame`: a frame carries only the part of the
/// buffer the client damaged, so the copy path stops paying megabytes for a
/// blinking cursor. A v9 chrome would draw those pixels as if they were the
/// whole buffer, which is a window drawn from its own top-left corner
/// outwards — visibly wrong rather than merely stale.
///
/// v9 added `takes_pointer` to `place_portal`: the chrome reports an element's
/// `pointer-events`, so a window the engine painted something over stops
/// swallowing the clicks meant for what covers it.
///
/// A bump rather than a silent addition, though the field defaults. The
/// default is for reading a message that predates the field, not for admitting
/// a chrome that would send one: `negotiate` matches exactly, so a v8 chrome
/// is turned away at `hello` and says so. Left unbumped it would instead have
/// started, placed every window as taking the pointer, and had its menus
/// swallowed by the windows under them with nothing anywhere to say why —
/// which is worse than not starting.
///
/// v8 added `native` to `place_portal` and `app_composited` alongside
/// `app_frame`: the chrome can see a computed style the compositor's shaders
/// have no answer for, and says so, and that window alone goes back down the
/// copy path — and the compositor answers when it has taken a window back, so
/// the chrome knows when the pixels it holds are stale.
///
/// A bump rather than a silent addition, though `native` defaults and
/// `app_composited` can be ignored. A v7 chrome would never send `native:
/// false`, so a window it styled with a `filter` would be drawn natively and
/// wrongly, and it would never drop a canvas it had been told to — leaving a
/// still of a window over the live one. Both are pictures that are quietly
/// wrong, which is worse than a chrome that is turned away at `hello` and says
/// so.
///
/// v7 added `shadow` to `place_portal`, for the same reason v6 added the other
/// two: the compositor draws the window, so a `box-shadow` on the element is
/// its to cast.
///
/// `negotiate` matches exactly, so an older chrome is turned away at the
/// handshake rather than running with the fields it knows — the version is what
/// the two halves agree on, not a floor. The `serde` defaults on the newer
/// fields are for reading a message that predates them, not for admitting a
/// chrome that would send one.
///
/// v6 added `corner_radius` and `opacity` to `place_portal`: the compositor
/// draws app windows itself, so a `border-radius` or an `opacity` on the
/// element is no longer something the engine applies to a picture of the
/// window — it has to be told.
///
/// v5 added `grab_shortcut` and `shortcut`: the chrome claims key combinations
/// and the compositor takes matching presses out of the stream before anyone is
/// given them. A v4 chrome never claims any, so its own shortcuts stop working
/// the moment a window takes the keyboard — which is what this fixes rather
/// than a difference in how a message is read.
///
/// v4 made the frame path scale-aware: the chrome reports its
/// `device_pixel_ratio`, and `app_frame` says at what `scale` its pixels were
/// drawn so the chrome can size a canvas backing store in device pixels while
/// laying the element out in logical ones. A v3 chrome would take a scaled
/// frame's pixel dimensions for logical ones and mis-map every pointer event,
/// so the versions are not interchangeable.
///
/// v3 moved an app's pixels out of the JSON: `app_frame` now carries a byte
/// count and the pixels follow the header line as raw bytes. A v2 chrome would
/// read those bytes as messages, so the versions are not interchangeable.
///
/// v2 added `resize_app`, `app_cursor`, and the high-resolution scroll fields
/// on `pointer_axis` — the last of which a v1 chrome does not send, so the
/// versions are not interchangeable.
pub const PROTOCOL_VERSION: u32 = 17;

/// A key combination the desktop claims for itself.
///
/// `key` is a Linux evdev keycode, the same numbering the chrome forwards
/// keystrokes in — not the X keycode the Wayland keymap uses, which is this
/// plus 8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Shortcut {
    pub key: u32,
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub logo: bool,
}

/// A shadow an element casts, in the logical units the placement is in.
///
/// One shadow, not the list CSS allows: the first, which is the one on top.
/// Inset shadows are not represented at all — they fall *inside* the box, over
/// the client's own pixels, and drawing one as an outer shadow would ring a
/// window that asked for the opposite.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Shadow {
    pub dx: f64,
    pub dy: f64,
    /// The width of the falloff. Zero is a hard edge, never negative.
    pub blur: f64,
    /// How much bigger than the window the shadow is before it blurs.
    pub spread: f64,
    /// Straight RGBA: channels 0-255, alpha 0-1, as CSS reports them.
    pub color: [f64; 4],
}

/// What an element with no `opacity` set has: all of it.
///
/// Spelled out because serde needs a function, and because a missing field
/// meaning *invisible* would be the worst possible default — a v5 chrome would
/// place windows nobody could see.
fn opaque() -> f64 {
    1.0
}

/// What a window whose chrome expressed no opinion gets: the fast path.
fn natively() -> bool {
    true
}

fn interactive() -> bool {
    true
}

/// Messages sent from the chrome (in-page bridge) to the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChromeMessage {
    /// First message after connecting; declares the version the chrome speaks.
    Hello { protocol_version: u32 },

    /// Report the on-screen placement of an `<app>` element. Sent whenever the
    /// element's geometry, stacking, or visibility changes. `transform` is a
    /// CSS `matrix(a,b,c,d,e,f)` mapping app-local pixels to screen space.
    PlacePortal {
        app_id: String,
        transform: [f64; 6],
        size: [f64; 2],
        z_index: i32,
        visible: bool,
        /// The element's `border-radius`, in the same logical units as `size`.
        ///
        /// One radius, not four: it is what the compositor's shader can apply
        /// without knowing which way up a client's buffer is, and it is what
        /// every window actually asks for. An element with four different
        /// corners reports the one it uses most.
        #[serde(default)]
        corner_radius: f64,
        /// The element's `opacity`, 0 to 1.
        #[serde(default = "opaque")]
        opacity: f64,
        /// The element's `box-shadow`, if it casts one that can be drawn.
        #[serde(default)]
        shadow: Option<Shadow>,
        /// Whether the compositor should draw this window's own buffer.
        ///
        /// False for an element styled in a way the compositor's shaders have
        /// no answer for — a `filter`, a `clip-path`, a shadow past the first.
        /// That window goes back down the copy path, which is slow and correct
        /// rather than fast and wrong, and only that window does.
        ///
        /// Natively by default, so a chrome with no opinion gets the fast
        /// path: a chrome that cannot say is a chrome from before there was
        /// anything the shaders could not draw.
        #[serde(default = "natively")]
        native: bool,
        /// Whether a pointer over this window belongs to it.
        ///
        /// False for an element with `pointer-events: none`. The compositor
        /// hit-tests a rectangle and cannot see what the engine painted over
        /// it, so a window under a menu, a dialog or a browser tab would
        /// swallow the clicks meant for them — and the click that hands the
        /// keyboard back to the chrome is one the chrome has to receive, so it
        /// would swallow the way out too.
        ///
        /// Takes the pointer by default: a chrome that cannot say is a chrome
        /// from before there was anything to paint over a window, and every
        /// window it places is meant to be used.
        #[serde(default = "interactive")]
        takes_pointer: bool,
    },

    /// An `<app>` element was unmounted; the host should stop compositing it.
    RemovePortal { app_id: String },

    /// The chrome laid an `<app>` element out at a new size. The compositor
    /// configures the client to match so it re-renders at that resolution,
    /// rather than having its old buffer stretched into the new box.
    ResizeApp { app_id: String, size: [f64; 2] },

    /// The depths the chrome draws at, so the compositor can put windows
    /// between them.
    ///
    /// One entry per depth, in the order the chrome will be asked to render
    /// them; the *values* are `z-index`, in the space `place_portal` reports a
    /// window's in, and are what order the drawing. A chrome that sends
    /// nothing here is drawn as one layer over every window, which is what
    /// every chrome did before this existed.
    ///
    /// Sent whenever the set changes, and a re-send of the same depths still
    /// means "start over": what is *at* a depth can move without the depth
    /// doing so.
    DeclareBands { depths: Vec<i32> },

    /// How many physical pixels the chrome paints per CSS pixel — its
    /// `devicePixelRatio`. The compositor advertises this as the `wl_output`
    /// scale, which is what makes a client render at the display's real
    /// resolution instead of drawing one pixel per CSS pixel and being
    /// stretched over the rest.
    ///
    /// Sent on connect and whenever it changes (moving a window between
    /// displays, or a browser zoom).
    SetDevicePixelRatio { ratio: f64 },

    /// Request keyboard focus for an app.
    FocusApp { app_id: String },

    /// Return keyboard focus to the chrome.
    FocusChrome,

    /// Ask a client to close the window `app_id`.
    ///
    /// A request, not a kill: the compositor sends the toplevel a close, and
    /// what happens next is the client's — a terminal exits, an editor with
    /// unsaved work puts a dialog up and stays. The window leaves the chrome
    /// when the client actually goes away and `app_closed` says so, which is
    /// why this has no answer of its own.
    CloseApp { app_id: String },

    /// Ask the compositor to spawn a client process (argv). The child inherits
    /// the compositor's environment, so it connects to Domicile's Wayland display.
    /// Used by chrome keybindings/launchers.
    Spawn { command: Vec<String> },

    /// Claim a key combination for the desktop, whatever holds the keyboard.
    ///
    /// A chrome shortcut cannot depend on the chrome being focused: the moment
    /// a window is, every key goes to it, and the combination that would put
    /// another window on screen is the one the user can no longer press. The
    /// compositor holds these and takes matching presses out of the stream
    /// before anyone is given them, which is what "global" means.
    ///
    /// Registering the same combination twice is not an error; it is one claim.
    GrabShortcut { shortcut: Shortcut },

    // --- input forwarding: the chrome captures input over an <app> element and
    // forwards it here so the compositor can inject it into the client. ---
    /// Pointer moved to a surface-local coordinate `(x, y)` over an app.
    PointerMotion { app_id: String, x: f64, y: f64 },
    /// Pointer left an app (focus returns to the chrome).
    PointerLeave { app_id: String },
    /// Pointer button changed over an app. `button` is a Linux input event code
    /// (e.g. `0x110` = left, `0x111` = right, `0x112` = middle).
    PointerButton {
        app_id: String,
        button: u32,
        pressed: bool,
    },
    /// Scroll over an app. `dx`/`dy` are the continuous distance in
    /// surface-logical units; `v120_x`/`v120_y` are the same scroll as
    /// `wl_pointer`'s high-resolution discrete steps, 120 per wheel detent.
    PointerAxis {
        app_id: String,
        dx: f64,
        dy: f64,
        v120_x: i32,
        v120_y: i32,
    },
    /// Key event destined for the focused app. `keycode` is a Linux evdev code.
    Key {
        app_id: String,
        keycode: u32,
        pressed: bool,
    },
}

/// Messages sent from the host to the chrome (in-page bridge).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostMessage {
    /// Response to `Hello`; declares the version the host agreed to speak.
    Welcome { protocol_version: u32 },

    /// Render only the band at this index of the last `declare_bands`, and
    /// commit it.
    ///
    /// The compositor asks for one at a time and takes the chrome's next
    /// commit as the answer, because the page cannot label its own frames: the
    /// Wayland connection belongs to Chromium rather than to the page, and a
    /// label sent back over this socket would not be ordered against the
    /// commit it describes. One question outstanding is what makes the next
    /// commit unambiguous. See `docs/architecture/WINDOW-COMPOSITING.md`.
    RenderBand { band: u32 },

    /// A combination claimed with `GrabShortcut` was pressed.
    ///
    /// Delivered instead of to whatever held the keyboard, so the chrome hears
    /// it whether or not it was focused. Only presses: a release changes
    /// nothing and would arrive as a second event for one keystroke.
    Shortcut { shortcut: Shortcut },

    /// A new Wayland client wants a portal. The chrome decides where to mount
    /// its `<app id="…">` element.
    ///
    /// `size` is absent until the client has committed a buffer, which it has
    /// not when this goes out: a toplevel maps before it draws, and how big it
    /// wants to be is something it says by drawing. The size follows on
    /// [`HostMessage::AppResized`]. A chrome that has none must decide the
    /// window's size itself rather than believe a number here.
    AppAppeared {
        app_id: String,
        title: Option<String>,
        size: Option<[f64; 2]>,
    },

    /// A client said what its window is called, and says it again whenever
    /// that changes — which for a terminal is every command it runs.
    ///
    /// Separate from [`HostMessage::AppAppeared`] because the announcement
    /// comes first: a toplevel is announced when the client creates it, and
    /// `set_title` is a request it makes afterwards, so the announcement
    /// carries whatever was known then — which is nothing.
    ///
    /// `title` is optional to match [`HostMessage::AppAppeared`]'s, not
    /// because a client can take its name back: xdg-shell has no request that
    /// unsets one, so nothing here sends `None` today. What a client saying it
    /// has no name actually looks like is `set_title("")`, which the chrome
    /// reads as no name at all.
    AppTitled {
        app_id: String,
        title: Option<String>,
    },

    /// A client's content size changed, in **logical** units — the CSS pixels
    /// the chrome lays out in and the coordinates `wl_pointer` speaks, not the
    /// buffer's own pixels, which at scale > 1 are more numerous.
    AppResized { app_id: String, size: [f64; 2] },

    /// A new pixel frame for an app surface, to draw into its `<app>` element.
    ///
    /// The pixels are **not** in this message: `bytes` says how many follow the
    /// header line, as raw row-major RGBA (`width * height * 4`). They travel
    /// outside the JSON because base64 is the most expensive step in the frame
    /// path — encoding, escaping and decoding one full-window frame costs ~50ms
    /// between the two processes, ~31ms of it on the renderer thread that also
    /// handles the keyboard.
    ///
    /// This is still the copy-based stopgap until the dmabuf/CEF bridge lands.
    AppFrame {
        app_id: String,
        /// The buffer's own dimensions, in device pixels. This is the size of
        /// the pixel data and so of the canvas backing store; divide by
        /// `scale` for the logical size the element is laid out at.
        width: u32,
        height: u32,
        /// How many device pixels the client drew per logical unit. 1 for a
        /// client that does not scale, which is the graceful floor: its frame
        /// is then exactly as sharp as it was before any of this existed.
        scale: u32,
        format: String,
        bytes: u32,
        /// Which part of the buffer these bytes are, as `[x, y, width,
        /// height]` in buffer pixels. Absent means all of it.
        ///
        /// The copy path's cost is bytes — a frame crosses a Unix socket and
        /// then the engine's process boundary — so a client that changed a
        /// cursor cell sends a cursor cell. Only ever present when the chrome
        /// still holds the frame this one patches; the compositor sends the
        /// whole buffer for a first frame, a resize, or a window whose pixels
        /// it just handed back.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<[u32; 4]>,
    },

    /// A client went away; the chrome should unmount its `<app>` element.
    AppClosed { app_id: String },

    /// A client asked for a particular cursor over its surface. The chrome
    /// applies it to the app's element, so the pointer changes shape over an
    /// `<app>` exactly as it would over any other web content.
    AppCursor { app_id: String, cursor: CursorShape },

    /// What the desktop is made of, so the shell can lay out against it.
    ///
    /// The chrome is a single page spanning every display, and a display is a
    /// region of that page — so this is what tells it where those regions are.
    ///
    /// Answered to `hello`, after `welcome`, and sent again whenever the
    /// desktop changes: with no displays configured it is Domicile's own
    /// window, so resizing that window or changing its density re-describes it.
    ///
    /// Latest wins, and that is the only ordering guaranteed. A change
    /// broadcast goes out to every connection, including one accepted but not
    /// yet welcomed, so it can arrive before the `welcome` that a handshake
    /// answer follows — a chrome that reads this before agreeing a version is
    /// reading a desktop it will be told again.
    ///
    /// Empty is a desktop of no screens. The *compositor* never sends it: it
    /// describes at least one output, and the window-following case is a
    /// display named `domicile-0` rather than an absence. It is the state of a
    /// `Host` nobody has described a desktop to — unit tests, and the
    /// `domicile` daemon, which serves this protocol from a bare `Session` and
    /// never describes one. A chrome told an empty list has no screens to lay
    /// out on, which is the honest answer from a host that never asked for any.
    Displays { displays: Vec<DisplayInfo> },

    /// The compositor has taken this window back and is drawing the client's
    /// own buffer; the chrome should drop any pixels it holds for it.
    ///
    /// The counterpart to `app_frame`, and the reason it is a message rather
    /// than something the chrome works out for itself: only the compositor
    /// knows whether it *managed* to draw the window. A `wl_shm` client is
    /// never drawn natively however ordinary its element's CSS, and a chrome
    /// that dropped its canvas on the strength of its own `native: true` would
    /// blank that window until the client next redrew.
    ///
    /// Sent on the frame the compositor first draws itself, so it arrives
    /// after the last copied frame on the same socket. A chrome that drops the
    /// canvas any earlier races the frames still in flight, and one of them
    /// puts a still of the window back over the live one.
    AppComposited { app_id: String },

    /// Who holds the keyboard now: an app, or the chrome itself (`None`).
    ///
    /// The chrome asks for focus with `focus_app`, but it is not the only
    /// thing that moves it — a click on a window focuses it in the compositor,
    /// and a focused client going away hands the keyboard back. Without this
    /// the chrome's idea of which window is active is right until the first
    /// click and wrong afterwards, which is every focus affordance a desktop
    /// has: the active title bar, the highlighted taskbar entry, the border.
    ///
    /// Sent when it *changes*, to every chrome — focus is the desktop's, and a
    /// page not told has missed the change for good. It also rides along with
    /// the windows a connecting chrome is caught up on, so a page that has just
    /// loaded knows without having to ask; that catch-up is broadcast too, and
    /// a chrome that already knew is being told what it already knew.
    FocusChanged {
        /// `None` means the chrome holds the keyboard.
        app_id: Option<String>,
    },
}

/// One display of the desktop, as the chrome is told about it.
///
/// All of it logical — the CSS pixels the chrome lays out in — and all of it in
/// one desktop-wide coordinate space whose origin is the top-left corner of the
/// displays' bounding box. The config may place a display anywhere, negative
/// included; what reaches here is normalised, because the page it describes
/// starts at zero.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayInfo {
    /// What the shell addresses this display by, e.g. `<Screen name="left">`.
    pub name: String,
    /// Its top-left corner in the desktop's coordinate space.
    pub position: [i32; 2],
    /// Its width and height, logical. A `wl_output` mode is this times `scale`.
    pub size: [u32; 2],
    /// The `wl_output` scale advertised to clients on this display.
    ///
    /// It governs what *clients* draw at. The chrome is one page at one
    /// `devicePixelRatio`, so it is not what the chrome itself renders at.
    pub scale: u32,
}

/// A cursor a client can ask for, named as the CSS `cursor` keyword the chrome
/// applies. These are the shapes `wp_cursor_shape_v1` defines, plus
/// [`CursorShape::None`] for a client that hides the cursor entirely.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CursorShape {
    None,
    Default,
    ContextMenu,
    Help,
    Pointer,
    Progress,
    Wait,
    Cell,
    Crosshair,
    Text,
    VerticalText,
    Alias,
    Copy,
    Move,
    NoDrop,
    NotAllowed,
    Grab,
    Grabbing,
    EResize,
    NResize,
    NeResize,
    NwResize,
    SResize,
    SeResize,
    SwResize,
    WResize,
    EwResize,
    NsResize,
    NeswResize,
    NwseResize,
    ColResize,
    RowResize,
    AllScroll,
    ZoomIn,
    ZoomOut,
}

/// Version negotiation failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("incompatible protocol version: host speaks {host}, chrome speaks {chrome}")]
pub struct VersionMismatch {
    pub host: u32,
    pub chrome: u32,
}

/// Negotiate a protocol version against a chrome that speaks `chrome_version`.
///
/// v1 requires an exact match; this is where looser compatibility rules would
/// live as the protocol evolves.
pub fn negotiate(chrome_version: u32) -> Result<u32, VersionMismatch> {
    if chrome_version == PROTOCOL_VERSION {
        Ok(PROTOCOL_VERSION)
    } else {
        Err(VersionMismatch {
            host: PROTOCOL_VERSION,
            chrome: chrome_version,
        })
    }
}
