//! A seat for each agent session, so an agent's pointer and keys never move
//! the user's. See `docs/architecture/AGENT-SEATS.md`.
//!
//! An agent seat has no `wl_seat` global: Chromium, Electron and Firefox bind
//! only the first. It sends its events down the `wl_pointer` and
//! `wl_keyboard` each client made from the user's seat (Smithay's
//! `add_*_sharing_objects`). So that each client still sees one consistent
//! seat, one seat drives a client at a time:
//!
//! - An agent can't point into a client the user's pointer or keyboard is in,
//!   nor type into one the user's keyboard is in. It is told so, and acts by
//!   ref instead.
//! - The user wins. Their pointer entering a client takes it from the
//!   agent's pointer, and their keyboard entering one takes it from the
//!   agent's pointer and keyboard both, before the user's seat says `enter`.
//!   The window the agent typed in, if that is the window the user's
//!   keyboard went to, is then taken: every agent is refused it and its
//!   popups until the shell gives it back (`ChromeMessage::GiveBack`), or
//!   the agent it was taken from leaves.
//! - A window that closes leaves every seat.
//! - The shell hears every agent seat (`HostMessage::Seats`) to draw them.
//!
//! Each agent seat has its own clipboard and primary selection too. An app
//! the agent types in copies to and pastes from the agent's, never the
//! user's, and clipboard managers and the history see only the user's.
//!
//! The agent's input arrives as [`crate::eis::Emulated`] events, laid out on
//! the desk by the same translation as the user's emulated input. Only native
//! windows take it: the shell and browser windows are the engine's, and the
//! agent reaches them by ref.

use std::collections::{BTreeSet, HashMap, HashSet};

use smithay::backend::input::{Axis, AxisSource, ButtonState, KeyState, Keycode};
use smithay::input::keyboard::{FilterResult, KeyboardHandle, XkbConfig};
use smithay::input::pointer::{AxisFrame, ButtonEvent, MotionEvent, PointerHandle};
use smithay::input::Seat;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::reexports::wayland_server::Resource;
use smithay::utils::SERIAL_COUNTER;
use smithay::wayland::compositor::with_states;
use smithay::wayland::selection::data_device::clear_data_device_selection;
use smithay::wayland::selection::primary_selection::clear_primary_selection;
use smithay::wayland::selection::share_selection_devices;
use smithay::wayland::shell::xdg::PopupSurface;
use tracing::debug;

use domicile_protocol::{AgentSeat as SeatSummary, HostMessage, PointerAxisSource};

use crate::client_requests::ClientRequest;
use crate::eis::{Emulated, Input};
use crate::surface_commit::window_geometry;
use crate::DomicileCompositor;

/// One step of an agent's input, after its keys are resolved to keysyms.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentStep {
    Send(Emulated),
    Keysym {
        keysym: u32,
        pressed: bool,
    },
    /// Give the window the agent's keyboard.
    Focus {
        window: String,
    },
}

/// Why an agent's pointer can't go where it asked.
pub const NOTHING_NATIVE: &str = "nothing at that point takes the agent's own pointer: it is \
     the shell, a browser window, or the empty desk. Act on browser windows and on the shell \
     (window \"shell\") by ref, with browser_snapshot and then browser_click or browser_type";

/// Every agent's seat, by its session.
#[derive(Default)]
pub struct AgentSeats {
    seats: HashMap<u32, AgentSeat>,
    /// Sessions that ended, which never get a seat again: input from one
    /// can still be on its way.
    gone: HashSet<u32>,
    /// What the chromes were last told, so an unchanged list isn't sent
    /// again.
    told: Vec<SeatSummary>,
}

struct AgentSeat {
    seat: Seat<DomicileCompositor>,
    /// The agent's name, as it asked to be let in.
    name: String,
    /// Where its pointer is on the desk, and what it holds down.
    input: Input,
    /// The window its pointer is over, if a native one.
    pointing_at: Option<String>,
    /// The window its keyboard is in.
    typing_in: Option<String>,
    /// Menus it opened that grabbed its keyboard, innermost last.
    menus: Vec<PopupSurface>,
    /// Windows the user took from it, which no agent can drive until given
    /// back.
    taken: BTreeSet<String>,
}

