//! The wire contract between the Domicile host and the in-page client.
//!
//! The chrome runs a small JS client that mirrors these types. Messages are
//! exchanged as JSON. Keep this crate dependency-light (serde only) so it stays
//! a clean, portable description of the protocol; the host maps these onto its
//! internal scene model, and the JS side mirrors them by hand.

use serde::{Deserialize, Serialize};

/// The protocol version this build speaks.
///
/// Pinned at 1, and there is no version history above it any more. The host
/// and every shipped chrome are built from this repo at the same commit, so
/// there are no two builds that can disagree and nothing for a number to
/// protect. Bumping it per wire change was bookkeeping about a skew that
/// cannot happen, and the history was an argument for refusing handshakes
/// nobody makes.
///
/// It starts mattering when a chrome ships separately from the host — an
/// outside shell, or a released binary someone upgrades one half of. That is
/// when to start bumping this and writing down why. The rule to loosen then is
/// written out three times, once per peer that has to apply it: [`negotiate`]
/// here, `DomicileClient`'s welcome check in `@domicile/chrome-sdk`, and `greet`
/// in `domicile-test-chrome`.
///
/// Meanwhile the `#[serde(default)]` on the newer fields below stays, and is
/// not a compatibility floor. Nothing can complete a handshake and then send a
/// message missing them, because the match is exact. They are there so a
/// message that predates a field can still be *read* — by a test fixture, a
/// captured session, a hand-written line in `wire/host-messages.jsonl` — which
/// is a thing this crate does independently of who it is talking to.
pub const PROTOCOL_VERSION: u32 = 1;

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

/// Messages sent from the chrome (in-page client) to the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChromeMessage {
    /// First message after connecting; declares the version the chrome speaks.
    Hello { protocol_version: u32 },

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

    /// Which display this chrome's window covers, by the name the desktop
    /// describes it under.
    ///
    /// **A DESK OF SEVERAL MONITORS IS SEVERAL WINDOWS, AND EACH ONE IS ONE
    /// SCREEN.** One window cannot span two CRTCs, so the engine opens one per
    /// display; without this every one of them would be told the whole desktop
    /// and would lay its `<Screen>` regions out in the desktop's coordinates,
    /// putting the desktop's top-left corner on every monitor.
    ///
    /// Sent once, on connecting, by a chrome that knows which display it is.
    /// The answer is the desktop narrowed to that one display and moved to the
    /// origin, so a page goes on laying out in the coordinates it always did
    /// and a shell needs to know nothing about any of this.
    ///
    /// A chrome that never sends one is told the whole desktop, which is what
    /// a nested run is and what every chrome was before this existed.
    SetScreen { name: String },

    /// The chrome's own viewport, in CSS pixels: how big the desktop is.
    ///
    /// **The desktop is the chrome's window, and this is the only way the
    /// compositor can learn its size when it is not drawing that window
    /// itself.** The window is the browser's, the compositor never sees it,
    /// and without this the desktop stays at the compositor's startup
    /// placeholder however big the window is — a chrome laid out for 1280x800
    /// in the corner of whatever the user actually opened.
    ///
    /// Its own message rather than a field on the density above, so each
    /// carries one fact: they change independently (a resize is not a
    /// density change) and the compositor restates the mode from whichever
    /// half moved, exactly as it already does for the scale.
    ///
    /// Sent on connect and on every resize.
    SetDesktopSize { size: [f64; 2] },

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

    /// What is there to open? Answered with [`HostMessage::Files`].
    ///
    /// A shell's launcher is a page, and a page has no filesystem: there is no
    /// `readdir` on `window.domicile` and this is deliberately not one. **It
    /// carries no path**, so nothing a page can say decides which directory is
    /// read — the compositor holds that policy, and the document served over
    /// `domicile://` gains no reach into the filesystem by asking. A launcher
    /// wants one list of what a user might open, not a directory browser, and
    /// this is that list.
    ///
    /// Asked again whenever the shell wants a fresh answer; nothing is pushed,
    /// because a home directory changes for reasons no desktop is watching.
    ListFiles,
}

