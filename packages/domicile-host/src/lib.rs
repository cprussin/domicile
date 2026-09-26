//! The Domicile host orchestrator — the compositor's brain.
//!
//! [`Host`] is deliberately free of Wayland and GPU dependencies: it tracks
//! connected apps, applies the placement/focus decisions the chrome sends, and
//! decides where input goes. The Smithay Wayland-server backend (behind the
//! `smithay-backend` feature) is thin glue that drives this: it calls
//! [`Host::app_appeared`] when a client maps a toplevel, feeds
//! [`Host::handle_chrome_message`] with messages from the page, and asks
//! [`Host::keyboard_target`] where the keyboard goes.
//!
//! This split keeps the interesting logic unit-testable end to end.

use std::collections::HashMap;

use domicile_protocol::{ChromeMessage, DisplayInfo, HostMessage, Theme};

pub mod battery;
pub mod clipboard;
pub mod file_changes;
pub mod file_index;
pub mod file_preview;
pub mod file_search;
pub mod home_walk;
pub mod home_watch;
pub mod index_file;
pub mod index_location;
pub mod ipc;
pub mod theme_turnover;
use domicile_scene::{KeyboardTarget, Scene};

/// Identifier for a connected app (Wayland toplevel), assigned by the host.
pub type AppId = String;

/// Something went wrong applying a chrome message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("no such app: {0}")]
    UnknownApp(AppId),
}

/// A connected app the host knows about (independent of whether the chrome has
/// given it an on-screen portal yet).
#[derive(Debug, Clone)]
pub struct App {
    pub app_id: AppId,
    /// Where this app falls in the order clients mapped, so a desktop can be
    /// re-announced in the order it was built up. Kept as a field because the
    /// alternative — reading the number back out of `app_id` — has to answer
    /// for an id with no number in it, and there is no such id.
    pub arrival: u64,
    pub title: Option<String>,
    /// The client's own content size, as of its latest committed buffer, and
    /// `None` until it has committed one.
    pub size: Option<(f64, f64)>,
}

/// The compositor's orchestration state.
#[derive(Debug, Default)]
pub struct Host {
    scene: Scene,
    apps: HashMap<AppId, App>,
    next_id: u64,
    /// The keyboard holder as the chromes were last told it, so that
    /// [`Host::focus_change`] can say nothing when nothing moved.
    told_focus: Option<AppId>,
    /// What the desktop is made of, as every chrome is told — on connecting,
    /// and again whenever it changes under them.
    ///
    /// Empty until something describes one, which is a desktop of no screens
    /// and nothing else. The compositor always describes at least one output,
    /// so a chrome on *it* never sees this — but a `Host` nobody has told is a
    /// real configuration, and the `domicile` daemon is one: it serves this
    /// protocol from a bare `Session` and never describes a desktop to it.
    /// Saying "no screens" beats inventing a display it never asked for.
    displays: Vec<DisplayInfo>,
    /// The keymap the compositor compiled, for the browser process reading
    /// this socket rather than for the page.
    ///
    /// `None` until something sets one, and then nothing is said — a `Host`
    /// nobody has handed a keymap is the `domicile` daemon and every unit
    /// test, neither of which has a keyboard behind it. Inventing a layout for
    /// them would be worse than the silence: it would be a desktop typing in
    /// a layout nobody chose.
    keymap: Option<String>,
    /// Which way round the desktop is drawn, as every chrome is told — on
    /// connecting, and again whenever it changes under them.
    ///
    /// Not an `Option`, which is where it differs from the keymap above. A
    /// keymap nobody handed over is a host with no keyboard behind it and
    /// there is no honest layout to invent for it; a page paints in one theme
    /// or the other whatever anybody said, so the question is only which — and
    /// the answer for a host nobody told is the dark the chrome was drawn
    /// against, which is also what `[theme] mode` defaults to.
    theme: Theme,
    /// Which way round the desk's windows are drawn. Apart from `theme`
    /// because the windows turn after the chromes do -- see
    /// [`theme_turnover`] -- and a chrome connecting in between is told each.
    windows_theme: Theme,
}

impl Host {
    pub fn new() -> Self {
        Host::default()
    }

