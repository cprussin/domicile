//! The JSON wire protocol between the Domicile host and the in-page client.
//!
//! `@domicile-desktop/sdk` mirrors these types by hand, so change both in the
//! same PR. Keep this crate serde-only so it stays a portable description of
//! the protocol; the host maps it onto its own scene model.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The protocol version this build speaks.
///
/// Pinned at 1: the host and every chrome are built from the same commit, so
/// their versions cannot differ. Start bumping it when a chrome ships apart
/// from the host. The compatibility rule then has to change in three places:
/// [`negotiate`] here, the engine's welcome check, and `greet` in
/// `domicile-test-chrome`.
///
/// The `#[serde(default)]` attributes below are not a compatibility floor.
/// They let this crate read older messages, such as test fixtures and lines
/// in `wire/host-messages.jsonl`.
pub const PROTOCOL_VERSION: u32 = 1;

/// A key combination the desktop claims for itself.
///
/// `key` is a Linux evdev keycode, as the chrome forwards keystrokes. The X
/// keycode the Wayland keymap uses is this plus 8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Shortcut {
    pub key: u32,
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub logo: bool,
}

/// A passphrase typed at the lock screen.
///
/// A newtype so that its [`Debug`] never prints the secret: a `debug!` of a
/// [`ChromeMessage::Unlock`] must not put the passphrase in the journal. Read
/// it only through [`Passphrase::as_str`]. Serialized as a plain string.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Passphrase(String);

impl Passphrase {
    /// The secret, for the caller that checks it.
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

/// Prints a placeholder so logs show a redacted value, not an empty one.
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

    /// The chrome's `devicePixelRatio`.
    ///
    /// The compositor advertises it as the `wl_output` scale so clients render
    /// at the display's real resolution. Sent on connect and whenever it
    /// changes.
    SetDevicePixelRatio { ratio: f64 },

    /// The chrome's viewport in CSS pixels, which is the desktop's size.
    ///
    /// The compositor cannot see the browser's window, so this is its only
    /// source for the size. Separate from [`ChromeMessage::SetDevicePixelRatio`]
    /// because the two change independently. Sent on connect and on every
    /// resize.
    SetDesktopSize { size: [f64; 2] },

    /// Where the page put an app's window, in desktop CSS pixels.
    ///
    /// The compositor enters the window on the displays it overlaps and gives
    /// it the scale of the one holding most of it. It does not move the
    /// window: the page's layout does that.
    SetAppBounds {
        app_id: String,
        position: [f64; 2],
        size: [f64; 2],
    },

    /// Request keyboard focus for an app.
    FocusApp { app_id: String },

    /// Return keyboard focus to the chrome.
    FocusChrome,

    /// Ask the client that owns `app_id` to close it.
    ///
    /// The client may refuse, for example to ask about unsaved work. There is
    /// no direct reply; [`HostMessage::AppClosed`] follows if it closes.
    CloseApp { app_id: String },

    /// Spawn a client process (argv) for a keybinding or launcher.
    ///
    /// The child inherits the compositor's environment, so it connects to
    /// Domicile's Wayland display.
    Spawn { command: Vec<String> },

    // Input the chrome captured over an <app> element, for the compositor to
    // inject into the client.
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

    /// Put an earlier clipboard history entry back on the clipboard.
    ///
    /// Carries the [`ClipboardEntry::id`], not text, so a page can only choose
    /// among existing entries and never write arbitrary clipboard contents.
    /// The compositor owns the resulting selection, so it outlives the client
    /// that first copied it. An unknown id is logged and ignored. See
    /// `domicile_host::clipboard`.
    CopyClipboardEntry { entry: u32 },

    /// The user picked a theme from the shell's toggle.
    ///
    /// The compositor applies it to the clients too (see
    /// `domicile_compositor::appearance`) and broadcasts
    /// [`HostMessage::Theme`] to every chrome, including the sender, so one
    /// path sets the theme. Not written back to the config file, which is
    /// generated; the change lasts until the desktop restarts.
    SetTheme { theme: Theme },

    /// This page has captured its old frame for `theme`; the windows may now
    /// switch.
    ///
    /// Sent from the shell's theme wipe, so windows that switch afterward are
    /// not already switched in the captured frame. The compositor waits for
    /// every chrome, or for `domicile_host::theme_turnover::CAPTURE_WITHIN`,
    /// then tells the clients and answers with [`HostMessage::WindowsTheme`].
    /// `theme` lets it ignore a capture for a theme already superseded.
    ThemeCaptured { theme: Theme },

