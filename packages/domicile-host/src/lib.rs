//! The compositor's window, focus and desktop state, without Wayland or GPU
//! dependencies so it can be unit tested.
//!
//! The compositor calls [`Host::app_appeared`] when a client maps a toplevel,
//! passes page messages to [`Host::handle_chrome_message`], and asks
//! [`Host::keyboard_target`] where keys go.

use std::collections::HashMap;

use std::collections::BTreeMap;

use domicile_protocol::{
    Appearance, BoundShortcut, Capturing, ChromeMessage, DisplayInfo, HostMessage, Notification,
    PortalRequest, PortalWallpaper, Theme, TrayItem,
};

pub mod autostart;
pub mod base64;
pub mod cast_grants;
pub mod clipboard;
pub mod cups;
pub mod data_dirs;
pub mod data_url;
pub mod dbus_json;
pub mod file_changes;
pub mod file_filters;
pub mod file_index;
pub mod file_search;
pub mod global_shortcuts;
pub mod home_walk;
pub mod home_watch;
mod icon_theme;
pub mod index_file;
pub mod index_location;
pub mod ipc;
pub mod ipp;
pub mod launcher_icon;
mod lock_screen_readouts;
pub mod mime_apps;
pub mod notifications;
mod png;
pub mod portal_notifications;
pub mod portals;
pub mod print_media;
pub mod print_settings;
pub mod screenshot;
pub mod shell_commands;
pub mod system;
pub mod theme_turnover;
pub mod tray;
pub mod usb_names;
pub mod wallpaper;
pub mod xdg_foreign;
use domicile_scene::{KeyboardTarget, Scene};

/// Identifier for a connected app (Wayland toplevel), assigned by the host.
pub type AppId = String;

/// Something went wrong applying a chrome message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("no such app: {0}")]
    UnknownApp(AppId),
}

/// A window's size limit on neither axis, as xdg-shell spells it.
const NO_LIMIT: (f64, f64) = (0.0, 0.0);

/// A mapped client window, whether or not the chrome has placed it.
#[derive(Debug, Clone)]
pub struct App {
    pub app_id: AppId,
    /// Map order, so [`Host::open_apps`] re-announces windows in that order.
    pub arrival: u64,
    pub title: Option<String>,
    /// The client's `xdg_toplevel.set_app_id`; `None` until it sets one.
    pub desktop_id: Option<String>,
    /// Content size of the latest committed buffer; `None` before the first.
    pub size: Option<(f64, f64)>,
    /// Size limits in logical units. `0` on an axis means no limit.
    pub min_size: (f64, f64),
    pub max_size: (f64, f64),
}

/// A popup a client opened over one of its windows. See
/// [`HostMessage::PopupPlaced`].
#[derive(Debug, Clone, PartialEq)]
pub struct Popup {
    pub app_id: AppId,
    /// Shares [`App::arrival`]'s counter, so a popup sorts after its parent.
    pub arrival: u64,
    pub parent: AppId,
    pub position: (f64, f64),
    pub size: (f64, f64),
    pub grab: bool,
}

/// The compositor's orchestration state.
#[derive(Debug, Default)]
pub struct Host {
    scene: Scene,
    apps: HashMap<AppId, App>,
    popups: HashMap<AppId, Popup>,
    next_id: u64,
    /// The focus holder last sent to the chromes, for [`Host::focus_change`].
    told_focus: Option<AppId>,
    /// The desktop's displays.
    ///
    /// Empty until described. The `domicile` daemon never describes one, so
    /// it reports no screens rather than an invented display.
    displays: Vec<DisplayInfo>,
    /// The compiled keymap, for the browser process rather than the page.
    ///
    /// `None` until set. The `domicile` daemon and unit tests have no
    /// keyboard, so they send no keymap rather than an invented layout.
    keymap: Option<String>,
    /// Chrome extensions from the config (Web Store ids, unpacked
    /// directories) for the browser process to install.
    ///
    /// `None` until set. The browser uninstalls extensions missing from the
    /// list, so a host without a config must not send an empty one.
    extensions: Option<(Vec<String>, Vec<String>)>,
    /// The config's bound keysyms resolved against the keymap, for
    /// [`HostMessage::ShellConfig`]. `None` until set, as for `keymap`.
    shell_config: Option<BTreeMap<String, u32>>,
    /// The chromes' theme.
    ///
    /// Not an `Option`: a page always paints in some theme. The default
    /// matches `theme.mode`'s default.
    theme: Theme,
    /// The client windows' theme. Separate from `theme` because windows
    /// switch after the chromes (see [`theme_turnover`]).
    windows_theme: Theme,
    /// The config's accent color, contrast and reduced motion.
    appearance: Appearance,
    /// The system tray's icons.
    ///
    /// `None` until set. The `domicile` daemon has no session bus, so it
    /// sends no tray rather than an empty one.
    tray: Option<Vec<TrayItem>>,
    /// The desktop's notifications. `None` until set, as for `tray`.
    notifications: Option<Vec<Notification>>,
    /// Handles clients exported their windows under, for a portal's
    /// `parent_window`.
    exports: xdg_foreign::Exports,
    /// The unanswered portal dialogs and the running input sessions. `None`
    /// until set, as for `tray`.
    portal_requests: Option<(Vec<PortalRequest>, Vec<Capturing>)>,
    /// The chords applications hold, which ride on the portal requests.
    global_shortcuts: Vec<BoundShortcut>,
    /// The pictures set through the Wallpaper portal, which ride on the portal
    /// requests.
    portal_wallpaper: PortalWallpaper,
}

