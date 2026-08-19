//! The wire contract between the Domicile host and the in-page bridge client.
//!
//! The chrome runs a small JS bridge that mirrors these types. Messages are
//! exchanged as JSON. Keep this crate dependency-light (serde only) so it stays
//! a clean, portable description of the protocol; the host maps these onto its
//! internal scene model, and the JS side mirrors them by hand.

use serde::{Deserialize, Serialize};

/// The protocol version this build speaks.
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
pub const PROTOCOL_VERSION: u32 = 7;

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
    },

    /// An `<app>` element was unmounted; the host should stop compositing it.
    RemovePortal { app_id: String },

    /// The chrome laid an `<app>` element out at a new size. The compositor
    /// configures the client to match so it re-renders at that resolution,
    /// rather than having its old buffer stretched into the new box.
    ResizeApp { app_id: String, size: [f64; 2] },

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

    /// A combination claimed with `GrabShortcut` was pressed.
    ///
    /// Delivered instead of to whatever held the keyboard, so the chrome hears
    /// it whether or not it was focused. Only presses: a release changes
    /// nothing and would arrive as a second event for one keystroke.
    Shortcut { shortcut: Shortcut },

    /// A new Wayland client wants a portal. The chrome decides where to mount
    /// its `<app id="…">` element.
    AppAppeared {
        app_id: String,
        title: Option<String>,
        size: [f64; 2],
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
    },

    /// A client went away; the chrome should unmount its `<app>` element.
    AppClosed { app_id: String },

    /// A client asked for a particular cursor over its surface. The chrome
    /// applies it to the app's element, so the pointer changes shape over an
    /// `<app>` exactly as it would over any other web content.
    AppCursor { app_id: String, cursor: CursorShape },
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