    /// Search the home directory index for `query`. Answered with
    /// [`HostMessage::FoundFiles`].
    ///
    /// Carries no path, so a page cannot choose which directory is read. The
    /// compositor filters the index itself (see `domicile_host::file_search`)
    /// because the index is too large to send to the page.
    SearchFiles { query: String },

    /// Preview the file at `path`. Answered with [`HostMessage::FilePreview`].
    ///
    /// The compositor answers only for paths in its home index and returns
    /// [`FilePreview::Unreadable`] for anything else, so a page learns nothing
    /// a search could not already show it.
    PreviewFile { path: String },

    /// Try to unlock the desktop with a passphrase from the lock screen.
    ///
    /// The compositor checks it, not the page, so editing the page cannot
    /// open the lock. The answer is [`HostMessage::Locked`] to every chrome. A
    /// wrong passphrase, or a verifier that failed, gets `locked: true` again;
    /// only the compositor's log tells them apart. There is no rate limit yet;
    /// see `ROADMAP.md`.
    Unlock { passphrase: Passphrase },

    /// Lock the desktop now.
    ///
    /// Every chrome receives [`HostMessage::Locked`]. With no passphrase
    /// verifier configured this only logs.
    Lock,

    /// A click on a system tray icon.
    ///
    /// `id` is a [`TrayItem::id`]. No reply: the application decides what the
    /// click does, and any icon change arrives in the next
    /// [`HostMessage::Tray`]. An unknown id means the application exited while
    /// the click was in flight, and is ignored.
    ActivateTrayItem { id: String, action: TrayAction },

    /// The user dismissed these [`Notification::id`]s.
    ///
    /// One message for any number, so "clear all" is one broadcast. Answered
    /// with the next [`HostMessage::Notifications`]; each application receives
    /// `NotificationClosed` with reason "dismissed by the user". Unknown ids
    /// were closed by their application meanwhile and are ignored.
    DismissNotifications { ids: Vec<u32> },

    /// The user pressed a notification's button, or the notification itself.
    ///
    /// `action` is a [`NotificationAction::key`], or `"default"` for a
    /// [`Notification::clickable`] notification. The application receives
    /// `ActionInvoked`, then the notification closes, as other servers do.
    InvokeNotificationAction { id: u32, action: String },

    /// A call on the system: a file, a directory, a watch or a process.
    ///
    /// `id` is the page's, and names the call in every answer. A watch or a
    /// process keeps its id until [`HostMessage::SystemEnd`], and the page
    /// drives it by sending further requests under the same id. See
    /// `docs/SHELL-SYSTEM-ACCESS.md`.
    SystemRequest { id: u32, request: SystemRequest },

    /// The shell's answer to a [`PortalRequest`].
    ///
    /// The first answer wins; the compositor logs and drops an answer for a
    /// request that is gone. See `domicile_host::portals`.
    AnswerPortalRequest { id: u32, answer: PortalAnswer },
}