impl Host {
    pub fn new() -> Self {
        Host::default()
    }

    pub fn exports(&self) -> &xdg_foreign::Exports {
        &self.exports
    }

    pub fn exports_mut(&mut self) -> &mut xdg_foreign::Exports {
        &mut self.exports
    }

    /// Replace the desktop's displays, for chromes that connect later.
    pub fn describe_displays(&mut self, displays: Vec<DisplayInfo>) {
        self.displays = displays;
    }

    /// The displays message, sent on handshake and broadcast on change.
    pub fn describe_desktop(&self) -> HostMessage {
        HostMessage::Displays {
            displays: self.displays.clone(),
        }
    }

    /// Replace the compiled keymap, for chromes that connect later.
    ///
    /// The keymap comes from the seat's `input.keyboard`, so the browser and
    /// the compositor decode keys the same way.
    pub fn set_keymap(&mut self, keymap: String) {
        self.keymap = Some(keymap);
    }

    /// The keymap message, or `None` if no keymap was set.
    pub fn describe_keymap(&self) -> Option<HostMessage> {
        self.keymap
            .clone()
            .map(|keymap| HostMessage::Keymap { keymap })
    }

    /// Replace the config's extensions, for chromes that connect later.
    pub fn set_extensions(&mut self, web_store: Vec<String>, unpacked: Vec<String>) {
        self.extensions = Some((web_store, unpacked));
    }

    /// The extensions message, or `None` if none were set.
    pub fn describe_extensions(&self) -> Option<HostMessage> {
        self.extensions
            .clone()
            .map(|(web_store, unpacked)| HostMessage::Extensions {
                web_store,
                unpacked,
            })
    }

    /// Replace the keysym-to-keycode map, for chromes that connect later.
    pub fn set_shell_config(&mut self, keys: BTreeMap<String, u32>) {
        self.shell_config = Some(keys);
    }

    /// The shell config message, or `None` if none was set.
    pub fn describe_shell_config(&self) -> Option<HostMessage> {
        self.shell_config
            .clone()
            .map(|keys| HostMessage::ShellConfig { keys })
    }

    /// Set the theme and return the message to broadcast to every chrome, or
    /// `None` if it did not change.
    ///
    /// The startup config, a reload and [`ChromeMessage::SetTheme`] all call
    /// this. Skipping unchanged themes avoids a theme transition on every
    /// page each time the config file is rewritten.
    pub fn set_theme(&mut self, theme: Theme) -> Option<HostMessage> {
        (self.theme != theme).then(|| {
            self.theme = theme;
            self.describe_theme()
        })
    }

    /// The theme message, sent on handshake and broadcast on change.
    pub fn describe_theme(&self) -> HostMessage {
        HostMessage::Theme { theme: self.theme }
    }

    /// Set the windows' theme and return the message to broadcast, or `None`
    /// if it did not change.
    pub fn set_windows_theme(&mut self, theme: Theme) -> Option<HostMessage> {
        (self.windows_theme != theme).then(|| {
            self.windows_theme = theme;
            self.describe_windows_theme()
        })
    }

    /// The windows' theme message.
    pub fn describe_windows_theme(&self) -> HostMessage {
        HostMessage::WindowsTheme {
            theme: self.windows_theme,
        }
    }

    /// Set the config's appearance and return the message to broadcast, or
    /// `None` if it did not change.
    pub fn set_appearance(&mut self, appearance: Appearance) -> Option<HostMessage> {
        (self.appearance != appearance).then(|| {
            self.appearance = appearance;
            self.describe_appearance()
        })
    }