    /// Say what the desktop is made of, for every chrome that connects after.
    ///
    /// Replaces whatever was described before rather than adding to it: the
    /// argument is the desktop, not a display joining one. The compositor
    /// re-describes on the path where the desktop changes at runtime — with no
    /// displays configured it is Domicile's own window, and resizing that
    /// window resizes it — so a chrome connecting after has to be told the
    /// current desktop rather than whichever was first.
    pub fn describe_displays(&mut self, displays: Vec<DisplayInfo>) {
        self.displays = displays;
    }

    /// The desktop, in the message a chrome is told it as.
    ///
    /// Two callers and they are not the same event: the handshake answers a
    /// connecting chrome with it, and the compositor broadcasts it to the
    /// chromes already connected when the desktop changes under them.
    pub fn describe_desktop(&self) -> HostMessage {
        HostMessage::Displays {
            displays: self.displays.clone(),
        }
    }

    /// Hand over the keymap the compositor compiled, for every chrome that
    /// connects after.
    ///
    /// Out of the same `input.keyboard` the seat is built from — so the
    /// browser decodes a key against the compositor's own reading of the
    /// config rather than against a second reading of its own, which is two
    /// readings that can disagree.
    ///
    /// Set at startup and again whenever a reload changes the keyboard, which
    /// is why it replaces rather than accumulates: the argument is the layout
    /// the desk types on now. The compositor broadcasts the same text to the
    /// chromes already connected, so this retained copy is for the ones that
    /// connect next.
    pub fn set_keymap(&mut self, keymap: String) {
        self.keymap = Some(keymap);
    }

    /// The keymap, in the message a chrome is told it as, or `None` from a
    /// host that has never been given one.
    pub fn describe_keymap(&self) -> Option<HostMessage> {
        self.keymap
            .clone()
            .map(|keymap| HostMessage::Keymap { keymap })
    }

    /// Take up a theme, and hand back what to tell the chromes — or `None`
    /// where the desk is already on it.
    ///
    /// Three things set one and none of them is this crate's: the config the
    /// compositor read at startup, a reload whose `[theme]` moved, and a click
    /// on the shell's toggle arriving as [`ChromeMessage::SetTheme`]. All
    /// three land here so there is one place the desk's theme is, which is
    /// what lets the *answer* be the broadcast: a toggle clicked on one
    /// monitor's page is the whole desktop changing, and the compositor sends
    /// this to every chrome rather than back to the one that asked.
    ///
    /// `None` when nothing moved, because "set it to what it is" is the
    /// ordinary case rather than the odd one — a config file is rewritten for
    /// all sorts of reasons — and a broadcast for it would run the theme wipe
    /// on every page on the desk over a theme that did not change.
    pub fn set_theme(&mut self, theme: Theme) -> Option<HostMessage> {
        (self.theme != theme).then(|| {
            self.theme = theme;
            self.describe_theme()
        })
    }

    /// The theme, in the message a chrome is told it as.
    ///
    /// [`Host::describe_desktop`]'s two callers, for its reasons: the
    /// handshake answers a connecting chrome with it, and the compositor
    /// broadcasts it when the theme changes under the chromes already there.
    pub fn describe_theme(&self) -> HostMessage {
        HostMessage::Theme { theme: self.theme }
    }

    /// Remember which way round the desk's windows are now drawn, and say so
    /// if that moved.
    pub fn set_windows_theme(&mut self, theme: Theme) -> Option<HostMessage> {
        (self.windows_theme != theme).then(|| {
            self.windows_theme = theme;
            self.describe_windows_theme()
        })
    }

    /// The windows' theme, in the message a chrome is told it as.
    pub fn describe_windows_theme(&self) -> HostMessage {
        HostMessage::WindowsTheme {
            theme: self.windows_theme,
        }
    }

    /// Register a newly-mapped Wayland toplevel. Returns its assigned id and the
    /// message to forward to the chrome so it can mount an `<app>` element. The
    /// app has no on-screen portal until the chrome places it.
    pub fn app_appeared(
        &mut self,
        title: Option<String>,
        size: Option<(f64, f64)>,
    ) -> (AppId, HostMessage) {
        self.next_id += 1;
        let app_id = format!("app-{}", self.next_id);
        self.apps.insert(
            app_id.clone(),
            App {
                app_id: app_id.clone(),
                arrival: self.next_id,
                title: title.clone(),
                size,
            },
        );
        let message = HostMessage::AppAppeared {
            app_id: app_id.clone(),
            title,
            size: size.map(wire_size),
        };
        (app_id, message)
    }

