//! The wire contract between the Domicile host and the in-page client.
//!
//! The chrome runs a small JS client that mirrors these types. Messages are
//! exchanged as JSON. Keep this crate dependency-light (serde only) so it
//! stays a clean, portable description of the protocol; the host maps these
//! onto its internal scene model, and the JS side mirrors them by hand.

use std::collections::BTreeMap;

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
/// here, `DomicileClient`'s welcome check in `@domicile-desktop/sdk`, and `greet`
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

/// What somebody typed at a locked desk, carried so that it cannot be printed.
///
/// **A NEWTYPE BECAUSE THE FAILURE MODE IS A TRACE MACRO, NOT A DESIGN.** A
/// `String` in [`ChromeMessage::Unlock`] would be correct and would stay
/// correct until somebody added `debug!(?message)` to the message loop — a
/// line with every reason to exist and none to be thinking about the lock —
/// and the desk's passphrase would be in the journal from then on. So this
/// carries its own [`Debug`], which prints the field and never the secret, and
/// the value comes out only through [`Passphrase::as_str`], which nothing a
/// formatter reaches calls.
///
/// Transparent on the wire: the message field is the string itself, so the
/// redaction costs the protocol nothing.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Passphrase(String);

impl Passphrase {
    /// The secret itself, for the one caller that has to compare it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for Passphrase {
    fn from(passphrase: &str) -> Passphrase {
        Passphrase(passphrase.to_string())
    }
}

impl From<String> for Passphrase {
    fn from(passphrase: String) -> Passphrase {
        Passphrase(passphrase)
    }
}

/// Says that there is a passphrase here and never what it is.
///
/// Derived `Debug` is what this type exists to not have — see the note on
/// [`Passphrase`]. The field is named so that a reader of a log line can tell
/// a redacted passphrase from an empty one.
impl std::fmt::Debug for Passphrase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Passphrase(<redacted>)")
    }
}