/// Messages sent from the host to the chrome (in-page client).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostMessage {
    /// Response to `Hello`; declares the version the host agreed to speak.
    Welcome { protocol_version: u32 },

    /// A combination the desktop claimed for itself was pressed.
    ///
    /// Delivered instead of to whatever held the keyboard, so the chrome hears
    /// it whether or not it was focused. Only presses: a release changes
    /// nothing and would arrive as a second event for one keystroke.
    ///
    /// THE CLAIM ITSELF IS NO LONGER MADE HERE. A chrome used to send
    /// `grab_shortcut` down this socket and the compositor held the set; it
    /// cannot any more, because a browser window is a page inside the chrome's
    /// own window and forwards not one of its keys. The browser process is the
    /// only layer above a focused guest, so it holds the claims and matches
    /// them.
    Shortcut { shortcut: Shortcut },

    /// Which modifier keys are held now, whenever that changes.
    ///
    /// The chrome cannot see this for itself: `wl_keyboard.modifiers` goes to
    /// the surface that holds the keyboard, so the moment a window is focused
    /// the page stops being told — and a chrome whose windows answer to a held
    /// modifier needs to know exactly then. Alt to drag a window is why this
    /// exists.
    ///
    /// Which modifiers are down, never which key put them there: no ordinary
    /// key appears here, and one held down sends nothing at all. A chrome that
    /// connects mid-keystroke is not caught up on this, because the state it
    /// would be caught up on is one a user is holding — the next thing that
    /// happens is them letting go, which is a message.
    ///
    /// Not a claim: the focused client is given the key as well. A modifier
    /// the chrome had to take would be one no window could ever use.
    Modifiers {
        alt: bool,
        ctrl: bool,
        shift: bool,
        logo: bool,
    },

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
    /// `set_title` is a request it makes afterward, so the announcement
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

    /// The keymap the compositor compiled, in `XKB_KEYMAP_FORMAT_TEXT_V1` —
    /// the same text `wl_keyboard.keymap` hands a Wayland client.
    ///
    /// **This one is read by the browser process and never reaches the page.**
    /// The chrome's engine decodes a key with a `KeyboardLayoutEngine` of its
    /// own, and off ChromeOS nothing ever sets that engine a keymap: the two
    /// setters that would are `#[cfg(IS_CHROMEOS)]`, and the third —
    /// `SetCurrentLayoutFromBuffer`, which is not gated — has exactly one
    /// caller upstream, the Wayland ozone platform handling this same event.
    /// A DRM/Ozone browser therefore holds a null `xkb_state`, logs
    /// `No current XKB state` at every keypress, and answers every printable
    /// key with an unidentified `DomKey` and a positional US-QWERTY keycode.
    /// So a user typing into the shell gets no character at all, whatever
    /// `xkb_layout` they configured.
    ///
    /// The compositor is where the keymap is, because the keymap is what it
    /// hands its clients: the shell and the windows on it read one layout
    /// rather than each reading `input.keyboard` for itself. That is why the
    /// compiled text crosses rather than the `XkbConfig` behind it — a browser
    /// handed the config would be a second reading of it, with nothing
    /// anywhere comparing the two answers.
    ///
    /// A fact and not a stream, like [`HostMessage::Displays`]: it rides with
    /// the handshake, so a page that reloads — a new control channel, and a
    /// browser process whose engine may have been handed nothing yet — is told
    /// again rather than having had to be listening.
    Keymap { keymap: String },

    /// Who holds the keyboard now: an app, or the chrome itself (`None`).
    ///
    /// The chrome asks for focus with `focus_app`, but it is not the only
    /// thing that moves it — a click on a window focuses it in the compositor,
    /// and a focused client going away hands the keyboard back. Without this
    /// the chrome's idea of which window is active is right until the first
    /// click and wrong afterward, which is every focus affordance a desktop
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

    /// A client asked for the keyboard. Nothing has moved yet.
    ///
    /// The counterpart to [`HostMessage::FocusChanged`], and deliberately not
    /// the same message: that one reports a decision, this one is a request,
    /// and the shell is what turns the second into the first by answering with
    /// `focus_app` — or by ignoring it, which is the point. A compositor that
    /// honored the request itself would be deciding the shell's policy for
    /// it, and there would be no way to write a desktop where a window cannot
    /// steal what the user is typing into.
    ///
    /// `xdg-activation` is what a client sends to raise this — the protocol
    /// behind "open this link in the browser you already have running", and
    /// behind every dialog that wants to be in front. A shell that does
    /// nothing with it is a desktop where those requests are refused, which is
    /// a defensible policy and used to be the only one available.
    ///
    /// Not sent for the click that focuses a window: the click is the page's
    /// own event, it never reaches the compositor as anything but pointer
    /// input, and the shell has already decided by the time the seat moves.
    /// See `APP_FOCUS_REQUESTED_EVENT` in `@domicile/chrome-sdk`, which is the
    /// same question asked where the answer is known.
    FocusRequested { app_id: String },

    /// What there is to open, answering [`ChromeMessage::ListFiles`].
    ///
    /// Paths relative to the home directory — `Notes/today.org` rather than
    /// `/home/you/Notes/today.org` — because that is what a launcher draws and
    /// because the part every row would share is the part no row needs. A
    /// shell that opens one hands it straight back to `spawn`, and the
    /// compositor's child inherits the home directory it was named from.
    ///
    /// Sorted, and the order is the answer: see `domicile_host::files`, which
    /// is where the walk and the sort live.
    ///
    /// An empty list is a home with nothing to offer, which is a real answer
    /// rather than a failure — the same distinction [`HostMessage::Displays`]
    /// draws.
    Files { files: Vec<String> },
}