    /// Everything a chrome needs to mount the desktop as it stands, as if each
    /// window had just appeared.
    ///
    /// `app_appeared` is sent once, when the client maps, and nothing ever says
    /// it again — so a chrome that was not listening at that moment loses that
    /// window for good, while the client goes on running and drawing. Two ways
    /// in: a client that maps in the milliseconds between the page's handshake
    /// and its first React commit, and every reload, which starts a fresh page
    /// against a compositor full of clients.
    ///
    /// In the order the apps arrived rather than the map's, which is arbitrary
    /// — a desktop that mounts its windows in a different order on each reload
    /// is its own bug.
    pub fn open_apps(&self) -> Vec<HostMessage> {
        let mut open: Vec<&App> = self.apps.values().collect();
        open.sort_by_key(|app| app.arrival);
        open.iter()
            .map(|app| HostMessage::AppAppeared {
                app_id: app.app_id.clone(),
                title: app.title.clone(),
                size: app.size.map(wire_size),
            })
            // And who has the keyboard, which a page that has just loaded has
            // no other way to learn. After the windows: it names one of them.
            //
            // Sent unconditionally rather than through `focus_change`, and
            // without disturbing what that has told the other chromes. This
            // announcement is a catch-up rather than a change, so it must not
            // consume the delta the chromes that were already listening are
            // still owed — and the compositor broadcasts it, so a chrome that
            // already knew is told what it already knew, which is the same
            // no-op as a second `app_appeared`.
            .chain(std::iter::once(HostMessage::FocusChanged {
                app_id: self.focus_holder(),
            }))
            .collect()
    }

    /// Who holds the keyboard, in the shape the chrome is told it.
    ///
    /// `None` is the chrome. Public because the seat needs the same answer:
    /// the compositor sets keyboard focus from what this says rather than from
    /// what the chrome asked for, so that the two cannot disagree about which
    /// window is being typed into.
    pub fn focus_holder(&self) -> Option<AppId> {
        match self.scene.keyboard_target() {
            KeyboardTarget::App(app_id) => Some(app_id),
            KeyboardTarget::Chrome => None,
        }
    }

    /// A client asked for the keyboard. Nothing here gives it to them.
    ///
    /// The message goes out and the seat stays where it is, because which
    /// window the user is typing into is the shell's to decide — this is the
    /// question, [`Host::focus_change`] reports the answer, and `focus_app` is
    /// how a shell that decided to grant it says so. A host that granted this
    /// itself would make focus stealing unrefusable by any shell built on it.
    ///
    /// `None` for a client this host has no window for, which is the gate
    /// `ChromeMessage::FocusApp` keeps on the way back: a request no shell
    /// could answer is not one worth broadcasting.
    pub fn focus_requested(&self, app_id: &str) -> Option<HostMessage> {
        self.apps
            .contains_key(app_id)
            .then(|| HostMessage::FocusRequested {
                app_id: app_id.to_string(),
            })
    }

    /// What the chrome has to be told about focus, which is nothing unless it
    /// moved since the last time this was asked.
    ///
    /// Asked after anything that could move it rather than returned from each
    /// of those, because the things that move focus do not look alike — a
    /// chrome message, a click the compositor routed, a client going away —
    /// and the one thing they have in common is that afterward the answer to
    /// this question may have changed.
    pub fn focus_change(&mut self) -> Option<HostMessage> {
        let holder = self.focus_holder();
        if holder == self.told_focus {
            return None;
        }
        self.told_focus = holder.clone();
        Some(HostMessage::FocusChanged { app_id: holder })
    }

    /// Record a client's new content size. Returns the chrome notification, or
    /// `None` if the app is unknown.
    pub fn app_resized(&mut self, app_id: &str, size: (f64, f64)) -> Option<HostMessage> {
        let app = self.apps.get_mut(app_id)?;
        app.size = Some(size);
        Some(HostMessage::AppResized {
            app_id: app_id.to_string(),
            size: wire_size(size),
        })
    }