/// Messages sent from the host to the chrome (in-page client).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostMessage {
    /// Response to `Hello`; declares the version the host agreed to speak.
    Welcome { protocol_version: u32 },

    /// A desktop shortcut was pressed.
    ///
    /// Delivered instead of to the focused client, so the chrome hears it
    /// regardless of focus. Presses only. The browser process registers and
    /// matches the shortcuts, because browser windows never forward their
    /// keys to the compositor.
    Shortcut { shortcut: Shortcut },

    /// Which modifier keys are held, sent whenever that changes.
    ///
    /// The chrome loses `wl_keyboard.modifiers` once a window has focus, but
    /// still needs them, for example for Alt-drag. Only modifiers are
    /// reported, never other keys. A newly connected chrome is not caught up.
    /// The focused client still receives the keys.
    Modifiers {
        alt: bool,
        ctrl: bool,
        shift: bool,
        logo: bool,
    },

    /// A new Wayland toplevel appeared; the chrome decides where to mount its
    /// `<app id="…">` element.
    ///
    /// `size` is usually absent because the client has not drawn yet; it
    /// follows in [`HostMessage::AppResized`]. Until then the chrome picks the
    /// window's size itself.
    AppAppeared {
        app_id: String,
        title: Option<String>,
        size: Option<[f64; 2]>,
    },

    /// A window's title, sent whenever it changes.
    ///
    /// Separate from [`HostMessage::AppAppeared`] because clients set the
    /// title after creating the toplevel. `title` is optional only to match
    /// `AppAppeared`; xdg-shell cannot unset a title, so this never sends
    /// `None`. The chrome treats `""` as no title.
    AppTitled {
        app_id: String,
        title: Option<String>,
    },

    /// A client's content size changed, in logical units (CSS pixels, as
    /// `wl_pointer` uses), not buffer pixels.
    AppResized { app_id: String, size: [f64; 2] },

    /// A client opened or moved a popup, such as a menu, a tooltip or a
    /// bubble drawn as a subsurface (Chromium's extension popups).
    ///
    /// The popup is its own `<app>`, positioned rather than laid out:
    /// `position` is its top-left relative to `parent`, and `size` its box,
    /// both logical. `parent` is a window or popup announced earlier. Closed
    /// with [`HostMessage::AppClosed`]. Shells must not treat a popup as a
    /// window: it has no title, focus or tiling. `grab` marks a menu that
    /// should close when a press lands elsewhere.
    PopupPlaced {
        app_id: String,
        parent: String,
        position: [f64; 2],
        size: [f64; 2],
        grab: bool,
    },
    /// A window's minimum size in logical units (`xdg_toplevel.set_min_size`).
    ///
    /// `0` on an axis means no limit. The compositor crops windows sized below
    /// this, so shells should respect it. Sent only when it changes.
    AppMinSize { app_id: String, size: [f64; 2] },

    /// A window's maximum size (`xdg_toplevel.set_max_size`), read as
    /// [`HostMessage::AppMinSize`] is.
    AppMaxSize { app_id: String, size: [f64; 2] },

    /// A client went away; the chrome should unmount its `<app>` element.
    AppClosed { app_id: String },

    /// The cursor a client asked for over its surface, for the chrome to apply
    /// to the app's element.
    AppCursor { app_id: String, cursor: CursorShape },

    /// The desktop's displays, as regions of the single chrome page.
    ///
    /// Sent after `welcome` and whenever the layout changes. Latest wins; a
    /// broadcast can reach a connection before its `welcome`. The compositor
    /// always sends at least one display. An empty list comes only from a
    /// host with no desktop described, such as unit tests or the `domicile`
    /// daemon.
    Displays { displays: Vec<DisplayInfo> },

    /// The compositor's compiled keymap, in `XKB_KEYMAP_FORMAT_TEXT_V1`.
    ///
    /// Read by the browser process and never forwarded to the page. Off
    /// ChromeOS, Chromium's DRM/Ozone build never sets a keymap, so typing
    /// into the shell produces no characters. Sending the compiled text, not
    /// the XKB config, keeps one source for the layout. Sent with the
    /// handshake so a reloaded page gets it again.
    Keymap { keymap: String },

    /// The Chrome extensions to install into the browser windows' profile. See
    /// `docs/architecture/EXTENSIONS.md`.
    ///
    /// `web_store` holds Chrome Web Store ids; `unpacked` holds absolute paths
    /// to unpacked extension directories. Always the full list: the browser
    /// removes what it installed and the list no longer names. Sent with the
    /// handshake and on reloads that change it. Not sent when nothing is
    /// configured, because an empty list uninstalls everything.
    Extensions {
        web_store: Vec<String>,
        unpacked: Vec<String>,
    },

    /// Who holds the keyboard: an app, or the chrome (`None`).
    ///
    /// Focus also moves without `focus_app`, for example on a click or when a
    /// focused client exits. Sent to every chrome on each change, and with the
    /// catch-up a newly connected chrome receives.
    FocusChanged {
        /// `None` means the chrome holds the keyboard.
        app_id: Option<String>,
    },

    /// A client asked for keyboard focus; nothing has moved yet.
    ///
    /// The shell decides: it answers with `focus_app` or ignores the request,
    /// so it can stop windows stealing focus. Clients ask through
    /// `xdg-activation`. Not sent for clicks, which the page handles itself;
    /// see `APP_FOCUS_REQUESTED_EVENT` in `@domicile-desktop/sdk`.
    FocusRequested { app_id: String },

    /// The results of a [`ChromeMessage::SearchFiles`].
    ///
    /// `query` echoes the request so a shell can drop stale answers. `files`
    /// holds the first matches as paths relative to home, in byte order, with
    /// directories ending in `/`; pass one to `spawn` unchanged. `matched` is
    /// the total count.
    ///
    /// `indexing` is true while the index is still being built. The shell
    /// must not treat missing results as absent files then, and should ask
    /// again; see `packages/shell-manganese`'s launcher.
    FoundFiles {
        query: String,
        files: Vec<String>,
        matched: u32,
        indexing: bool,
    },

    /// The answer to a [`ChromeMessage::PreviewFile`].
    ///
    /// `path` echoes the request so a shell can drop stale answers. The
    /// preview is flattened beside it, the shape the engine reads.
    FilePreview {
        path: String,
        #[serde(flatten)]
        preview: FilePreview,
    },

    /// The clipboard history, newest first.
    ///
    /// Only the compositor sees `wl_data_device.set_selection`, and a
    /// selection normally dies with its client, so the history lives here.
    /// Pushed on every change and on connect.
    ///
    /// Entries carry previews, not full contents, to limit what reaches the
    /// page (copied passwords included); [`ChromeMessage::CopyClipboardEntry`]
    /// restores the full text. Text selections only. The history is in memory
    /// only, so it starts empty.
    Clipboard { entries: Vec<ClipboardEntry> },

    /// The desktop's current theme.
    ///
    /// Sent on connect, when a config reload changes `theme`, and to every
    /// chrome after [`ChromeMessage::SetTheme`]. There is no "follow the
    /// system" value because Domicile is the system; see
    /// [`domicile_config::ThemeMode`].
    Theme { theme: Theme },
    /// Whether the desktop is idle.
    ///
    /// `true` after `idle.blank_after_seconds` without input; `false` when
    /// input resumes. Decided by `crate::idle` in `domicile-compositor`.
    /// Sent on each change and on connect, so a reloaded page knows the state.
    ///
    /// It goes out with the blanking modeset, not before it, so a shell gets
    /// no warning to animate on. Use it to prepare what shows when the screens
    /// return. A pre-blank warning is in `ROADMAP.md`.
    ///
    /// Not sent at all when blanking is not configured. Idle is not locked;
    /// see [`HostMessage::Locked`].
    Idle { idle: bool },

    /// Whether the desktop is locked.
    ///
    /// While `true`, the compositor drops all forwarded input instead of
    /// injecting it (see `crate::lock` in `domicile-compositor`), so a page
    /// reload, an engine crash or an edited shell cannot unlock it. The page
    /// still receives its own keys, which is how it collects the passphrase
    /// for [`ChromeMessage::Unlock`]. Sent on each change and on connect.
    ///
    /// Not sent when no passphrase is configured, because such a desktop
    /// cannot lock.
    Locked { locked: bool },

    /// The theme the windows now use.
    ///
    /// The second half of [`HostMessage::Theme`]. Windows switch once every
    /// chrome has sent [`ChromeMessage::ThemeCaptured`]; this is sent after
    /// they had a chance to repaint, or after
    /// `domicile_host::theme_turnover::REPAINT_WITHIN`. The browser process
    /// uses it for its own pages, and the shell ends its wipe on it. Also sent
    /// on connect.
    WindowsTheme { theme: Theme },

    /// Every system tray icon, in registration order.
    ///
    /// The compositor is the StatusNotifierItem host on the session bus; see
    /// `crate::tray` in `domicile-compositor`. Pushed as the full list on any
    /// change and on connect. Items whose status is `Passive` are omitted, as
    /// every tray does.
    Tray { items: Vec<TrayItem> },

    /// Every notification not yet dismissed, oldest first.
    ///
    /// The compositor is the `org.freedesktop.Notifications` server, which
    /// also receives Chrome's Web Notifications; see `crate::notifications`
    /// in `domicile-compositor`. Pushed as the full list on any change and on
    /// connect. The shell works out which are new.
    Notifications { items: Vec<Notification> },

    /// The evdev key for each keysym name the keyboard can type.
    ///
    /// Shells bind chords by keysym, but presses arrive as keys, and only the
    /// compositor has the keymap. See the SDK's `bindKeys`. Sent on connect
    /// and when a reload changes the keyboard.
    ShellConfig { keys: BTreeMap<String, u32> },

    /// The answer to a [`ChromeMessage::SystemRequest`]. Every call that
    /// starts something gets exactly one.
    SystemReply { id: u32, reply: SystemReply },

    /// Something a running watch or process produced.
    SystemEvent { id: u32, event: SystemEvent },

    /// A watch or process is over. The last message under its `id`.
    SystemEnd { id: u32, end: SystemEnd },

    /// Every portal dialog not yet answered, oldest first.
    ///
    /// The compositor is the `xdg-desktop-portal` backend; see
    /// `docs/architecture/PORTALS.md`. Pushed as the full list on any change
    /// and on connect, so a reloaded page still sees a pending dialog. The
    /// shell answers with [`ChromeMessage::AnswerPortalRequest`].
    PortalRequests { items: Vec<PortalRequest> },
}