/// One display of the desktop, as the chrome is told about it.
///
/// All of it logical — the CSS pixels the chrome lays out in — and all of it in
/// one desktop-wide coordinate space whose origin is the top-left corner of the
/// displays' bounding box. The config may place a display anywhere, negative
/// included; what reaches here is normalized, because the page it describes
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
    /// The pixels the monitor scans out, un-turned.
    ///
    /// The one field here that is not logical, and it is not a second spelling
    /// of `size`: a monitor on its side scans out exactly as it did lying
    /// down, and `size` is that mode *turned* and divided by the density. A
    /// portrait 4K panel is `mode: [3840, 2160]` and `size: [1800, 3200]`.
    ///
    /// Sent about every display, because it is a fact about the panel that a
    /// shell may want to show. What makes it load-bearing is
    /// [`fills_the_window`](DisplayInfo::fills_the_window), which says this
    /// mode is also the page's own viewport.
    #[serde(default)]
    pub mode: [u32; 2],
    /// Which way up the monitor is bolted to the desk.
    #[serde(default)]
    pub transform: DisplayTransform,
    /// This display is the whole page, so the page has to fill it.
    ///
    /// **A DESK OF SEVERAL MONITORS IS SEVERAL PAGES.** Where the engine scans
    /// out it opens one browser window per CRTC, each window is its monitor's
    /// `mode` in CSS pixels, and each loads the same shell — so a page is told
    /// this one display, at the origin, and has to draw its logical box over
    /// the whole window. That is `mode` divided by `size`, turned by
    /// `transform`: the two facts above stop being description and become the
    /// map from what the shell lays out in to what the monitor shows.
    ///
    /// False for every desktop the page's window is the whole of — a nested
    /// run, a developer window — where the page's CSS pixels already *are* the
    /// desktop's logical ones and there is nothing to map.
    #[serde(default)]
    pub fills_the_window: bool,
}

/// Which way up a monitor is bolted to the desk.
///
/// Rotations only, which is all a config can ask for. The same four
/// `wl_output.transform` values the compositor advertises to clients, spelled
/// the way the config file writes them.
///
/// **NAMED FOR THE TURN THE CONTENT TAKES, NOT THE ONE THE PANEL DID.** That
/// is the `wl_output` convention and `domicile-config`'s: `transform_90` is an
/// output rotated a quarter turn anticlockwise, so what is drawn on it has to
/// go a quarter turn *clockwise* to come out upright, and that clockwise turn
/// is what this names. A page applies it as written.
///
/// The spelling is not `rename_all`: serde's kebab-case reads `Rotate270` as
/// one word and writes `rotate270`, which is neither what the config file says
/// nor what `wl_output` is called anywhere.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayTransform {
    /// The way the connector scans out, which is the way most monitors sit.
    #[default]
    #[serde(rename = "normal")]
    Normal,
    /// A quarter turn clockwise.
    #[serde(rename = "rotate-90")]
    Rotate90,
    #[serde(rename = "rotate-180")]
    Rotate180,
    /// A quarter turn anticlockwise, which is how a monitor on a desk usually
    /// ends up standing on its side.
    #[serde(rename = "rotate-270")]
    Rotate270,
}

impl DisplayTransform {
    /// Whether this turn trades the monitor's width for its height.
    ///
    /// The one thing a transform changes about arithmetic; everything else it
    /// changes is pixels. A page uses it to know which way `mode` divides into
    /// `size`.
    pub fn swaps_axes(self) -> bool {
        match self {
            Self::Normal | Self::Rotate180 => false,
            Self::Rotate90 | Self::Rotate270 => true,
        }
    }
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

#[cfg(test)]
mod wire_names {
    use super::*;

    /// The exact JSON `@domicile/chrome-sdk` puts on the wire for the desktop
    /// size, spelled out.
    ///
    /// A second spelling, deliberately. Nothing checks that the TypeScript
    /// message strings and this enum agree — `chrome-message.ts` writes
    /// `"set_desktop_size"` as a literal and serde derives it from the variant
    /// name, and the two only meet at runtime, where a disagreement is one
    /// `unparseable chrome message` line and a desktop that never resizes.
    /// This is the cheapest thing that fails in CI instead.
    #[test]
    fn the_desktop_size_the_sdk_sends_parses() {
        let sent = r#"{"type":"set_desktop_size","size":[1600,1200]}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::SetDesktopSize {
                size: [1600.0, 1200.0]
            }
        );
    }
}
