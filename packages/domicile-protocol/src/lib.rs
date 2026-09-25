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
    /// this one: a desk of three monitors is three pages, and a toggle clicked
    /// on one of them is the whole desktop changing. The sender is told again
    /// as part of that, which is the same catch-up
    /// [`HostMessage::FocusChanged`] does and for the same reason — one path
    /// that sets the theme, rather than a page that believes its own click.
    ///
    /// **Not written back to the config file.** The file is generated — a
    /// shell owns it, and on NixOS home-manager owns the shell — so a desktop
    /// that edited it would be overwriting a build product. A toggle lasts as
    /// long as the desktop does, and `[theme]` is what it comes up as.
    SetTheme { theme: Theme },

    /// What is there to open that matches `query`? Answered with
    /// [`HostMessage::FoundFiles`].
    ///
    /// A shell's launcher is a page, and a page has no filesystem: there is no
    /// `readdir` on `window.domicile` and this is deliberately not one. **It
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
    /// `[theme]` moved; and to every chrome when one of them sends
    /// [`ChromeMessage::SetTheme`]. That last one is why this is a broadcast
    /// rather than an answer: a desk of three monitors is three pages, and a
    /// theme half of them are on is not a theme.
    ///
    /// A fact rather than a preference. `[theme] mode` is where a desk states
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
    /// the thing that says no. `ROADMAP.md` carries that too.
    Idle { idle: bool },
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FilePreview {
    /// The front of a file that reads as text.
    Text { text: String },
    /// The front of what a directory holds, sorted, a directory ending in `/`.
    Directory { entries: Vec<String> },
    /// A file that is not text, and so has nothing a preview can draw.
    Binary,
    /// Not in the index, or not readable: nothing to show, and said so.
    Unreadable,
}

/// Which way round a desktop is drawn.
///
/// The same two words the config file spells, and deliberately the same two:
/// `[theme] mode = "light"` is where a desk states the one it starts on, and
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

    /// The exact JSON `@domicile/chrome-sdk` puts on the wire for a theme the
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