/// Messages sent from the chrome (in-page client) to the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChromeMessage {
    /// First message after connecting; declares the version the chrome speaks.
    Hello { protocol_version: u32 },

    /// How many physical pixels the chrome paints per CSS pixel — its
    /// `devicePixelRatio`. The compositor advertises this as the `wl_output`
    /// scale, which is what makes a client render at the display's real
    /// resolution instead of drawing one pixel per CSS pixel and being
    /// stretched over the rest.
    ///
    /// Sent on connect and whenever it changes (moving a window between
    /// displays, or a browser zoom).
    SetDevicePixelRatio { ratio: f64 },

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

    /// Put a thing that was copied earlier back on the clipboard.
    ///
    /// **The one message a clipboard manager needs, and it carries an id
    /// rather than the text.** The compositor keeps what was copied — see
    /// `domicile_host::clipboard` — so a shell picking a row hands back the
    /// `id` it was told in [`HostMessage::Clipboard`] and the bytes never make
    /// the round trip. A page that could send text here would be a page
    /// writing the desktop's clipboard, which is a larger capability than
    /// choosing among the things already on it.
    ///
    /// The selection it sets is the compositor's own, so the entry outlives
    /// the client that first copied it: a terminal closed an hour ago is still
    /// something this can paste.
    ///
    /// An id nothing matches is a shell bug rather than a race — the history
    /// only ever grows toward the newest, and an entry that has fallen off the
    /// end fell off a list the shell was told about. The compositor says so
    /// and sets nothing.
    CopyClipboardEntry { entry: u32 },

    /// The user picked a theme off the shell's toggle.
    ///
    /// **THE ONE PIECE OF DESKTOP STATE A PAGE OWNS, AND IT IS OWNED BY THE
    /// PAGE BECAUSE THE SWITCH IS DRAWN THERE.** Everything else on this
    /// socket going up is a request about a window or a device; this is the
    /// shell saying what the desktop now *is*, and the compositor takes it
    /// rather than deciding about it.
    ///
    /// It has to come back here rather than stay in the page, because a theme
    /// that lived in the chrome would be a desktop where the panels went dark
    /// and every window stayed light. The compositor is the process the
    /// desktop's clients can hear — see `domicile_compositor::appearance`,
    /// which answers the settings portal GTK, Qt and Electron read their color
    /// scheme from — and it is the process that read
    /// [`domicile_config::ThemeConfig`] in the first place.
    ///
    /// Answered with [`HostMessage::Theme`] to *every* chrome rather than to
    /// this one. The sender is told again as part of that, which is the same
    /// catch-up [`HostMessage::FocusChanged`] does and for the same reason —
    /// one path that sets the theme, rather than a page that believes its own
    /// click.
    ///
    /// **Not written back to the config file.** The file is generated — a
    /// shell owns it, and on NixOS home-manager owns the shell — so a desktop
    /// that edited it would be overwriting a build product. A toggle lasts as
    /// long as the desktop does, and `theme` is what it comes up as.
    SetTheme { theme: Theme },

    /// Set the screen's backlight to `level`, a fraction 0.0 through 1.0.
    ///
    /// Answered like [`ChromeMessage::SetTheme`]: with
    /// [`HostMessage::Brightness`] to every chrome, once the kernel says the
    /// backlight moved, rather than a reply a page could believe its own drag
    /// by. The compositor asks logind to write it — the session's owner may,
    /// where `/sys` is root's — and never goes all the way to zero, which on
    /// most panels is a screen that is off. See `domicile_host::backlight`.
    SetBrightness { level: f64 },

    /// Set a device's or a stream's volume: `id` is an [`AudioDevice::id`] or
    /// an [`AudioStream::id`] from the last [`HostMessage::Audio`], and
    /// `volume` a fraction of the server's normal, 1.0 being 100%.
    ///
    /// Answered like [`ChromeMessage::SetBrightness`]: with the next
    /// [`HostMessage::Audio`], to every chrome, once the sound server says the
    /// volume moved. Every channel is set alike.
    SetAudioVolume { id: String, volume: f64 },

    /// Mute or unmute a device or a stream, named as for
    /// [`ChromeMessage::SetAudioVolume`] and answered the same way.
    SetAudioMuted { id: String, muted: bool },

    /// Make a device the one new streams play to or record from: `id` is an
    /// [`AudioDevice::id`]. Answered with the next [`HostMessage::Audio`].
    SetDefaultAudioDevice { id: String },

    /// Move a stream to another device: `id` is an [`AudioStream::id`] and
    /// `device` an [`AudioDevice::id`] of the same direction — a playback
    /// stream to an output, a recording to an input.
    MoveAudioStream { id: String, device: String },

    /// Switch a device to one of its [`AudioDevice::ports`] — speakers to
    /// headphones — by the port's [`AudioChoice::name`].
    SetAudioPort { id: String, port: String },

    /// Switch a sound card to one of its [`AudioCard::profiles`], by name —
    /// how a card turns on its HDMI output, or a headset its microphone.
    SetAudioProfile { card: String, profile: String },

    /// Meter these devices and streams — [`AudioDevice::id`]s and
    /// [`AudioStream::id`]s — and send their peaks as
    /// [`HostMessage::AudioLevels`] until told otherwise.
    ///
    /// **A lease, not a switch.** A mixer sends this again every second while
    /// it is on screen, and the compositor stops metering what nobody has
    /// renewed for a few: metering a microphone records it, and a page that
    /// went away without saying so must not leave one recording. An empty list
    /// lets go at once. What every chrome on the desk asked for is metered,
    /// and every chrome is told.
    WatchAudioLevels { ids: Vec<String> },

    /// This page is holding its old frame for the theme it was told: turn the
    /// desk's windows over now.
    ///
    /// Sent from inside the shell's wipe, once the frame it wipes away from is
    /// captured. A window that turned before then is in that frame already
    /// turned, and the wipe passes over it rather than across it. The
    /// compositor waits for every chrome on the desk -- or for
    /// `domicile_host::theme_turnover::CAPTURE_WITHIN` -- then tells the
    /// clients, and answers with [`HostMessage::WindowsTheme`].
    ///
    /// Carries the theme it is for, so a capture for a theme the desk has
    /// already moved past is not counted towards the next one.
    ThemeCaptured { theme: Theme },

    /// What is there to open that matches `query`? Answered with
    /// [`HostMessage::FoundFiles`].
    ///
    /// A shell's launcher is a page, and a page has no filesystem: there is no
    /// `readdir` on `DomicileHost` and this is deliberately not one. **It
    /// carries no path**, so nothing a page can say decides which directory is
    /// read — the compositor holds that policy, and the document served over
    /// `domicile://` gains no reach into the filesystem by asking.
    ///
    /// **A query, not a request for the list.** The compositor keeps an index
    /// of the whole home, which on a real one is hundreds of thousands of
    /// paths; it used to cross into the page whole so the page could filter
    /// it, and each crossing was a desktop that took no input until it was
    /// over. The filter is the compositor's now — see
    /// `domicile_host::file_search` — and all a page is ever told is what
    /// matched.
    SearchFiles { query: String },

    /// What is in `path`? Answered with [`HostMessage::FilePreview`].
    ///
    /// A launcher's preview of the row it has reached. **This one does name a
    /// path**, and what keeps that from being a `readdir` on the page is where
    /// the answer comes from: the compositor answers only for a path its index
    /// of the home holds, and says [`FilePreview::Unreadable`] for anything
    /// else. So a page learns nothing about a path a search could not already
    /// have named — and it can already `spawn`.
    PreviewFile { path: String },

    /// What applications does `query` name? Answered with
    /// [`HostMessage::FoundApps`].
    ///
    /// Words, like [`ChromeMessage::SearchFiles`]: which directories hold the
    /// desktop entries is the XDG base directory spec's to say and the
    /// compositor's to read — see `domicile_host::desktop_entries`.
    SearchApps { query: String },

    /// Somebody typed a passphrase at the lock screen. Let this desk go if it
    /// is the right one.
    ///
    /// **AN ATTEMPT, AND THE COMPOSITOR IS WHAT DECIDES.** A shell draws the
    /// lock screen and collects what was typed; it does not check it, and it is
    /// not told directly whether this one was right. What it gets is
    /// [`HostMessage::Locked`] — to *every* chrome, once the check is over —
    /// which is the same one-path-that-decides arrangement
    /// [`ChromeMessage::SetTheme`] has, for a harder reason: a page that
    /// cleared its own lock screen because it believed its own keystrokes would
    /// be a lock anybody could open by editing the page.
    ///
    /// **A WRONG PASSPHRASE IS `locked: true` AGAIN.** Nothing else sends one
    /// to a desk being checked — that desk is already shut — so a page waiting
    /// on its check reads it as the answer. A verifier that could not check
    /// says the same, and the compositor tells the two apart only in its own
    /// log, without the passphrase in it. There is no count and no delay on
    /// this protocol yet; `ROADMAP.md` carries what is left of that.
    ///
    /// The passphrase is a [`Passphrase`] rather than a `String` so that it
    /// cannot be printed by accident — see that type.
    Unlock { passphrase: Passphrase },

    /// Lock this desk now, whoever is at it.
    ///
    /// The shell's half of what the idle edge already does: the desk shuts,
    /// and every chrome hears [`HostMessage::Locked`]. A desk that states no
    /// verifier has no lock to shut, so this does nothing there but say so in
    /// the compositor's log. Answered with nothing else.
    Lock,

    /// A click on one of the system tray's icons: `id` is a
    /// [`TrayItem::id`] from the last [`HostMessage::Tray`], and `action`
    /// which button it was.
    ///
    /// Answered with nothing. What the click does is the application's — a
    /// window raised, a menu of its own opened — and a tray whose icon
    /// changes because of it hears so in the next [`HostMessage::Tray`]. An id
    /// that names nothing is an icon whose application went away while the
    /// click was in flight, which is the one way to reach it and says nothing
    /// worth answering.
    ActivateTrayItem { id: String, action: TrayAction },

    /// The user cleared these notifications: each [`Notification::id`] from
    /// the last [`HostMessage::Notifications`]. One message for one or for
    /// every one of them, so clearing the lot is one broadcast rather than
    /// one per row.
    ///
    /// Answered with the next [`HostMessage::Notifications`], without them,
    /// and each application hears `NotificationClosed` with the reason
    /// "dismissed by the user". An id that names nothing is one its
    /// application closed while the click was in flight, and is passed over.
    DismissNotifications { ids: Vec<u32> },

    /// The user pressed one of a notification's buttons, or the notification
    /// itself: `action` is a [`NotificationAction::key`], or `"default"` for
    /// a press on a [`Notification::clickable`] one.
    ///
    /// The application hears `ActionInvoked`, which is all the spec lets a
    /// server say — what the press does is the application's. The
    /// notification is then closed, as a dismissal is, because that is what
    /// every server does with one whose action has been taken.
    InvokeNotificationAction { id: u32, action: String },
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

    /// A client opened a popup — a menu, a tooltip — over one of its windows,
    /// or moved one it had open. It is an `<app>` of its own, placed rather
    /// than laid out: `position` is its box's top-left relative to `parent`'s
    /// box, and `size` is its box, both in logical units. `parent` is a window
    /// or another popup, and is always announced first.
    ///
    /// Sent again with the same `app_id` when the client repositions it. It
    /// goes the way a window does, with [`HostMessage::AppClosed`]. A popup is
    /// never a window: it has no title, is not given the keyboard by name,
    /// and is not tiled — a shell that treated it as one would put a menu in
    /// a frame of its own.
    ///
    /// `grab` is a menu, which the client expects to go away when a press
    /// lands anywhere else; a tooltip has none.
    PopupPlaced {
        app_id: String,
        parent: String,
        position: [f64; 2],
        size: [f64; 2],
        grab: bool,
    },
    /// The smallest a client will draw its window, in logical units —
    /// `xdg_toplevel.set_min_size`. A `0` on an axis is no limit on it, as in
    /// xdg-shell. A box smaller than this gets a frame larger than the box,
    /// which the compositor crops, so a shell that sizes windows keeps them at
    /// least this big. Sent when it changes, and not before the first change.
    AppMinSize { app_id: String, size: [f64; 2] },

    /// The largest a client will draw its window — `xdg_toplevel.set_max_size`,
    /// read as [`HostMessage::AppMinSize`] is.
    AppMaxSize { app_id: String, size: [f64; 2] },

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

    /// The Chrome extensions the desk's config names, for the browser process
    /// to install into the profile its browser windows use — see
    /// `docs/architecture/EXTENSIONS.md`.
    ///
    /// `web_store` is Chrome Web Store ids; `unpacked` is absolute paths to
    /// directories holding an unpacked extension. The whole list every time,
    /// and the browser reconciles against it: what it added and the list no
    /// longer names goes.
    ///
    /// A fact and not a stream, like [`HostMessage::Keymap`]: it rides with
    /// the handshake and again whenever a reload changes it. Absent from a
    /// host nobody has handed one, which is not the same as an empty list —
    /// an empty list uninstalls everything the browser added.
    Extensions {
        web_store: Vec<String>,
        unpacked: Vec<String>,
    },

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
    /// See `APP_FOCUS_REQUESTED_EVENT` in `@domicile-desktop/sdk`, which is the
    /// same question asked where the answer is known.
    FocusRequested { app_id: String },

    /// What matched a [`ChromeMessage::SearchFiles`], and only that.
    ///
    /// `query` is the one this answers, sent back so a shell can tell the
    /// answer to what is in its box from the answer to a keystroke ago.
    ///
    /// `files` is the front of what matched: paths relative to the home
    /// directory — `Notes/today.org` rather than `/home/you/Notes/today.org`
    /// — in byte order, and a directory ends in `/`. A shell that opens one
    /// hands it straight back to `spawn`, and the compositor's child inherits
    /// the home directory it was named from. `matched` is how many there were
    /// in all, which a launcher counts beside its box.
    ///
    /// `indexing` is whether the index this was found in is all of the home.
    /// **It is the difference between an incomplete answer and a wrong one**:
    /// a launcher's rows are its whole evidence that a file exists, so an
    /// answer from an index still being built has to arrive saying so, or a
    /// person who typed the name of a file the walk has not reached yet is
    /// told — in the only language the panel has — that they do not have it.
    /// A shell that is told this asks again; `packages/shell-manganese`'s
    /// launcher is the worked example.
    FoundFiles {
        query: String,
        files: Vec<String>,
        matched: u32,
        indexing: bool,
    },

    /// What is in a path, answering [`ChromeMessage::PreviewFile`].
    ///
    /// `path` is the one asked about, sent back so a shell can tell the
    /// preview of the row it is on from the one it has just left. The kind
    /// sits beside it on the wire rather than nested under it, which is how
    /// the engine reads every other message.
    FilePreview {
        path: String,
        #[serde(flatten)]
        preview: FilePreview,
    },

    /// The applications and bookmarks a [`ChromeMessage::SearchApps`]
    /// matched, each best first.
    ///
    /// `query` is the one this answers, for [`HostMessage::FoundFiles`]'s
    /// reason. Each entry carries the argv it runs, so a shell launches one
    /// with `spawn` and nothing on the page parses an `Exec` line. A bookmark
    /// is the desk's own, from `applications.bookmarks`, and the shell opens
    /// its URL itself.
    FoundApps {
        query: String,
        apps: Vec<DesktopEntry>,
        bookmarks: Vec<Bookmark>,
    },

    /// The machine's battery: how full, and whether a lead is in.
    ///
    /// **Pushed, and only pushed.** There is no `ListBattery`: a charge is
    /// one reading rather than a list, and a page that has just loaded is
    /// caught up by the next one without having to ask. The
    /// kernel announces a supply that changed and the compositor re-reads
    /// `/sys/class/power_supply` when it does, sending this if the reading
    /// moved — plus once more to a chrome that has just connected, so a page
    /// that reloaded is not left blank until the next percent.
    ///
    /// **Not `navigator.getBattery`, which is where a shell would otherwise
    /// read this.** That API answers through UPower over D-Bus, and a desktop
    /// on a bare tty has neither: the engine resolves with Chromium's default
    /// `BatteryStatus` instead — charging, and full — which no page can tell
    /// from a real laptop on a full battery. The kernel's own files need no
    /// daemon and no bus, and the compositor is already the process that owns
    /// the machine. `domicile_host::battery` is the reading.
    ///
    /// `charge` is a fraction, 0.0 through 1.0, rather than a percentage: the
    /// bar rounds it to figures *and* fills a meter with it, and rounding once
    /// where it is drawn is what keeps those two from disagreeing.
    ///
    /// `charging` is whether a lead is in, not whether the cell is gaining. A
    /// full battery on AC is `true` here, because what a shell draws from it
    /// is a plug rather than a rate — see `domicile_host::battery::charging`
    /// for which files answer it.
    ///
    /// A machine with no battery is no message rather than a zero: there is
    /// nothing to draw, and a desktop PC reporting an empty cell would be this
    /// protocol inventing a reading, which is the failure the whole message
    /// exists to undo.
    Battery { charge: f64, charging: bool },

    /// How bright the screen is, 0.0 through 1.0.
    ///
    /// Pushed like [`HostMessage::Battery`]: when the kernel announces the
    /// backlight moved — a brightness key, another program, or
    /// [`ChromeMessage::SetBrightness`] — and once more to a chrome that has
    /// just connected. A fraction for the battery's reason: rounding belongs
    /// where it is drawn. A machine with no backlight sends nothing, so a
    /// desktop on an external monitor shows no slider rather than a dead one.
    /// `domicile_host::backlight` is the reading.
    Brightness { level: f64 },

    /// What has been copied on this desktop, newest first.
    ///
    /// **The compositor is the only thing that sees a copy.** A selection is
    /// `wl_data_device.set_selection` from the focused client, which nothing
    /// above the compositor is told about — and it lives only as long as the
    /// client that offered it, so closing the terminal you copied out of
    /// empties the clipboard. That is what a manager is for, and it has to be
    /// here because this is the process the offer arrives at.
    ///
    /// **Pushed and never asked for, like [`HostMessage::Battery`].** A copy
    /// is an event the compositor already
    /// hears; a shell that had to ask would be asking on a timer or on a
    /// keystroke, and either one draws a panel that is a moment out of date.
    /// Sent whenever the history changes, and again to a chrome that has just
    /// connected — a page that reloaded would otherwise have an empty panel
    /// until the next copy.
    ///
    /// **Previews, not the text.** Each entry is an id and enough of what was
    /// copied to recognize it by; the bytes stay in the compositor and go back
    /// on the clipboard through [`ChromeMessage::CopyClipboardEntry`]. A
    /// password manager's copy is a row in this list, so the less of it that
    /// crosses into a page the better — and a history of long copies
    /// broadcast on every copy would be the desktop moving its clipboard
    /// through the shell for nothing.
    ///
    /// **Text only.** An entry exists for a selection that offered text; an
    /// image or a file drag is not recorded, because a list of previews is not
    /// a store and pretending otherwise would mean a manager that offers rows
    /// it cannot hand back.
    ///
    /// Empty is a desktop nothing has been copied on yet, which is an answer
    /// rather than a silence — and the ordinary state of a desktop that has
    /// just started, because the history is in memory and never on disk.
    Clipboard { entries: Vec<ClipboardEntry> },

    /// Which way round the desktop is drawn now.
    ///
    /// **Pushed, and there is no `ListTheme` to go with it** — the asymmetry
    /// [`HostMessage::Battery`] draws, arrived at from the other side. A theme
    /// does not change on its own the way a charge does; it changes because
    /// somebody clicked the toggle or edited the config, and both of those are
    /// events the compositor already has in hand.
    ///
    /// Sent to a chrome that has just connected, so a page's first paint is
    /// the theme the desk is actually on; on every reload of a config whose
    /// `theme` moved; and to every chrome when one of them sends
    /// [`ChromeMessage::SetTheme`].
    ///
    /// A fact rather than a preference. `theme.mode` is where a desk states
    /// the one it comes up on, and there is no `system` for it to be resolved
    /// against — Domicile *is* the system, so there is nothing above the
    /// desktop whose preference a page could be deferring to. See
    /// [`domicile_config::ThemeMode`].
    Theme { theme: Theme },
    /// Whether anybody is at this desktop.
    ///
    /// `true` is a desk nobody has touched for `idle.blank_after_seconds`;
    /// `false` is somebody back at it. The compositor's own seam decides both
    /// — see `crate::idle` in `domicile-compositor` — and this is the same
    /// answer the connectors are given, said to the shell as well.
    ///
    /// **THE STATE, THOUGH IT IS SENT ON THE EDGE.** The compositor reports
    /// the turn the answer *changed* on, because lighting a connector is a
    /// modeset and a dark desk asking for one per tick is a modeset a second
    /// with nobody in the room. A page has the opposite problem: it reloads,
    /// and a page that has just loaded has missed every edge there ever was.
    /// So what crosses here is where the desk stands rather than which way it
    /// just went, and a chrome that has just said hello is told it — the
    /// treatment [`HostMessage::Clipboard`] gets, and for
    /// [`HostMessage::AppAppeared`]'s reason.
    ///
    /// **IT DOES NOT LEAD THE BLANKING, AND A SHELL MUST NOT DRAW AS IF IT
    /// DID.** This goes out on the same turn the screens are told to go dark,
    /// ahead of the modeset rather than ahead of the timeout, so the glass is
    /// out within the same breath: there is no warning here to fade on, count
    /// down or animate with. What is worth doing with the dark edge is what
    /// will be true when the screens come *back* — a lock over the desktop, a
    /// panel closed, a secret put away — because the lit edge does lead: a
    /// modeset takes tens of milliseconds and this is already in the page. A
    /// desk that warns before it goes dark wants a lead time nothing in the
    /// config states yet, and `ROADMAP.md` carries that.
    ///
    /// **A desktop that never blanks never sends this**, not even a `false`:
    /// no `idle.blank_after_seconds` is no clock at all, and silence is the
    /// honest answer from a desk that has no opinion about who is at it. So a
    /// shell told nothing draws no idle affordance, and one told `false` knows
    /// both that somebody is here and that this desk does blank.
    ///
    /// **Not a lock.** A dark screen is a screen and anybody can type at one:
    /// the seat is the compositor's, so refusing to deliver what is typed is
    /// its decision rather than the page's, and no message here makes a page
    /// the thing that says no. That refusal is [`HostMessage::Locked`], which
    /// is a message of its own because the two are not the same fact: a desk
    /// can be dark and open, and a locked desk that somebody has just wiggled
    /// the mouse at is lit and shut.
    Idle { idle: bool },

    /// Whether this desk is locked.
    ///
    /// `true` is a desk that will not deliver a keystroke or a click to any
    /// client until somebody says the passphrase; `false` is one that will.
    ///
    /// **THE COMPOSITOR HOLDS THIS, WHICH IS THE ENTIRE POINT.** The lock is
    /// not a thing the page is doing. Every key and every pointer event on this
    /// system is forwarded by the shell's page and injected into the seat here,
    /// and while this is `true` the injection does not happen — see
    /// `crate::lock` in `domicile-compositor`. So a page reload does not open
    /// the desk, an engine that died and came back does not open the desk, and
    /// neither does a shell edited in the devtools of the browser that is
    /// drawing it. What a shell draws over a locked desktop is a surface over
    /// a desktop that has already stopped listening.
    ///
    /// **A state, and a chrome saying hello is told it.** For
    /// [`HostMessage::Idle`]'s reason with the stakes the other way up: a page
    /// that has just loaded has missed every edge there was, and the edge it
    /// missed is the one that would have raised its lock screen.
    ///
    /// The page keeps its own keys throughout, which is what makes a lock
    /// screen possible at all: it is the thing forwarding input, so refusing to
    /// forward is not what stops it — the compositor refusing to inject is.
    /// That is also why the shell can take a passphrase while the desk is shut,
    /// and [`ChromeMessage::Unlock`] is how it offers one.
    ///
    /// **A desk with no passphrase configured never sends this**, not even
    /// `false`: it cannot lock, because a desk that locked with nothing to
    /// unlock it would be a desk nobody could get back into. So silence here is
    /// a desktop with no lock, the way silence on `idle` is a desktop with no
    /// clock.
    Locked { locked: bool },

    /// Which way round the desk's *windows* are drawn now.
    ///
    /// [`HostMessage::Theme`]'s other half. The chrome turns over when it is
    /// told the theme; the windows turn over once every chrome has sent
    /// [`ChromeMessage::ThemeCaptured`], so a shell's wipe can pass across
    /// them. This is sent once they have had their chance to repaint: the
    /// settings portal told, each mapped window's next frame committed or
    /// `domicile_host::theme_turnover::REPAINT_WITHIN` gone. The browser
    /// process takes the scheme its own pages are drawn in from it, and a
    /// shell holding its wipe lets go on it.
    ///
    /// Also sent to a chrome that has just connected, beside
    /// [`HostMessage::Theme`], because the browser has no other way to learn
    /// what its pages should be drawn in.
    WindowsTheme { theme: Theme },

    /// The system tray: every application showing an icon in it, in the
    /// order they registered.
    ///
    /// **StatusNotifierItem, over the session bus.** That is the tray every
    /// toolkit on a Wayland desktop speaks — the X11 `_NET_SYSTEM_TRAY`
    /// embedding cannot exist without X — and the compositor is the host that
    /// answers it: it owns `org.kde.StatusNotifierWatcher`, reads each
    /// item's properties and follows its signals. See `crate::tray` in
    /// `domicile-compositor`.
    ///
    /// **Pushed, like [`HostMessage::Clipboard`], and the whole list every
    /// time.** Sent whenever an item arrives, leaves or changes how it looks,
    /// and to a chrome that has just connected. Empty is a desk no application
    /// has put an icon on, which is an answer — and every desk with no session
    /// bus, where nothing ever can.
    ///
    /// An item that says it is `Passive` is not in the list: the spec's word
    /// for an icon that has nothing to say right now, which every tray hides.
    Tray { items: Vec<TrayItem> },

    /// The desk's notifications: every one an application sent that nobody
    /// has cleared yet, oldest first.
    ///
    /// **`org.freedesktop.Notifications`, over the session bus.** That is
    /// what `notify-send`, every toolkit and the browser itself send to —
    /// a page's Web Notification included, because Chrome on Linux shows
    /// one by calling the same server — and the compositor is the server.
    /// See `crate::notifications` in `domicile-compositor`.
    ///
    /// **Pushed, and the whole list every time**, for
    /// [`HostMessage::Tray`]'s reasons: on every change and to a chrome that
    /// has just connected, so a page that reloads still has the history, and
    /// every monitor's page has the same one. Which of them are *new* is
    /// the shell's to tell, by the ones it had not been told before.
    Notifications { items: Vec<Notification> },

    /// The desk's sound: every output and input device, every stream playing
    /// or recording, and every sound card, as a mixer draws them.
    ///
    /// **Read off the sound server with `pactl`**, PulseAudio's or
    /// PipeWire's — see `domicile_host::audio`. Pushed, and the whole state
    /// every time, for [`HostMessage::Tray`]'s reasons: whenever the server
    /// says something moved — a volume, a device plugged in, a stream started
    /// — and to a chrome that has just connected. A desk with no sound server
    /// sends none, so a shell that has had no message draws no mixer rather
    /// than one at zero.
    ///
    /// Each list is in the server's own order. `inputs` includes the
    /// monitors of the outputs, flagged, which a mixer hides from its devices
    /// and offers as somewhere to record from.
    Audio {
        outputs: Vec<AudioDevice>,
        inputs: Vec<AudioDevice>,
        playback: Vec<AudioStream>,
        recording: Vec<AudioStream>,
        cards: Vec<AudioCard>,
    },

    /// How loud what a mixer asked to meter is now — see
    /// [`ChromeMessage::WatchAudioLevels`]. Sent some twenty times a second
    /// while anything is metered, and never otherwise. An id the sound server
    /// has not been heard on yet is left out rather than sent as silence.
    AudioLevels { levels: Vec<AudioLevel> },

    /// The keyboard, for the keys a shell binds: every keysym it can type, by
    /// name, and the evdev key it is on.
    ///
    /// **A SHELL'S KEYS ARE ITS PROPS**, written as chords naming keysyms, and
    /// a press arrives as a key — so somebody has to say which key each
    /// keysym is on, and only the compositor holds the keymap
    /// `input.keyboard` compiles to. The page resolves its chords against
    /// this; see the SDK's `bindKeys`.
    ///
    /// Sent to a chrome that has just connected, and to every chrome on a
    /// reload that moved the keyboard — a keysym moves with the layout.
    ShellConfig { keys: BTreeMap<String, u32> },
}