impl AgentSeat {
    /// Its keyboard and pointer, which it is made with.
    fn devices(
        &self,
    ) -> (
        KeyboardHandle<DomicileCompositor>,
        PointerHandle<DomicileCompositor>,
    ) {
        (
            self.seat
                .get_keyboard()
                .expect("an agent's seat is made with a keyboard"),
            self.seat
                .get_pointer()
                .expect("an agent's seat is made with a pointer"),
        )
    }
}

impl AgentSeats {
    /// Agent `session`'s seat, which its input made first.
    fn mine(&mut self, session: u32) -> &mut AgentSeat {
        self.seats
            .get_mut(&session)
            .expect("an agent's seat is made before its input")
    }

    /// The surfaces agents' keyboards are in, but `except`'s, whose focus
    /// may be changing (its keyboard is locked meanwhile).
    pub fn focused(&self, except: &Seat<DomicileCompositor>) -> Vec<WlSurface> {
        self.seats
            .values()
            .filter(|agent| &agent.seat != except)
            .filter_map(|agent| agent.devices().0.current_focus())
            .collect()
    }

    /// Every agent's keyboard.
    pub fn keyboards(&self) -> Vec<KeyboardHandle<DomicileCompositor>> {
        self.seats.values().map(|agent| agent.devices().0).collect()
    }
}

impl DomicileCompositor {
    /// Run agent `session`'s `steps` on its own seat, making the seat on its
    /// first input. Stops at the first step that can't be done, and says why.
    /// `let_go` ends the call: every key and button it holds comes up.
    pub fn agent_input(
        &mut self,
        session: u32,
        steps: Vec<AgentStep>,
        let_go: bool,
    ) -> Result<(), String> {
        if self.the_desk_is_locked() {
            if self.agent_seats.seats.contains_key(&session) {
                self.agent_lets_go(session);
            }
            return Err("the desktop is locked".to_string());
        }
        self.agent_seat(session)?;
        let done = steps
            .into_iter()
            .try_for_each(|step| self.agent_step(session, step));
        if let_go || done.is_err() {
            self.agent_lets_go(session);
        }
        self.tell_the_chromes_the_seats(false);
        done
    }

    /// Agent session `session` ended: its seat lets go of everything and goes.
    pub fn agent_gone(&mut self, session: u32) {
        self.agent_seats.gone.insert(session);
        // An agent that never pointed or typed has no seat.
        if !self.agent_seats.seats.contains_key(&session) {
            return;
        }
        self.agent_lets_go(session);
        let agent = self
            .agent_seats
            .seats
            .remove(&session)
            .expect("checked above");
        for menu in agent.menus.iter().rev() {
            menu.send_popup_done();
        }
        // What it copied goes with it: the app that copied it is told it
        // no longer holds a clipboard, and the app it types in that there is
        // nothing to paste. Before its keyboard leaves, which ends the offers.
        clear_data_device_selection(&self.display_handle, &agent.seat);
        clear_primary_selection(&self.display_handle, &agent.seat);
        let (keyboard, pointer) = agent.devices();
        keyboard.set_focus(self, None, SERIAL_COUNTER.next_serial());
        self.agent_pointer_leaves(&pointer);
        self.seat_state.remove_seat(&agent.seat);
        debug!(session, "an agent's seat went with its session");
        self.activate(self.seat.get_keyboard().unwrap().current_focus().as_ref());
        self.tell_the_chromes_the_seats(false);
    }

    /// The user's seat is about to enter `surface`'s client, with its
    /// keyboard when `keyboard`, else its pointer. Any agent there leaves
    /// first: the person wins.
    pub fn yield_to_the_person(&mut self, surface: &WlSurface, keyboard: bool) {
        let Some(client) = surface.client() else {
            return;
        };
        let in_client =
            |on: Option<WlSurface>| on.and_then(|on| on.client()) == Some(client.clone());
        let sessions: Vec<u32> = self.agent_seats.seats.keys().copied().collect();
        for session in sessions {
            let (typing, pointer) = self.agent_seats.seats[&session].devices();
            if in_client(pointer.current_focus()) {
                debug!(session, "the user's pointer took an app from an agent's");
                self.agent_lets_go(session);
                self.agent_pointer_leaves(&pointer);
                self.agent_seats.mine(session).pointing_at = None;
            }
            if keyboard && in_client(typing.current_focus()) {
                debug!(session, "the user's keyboard took an app from an agent's");
                self.agent_lets_go(session);
                typing.set_focus(self, None, SERIAL_COUNTER.next_serial());
                let users = self.window_of(surface);
                let agent = self.agent_seats.mine(session);
                // The window the user went to is theirs until they give it
                // back. Another of the app's only moved the agent's keyboard
                // off it.
                let typing_in = agent.typing_in.take();
                if typing_in.is_some() && typing_in == users {
                    agent.taken.extend(typing_in);
                }
                // Its menus close, as a menu does when its window loses the
                // keyboard.
                for menu in std::mem::take(&mut agent.menus).iter().rev() {
                    menu.send_popup_done();
                }
            }
        }
        self.tell_the_chromes_the_seats(false);
    }