/// A dialog an application asked for through a portal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortalRequest {
    /// The id [`ChromeMessage::AnswerPortalRequest`] uses. Never reused.
    pub id: u32,
    /// The asking application's desktop file id, as the portal frontend
    /// names it. Empty for an application it could not identify.
    pub app_id: String,
    /// The `<app>` the dialog is modal over, or absent to put it over the
    /// focused screen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_app_id: Option<String>,
    /// What the dialog asks.
    #[serde(flatten)]
    pub kind: PortalKind,
}

/// What a [`PortalRequest`] asks, as `kind` and `body` on the wire.
///
/// The engine relays `body` without reading it; the SDK parses it per kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "body", rename_all = "snake_case")]
pub enum PortalKind {
    /// `org.freedesktop.impl.portal.Access`: allow or deny.
    Access(AccessDialog),
    /// `org.freedesktop.impl.portal.AppChooser`: pick an application to open
    /// a file or URI with. `OpenURI` asks through it too.
    AppChooser(AppChooserDialog),
    /// `org.freedesktop.impl.portal.FileChooser`: pick files to open or a
    /// place to save.
    FileChooser(FileChooserDialog),
}

impl PortalKind {
    /// Whether `answer` can answer a request of this kind: its own kind, or a
    /// dismissal or refusal. A chosen application must be one offered.
    pub fn accepts(&self, answer: &PortalAnswer) -> bool {
        match (self, answer) {
            (_, PortalAnswer::Canceled | PortalAnswer::Refused) => true,
            (PortalKind::Access(_), PortalAnswer::Access) => true,
            (PortalKind::AppChooser(dialog), PortalAnswer::AppChooser { choice }) => {
                dialog.choices.contains(choice)
            }
            (PortalKind::FileChooser(_), PortalAnswer::FileChooser(_)) => true,
            (
                PortalKind::Access(_),
                PortalAnswer::AppChooser { .. } | PortalAnswer::FileChooser(_),
            )
            | (PortalKind::AppChooser(_), PortalAnswer::Access | PortalAnswer::FileChooser(_))
            | (
                PortalKind::FileChooser(_),
                PortalAnswer::Access | PortalAnswer::AppChooser { .. },
            ) => false,
        }
    }
}