/// An application a desktop entry offers, as a launcher is told about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopEntry {
    /// The desktop file ID: its path under `applications/`, `/` read as `-`.
    pub id: String,
    /// `Name`, unlocalized.
    pub name: String,
    /// `Comment`, or empty for an entry that has none.
    pub comment: String,
    /// `Exec`, unquoted and with its field codes dropped.
    pub command: Vec<String>,
    /// `Icon`, as a `data:` URL a page can draw without being able to read
    /// the file, or nothing when the entry names none the compositor found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// `X-Domicile-Preview`, a picture of the application for a launcher's
    /// preview, found and sent as `icon` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

/// A URL the desk offers by name, as a launcher is told about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bookmark {
    /// What a launcher's row says.
    pub name: String,
    /// What choosing it opens.
    pub url: String,
    /// The icon the site names for itself, as a `data:` URL, or nothing when
    /// the compositor has not found one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// One thing that was copied, as the shell is told about it.
///
/// Newest first in [`HostMessage::Clipboard`], which is the order a manager is
/// read in: the last thing copied is the one most likely to be wanted again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipboardEntry {
    /// What [`ChromeMessage::CopyClipboardEntry`] names this entry by.
    ///
    /// Assigned by the compositor and never reused, so an id a shell is
    /// holding either names the entry it was told about or names nothing at
    /// all. It is not a position: the list a copy re-orders keeps every id it
    /// had.
    ///
    /// Counted in 32 bits rather than 64 because the browser process carries
    /// this through a `base::Value`, whose whole numbers are a signed 32-bit
    /// `int`. The ceiling is two billion copies in one session of one desktop,
    /// which is a century of copying something every second.
    pub id: u32,

    /// Enough of what was copied to recognize it by, and not necessarily all
    /// of it.
    ///
    /// The whole entry where it is short, which is what nearly every copy is.
    /// A long one is cut — see `domicile_host::clipboard::PREVIEW_CHARACTERS`
    /// — because this is drawn as a row and the rest of a copied file is not a
    /// row. What goes back on the clipboard is always the whole thing.
    pub preview: String,
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
    /// shell may want to show. Description only: the engine turns and scales
    /// each monitor's slice of the page itself, so no page lays out in these
    /// pixels.
    #[serde(default)]
    pub mode: [u32; 2],
    /// Which way up the monitor is bolted to the desk.
    #[serde(default)]
    pub transform: DisplayTransform,
}