    /// The appearance message, sent on handshake and broadcast on change.
    pub fn describe_appearance(&self) -> HostMessage {
        HostMessage::Appearance(self.appearance.clone())
    }

    /// Set the tray's icons and return the message to broadcast, or `None` if
    /// they did not change.
    ///
    /// Tray items often re-signal unchanged state, so skipping repeats avoids
    /// redundant redraws.
    pub fn set_tray(&mut self, items: Vec<TrayItem>) -> Option<HostMessage> {
        (self.tray.as_ref() != Some(&items)).then(|| {
            let message = HostMessage::Tray {
                items: items.clone(),
            };
            self.tray = Some(items);
            message
        })
    }

    /// The tray message, or `None` if no tray was set.
    pub fn describe_tray(&self) -> Option<HostMessage> {
        self.tray.clone().map(|items| HostMessage::Tray { items })
    }

    /// Set the notifications and return the message to broadcast, or `None`
    /// if they did not change.
    pub fn set_notifications(&mut self, items: Vec<Notification>) -> Option<HostMessage> {
        (self.notifications.as_ref() != Some(&items)).then(|| {
            let message = HostMessage::Notifications {
                items: items.clone(),
            };
            self.notifications = Some(items);
            message
        })
    }

    /// The notifications message, or `None` if none were set.
    pub fn describe_notifications(&self) -> Option<HostMessage> {
        self.notifications
            .clone()
            .map(|items| HostMessage::Notifications { items })
    }

    /// Set the unanswered portal dialogs and the running input sessions, and
    /// return the message to broadcast, or `None` if they did not change.
    pub fn set_portal_requests(
        &mut self,
        items: Vec<PortalRequest>,
        capturing: Vec<Capturing>,
    ) -> Option<HostMessage> {
        let set = (items, capturing);
        (self.portal_requests.as_ref() != Some(&set)).then(|| {
            self.portal_requests = Some(set);
            self.describe_portal_requests()
                .expect("the requests were just set")
        })
    }

    /// Set the chords applications hold through the GlobalShortcuts portal and
    /// return the message to broadcast, or `None` if they did not change. They
    /// ride on [`HostMessage::PortalRequests`].
    pub fn set_global_shortcuts(&mut self, shortcuts: Vec<BoundShortcut>) -> Option<HostMessage> {
        (self.global_shortcuts != shortcuts).then(|| {
            self.global_shortcuts = shortcuts;
            self.describe_portal_requests()
                .expect("the requests are set before any shortcut is bound")
        })
    }

    /// The portal requests message, or `None` if none were set.
    /// Set the Wallpaper portal's pictures and return the message to
    /// broadcast, or `None` if they did not change. They ride on
    /// [`HostMessage::PortalRequests`].
    pub fn set_portal_wallpaper(&mut self, wallpaper: PortalWallpaper) -> Option<HostMessage> {
        (self.portal_wallpaper != wallpaper).then(|| {
            self.portal_wallpaper = wallpaper;
            self.describe_portal_requests()
                .expect("the requests are set before any wallpaper is shown")
        })
    }

    pub fn describe_portal_requests(&self) -> Option<HostMessage> {
        self.portal_requests
            .clone()
            .map(|(items, capturing)| HostMessage::PortalRequests {
                items,
                capturing,
                shortcuts: self.global_shortcuts.clone(),
                wallpaper: self.portal_wallpaper.clone(),
            })
    }