    /// Record what a client calls its window. Returns the chrome notification,
    /// or `None` if the app is unknown or the name has not changed.
    ///
    /// Answering only a change is this type's contract rather than a filter
    /// the caller depends on: what the chromes have been told and what is
    /// recorded here stay in step however often a caller repeats itself.
    /// Today's only production caller repeats nothing — Smithay drops a
    /// `set_title` that does not change the title before the compositor ever
    /// hears it — so this arm is held by the tests rather than by traffic.
    pub fn app_titled(&mut self, app_id: &str, title: Option<String>) -> Option<HostMessage> {
        let app = self.apps.get_mut(app_id)?;
        if app.title == title {
            None
        } else {
            app.title = title.clone();
            Some(HostMessage::AppTitled {
                app_id: app_id.to_string(),
                title,
            })
        }
    }

    /// Tear down a client: forget it and remove any portal. Returns the chrome
    /// notification, or `None` if the app was already gone.
    pub fn app_closed(&mut self, app_id: &str) -> Option<HostMessage> {
        self.apps.remove(app_id)?;
        self.scene.window_gone(app_id);
        Some(HostMessage::AppClosed {
            app_id: app_id.to_string(),
        })
    }

    /// Apply a message received from the chrome.
    pub fn handle_chrome_message(&mut self, message: ChromeMessage) -> Result<(), HostError> {
        match message {
            ChromeMessage::Hello { .. } => {
                // The handshake is handled by the connection layer; nothing to do here.
            }
            ChromeMessage::SetScreen { .. } => {
                // PER CONNECTION, AND THE BRAIN IS SHARED. Which display a
                // window covers is a fact about that one socket -- the desk
                // has one brain and a window each -- so recording it here
                // would be the last chrome to connect overwriting what every
                // other one is. The compositor holds it beside the writer it
                // belongs to and reads that connection's desktop from it with
                // `as_seen_from` on the way out.
            }
            ChromeMessage::SetDevicePixelRatio { .. } => {
                // The scene is described in logical units, which do not change
                // when the display's pixel density does. This is the
                // compositor's business — it becomes the `wl_output` scale —
                // and it is intercepted there before reaching the brain.
            }
            ChromeMessage::SetDesktopSize { .. } => {
                // The other half of the same mode, and the brain's business
                // just as little: how big the desktop is is `wl_output` state,
                // and the scene places windows in it at coordinates the chrome
                // already sends absolute. Intercepted in the compositor beside
                // the density above.
            }
            ChromeMessage::FocusApp { app_id } => {
                // Gated on a window this host knows about, which is a window
                // that has mapped. It used to be gated on the page having
                // *placed* it, and that gate is gone with placement — see
                // `Scene::focus_app`.
                if !self.apps.contains_key(&app_id) {
                    return Err(HostError::UnknownApp(app_id));
                }
                self.scene.focus_app(&app_id);
            }
            ChromeMessage::FocusChrome => {
                self.scene.focus_chrome();
            }
            // Compositor-level, like Spawn: a close is the client's to answer
            // — the window leaves the scene when it actually goes away.
            ChromeMessage::CloseApp { .. }
            | ChromeMessage::Spawn { .. }
            | ChromeMessage::SearchFiles { .. }
            | ChromeMessage::PreviewFile { .. }
            | ChromeMessage::CopyClipboardEntry { .. }
            | ChromeMessage::SetTheme { .. }
            | ChromeMessage::ThemeCaptured { .. }
            | ChromeMessage::PointerMotion { .. }
            | ChromeMessage::PointerLeave { .. }
            | ChromeMessage::PointerButton { .. }
            | ChromeMessage::PointerAxis { .. }
            | ChromeMessage::Key { .. }
            | ChromeMessage::Unlock { .. } => {
                // Compositor-level side effects (spawning, input injection). The
                // compositor intercepts these; the brain ignores them so it stays
                // pure and testable.
                //
                // `SetTheme` is in here for a different reason from the rest,
                // and it is the reason it is intercepted rather than applied:
                // what the chrome asked for has to reach the desktop's
                // *clients* as well as its pages, through a D-Bus service this
                // crate cannot have — see `domicile_compositor::appearance`.
                // The compositor calls `Host::set_theme` itself and broadcasts
                // what comes back, which is the same shape as `Spawn`: the
                // brain holds the state, the compositor does the deed.
                //
                // `Unlock` is here for the same reason as the input forwards
                // above and not for `SetTheme`'s: the lock is the seat's, and
                // the seat is the compositor's. Whether this desk is listening
                // is not scene state and must not become it — see
                // `crate::lock` over there, which is the only thing that holds
                // it.
            }
        }
        Ok(())
    }