/// Which way up a monitor is bolted to the desk.
///
/// Rotations only, which is all a config can ask for. The same four
/// `wl_output.transform` values the compositor advertises to clients, spelled
/// the way the config file writes them.
///
/// **NAMED FOR THE `wl_output` VALUE, WHICH COUNTS COUNTERCLOCKWISE.**
/// `transform_90` is content turned a quarter turn *counterclockwise* to come
/// out upright — the one for a panel bolted a quarter turn clockwise — and
/// `rotate-270` is the clockwise quarter a panel on its left side needs. The
/// same numbers kanshi and sway write. A page applies the turn this names.
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
    /// Content turned a quarter counterclockwise.
    #[serde(rename = "rotate-90")]
    Rotate90,
    #[serde(rename = "rotate-180")]
    Rotate180,
    /// Content turned a quarter clockwise, for a panel standing on its left side,
    /// which is how a monitor on a desk usually ends up.
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

/// What a path holds, as much of it as a preview has room for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FilePreview {
    /// The front of a file that reads as text.
    Text { text: String },
    /// The front of what a directory holds, sorted, a directory ending in `/`.
    Directory { entries: Vec<String> },
    /// A file that plays as sound, by what it says about itself. A tag the
    /// file does not carry is absent: an empty title is a title.
    Audio {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        artist: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        album: Option<String>,
        /// How long it plays, in seconds.
        duration: f64,
        /// The picture it carries of itself, as a `data:` URL a page can
        /// draw without being able to read the file.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cover: Option<String>,
    },
    /// A file that is not text, and so has nothing a preview can draw.
    Binary,
    /// Not in the index, or not readable: nothing to show, and said so.
    Unreadable,
}