    /// Register a newly-mapped Wayland toplevel. Returns its assigned id and
    /// the message to forward to the chrome so it can mount an `<app>`
    /// element. The app has no on-screen portal until the chrome places it.
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
                desktop_id: None,
                size,
                min_size: NO_LIMIT,
                max_size: NO_LIMIT,
            },
        );
        let message = HostMessage::AppAppeared {
            app_id: app_id.clone(),
            title,
            desktop_id: None,
            size: size.map(wire_size),
        };
        (app_id, message)
    }

    /// Messages that re-announce every open window and popup, then focus.
    ///
    /// `AppAppeared` is sent once, at map time. A page that was not listening
    /// then (a reload, or a map before the page's first render) needs this to
    /// learn about existing windows. Sorted by arrival so the order is stable.
    pub fn open_apps(&self) -> Vec<HostMessage> {
        // Windows and popups share one counter, so sorting by it puts each
        // parent before its popups.
        let mut open: Vec<(u64, Vec<HostMessage>)> = self
            .apps
            .values()
            .map(|app| (app.arrival, announced(app)))
            .chain(
                self.popups
                    .values()
                    .map(|popup| (popup.arrival, vec![placed(popup)])),
            )
            .collect();
        open.sort_by_key(|(arrival, _)| *arrival);
        open.into_iter()
            .flat_map(|(_, messages)| messages)
            // Focus goes last because it names a window. It bypasses
            // `focus_change` so it does not consume a change other chromes are
            // still owed.
            .chain(std::iter::once(HostMessage::FocusChanged {
                app_id: self.focus_holder(),
            }))
            .collect()
    }

    /// The window with keyboard focus, or `None` for the chrome.
    ///
    /// The compositor sets seat focus from this, so the seat and the chrome
    /// agree.
    pub fn focus_holder(&self) -> Option<AppId> {
        match self.scene.keyboard_target() {
            KeyboardTarget::App(app_id) => Some(app_id),
            KeyboardTarget::Chrome => None,
        }
    }

    /// The message for a client asking for focus, or `None` for an unknown
    /// window.
    ///
    /// Focus does not move. The shell decides and answers with
    /// `ChromeMessage::FocusApp`, so a shell can refuse focus stealing.
    pub fn focus_requested(&self, app_id: &str) -> Option<HostMessage> {
        self.apps
            .contains_key(app_id)
            .then(|| HostMessage::FocusRequested {
                app_id: app_id.to_string(),
            })
    }

    /// The focus message to broadcast, or `None` if focus has not moved since
    /// the last call.
    ///
    /// Callers check this after anything that may move focus: a chrome
    /// message, a routed click or a closed client.
    pub fn focus_change(&mut self) -> Option<HostMessage> {
        let holder = self.focus_holder();
        if holder == self.told_focus {
            return None;
        }
        self.told_focus = holder.clone();
        Some(HostMessage::FocusChanged { app_id: holder })
    }

    /// Record the smallest a client will draw its window. Returns the chrome
    /// notification, or `None` if the app is unknown or nothing changed.
    pub fn app_min_size(&mut self, app_id: &str, size: (f64, f64)) -> Option<HostMessage> {
        let app = self.apps.get_mut(app_id)?;
        if app.min_size == size {
            None
        } else {
            app.min_size = size;
            Some(HostMessage::AppMinSize {
                app_id: app_id.to_string(),
                size: wire_size(size),
            })
        }
    }

    /// Record the largest a client will draw its window, as
    /// [`Host::app_min_size`] does the smallest.
    pub fn app_max_size(&mut self, app_id: &str, size: (f64, f64)) -> Option<HostMessage> {
        let app = self.apps.get_mut(app_id)?;
        if app.max_size == size {
            None
        } else {
            app.max_size = size;
            Some(HostMessage::AppMaxSize {
                app_id: app_id.to_string(),
                size: wire_size(size),
            })
        }
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
    /// Smithay already drops unchanged titles; this check keeps the recorded
    /// title and the chromes in step regardless of the caller.
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

    /// Record which desktop entry a client says it is. Returns the chrome
    /// notification, or `None` if the app is unknown or the id has not
    /// changed.
    pub fn app_desktop_id(&mut self, app_id: &str, desktop_id: String) -> Option<HostMessage> {
        let app = self.apps.get_mut(app_id)?;
        if app.desktop_id.as_ref() == Some(&desktop_id) {
            None
        } else {
            app.desktop_id = Some(desktop_id.clone());
            Some(HostMessage::AppDesktopId {
                app_id: app_id.to_string(),
                desktop_id,
            })
        }
    }

    /// A popup opened over `parent`, a window or another popup. Returns its
    /// new id and the chrome notification, or `None` if `parent` is unknown.
    pub fn popup_placed(
        &mut self,
        parent: &str,
        position: (f64, f64),
        size: (f64, f64),
        grab: bool,
    ) -> Option<(AppId, HostMessage)> {
        if !self.apps.contains_key(parent) && !self.popups.contains_key(parent) {
            return None;
        }
        self.next_id += 1;
        let popup = Popup {
            app_id: format!("app-{}", self.next_id),
            arrival: self.next_id,
            parent: parent.to_string(),
            position,
            size,
            grab,
        };
        let message = placed(&popup);
        let app_id = popup.app_id.clone();
        self.popups.insert(app_id.clone(), popup);
        Some((app_id, message))
    }

    /// A popup the client repositioned. Returns the chrome notification, or
    /// `None` if `app_id` is no popup.
    pub fn popup_moved(
        &mut self,
        app_id: &str,
        position: (f64, f64),
        size: (f64, f64),
    ) -> Option<HostMessage> {
        let popup = self.popups.get_mut(app_id)?;
        popup.position = position;
        popup.size = size;
        Some(placed(popup))
    }

    /// Tear down a client: forget it and remove any portal. Returns the chrome
    /// notification, or `None` if the app was already gone.
    pub fn app_closed(&mut self, app_id: &str) -> Option<HostMessage> {
        if self.popups.remove(app_id).is_none() {
            self.apps.remove(app_id)?;
            self.scene.window_gone(app_id);
            self.exports.app_closed(app_id);
        }
        Some(HostMessage::AppClosed {
            app_id: app_id.to_string(),
        })
    }

    /// Apply a message received from the chrome.
    pub fn handle_chrome_message(&mut self, message: ChromeMessage) -> Result<(), HostError> {
        match message {
            ChromeMessage::Hello { .. } => {
                // The connection layer handles the handshake.
            }
            ChromeMessage::SetDevicePixelRatio { .. } => {
                // The compositor intercepts this as the `wl_output` scale. The
                // scene uses logical units, so it is unaffected.
            }
            ChromeMessage::SetDesktopSize { .. } | ChromeMessage::SetAppBounds { .. } => {
                // The compositor intercepts this as `wl_output` state. The
                // chrome sends absolute coordinates, so the scene needs no
                // size.
            }
            ChromeMessage::FocusApp { app_id } => {
                // Any mapped window can take focus. See `Scene::focus_app`.
                if !self.apps.contains_key(&app_id) {
                    return Err(HostError::UnknownApp(app_id));
                }
                self.scene.focus_app(&app_id);
            }
            ChromeMessage::FocusChrome => {
                self.scene.focus_chrome();
            }
            // A close is the client's to answer. The window leaves the scene
            // when the client destroys it.
            ChromeMessage::CloseApp { .. }
            | ChromeMessage::Spawn { .. }
            | ChromeMessage::SearchFiles { .. }
            | ChromeMessage::CopyClipboardEntry { .. }
            | ChromeMessage::ActivateTrayItem { .. }
            | ChromeMessage::DismissNotifications { .. }
            | ChromeMessage::InvokeNotificationAction { .. }
            | ChromeMessage::SetTheme { .. }
            | ChromeMessage::ThemeCaptured { .. }
            | ChromeMessage::PointerMotion { .. }
            | ChromeMessage::PointerLeave { .. }
            | ChromeMessage::PointerButton { .. }
            | ChromeMessage::PointerAxis { .. }
            | ChromeMessage::Key { .. }
            | ChromeMessage::Unlock { .. }
            | ChromeMessage::Lock
            | ChromeMessage::SystemRequest { .. }
            | ChromeMessage::AnswerPortalRequest { .. } => {
                // The compositor intercepts these side effects so this type
                // stays pure.
                //
                // `SetTheme` must also reach clients over D-Bus (see
                // `domicile_compositor::portals::settings`), so the compositor calls
                // `Host::set_theme` itself and broadcasts the result.
                //
                // `Lock` and `Unlock` belong to the seat. Only the compositor's
                // `lock` module holds lock state.
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
}

/// The chrome message for a popup.
fn placed(popup: &Popup) -> HostMessage {
    HostMessage::PopupPlaced {
        app_id: popup.app_id.clone(),
        parent: popup.parent.clone(),
        position: wire_size(popup.position),
        size: wire_size(popup.size),
        grab: popup.grab,
    }
}

/// Messages announcing a window, then its size limits. Limits come second
/// because a chrome needs the window first.
fn announced(app: &App) -> Vec<HostMessage> {
    let appeared = HostMessage::AppAppeared {
        app_id: app.app_id.clone(),
        title: app.title.clone(),
        desktop_id: app.desktop_id.clone(),
        size: app.size.map(wire_size),
    };
    let min = (app.min_size != NO_LIMIT).then(|| HostMessage::AppMinSize {
        app_id: app.app_id.clone(),
        size: wire_size(app.min_size),
    });
    let max = (app.max_size != NO_LIMIT).then(|| HostMessage::AppMaxSize {
        app_id: app.app_id.clone(),
        size: wire_size(app.max_size),
    });
    std::iter::once(appeared).chain(min).chain(max).collect()
}

/// A size as the protocol carries it.
fn wire_size((width, height): (f64, f64)) -> [f64; 2] {
    [width, height]
}