/// An `AccessDialog`'s texts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessDialog {
    pub title: String,
    pub subtitle: String,
    /// May be empty.
    pub body: String,
    /// The allow button's label; the shell's own when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant_label: Option<String>,
    /// The deny button's label; the shell's own when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny_label: Option<String>,
}

/// An `AppChooser` request: what to open, and the applications offered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppChooserDialog {
    /// Desktop file ids without `.desktop`, as the portal frontend names
    /// them. `UpdateChoices` replaces them while the dialog is up.
    pub choices: Vec<String>,
    /// The application chosen last time for this content type, to preselect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_choice: Option<String>,
    /// The MIME type being opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// The file's name, without its directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

/// A file chooser, in the shell's terms: the compositor has turned the
/// portal's globs, MIME types and byte-string paths into these.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChooserDialog {
    pub mode: FileChooserMode,
    pub title: String,
    /// The confirm button's label; the shell's own when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_label: Option<String>,
    /// Open several files.
    pub multiple: bool,
    /// Open a folder rather than a file.
    pub directory: bool,
    /// The groups the user switches between; empty accepts any file.
    pub filters: Vec<FileFilter>,
    /// The index in `filters` to start with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_filter: Option<u32>,
    /// The absolute folder to start in; `home` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_folder: Option<String>,
    /// The user's absolute home directory, where the picker's places are.
    pub home: String,
    /// The suggested name for [`FileChooserMode::Save`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_name: Option<String>,
    /// The names [`FileChooserMode::SaveFiles`] saves into the chosen folder.
    pub files: Vec<String>,
    /// Extra questions, such as an encoding.
    pub choices: Vec<FileChoice>,
}

/// Which `FileChooser` method asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChooserMode {
    /// `OpenFile`: existing files or a folder.
    Open,
    /// `SaveFile`: one new path.
    Save,
    /// `SaveFiles`: a folder to save [`FileChooserDialog::files`] into.
    SaveFiles,
}

/// A named group of accepted extensions, such as "Images".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileFilter {
    pub name: String,
    /// Lowercase and without the dot; empty accepts any file.
    pub extensions: Vec<String>,
}

/// A question asked beside the files. No options means a checkbox, answered
/// `"true"` or `"false"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChoice {
    pub id: String,
    pub label: String,
    pub options: Vec<FileChoiceOption>,
    /// The option id, or `"true"`/`"false"`, selected at first.
    pub initial: String,
}

/// One answer a [`FileChoice`] offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChoiceOption {
    pub id: String,
    pub label: String,
}

/// What the user chose in a [`PortalKind::FileChooser`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChooserAnswer {
    /// Absolute paths: the files, or the folder for
    /// [`FileChooserMode::SaveFiles`].
    pub paths: Vec<String>,
    /// Each [`FileChoice::id`]'s answer.
    pub choices: BTreeMap<String, String>,
    /// The index in [`FileChooserDialog::filters`] in use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_filter: Option<u32>,
}