/// Which way round a desktop is drawn.
///
/// The same two words the config file spells, and deliberately the same two:
/// `"theme": { "mode": "light" }` is where a desk states the one it starts on, and
/// this is that value on the wire. Mapped rather than shared — this crate
/// carries serde and nothing else, which is what keeps it a portable
/// description of the protocol — the way [`DisplayTransform`] is mapped from
/// `domicile_config::Transform` beside it.
///
/// **There is no third variant and there is not going to be one.** "Follow the
/// system" is what a program running *on* a desktop offers; this is the
/// desktop. See `domicile_config::ThemeMode`, which refuses the word.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    /// What the chrome was drawn against, and so what a desk that stated
    /// nothing comes up on.
    #[default]
    Dark,
    Light,
}

/// One icon in the system tray, as a shell is told about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrayItem {
    /// What [`ChromeMessage::ActivateTrayItem`] names this icon by: its
    /// StatusNotifierItem `Id`, which stays the same when the application is
    /// closed and opened again, so a shell can keep the icon's place by it.
    /// A second icon with the same `Id` has `#2` after it, and so on; one
    /// with none is named by its bus name and object path, written together.
    pub id: String,
    /// What the icon is, in words: its tooltip's title where it has one, its
    /// `Title` where it does not, and its `Id` where it has neither — so
    /// never empty, and what a shell labels the icon with.
    pub title: String,
    /// The picture, as a `data:` URL a page can draw without reading a file:
    /// the attention icon when the item needs attention, and its ordinary one
    /// otherwise. Absent when the compositor found none it could draw, which
    /// leaves a shell the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// One device a [`HostMessage::Audio`] lists: an output (a sink) or an input
