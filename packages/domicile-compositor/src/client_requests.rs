//! Chrome requests that run on the Wayland thread, where the seat and surfaces
//! live, and the order the compositor handles each one in.

use std::time::Instant;

use smithay::backend::input::{Axis, AxisSource, ButtonState};
use smithay::input::pointer::{AxisFrame, MotionEvent};
use smithay::utils::SERIAL_COUNTER;
use smithay::wayland::compositor::with_states;
use smithay::wayland::selection::data_device::set_data_device_selection;
use tracing::{debug, warn};

use domicile_host::theme_turnover::{Turnover, CAPTURE_WITHIN};
use domicile_protocol::{Passphrase, PortalAnswer, Theme, TrayAction};

use crate::chrome_hub::announce_open_apps;
use crate::engine::Clipboard;
use crate::lock::Asked;
use crate::{
    at, say_what_the_lock_refused, spawn_client, text_mimes, window_geometry, DomicileCompositor,
    Holder,
};

/// A chrome request that must run on the Wayland thread, where the seat and
/// surfaces live.
///
/// Emulated input from [`crate::eis`] becomes these too, so it takes the same
/// path and the lock refuses it the same way.
#[derive(Debug, PartialEq)]
pub enum ClientRequest {
    /// Every chrome in `chromes` was told `theme`. Switch the windows once
    /// they have captured. See [`chrome_key`](crate::chrome_key).
    TurnTheWindows {
        theme: Theme,
        chromes: Vec<usize>,
    },
    /// A chrome's old frame is held for `theme`.
    ThemeCaptured {
        chrome: usize,
        theme: Theme,
    },
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
    /// `scale` is the integer the output advertises (see
    /// [`crate::scale::output_scale`]). `ratio` is the exact value, needed to
    /// convert the engine's device-pixel `<app>` bounds to logical units.
    SetOutputScale {
        ratio: f64,
        scale: i32,
    },
    /// The chrome's viewport changed. Re-advertise the output at that size.
    SetOutputSize {
        logical: (i32, i32),
    },
    /// The page put the window `app_id` at `bounds`, in desktop logical units.
    SetAppBounds {
        app_id: String,
        bounds: domicile_scene::Bounds,
    },
    /// The chrome asked the client of `app_id` to close its window.
    CloseApp {
        app_id: String,
    },
    /// The chrome asked to start a program.
    ///
    /// Handled here because the lock state lives here, and a locked desktop
    /// refuses spawns. See [`crate::lock::refused`].
    Spawn {
        command: Vec<String>,
    },
    /// A chrome's page said `hello`. It holds no pixels yet.
    ///
    /// `served_by` is the peer process of the connection, which is the browser
    /// process. A new pid means the engine was replaced, not just reloaded. See
    /// [`crate::which_engine`].
    ChromeHello {
        served_by: Option<i32>,
    },
    /// A client's copied text, read from its pipe.
    ///
    /// Sent by the reader thread, not a chrome, because a client may write
    /// slowly and the Wayland thread must not wait. See
    /// [`DomicileCompositor::read_what_was_copied`].
    ClipboardCopied {
        clipboard: Clipboard,
        text: String,
    },
    /// The shell picked a clipboard history entry. Make it the seat's
    /// selection.
    ///
    /// The compositor owns this selection, so the entry stays pasteable after
    /// its original client exits.
    CopyClipboardEntry {
        entry: u32,
    },
    /// The shell clicked a tray icon. Routed through this thread so a locked
    /// desktop can refuse it. See [`crate::lock::refused`].
    ActivateTrayItem {
        id: String,
        action: TrayAction,
    },
    /// The shell dismissed notifications. Routed here so a locked desktop can
    /// refuse it.
    DismissNotifications {
        ids: Vec<u32>,
    },
    /// The shell invoked a notification action. Routed here so a locked desktop
    /// can refuse it.
    InvokeNotificationAction {
        id: u32,
        action: String,
    },
    /// The shell answered a portal dialog. Routed here so a locked desktop can
    /// refuse it.
    AnswerPortalRequest {
        id: u32,
        answer: PortalAnswer,
    },
    /// A passphrase typed at the lock screen.
    ///
    /// Handled here because locking blocks input to the seat, and the seat
    /// lives on this thread. See [`crate::lock`].
    Unlock {
        passphrase: Passphrase,
    },
    /// The shell asked to lock now. See [`DomicileCompositor::shut_the_desk`].
    Lock,
    /// Whether any application holds an idle inhibitor through the portal.
    /// From the portal thread; see [`crate::portals`].
    HeldAwakeByThePortal {
        held: bool,
    },
}