    /// The user takes window `app_id` from the agent holding it: the agent
    /// lets go and leaves it, and can't drive it until it's given back.
    pub fn take_over(&mut self, app_id: &str) {
        // A menu is taken with its window.
        let app_id = &self.window_named(app_id);
        let held_by = self
            .agent_seats
            .seats
            .iter()
            .find(|(_, agent)| {
                [&agent.typing_in, &agent.pointing_at]
                    .into_iter()
                    .flatten()
                    .any(|held| self.window_named(held) == *app_id)
            })
            .map(|(session, _)| *session);
        let Some(session) = held_by else {
            // The shell's list was a frame behind the agent's.
            debug!(app_id, "the shell took a window no agent holds");
            return;
        };
        let Some(surface) = self.surface_for(app_id) else {
            debug!(app_id, "the shell took a window that has closed");
            return;
        };
        debug!(session, app_id, "the shell took a window from an agent");
        let (typing, pointer) = self.agent_seats.seats[&session].devices();
        self.agent_lets_go(session);
        let client = surface.client();
        let in_client = |on: Option<WlSurface>| on.and_then(|on| on.client()) == client;
        if in_client(pointer.current_focus()) {
            self.agent_pointer_leaves(&pointer);
            self.agent_seats.mine(session).pointing_at = None;
        }
        if in_client(typing.current_focus()) {
            typing.set_focus(self, None, SERIAL_COUNTER.next_serial());
            let agent = self.agent_seats.mine(session);
            agent.typing_in = None;
            for menu in std::mem::take(&mut agent.menus).iter().rev() {
                menu.send_popup_done();
            }
        }
        self.agent_seats
            .mine(session)
            .taken
            .insert(app_id.to_string());
        self.tell_the_chromes_the_seats(false);
    }

    /// Agents may drive window `app_id` again.
    pub fn give_back(&mut self, app_id: &str) {
        let mut given = false;
        for agent in self.agent_seats.seats.values_mut() {
            given |= agent.taken.remove(app_id);
        }
        debug!(app_id, given, "the shell gave a window back to agents");
        self.tell_the_chromes_the_seats(false);
    }

    /// Tell every chrome the agent seats, if they changed since last told, or
    /// `always` for a chrome that just connected.
    pub fn tell_the_chromes_the_seats(&mut self, always: bool) {
        // Most of the time there are none, and the user's every move asks.
        if !always && self.agent_seats.seats.is_empty() && self.agent_seats.told.is_empty() {
            return;
        }
        let mut sessions: Vec<u32> = self.agent_seats.seats.keys().copied().collect();
        sessions.sort_unstable();
        let seats: Vec<SeatSummary> = sessions
            .into_iter()
            .map(|session| {
                let agent = &self.agent_seats.seats[&session];
                // A menu it points at is held through its window.
                let pointing_at = agent
                    .pointing_at
                    .as_deref()
                    .map(|on| self.window_named(on))
                    .filter(|window| self.toplevel_for(window).is_some());
                let mut holds: Vec<String> = Vec::new();
                for held in [agent.typing_in.clone(), pointing_at].into_iter().flatten() {
                    if !holds.contains(&held) {
                        holds.push(held);
                    }
                }
                SeatSummary {
                    id: format!("agent-{session}"),
                    name: agent.name.clone(),
                    pointer: agent.input.at(),
                    focused: agent.typing_in.clone(),
                    holds,
                    taken: agent.taken.iter().cloned().collect(),
                }
            })
            .collect();
        if !always && seats == self.agent_seats.told {
            return;
        }
        let holds = seats
            .iter()
            .flat_map(|seat| {
                seat.holds
                    .iter()
                    .map(|held| (held.clone(), seat.id.clone()))
            })
            .collect();
        self.hub.host.lock().unwrap().describe_agent_holds(holds);
        self.agent_seats.told = seats.clone();
        self.hub.broadcast(HostMessage::Seats { seats });
    }