/// (a source).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioDevice {
    /// What the mixer's requests name it by. Opaque, and stable across a
    /// restart of the server: it is built from the device's own name.
    pub id: String,
    /// What it is called, in words.
    pub description: String,
    /// The loudest of its channels, as a fraction of the server's normal:
    /// 1.0 is 100%, and a device turned up past that reads more.
    pub volume: f64,
    pub muted: bool,
    /// Whether new streams go to it.
    pub default: bool,
    /// Whether it is an output's monitor — what that output is playing, as
    /// something to record. Always `false` for an output.
    pub monitor: bool,
    /// Where the device can send its sound, or take it from: speakers,
    /// headphones, a line in. Often empty, and often only one.
    pub ports: Vec<AudioChoice>,
    /// The [`AudioChoice::name`] of the port in use, if it has any.
    pub port: Option<String>,
}

/// One meter of a [`HostMessage::AudioLevels`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioLevel {
    /// The [`AudioDevice::id`] or [`AudioStream::id`] it meters.
    pub id: String,
    /// The loudest sample since the last message, 0.0 through 1.0 of full
    /// scale: linear, so a meter draws it in decibels if it likes.
    pub peak: f64,
}

/// One port of an [`AudioDevice`] or one profile of an [`AudioCard`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioChoice {
    /// What [`ChromeMessage::SetAudioPort`] and
    /// [`ChromeMessage::SetAudioProfile`] name it by.
    pub name: String,
    pub description: String,
    /// `false` for a port whose jack is empty, or a profile that needs one.
    /// Still listed, and still choosable, as every mixer lets it be.
    pub available: bool,
}