impl DomicileCompositor {
    /// Handle a request from a chrome on the Wayland thread.
    pub fn handle_client_request(&mut self, event: ClientRequest) {
        // First, for every request: this is how the compositor knows someone is
        // present.
        self.keep_the_desktop_awake(&event);
        // After counting activity, before anything reaches the seat. Input to a
        // locked desktop still wakes the screens but reaches no client. The
        // lock must act here, not at the socket, because the shell's own lock
        // screen needs its keys. [`crate::lock::refused`] lists what is
        // refused.
        let refusal = if self.the_desk_is_locked() {
            crate::lock::refused(Asked::OnTheWaylandThread(&event))
        } else {
            None
        };
        if let Some(refusal) = refusal {
            say_what_the_lock_refused(refusal);
            return;
        }
        // Input the lock let through, before it reaches the seat.
        if self.captured(&event) {
            return;
        }
        match event {
            ClientRequest::PointerMotion { app_id, x, y } => {
                let Some(surface) = self.surface_for(&app_id) else {
                    tracing::debug!(%app_id, "pointer motion: no surface");
                    return;
                };
                self.cast_pointer(Some((app_id.clone(), (x, y))));
                // The chrome's box is the window geometry, not the surface, so
                // offset for client-side shadows.
                let (x, y) = crate::window_geometry::surface_point(
                    with_states(&surface, window_geometry),
                    (x, y),
                );
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
                self.cast_pointer(None);
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
                let state = if pressed {
                    self.let_go_of_lost_presses();
                    self.held_buttons.push(button);
                    ButtonState::Pressed
                } else {
                    self.held_buttons.retain(|held| *held != button);
                    ButtonState::Released
                };
                self.pointer_button(button, state);
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
                // Start timing here, the moment the client can know about the
                // key.
                //
                // Presses only, as the chrome does: a release changes nothing
                // on screen and would time some unrelated redraw.
                if pressed {
                    self.pending_key.get_or_insert_with(Instant::now);
                }
                self.inject_key(keycode, pressed);
                self.tell_the_chromes_the_modifiers();
            }
            ClientRequest::KeyboardFocus { app_id } => {
                // A menu over the target window keeps the keyboard. Focus
                // anywhere else dismisses it, like a click elsewhere.
                if let Some(menu) = self.grabbing.last().cloned() {
                    if app_id.is_some() && app_id == self.window_under(&menu) {
                        let keyboard = self.seat.get_keyboard().unwrap();
                        let serial = SERIAL_COUNTER.next_serial();
                        keyboard.set_focus(self, Some(menu.wl_surface().clone()), serial);
                        return;
                    }
                    self.dismiss_the_menus();
                }
                let requested = match &app_id {
                    Some(id) => self.surface_for(id),
                    None => None,
                };
                if let Some(id) = &app_id {
                    if requested.is_some() {
                        debug!(app_id = %id, "keyboard focus -> client");
                    } else {
                        // The window closed or has not mapped yet. Focusing
                        // nothing would leave the desktop deaf, since nothing
                        // would take focus back.
                        debug!(app_id = %id, "keyboard focus -> a window with no surface; the chrome keeps it");
                    }
                }
                // Fall back to the chrome, so the keyboard always has a holder.
                let surface = requested.or_else(|| {
                    self.chrome_toplevel
                        .as_ref()
                        .map(|toplevel| toplevel.wl_surface().clone())
                });
                let keyboard = self.seat.get_keyboard().unwrap();
                let serial = SERIAL_COUNTER.next_serial();
                keyboard.set_focus(self, surface, serial);
            }
            ClientRequest::ClipboardCopied { clipboard, text } => {
                self.took_a_copy(clipboard, text);
                self.tell_the_engine_a_clipboard(clipboard);
            }
            // Forward to the tray worker, which talks to the session bus.
            ClientRequest::ActivateTrayItem { id, action } => {
                if let Some(tray) = self.hub.tray.get() {
                    tray.activate(id, action);
                }
            }
            // Forward to the notification server's worker.
            ClientRequest::DismissNotifications { ids } => {
                if let Some(server) = self.hub.notifications.get() {
                    server.dismiss(ids);
                }
            }
            ClientRequest::InvokeNotificationAction { id, action } => {
                if let Some(server) = self.hub.notifications.get() {
                    server.invoke(id, action);
                }
            }
            ClientRequest::AnswerPortalRequest { id, answer } => {
                self.hub.portals.answer(id, answer);
            }
            ClientRequest::CopyClipboardEntry { entry } => match self.clipboard.text(entry) {
                Some(text) => {
                    // Paste now yields this entry, not the newest. See
                    // [`DomicileCompositor::holding`].
                    self.holding[at(Clipboard::Copy)] = Some(text.to_owned());
                    set_data_device_selection(
                        &self.display_handle,
                        &self.seat,
                        text_mimes(),
                        Holder::Desk(Clipboard::Copy),
                    );
                    self.hub.portals.selection_changed(text_mimes(), None);
                    self.tell_the_engine_a_clipboard(Clipboard::Copy);
                }
                // The history dropped this entry. Set nothing rather than
                // substitute another entry for what the user picked.
                None => warn!(
                    entry,
                    "the shell asked for a clipboard entry this desktop no longer holds"
                ),
            },
            ClientRequest::Unlock { passphrase } => self.offered_the_passphrase(&passphrase),
            ClientRequest::HeldAwakeByThePortal { held } => self.held_awake_by_the_portal(held),
            ClientRequest::Lock => {
                if self.lock.is_some() {
                    self.shut_the_desk("the shell asked for this desktop to be locked");
                } else {
                    warn!("a chrome asked to lock a desktop that has no lock");
                }
            }
            ClientRequest::TurnTheWindows { theme, chromes } => {
                // Replace any turnover in progress; its windows are about to
                // get a newer theme.
                let (turnover, step) = Turnover::begin(theme, chromes);
                self.turnover = Some(turnover);
                self.arm_the_turnover_deadline(CAPTURE_WITHIN, Turnover::capture_deadline);
                self.follow_the_turnover(step);
            }
            ClientRequest::ThemeCaptured { chrome, theme } => {
                if let Some(turnover) = &mut self.turnover {
                    let step = turnover.captured(&chrome, theme);
                    self.follow_the_turnover(step);
                }
            }
            ClientRequest::ChromeHello { served_by } => {
                // A page started, so any keys the previous page held will never
                // be released. Release them.
                //
                // Every new connection sends `hello`, so on a two-chrome
                // desktop one page starting releases keys held through another.
                // `held` is cleared on the same terms.
                self.release_pressed_keys();
                // A hello is the only sign the engine was replaced; see
                // [`crate::which_engine`]. Rejoin before announcing windows, so
                // each has a frame sink again.
                self.rejoin_the_engine(served_by);
                // Catch up the new page on state it would otherwise only learn
                // on the next change.
                announce_open_apps(&self.hub);
                // An empty clipboard is a valid message, so the normal
                // broadcast works.
                self.tell_the_chromes_the_clipboard();
                // A shell that reloaded while the screens were dark would
                // otherwise assume someone is present.
                self.tell_a_new_chrome_whether_anybody_is_here();
                // A shell that reloaded, or an engine that restarted, would
                // otherwise show an unlocked desktop.
                self.tell_a_new_chrome_whether_the_desk_is_locked();
            }
            ClientRequest::SetOutputScale { ratio, scale } => {
                // Keep the ratio even if the scale is refused: the engine
                // reports boxes in the page's device pixels regardless.
                self.device_pixel_ratio = ratio;
                self.set_output_scale(scale);
            }
            ClientRequest::SetOutputSize { logical } => self.set_output_size(logical),
            ClientRequest::SetAppBounds { app_id, bounds } => {
                if self.toplevel_for(&app_id).is_some() {
                    self.app_bounds.insert(app_id, bounds);
                    self.enter_the_displays_each_window_is_on();
                } else {
                    // Usually the window closed while the message was in
                    // flight. Logged in case the chrome sent a bogus id.
                    debug!(%app_id, "bounds: a window with no toplevel");
                }
            }
            ClientRequest::Spawn { command } => {
                spawn_client(&command, &self.hub.wayland_display, self.scope_clients)
            }
            ClientRequest::CloseApp { app_id } => match self.toplevel_for(&app_id) {
                Some(toplevel) => {
                    debug!(%app_id, "close -> client");
                    toplevel.send_close();
                }
                // Dismiss a popup instead; the client then destroys it
                // (`popup_destroyed`).
                None => match self.popups.iter().find(|(id, _)| *id == app_id) {
                    Some((_, popup)) => {
                        debug!(%app_id, "dismiss -> client");
                        popup.send_popup_done();
                    }
                    // Usually the window closed while the message was in
                    // flight. Logged in case the chrome sent a bogus id.
                    None => debug!(%app_id, "close: a window with no toplevel"),
                },
            },
        }
    }
}