/// The shell's answer to a [`PortalRequest`].
///
/// Each backend reads only its own kind; any other answer refuses the
/// request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PortalAnswer {
    /// The user allowed a [`PortalKind::Access`].
    Access,
    /// The application the user picked in a [`PortalKind::AppChooser`]: one
    /// of its `choices`.
    AppChooser { choice: String },
    /// The user chose in a [`PortalKind::FileChooser`].
    FileChooser(FileChooserAnswer),
    /// The user dismissed the dialog, or denied it.
    Canceled,
    /// The shell has no dialog for this kind.
    Refused,
}

impl PortalAnswer {
    /// The portal's `response`: 0 for success, 1 for canceled by the user,
    /// 2 for any other end.
    pub fn response(&self) -> u32 {
        match self {
            PortalAnswer::Access
            | PortalAnswer::AppChooser { .. }
            | PortalAnswer::FileChooser(_) => 0,
            PortalAnswer::Canceled => 1,
            PortalAnswer::Refused => 2,
        }
    }
}

/// What a [`ChromeMessage::SystemRequest`] asks for.
///
/// A relative path is read from the home directory. Bytes travel as standard
/// padded base64.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "call", rename_all = "snake_case")]
pub enum SystemRequest {
    /// Read a whole file. Answered with [`SystemReply::Read`].
    ReadFile { path: String },
    /// Write a whole file, creating it if needed. Answered with
    /// [`SystemReply::Written`].
    ///
    /// `atomic` writes a temporary file beside it and renames it over, so a
    /// reader never sees half a file. Files under `/sys` and `/proc` cannot be
    /// renamed over, so write those with `atomic` off.
    WriteFile {
        path: String,
        data: String,
        atomic: bool,
    },
    /// List a directory. Answered with [`SystemReply::Entries`].
    ReadDir { path: String },
    /// Describe a path, following symlinks. Answered with
    /// [`SystemReply::Stat`].
    Stat { path: String },
    /// Report changes to a file or to a directory's entries. Answered with
    /// [`SystemReply::Started`], then a [`SystemEvent::Changed`] per change.
    Watch { path: String },
    /// End the watch or D-Bus match with this id. It ends with
    /// [`SystemEnd::Stopped`].
    Unwatch,
    /// Run a program. Answered with [`SystemReply::Started`], then its output
    /// as [`SystemEvent::Output`], then [`SystemEnd::Exited`].
    ///
    /// `argv[0]` is looked up on the compositor's `PATH`; there is no shell.
    /// `cwd` defaults to the home and `env` adds to the compositor's
    /// environment. Without `stdin` the program reads `/dev/null`.
    Spawn {
        argv: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default)]
        stdin: bool,
    },
    /// Write to the standard input of the process with this id.
    Stdin { data: String },
    /// Close the standard input of the process with this id.
    CloseStdin,
    /// Signal the process with this id.
    Kill { signal: Signal },
    /// Call a D-Bus method. Answered with [`SystemReply::Returned`], or
    /// [`SystemErrorKind::Dbus`] when the method returns an error.
    ///
    /// `body` is JSON text: an array with one element per type in
    /// `signature`. See `domicile_host::dbus_json` for how each D-Bus type is
    /// written.
    DbusCall {
        bus: Bus,
        destination: String,
        path: String,
        interface: String,
        member: String,
        signature: String,
        body: String,
    },
    /// Report the signals matching every field given. Answered with
    /// [`SystemReply::Started`], then a [`SystemEvent::Signal`] per signal.
    /// [`SystemRequest::Unwatch`] ends it.
    DbusMatch {
        bus: Bus,
        #[serde(default)]
        sender: Option<String>,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        interface: Option<String>,
        #[serde(default)]
        member: Option<String>,
    },
}

/// Which D-Bus bus a call or match is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Bus {
    Session,
    System,
}

/// A signal for [`SystemRequest::Kill`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Signal {
    Hup,
    Int,
    Term,
    Kill,
    Usr1,
    Usr2,
}

/// The answer to a [`SystemRequest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemReply {
    /// A file's contents, base64.
    Read { data: String },
    /// The file was written.
    Written,
    /// A directory's entries, in no particular order.
    Entries { entries: Vec<DirEntry> },
    /// A path's type, size in bytes and modification time in milliseconds
    /// since the epoch. Files under `/sys` and `/proc` report a size of 4096
    /// or 0 whatever they hold.
    Stat {
        file_type: FileType,
        size: u64,
        modified_ms: Option<u64>,
    },
    /// What a D-Bus method returned: JSON text for its body, as
    /// [`SystemRequest::DbusCall`] takes one, and the signature to read it by.
    Returned { signature: String, body: String },
    /// The watch, match or process is running.
    Started,
    /// The call failed. Nothing else follows under this id.
    Failed { error: SystemError },
}