/// One stream a [`HostMessage::Audio`] lists: something playing (a sink
/// input) or recording (a source output).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioStream {
    /// What the mixer's requests name it by, for as long as it plays.
    pub id: String,
    /// Who is playing or recording it, as the application named itself.
    pub application: String,
    /// What it is — a song's title, a call — where the application said.
    pub title: Option<String>,
    /// As [`AudioDevice::volume`].
    pub volume: f64,
    pub muted: bool,
    /// The [`AudioDevice::id`] it plays to or records from; `None` for a
    /// device the server listed after the stream, which the next message
    /// settles.
    pub device: Option<String>,
}

/// One sound card a [`HostMessage::Audio`] lists, with the profiles that say
/// which of its devices are on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioCard {
    /// What [`ChromeMessage::SetAudioProfile`] names it by.
    pub id: String,
    pub description: String,
    /// Best first, the server's order of priority.
    pub profiles: Vec<AudioChoice>,
    /// The [`AudioChoice::name`] of the profile in use.
    pub profile: Option<String>,
}

/// Which button clicked a tray icon, as StatusNotifierItem names the three
/// things one can be asked to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayAction {
    /// `Activate`: the primary button, and what the application does by
    /// default — usually its window, raised.
    Primary,
    /// `SecondaryActivate`: the middle button.
    Secondary,
    /// `ContextMenu`: the secondary button, which asks the application for a
    /// menu of its own.
    Context,
}