    /// The current keyboard delivery target.
    pub fn keyboard_target(&self) -> KeyboardTarget {
        self.scene.keyboard_target()
    }

    /// Read-only access to the scene (portals + focus).
    pub fn scene(&self) -> &Scene {
        &self.scene
    }

    /// Look up a connected app.
    pub fn app(&self, app_id: &str) -> Option<&App> {
        self.apps.get(app_id)
    }

    /// Number of connected apps (mapped clients), regardless of placement.
    pub fn app_count(&self) -> usize {
        self.apps.len()
    }
}

/// A size as the wire carries it. The memory form is a tuple and the protocol's
/// is a two-element array; this is the one place the two meet.
fn wire_size((width, height): (f64, f64)) -> [f64; 2] {
    [width, height]
}

/// The desk as the window on `name` sees it: every display, with that one at
/// the origin and the whole of it.
///
/// **A DESK OF SEVERAL MONITORS IS SEVERAL WINDOWS.** One browser window
/// cannot span two CRTCs — `ScreenManager::FindWindowAt` binds a window to a
/// controller only on an exact rectangle match — so the engine opens one per
/// display, each loading the same shell. This is the one thing that differs
/// between what those windows are told.
///
/// **MOVED TO THE ORIGIN, WHICH IS HALF THE POINT.** A window is its display,
/// so within it that display starts at zero. A page goes on placing a region
/// at `position` against the initial containing block exactly as it always
/// has, and a shell needs to know nothing about any of this.
///
/// **AND THE REST OF THE DESK COMES WITH IT, WHICH IS THE OTHER HALF.** A
/// shell decides things about the desk that it cannot decide about one
/// monitor: which screen the chrome goes on, what a box across every screen
/// is, which monitor is left of which. Handed its own display alone, every
/// page decides all of them about itself — every monitor draws the whole
/// chrome, and every page embeds every window. A client's frame sink takes
/// one parent, so the last page to embed takes the window off all the others,
/// and a terminal that still answers the keyboard stops drawing. Which
/// display this page may draw on is `fills_the_window`, and it is exactly
/// one of them.
///
/// The others come relative to it because the desk is one space and moving
/// its origin moves all of it: a list whose own screen had been moved and
/// whose others had not is a desk that overlaps itself.
///
/// **A NAME THAT MATCHES NOTHING IS AN EMPTY DESKTOP**, not the whole one.
/// That is a window whose display went away between the engine naming it and
/// the desktop being described, and the two readings are a blank screen and a
/// page laying out in a desktop it has no corner of. A blank one is honest and
/// lasts until the reconciliation closes the window.
///
/// **AND ITS OWN DISPLAY IS THE WHOLE WINDOW**, which `fills_the_window`
/// says. The engine turns and scales that window itself, so the page is the
/// display's logical box the right way up and has nothing to map; the flag is
/// how a page knows which display is its own. Set only here, because this is the only place that knows a window is a monitor —
/// `Advertised::described` describes a desktop, and a desktop is not anybody's
/// viewport.
pub fn as_seen_from(displays: &[DisplayInfo], name: &str) -> Vec<DisplayInfo> {
    let Some(window) = displays.iter().find(|display| display.name == name) else {
        return Vec::new();
    };
    let [left, top] = window.position;
    displays
        .iter()
        .map(|display| DisplayInfo {
            position: [display.position[0] - left, display.position[1] - top],
            fills_the_window: display.name == name,
            ..display.clone()
        })
        .collect()
}