/// One entry of a directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    /// The entry's own type: a symlink is reported as one, not followed.
    pub file_type: FileType,
}

/// What a path is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileType {
    File,
    Directory,
    Symlink,
    /// A device, socket or pipe.
    Other,
}

/// Something a running watch or process produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemEvent {
    /// Bytes a process wrote, base64, in the order it wrote them on each
    /// stream.
    Output { stream: Stream, data: String },
    /// The watched file, or an entry of the watched directory, changed.
    /// `path` is absolute.
    Changed { path: String },
    /// A D-Bus signal a match named, its body written as
    /// [`SystemReply::Returned`]'s is.
    Signal {
        sender: String,
        path: String,
        interface: String,
        member: String,
        signature: String,
        body: String,
    },
}

/// One of a process's output streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stream {
    Stdout,
    Stderr,
}

/// How a watch or process ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemEnd {
    /// The process exited with `code`, or was killed by `signal`. Sent after
    /// all its output.
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
    /// The watch or match ended on [`SystemRequest::Unwatch`].
    Stopped,
    /// The watch or process broke.
    Failed { error: SystemError },
}

/// Why a system call failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemError {
    pub kind: SystemErrorKind,
    /// The operating system's description, for logs. Not for matching.
    pub message: String,
}

/// The kinds of [`SystemError`] a shell can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemErrorKind {
    NotFound,
    PermissionDenied,
    AlreadyExists,
    NotADirectory,
    IsADirectory,
    /// The request itself was wrong: bad base64, an empty argv, or an id that
    /// is already running.
    InvalidInput,
    /// The desktop is locked. See `docs/LOCK.md`.
    Locked,
    /// A D-Bus method returned an error. The message starts with its name,
    /// such as `org.freedesktop.DBus.Error.ServiceUnknown`.
    Dbus,
    Other,
}

/// One clipboard history entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipboardEntry {
    /// The id [`ChromeMessage::CopyClipboardEntry`] uses.
    ///
    /// Never reused, so a stale id matches nothing. Not a position. 32 bits
    /// because the browser process carries it in a `base::Value`, whose
    /// integers are signed 32-bit.
    pub id: u32,

    /// A possibly truncated preview of the copied text.
    ///
    /// Long entries are cut at
    /// `domicile_host::clipboard::PREVIEW_CHARACTERS`; restoring the entry
    /// always restores the full text.
    pub preview: String,
}

/// One display, in logical units (CSS pixels).
///
/// Positions share one desktop-wide space whose origin is the top-left of the
/// displays' bounding box, so they are never negative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayInfo {
    /// What the shell addresses this display by, e.g. `<Screen name="left">`.
    pub name: String,
    /// Its top-left corner in the desktop's coordinate space.
    pub position: [i32; 2],
    /// Its width and height, logical, after rotation.
    pub size: [u32; 2],
    /// The `wl_output` scale advertised to clients on this display.
    ///
    /// Not the chrome's own render scale: the chrome is one page with one
    /// `devicePixelRatio`.
    pub scale: u32,
    /// The monitor's mode in physical pixels, before rotation.
    ///
    /// Informational only; the engine rotates and scales each monitor's slice
    /// itself. A portrait 4K panel is `mode: [3840, 2160]` and
    /// `size: [1800, 3200]`.
    #[serde(default)]
    pub mode: [u32; 2],
    /// How the monitor is rotated.
    #[serde(default)]
    pub transform: DisplayTransform,
}

/// How a monitor is rotated, as written in the config file.
///
/// Matches the `wl_output.transform` rotations, which count counterclockwise:
/// `rotate-90` turns content a quarter counterclockwise, for a panel turned a
/// quarter clockwise. kanshi and sway use the same numbers.
///
/// Renamed per variant because serde's kebab-case would write `rotate270`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayTransform {
    #[default]
    #[serde(rename = "normal")]
    Normal,
    /// Content turned a quarter counterclockwise.
    #[serde(rename = "rotate-90")]
    Rotate90,
    #[serde(rename = "rotate-180")]
    Rotate180,
    /// Content turned a quarter clockwise, for a panel standing on its left
    /// side.
    #[serde(rename = "rotate-270")]
    Rotate270,
}