/// One notification, as a shell is told about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notification {
    /// The id `Notify` answered the application with, which is what
    /// [`ChromeMessage::DismissNotifications`] and
    /// [`ChromeMessage::InvokeNotificationAction`] name it by. A notification
    /// the application replaced keeps its id and arrives with new contents.
    pub id: u32,
    /// Who sent it, as it named itself. May be empty.
    pub app_name: String,
    /// The one line that says what happened. May be empty, though a sender
    /// that leaves it so has said very little.
    pub summary: String,
    /// More, as plain text: the spec's markup is taken out by the compositor,
    /// so a shell can draw this as text and not as HTML.
    pub body: String,
    /// The picture, as a `data:` URL: the notification's own image where it
    /// sent one, and its application's icon otherwise. Absent when there was
    /// neither, or nothing the compositor could draw.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub urgency: Urgency,
    /// Its buttons, in the order the application listed them. The `default`
    /// action is not one of them: it is [`Notification::clickable`].
    pub actions: Vec<NotificationAction>,
    /// Whether pressing the notification itself does something — the
    /// application offered a `default` action.
    pub clickable: bool,
    /// How long it asked to stay up, in milliseconds: `0` for until it is
    /// dismissed. Absent where it left that to the server, which is the
    /// shell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    /// When it arrived, or was last replaced: milliseconds since the Unix
    /// epoch, on the compositor's clock.
    pub time: u64,
}

/// One button of a [`Notification`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationAction {
    /// What [`ChromeMessage::InvokeNotificationAction`] names it by.
    pub key: String,
    /// What the button says.
    pub label: String,
}

/// How much a notification asks to be noticed: the spec's `urgency` hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Urgency {
    Low,
    #[default]
    Normal,
    /// Something the user should not miss — a battery about to run out.
    Critical,
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

    /// The exact JSON `@domicile-desktop/sdk` puts on the wire for a theme the
    /// user picked off the toggle, spelled out.
    ///
    /// Here for [`the_desktop_size_the_sdk_sends_parses`]'s reason and with a
    /// sharper edge: the host half of this message rides the shared fixture
    /// in `wire/`, and the chrome half has no fixture at all — so this is the
    /// only thing anywhere that fails when the SDK's spelling and this enum
    /// drift apart.
    #[test]
    fn the_theme_the_sdk_sends_parses() {
        let sent = r#"{"type":"set_theme","theme":"light"}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::SetTheme {
                theme: Theme::Light
            }
        );
    }

    /// The exact JSON the SDK sends when a page's old frame is held, spelled
    /// out, for [`the_theme_the_sdk_sends_parses`]'s reason.
    #[test]
    fn the_capture_the_sdk_sends_parses() {
        let sent = r#"{"type":"theme_captured","theme":"light"}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::ThemeCaptured {
                theme: Theme::Light
            }
        );
    }

    /// The exact JSON the SDK sends when a tray icon is clicked, spelled out,
    /// for [`the_theme_the_sdk_sends_parses`]'s reason.
    #[test]
    fn the_tray_click_the_sdk_sends_parses() {
        let sent =
            r#"{"type":"activate_tray_item","id":":1.42/StatusNotifierItem","action":"context"}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::ActivateTrayItem {
                id: ":1.42/StatusNotifierItem".to_string(),
                action: TrayAction::Context,
            }
        );
    }

    /// The exact JSON the SDK sends when notifications are cleared, for
    /// [`the_theme_the_sdk_sends_parses`]'s reason.
    #[test]
    fn the_dismissal_the_sdk_sends_parses() {
        let sent = r#"{"type":"dismiss_notifications","ids":[7,8]}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::DismissNotifications { ids: vec![7, 8] }
        );
    }

    /// And the one it sends when a notification's button is pressed.
    #[test]
    fn the_notification_action_the_sdk_sends_parses() {
        let sent = r#"{"type":"invoke_notification_action","id":7,"action":"reply"}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::InvokeNotificationAction {
                id: 7,
                action: "reply".to_string(),
            }
        );
    }

    /// The exact JSON `@domicile-desktop/sdk` puts on the wire for the desktop
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