    /// Agent session `session`'s seat, made on first use with the user's
    /// keymap.
    fn agent_seat(&mut self, session: u32) -> Result<(), String> {
        if self.agent_seats.seats.contains_key(&session) {
            return Ok(());
        }
        if self.agent_seats.gone.contains(&session) {
            return Err(format!("no agent is in as session {session}"));
        }
        let Some(name) = self
            .hub
            .portals
            .agents()
            .known()
            .connected
            .into_iter()
            .find(|agent| agent.session == session)
            .map(|agent| agent.agent)
        else {
            return Err(format!("no agent is in as session {session}"));
        };
        let keymap = match self.hub.host.lock().unwrap().describe_keymap() {
            Some(HostMessage::Keymap { keymap }) => keymap,
            _ => return Err("the desktop has no keyboard yet".to_string()),
        };
        let theirs = self.seat.get_keyboard().unwrap();
        let mut seat = self.seat_state.new_seat(format!("agent-{session}"));
        // No key repeats here, and the user's keyboard tells clients its
        // repeat rate, so these are never used.
        let (delay, rate) = (600, 25);
        let keyboard = seat
            .add_keyboard_sharing_objects(XkbConfig::default(), delay, rate, &theirs)
            .map_err(|why| format!("the agent's keyboard did not start: {why}"))?;
        keyboard
            .set_keymap_from_string(self, keymap)
            .expect("the compositor wrote this keymap, so xkb reads it back");
        seat.add_pointer_sharing_objects(&self.seat.get_pointer().unwrap());
        // Its own clipboard and primary selection, offered and set through
        // the same clients' devices as the user's.
        share_selection_devices(&seat, &self.seat);
        debug!(session, "an agent's seat was made");
        self.agent_seats.seats.insert(
            session,
            AgentSeat {
                seat,
                name,
                input: Input::default(),
                pointing_at: None,
                typing_in: None,
                menus: Vec::new(),
                taken: BTreeSet::new(),
            },
        );
        Ok(())
    }

    fn agent_step(&mut self, session: u32, step: AgentStep) -> Result<(), String> {
        match step {
            AgentStep::Send(emulated) => {
                let moves = matches!(
                    emulated,
                    Emulated::Motion { .. } | Emulated::MotionAbsolute { .. }
                );
                let desk = self.desk();
                let requests = self
                    .agent_seats
                    .mine(session)
                    .input
                    .translate(emulated, &desk);
                for request in requests {
                    self.agent_request(session, request)?;
                }
                if moves && self.agent_seats.mine(session).pointing_at.is_none() {
                    return Err(NOTHING_NATIVE.to_string());
                }
                Ok(())
            }
            AgentStep::Keysym { keysym, pressed } => {
                let keycode = self.keycode_of(keysym).ok_or_else(|| {
                    format!(
                        "no key on the desk's keyboard types {}",
                        smithay::input::keyboard::xkb::keysym_get_name(keysym.into())
                    )
                })?;
                self.agent_step(session, AgentStep::Send(Emulated::Key { keycode, pressed }))
            }
            AgentStep::Focus { window } => self.agent_focuses(session, &window),
        }
    }