impl DisplayTransform {
    /// Whether this rotation swaps width and height, i.e. how `mode` maps to
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

/// A short preview of a file's contents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FilePreview {
    /// The start of a text file.
    Text { text: String },
    /// The first entries of a directory, sorted, with directories ending in
    /// `/`.
    Directory { entries: Vec<String> },
    /// An audio file's tags. A missing tag is absent; an empty one is empty.
    Audio {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        artist: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        album: Option<String>,
        /// Length in seconds.
        duration: f64,
        /// Embedded cover art as a `data:` URL.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cover: Option<String>,
    },
    /// A non-text file with nothing to preview.
    Binary,
    /// Not in the index, or not readable.
    Unreadable,
}

/// The desktop's color theme.
///
/// Mirrors `domicile_config::ThemeMode` rather than sharing it, to keep this
/// crate serde-only. There is no "follow the system" variant because Domicile
/// is the system.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    /// The default when the config sets none.
    #[default]
    Dark,
    Light,
}

/// One system tray icon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrayItem {
    /// The id [`ChromeMessage::ActivateTrayItem`] uses.
    ///
    /// The StatusNotifierItem `Id`, which survives an application restart so a
    /// shell can keep the icon's position. Duplicates get `#2`, `#3` and so
    /// on; an item with no `Id` uses its bus name and object path.
    pub id: String,
    /// The icon's label: its tooltip title, else `Title`, else `Id`. Never
    /// empty.
    pub title: String,
    /// The icon as a `data:` URL, using the attention icon when the item needs
    /// attention. Absent when none could be drawn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// Which StatusNotifierItem action a tray click requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayAction {
    /// `Activate`: the primary button, usually raising the app's window.
    Primary,
    /// `SecondaryActivate`: the middle button.
    Secondary,
    /// `ContextMenu`: the secondary button, asking the app for its menu.
    Context,
}

/// One notification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notification {
    /// The id `Notify` returned, used by
    /// [`ChromeMessage::DismissNotifications`] and
    /// [`ChromeMessage::InvokeNotificationAction`]. A replaced notification
    /// keeps its id.
    pub id: u32,
    /// The sender's name. May be empty.
    pub app_name: String,
    /// The one-line summary. May be empty.
    pub summary: String,
    /// The body as plain text; the compositor strips the spec's markup.
    pub body: String,
    /// The notification's image, else its application's icon, as a `data:`
    /// URL. Absent when neither could be drawn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub urgency: Urgency,
    /// Its buttons, in the application's order. The `default` action is
    /// excluded; see [`Notification::clickable`].
    pub actions: Vec<NotificationAction>,
    /// Whether the application offered a `default` action.
    pub clickable: bool,
    /// Requested display time in milliseconds; `0` means until dismissed.
    /// Absent when left to the server (the shell).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    /// Arrival or last replacement time, in Unix milliseconds on the
    /// compositor's clock.
    pub time: u64,
}

/// One button of a [`Notification`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotificationAction {
    /// The key [`ChromeMessage::InvokeNotificationAction`] uses.
    pub key: String,
    /// What the button says.
    pub label: String,
}

/// A notification's `urgency` hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Urgency {
    Low,
    #[default]
    Normal,
    /// Something the user should not miss, such as a nearly empty battery.
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
/// Requires an exact match; see [`PROTOCOL_VERSION`].
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

    /// The exact JSON the SDK sends for a theme change.
    ///
    /// The chrome-to-host direction has no shared fixture in `wire/`, so these
    /// tests are the only check that the SDK's spelling matches this enum.
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

    /// The exact JSON the SDK sends once a page has captured its frame.
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

    /// The exact JSON the SDK sends for a tray icon click.
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

    /// The exact JSON the SDK sends to dismiss notifications.
    #[test]
    fn the_dismissal_the_sdk_sends_parses() {
        let sent = r#"{"type":"dismiss_notifications","ids":[7,8]}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the SDK's own wire form"),
            ChromeMessage::DismissNotifications { ids: vec![7, 8] }
        );
    }

    /// The exact JSON the SDK sends for a notification button press.
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

    /// The exact JSON the SDK sends for the desktop size.
    ///
    /// `chrome-message.ts` spells message types as literals and serde derives
    /// them here, so a mismatch would otherwise surface only at runtime, as an
    /// unparseable message and a desktop that never resizes.
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

    /// The exact JSON the engine's `setAppBounds` sends.
    #[test]
    fn an_apps_bounds_the_engine_sends_parse() {
        let sent =
            r#"{"type":"set_app_bounds","app_id":"7","position":[1920.5,30],"size":[800,600]}"#;
        assert_eq!(
            serde_json::from_str::<ChromeMessage>(sent).expect("the engine's own wire form"),
            ChromeMessage::SetAppBounds {
                app_id: "7".to_string(),
                position: [1920.5, 30.0],
                size: [800.0, 600.0],
            }
        );
    }
}