    /// Carry out one request the translation made, on the agent's seat.
    fn agent_request(&mut self, session: u32, request: ClientRequest) -> Result<(), String> {
        let pointing_at = self.agent_seats.mine(session).pointing_at.clone();
        let (keyboard, pointer) = self.agent_seats.mine(session).devices();
        let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
        match request {
            ClientRequest::PointerMotion { app_id, x, y, .. } => {
                // A window, or a menu over one.
                let Some(surface) = self.surface_for(&app_id) else {
                    return Err(format!("window {app_id} has closed"));
                };
                self.taken(&app_id)?;
                self.someone_else_holds(session, &surface, false)?;
                let (x, y) = crate::window_geometry::surface_point(
                    with_states(&surface, window_geometry),
                    (x, y),
                );
                let (surface, (x, y)) = self.input_target(surface, (x, y));
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
                self.agent_seats.mine(session).pointing_at = Some(app_id);
            }
            ClientRequest::PointerLeave => {
                self.agent_pointer_leaves(&pointer);
                self.agent_seats.mine(session).pointing_at = None;
            }
            ClientRequest::PointerButton { button, pressed } => {
                // A release always goes, so no button stays down.
                match (pressed, pointing_at) {
                    (true, None) => return Err(NOTHING_NATIVE.to_string()),
                    // A click gives the window the keyboard, as it would a
                    // hand's. A menu has the keyboard already.
                    (true, Some(window)) if self.toplevel_for(&window).is_some() => {
                        self.agent_focuses(session, &window)?
                    }
                    (true, Some(_)) => {}
                    (false, _) => {}
                }
                let state = if pressed {
                    ButtonState::Pressed
                } else {
                    ButtonState::Released
                };
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
            ClientRequest::PointerAxis {
                dx,
                dy,
                v120_x,
                v120_y,
                source,
                ..
            } => {
                if pointing_at.is_none() {
                    return Err(NOTHING_NATIVE.to_string());
                }
                let source = match source {
                    PointerAxisSource::Wheel => AxisSource::Wheel,
                    PointerAxisSource::Finger => AxisSource::Finger,
                    PointerAxisSource::Continuous => AxisSource::Continuous,
                    PointerAxisSource::WheelTilt => AxisSource::WheelTilt,
                };
                let mut frame = AxisFrame::new(time).source(source);
                if dx != 0.0 {
                    frame = frame.value(Axis::Horizontal, dx);
                }
                if dy != 0.0 {
                    frame = frame.value(Axis::Vertical, dy);
                }
                if v120_x != 0 {
                    frame = frame.v120(Axis::Horizontal, v120_x);
                }
                if v120_y != 0 {
                    frame = frame.v120(Axis::Vertical, v120_y);
                }
                pointer.axis(self, frame);
                pointer.frame(self);
            }
            ClientRequest::Key { keycode, pressed } => {
                // A release always goes, so no key stays down.
                // A window that closed leaves its surface behind.
                match (pressed, keyboard.current_focus().filter(|on| on.is_alive())) {
                    (true, None) => {
                        return Err("the agent's keyboard is in no window: click in one, or \
                             focus_window, first"
                            .to_string())
                    }
                    (true, Some(surface)) => {
                        if let Some(window) = self.agent_seats.mine(session).typing_in.clone() {
                            self.taken(&window)?;
                        }
                        self.someone_else_holds(session, &surface, true)?
                    }
                    (false, _) => {}
                }
                let key: Keycode = (keycode + 8).into();
                let state = if pressed {
                    KeyState::Pressed
                } else {
                    KeyState::Released
                };
                keyboard.input::<(), _>(self, key, state, serial, time, |_, _, _| {
                    FilterResult::Forward
                });
            }
            request => unreachable!("emulated input never makes {request:?}"),
        }
        Ok(())
    }

    /// Give window `window` agent `session`'s keyboard.
    fn agent_focuses(&mut self, session: u32, window: &str) -> Result<(), String> {
        let Some(surface) = self.toplevel_for(window).map(|on| on.wl_surface().clone()) else {
            return Err(format!(
                "{window} is no native window: the agent's keyboard goes to native windows. \
                 Act on browser windows and the shell by ref"
            ));
        };
        self.taken(window)?;
        self.someone_else_holds(session, &surface, true)?;
        let (keyboard, _) = self.agent_seats.mine(session).devices();
        keyboard.set_focus(self, Some(surface), SERIAL_COUNTER.next_serial());
        self.agent_seats.mine(session).typing_in = Some(window.to_string());
        Ok(())
    }

    /// Why no agent can drive window `app_id`, or a popup over it: the user
    /// took it.
    fn taken(&self, app_id: &str) -> Result<(), String> {
        let window = self.window_named(app_id);
        if self
            .agent_seats
            .seats
            .values()
            .any(|agent| agent.taken.contains(&window))
        {
            return Err(format!(
                "the user took over window {window}: act on it by ref, or wait until they give it \
                 back"
            ));
        }
        Ok(())
    }

    /// The window `app_id` names: itself, or the window under the popup it
    /// is. A closed one names itself.
    fn window_named(&self, app_id: &str) -> String {
        self.surface_for(app_id)
            .and_then(|surface| self.window_of(&surface))
            .unwrap_or_else(|| app_id.to_string())
    }

    /// Window `app_id` closed: it leaves every agent's seat.
    pub fn agents_window_closed(&mut self, app_id: &str) {
        for agent in self.agent_seats.seats.values_mut() {
            if agent.typing_in.as_deref() == Some(app_id) {
                agent.typing_in = None;
            }
            agent.taken.remove(app_id);
        }
        self.tell_the_chromes_the_seats(false);
    }

    /// Why agent `session` can't send `surface`'s client its pointer, or
    /// its keys when `keys`: the user, or another agent, is in it.
    fn someone_else_holds(
        &self,
        session: u32,
        surface: &WlSurface,
        keys: bool,
    ) -> Result<(), String> {
        let Some(client) = surface.client() else {
            return Err("that window has closed".to_string());
        };
        let in_client =
            |on: Option<WlSurface>| on.and_then(|on| on.client()).as_ref() == Some(&client);
        let users_keyboard = self.seat.get_keyboard().unwrap().current_focus();
        // A held button keeps the user's pointer in its client wherever the
        // page says it went.
        let users_pointer = [
            self.pointer_surface.clone(),
            self.seat.get_pointer().unwrap().current_focus(),
        ];
        if in_client(users_keyboard) || (!keys && users_pointer.into_iter().any(&in_client)) {
            return Err(
                "the user is using this app, so the agent's own pointer and keys can't \
                 reach it now. Act on it by ref (app_snapshot, browser_snapshot), or try again \
                 once the user has moved on"
                    .to_string(),
            );
        }
        let other_agent = self.agent_seats.seats.iter().any(|(other, agent)| {
            *other != session
                && (in_client(agent.devices().0.current_focus())
                    || in_client(agent.devices().1.current_focus()))
        });
        if other_agent {
            return Err("another agent is using this app; act on it by ref".to_string());
        }
        Ok(())
    }

    /// Release every key and button agent `session` holds.
    fn agent_lets_go(&mut self, session: u32) {
        let requests: Vec<ClientRequest> = self
            .agent_seats
            .mine(session)
            .input
            // Its pointer stays where it is: the next call goes on from there.
            .lift();
        for request in requests {
            self.agent_request(session, request)
                .expect("a release goes to its seat wherever its pointer and keyboard are");
        }
    }

    fn agent_pointer_leaves(&mut self, pointer: &PointerHandle<Self>) {
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

    /// A menu grabbing the keyboard, in an app an agent is using and the user
    /// isn't: the agent's keyboard goes to it, not the user's. `false` for a
    /// menu that is the user's.
    pub fn an_agents_menu_grabbed(&mut self, menu: &PopupSurface) -> bool {
        let Some(client) = menu.wl_surface().client() else {
            return false;
        };
        let in_client =
            |on: Option<WlSurface>| on.and_then(|on| on.client()).as_ref() == Some(&client);
        let users = [
            self.seat.get_keyboard().unwrap().current_focus(),
            self.seat.get_pointer().unwrap().current_focus(),
        ];
        if users.into_iter().any(&in_client) {
            return false;
        }
        let Some(session) = self.agent_seats.seats.iter().find_map(|(session, agent)| {
            let (keyboard, pointer) = agent.devices();
            (in_client(keyboard.current_focus()) || in_client(pointer.current_focus()))
                .then_some(*session)
        }) else {
            return false;
        };
        debug!(session, "a menu grabbed an agent's keyboard");
        let agent = self.agent_seats.mine(session);
        if !agent.menus.contains(menu) {
            agent.menus.push(menu.clone());
        }
        let (keyboard, _) = agent.devices();
        keyboard.set_focus(
            self,
            Some(menu.wl_surface().clone()),
            SERIAL_COUNTER.next_serial(),
        );
        true
    }

    /// A menu went. If it had an agent's keyboard, that goes to the menu or
    /// window under it.
    pub fn an_agents_menu_went(&mut self, menu: &PopupSurface) {
        let Some((session, at)) = self.agent_seats.seats.iter().find_map(|(session, agent)| {
            agent
                .menus
                .iter()
                .position(|held| held == menu)
                .map(|at| (*session, at))
        }) else {
            return;
        };
        let root = self.window_under(menu);
        let agent = self.agent_seats.mine(session);
        agent.menus.remove(at);
        let next = agent.menus.last().map(|popup| popup.wl_surface().clone());
        let (keyboard, _) = agent.devices();
        let next = next.or_else(|| root.and_then(|window| self.surface_for(&window)));
        keyboard.set_focus(self, next, SERIAL_COUNTER.next_serial());
    }
}
