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
//! the desk by the same translation as the user's emulated input. Over a
//! native window it goes down the seat. Anywhere else the pointer is over the
//! shell's page, and the browser takes it (`HostMessage::AgentInput`): it
//! hands the event to the browser window's page under the point, without
//! moving the user's pointer or focus, refuses it where the shell itself is
//! (agents act on the shell by ref), and answers which window it reached
//! (`ChromeMessage::AgentInputReached`). The seat's keys go there too while
//! its keyboard is in a browser window. The agent's steps wait for each
//! answer, so they stay in order and stop at the first one refused. The
//! person wins there as well: the browser says when the user's input reaches
//! a window an agent holds (`ChromeMessage::PersonInAgentsWindow`).

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

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

use domicile_protocol::{AgentPageInput, AgentSeat as SeatSummary, HostMessage, PointerAxisSource};

use crate::client_requests::ClientRequest;
use crate::configured_displays::Answer;
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

/// Why an agent can't press or scroll before it points.
pub const NOWHERE: &str = "the agent's pointer has not moved yet: point somewhere first";

/// Why an agent's input stopped when the browser never answered.
const THE_BROWSER_DID_NOT_ANSWER: &str =
    "the browser did not answer the agent's input in the browser's pages";

/// How many parents [`AgentSeats::started_for`] looks through.
const MOST_FORKS: usize = 8;

/// Process `pid`'s parent, from `/proc`: field 4 of its `stat` line, counted
/// after the command name's last `)`, which may hold spaces. `None` for a
/// process that is gone, and for the first process.
fn parent_of(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parent_in(&stat)
}

/// The parent a `/proc/PID/stat` line names, unless it is none (0).
fn parent_in(stat: &str) -> Option<u32> {
    let (_, after) = stat.rsplit_once(')')?;
    // `after` starts at field 3, the state.
    after
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
        .filter(|parent| *parent != 0)
}

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
    /// The agent session each program an agent started is for, by its pid.
    /// Its windows, and its children's, start held by that agent.
    started: HashMap<u32, u32>,
    /// The agent session each question to the browser is for, by serial.
    asked: HashMap<u64, u32>,
    /// The serial of the next question to the browser. See
    /// [`AgentSeats::next_serial`].
    serial: Option<u64>,
}

/// An agent's input still to run, while it waits on the browser.
struct Pending {
    work: VecDeque<Work>,
    let_go: bool,
    /// Each call waiting for this input. A call that gave up waiting sends
    /// its let-go after the rest, and both hear how it went.
    answers: Vec<Answer>,
    /// The question the browser has yet to answer, by its serial.
    asked: Option<(u64, Asked)>,
}

/// One piece of an agent's input.
#[derive(Debug)]
enum Work {
    Step(AgentStep),
    /// One request the translation made, for the seat.
    Request(ClientRequest),
    /// The pointer is over the shell's page: the browser finds what is under
    /// it.
    PagesPointer,
}

/// What an answer from the browser goes on to do.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Asked {
    Pointer,
    Press,
    /// A release, a scroll or a key: nothing comes of what it reached.
    Other,
    Focus,
}

struct AgentSeat {
    seat: Seat<DomicileCompositor>,
    /// The agent's name, as it asked to be let in.
    name: String,
    /// Where its pointer is on the desk, and what it holds down.
    input: Input,
    /// The window its pointer is over: a native one, or with `in_pages` a
    /// browser window.
    pointing_at: Option<String>,
    /// Its pointer is over the shell's page, where the browser takes its
    /// input, rather than a native window.
    in_pages: bool,
    /// The window its keyboard is in: a native one, or with
    /// `typing_in_pages` a browser window.
    typing_in: Option<String>,
    typing_in_pages: bool,
    /// Input it sent that waits on the browser.
    pending: Option<Pending>,
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
    /// Program `pid` was started for agent `session` (`domicile exec
    /// --agent`).
    pub fn started(&mut self, pid: u32, session: u32) {
        self.started.insert(pid, session);
    }

    /// The agent session the program `pid` was started for, by it or by a
    /// parent of it: a shell, or a launcher that forks.
    fn started_for(&self, pid: u32) -> Option<u32> {
        let mut at = pid;
        // Far enough for a shell and a forking launcher, and no loop.
        for _ in 0..MOST_FORKS {
            if let Some(session) = self.started.get(&at) {
                return Some(*session);
            }
            at = parent_of(at)?;
        }
        None
    }

    /// Serials for questions to the browser. They start from the clock, so
    /// they grow across compositor restarts: the browser keeps the first of
    /// each, as every page's channel hears it.
    fn next_serial(&mut self) -> u64 {
        let serial = self.serial.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(1, |since| {
                    u64::try_from(since.as_micros()).unwrap_or(u64::MAX / 2)
                })
        });
        self.serial = Some(serial + 1);
        serial
    }

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
    /// first input, and answer once they are done. Stops at the first step
    /// that can't be done, and answers why. `let_go` ends the call: every key
    /// and button it holds comes up. A step into the browser's pages waits
    /// for the browser's answer, and the steps after it with it.
    pub fn agent_input(
        &mut self,
        session: u32,
        steps: Vec<AgentStep>,
        let_go: bool,
        answer: Answer,
    ) {
        if self.the_desk_is_locked() {
            if self.agent_seats.seats.contains_key(&session) {
                self.agent_stops(session, Err("the desktop is locked".to_string()));
                self.agent_lets_go(session);
            }
            answer.give(Err("the desktop is locked".to_string()));
            return;
        }
        if let Err(why) = self.agent_seat(session) {
            answer.give(Err(why));
            return;
        }
        let agent = self.agent_seats.mine(session);
        // The call before gave up waiting on the browser, and sends this to
        // let go: what it waited on is over.
        if agent
            .pending
            .as_ref()
            .is_some_and(|pending| pending.asked.is_some())
        {
            debug!(session, "an agent's input waited on the browser too long");
            self.agent_stops(session, Err(THE_BROWSER_DID_NOT_ANSWER.to_string()));
        }
        let agent = self.agent_seats.mine(session);
        let pending = agent.pending.get_or_insert_with(|| Pending {
            work: VecDeque::new(),
            let_go: false,
            answers: Vec::new(),
            asked: None,
        });
        pending.work.extend(steps.into_iter().map(Work::Step));
        pending.let_go |= let_go;
        pending.answers.push(answer);
        self.agent_goes_on(session);
    }

    /// Run agent `session`'s input until it is done, refused, or waits on
    /// the browser.
    fn agent_goes_on(&mut self, session: u32) {
        loop {
            let agent = self.agent_seats.mine(session);
            let Some(pending) = agent.pending.as_mut() else {
                return;
            };
            let Some(work) = pending.work.pop_front() else {
                self.agent_stops(session, Ok(()));
                return;
            };
            match self.agent_work(session, work) {
                Ok(None) => {}
                Ok(Some((serial, asked))) => {
                    self.agent_seats.asked.insert(serial, session);
                    let pending = self
                        .agent_seats
                        .mine(session)
                        .pending
                        .as_mut()
                        .expect("only its own work ends its input");
                    pending.asked = Some((serial, asked));
                    self.tell_the_chromes_the_seats(false);
                    return;
                }
                Err(why) => {
                    self.agent_stops(session, Err(why));
                    return;
                }
            }
        }
    }

    /// Agent `session`'s input is over, `done`: it lets go if it was the
    /// last of the call or failed, and each call waiting hears.
    fn agent_stops(&mut self, session: u32, done: Result<(), String>) {
        let Some(pending) = self.agent_seats.mine(session).pending.take() else {
            return;
        };
        if let Some((serial, _)) = pending.asked {
            self.agent_seats.asked.remove(&serial);
        }
        if pending.let_go || done.is_err() {
            self.agent_lets_go(session);
        }
        self.tell_the_chromes_the_seats(false);
        for answer in pending.answers {
            answer.give(done.clone());
        }
    }

    /// The browser answered question `serial`: the event reached browser
    /// window `window`, or was `refused`. The agent's input goes on.
    pub fn agent_page_reached(
        &mut self,
        serial: u64,
        window: Option<String>,
        refused: Option<String>,
    ) {
        let Some(session) = self.agent_seats.asked.remove(&serial) else {
            // Its input stopped already: the agent left, or the call gave up.
            debug!(serial, "the browser answered an agent's input that is over");
            return;
        };
        let agent = self.agent_seats.mine(session);
        let asked = agent
            .pending
            .as_mut()
            .and_then(|pending| pending.asked.take())
            .filter(|(asked, _)| *asked == serial)
            .map(|(_, asked)| asked)
            .expect("a question is listed only while its input waits on it");
        debug!(
            session,
            serial,
            ?asked,
            window,
            refused,
            "the browser answered an agent's input"
        );
        if let Some(why) = refused {
            if asked == Asked::Pointer {
                agent.pointing_at = None;
            }
            self.agent_stops(session, Err(why));
            return;
        }
        match asked {
            Asked::Pointer => agent.pointing_at = window,
            // A press gives the window it lands in the agent's keyboard, as a
            // hand's does; the browser focused the page.
            Asked::Press | Asked::Focus => {
                if let Some(window) = window {
                    self.agent_types_in_pages(session, window);
                }
            }
            Asked::Other => {}
        }
        self.agent_goes_on(session);
    }

    /// Agent `session`'s keyboard is in browser window `window`, out of any
    /// native window.
    fn agent_types_in_pages(&mut self, session: u32, window: String) {
        let agent = self.agent_seats.mine(session);
        let (keyboard, _) = agent.devices();
        agent.typing_in = Some(window);
        agent.typing_in_pages = true;
        for menu in std::mem::take(&mut agent.menus).iter().rev() {
            menu.send_popup_done();
        }
        if keyboard.current_focus().is_some() {
            keyboard.set_focus(self, None, SERIAL_COUNTER.next_serial());
        }
    }

    /// Ask the browser to deliver `input` for agent `session`; `None` for
    /// `quiet`, which it doesn't answer.
    fn agent_asks_the_browser(
        &mut self,
        session: u32,
        input: AgentPageInput,
        quiet: bool,
    ) -> Option<u64> {
        let serial = self.agent_seats.next_serial();
        // Windows the user took from this agent, and windows other agents
        // hold.
        // An agent with no seat yet has taken nothing.
        let mut barred: Vec<String> = self
            .agent_seats
            .seats
            .get(&session)
            .map(|agent| agent.taken.iter().cloned().collect())
            .unwrap_or_default();
        for (other, agent) in &self.agent_seats.seats {
            if *other == session {
                continue;
            }
            if agent.in_pages {
                barred.extend(agent.pointing_at.clone());
            }
            if agent.typing_in_pages {
                barred.extend(agent.typing_in.clone());
            }
        }
        barred.sort_unstable();
        barred.dedup();
        debug!(
            session,
            serial,
            ?input,
            ?barred,
            quiet,
            "an agent's input for the browser's pages"
        );
        self.hub.broadcast(HostMessage::AgentInput {
            serial,
            seat: format!("agent-{session}"),
            input,
            barred,
            quiet,
        });
        (!quiet).then_some(serial)
    }

    /// Agent session `session` ended: its seat lets go of everything and goes.
    pub fn agent_gone(&mut self, session: u32) {
        self.agent_seats.gone.insert(session);
        self.agent_seats
            .started
            .retain(|_, started_for| *started_for != session);
        // An agent that never pointed or typed has no seat. It may have
        // driven pages by DevTools, so their clipboard goes.
        if !self.agent_seats.seats.contains_key(&session) {
            self.agent_asks_the_browser(session, AgentPageInput::Gone, true);
            return;
        }
        self.agent_stops(session, Err(format!("no agent is in as session {session}")));
        self.agent_lets_go(session);
        // What it held in the browser's pages goes too, and their clipboard.
        self.agent_asks_the_browser(session, AgentPageInput::Gone, true);
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

    /// The user's input reached browser window `window`, which agent seat
    /// `seat` holds: the person wins, as in [`Self::yield_to_the_person`].
    /// Their pointer moves the agent's off the window; their keyboard takes
    /// it, until they give it back.
    pub fn person_in_agents_window(&mut self, seat: &str, window: &str, keyboard: bool) {
        let Some(session) = seat
            .strip_prefix("agent-")
            .and_then(|session| session.parse::<u32>().ok())
            .filter(|session| self.agent_seats.seats.contains_key(session))
        else {
            debug!(
                seat,
                window, "the user reached a window of a seat that is gone"
            );
            return;
        };
        let agent = self.agent_seats.mine(session);
        let pointing = agent.in_pages && agent.pointing_at.as_deref() == Some(window);
        let typing =
            keyboard && agent.typing_in_pages && agent.typing_in.as_deref() == Some(window);
        if !pointing && !typing {
            return;
        }
        debug!(
            session,
            window, keyboard, "the user took a browser window from an agent"
        );
        self.agent_stops(
            session,
            Err(
                "the user is using this window now: act on it by ref, or try again once \
                 they have moved on"
                    .to_string(),
            ),
        );
        self.agent_lets_go(session);
        if pointing {
            self.agent_asks_the_browser(session, AgentPageInput::Leave, true);
            self.agent_seats.mine(session).pointing_at = None;
        }
        if typing {
            self.agent_asks_the_browser(session, AgentPageInput::Blur, true);
            let agent = self.agent_seats.mine(session);
            agent.typing_in = None;
            agent.typing_in_pages = false;
            agent.taken.insert(window.to_string());
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
        let agent = self.agent_seats.mine(session);
        let pointing = agent.in_pages && agent.pointing_at.as_deref() == Some(app_id);
        let typing = agent.typing_in_pages && agent.typing_in.as_deref() == Some(app_id);
        if pointing || typing {
            debug!(
                session,
                app_id, "the shell took a browser window from an agent"
            );
            self.agent_stops(session, Err(format!("the user took over window {app_id}")));
            self.agent_lets_go(session);
            if pointing {
                self.agent_asks_the_browser(session, AgentPageInput::Leave, true);
                self.agent_seats.mine(session).pointing_at = None;
            }
            if typing {
                self.agent_asks_the_browser(session, AgentPageInput::Blur, true);
                let agent = self.agent_seats.mine(session);
                agent.typing_in = None;
                agent.typing_in_pages = false;
            }
            self.agent_seats
                .mine(session)
                .taken
                .insert(app_id.to_string());
            self.tell_the_chromes_the_seats(false);
            return;
        }
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
                // A menu it points at is held through its window. A browser
                // window is its own.
                let pointing_at = match agent.in_pages {
                    true => agent.pointing_at.clone(),
                    false => agent
                        .pointing_at
                        .as_deref()
                        .map(|on| self.window_named(on))
                        .filter(|window| self.toplevel_for(window).is_some()),
                };
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
                in_pages: false,
                typing_in: None,
                typing_in_pages: false,
                pending: None,
                menus: Vec::new(),
                taken: BTreeSet::new(),
            },
        );
        Ok(())
    }

    /// Do one piece of agent `session`'s input. Answers the question it
    /// asked the browser, if it did, which the input waits on.
    fn agent_work(&mut self, session: u32, work: Work) -> Result<Option<(u64, Asked)>, String> {
        match work {
            Work::Step(step) => self.agent_step(session, step),
            Work::Request(request) => self.agent_request(session, request),
            Work::PagesPointer => {
                let agent = self.agent_seats.mine(session);
                let [x, y] = agent.input.at().expect("only a move points into the pages");
                agent.in_pages = true;
                let serial =
                    self.agent_asks_the_browser(session, AgentPageInput::Pointer { x, y }, false);
                Ok(serial.map(|serial| (serial, Asked::Pointer)))
            }
        }
    }

    fn agent_step(
        &mut self,
        session: u32,
        step: AgentStep,
    ) -> Result<Option<(u64, Asked)>, String> {
        match step {
            AgentStep::Send(emulated) => {
                let moves = matches!(
                    emulated,
                    Emulated::Motion { .. }
                        | Emulated::MotionAbsolute { .. }
                        | Emulated::TouchDown { .. }
                        | Emulated::TouchMotion { .. }
                );
                let desk = self.desk();
                let input = &mut self.agent_seats.mine(session).input;
                let requests = input.translate(emulated, &desk);
                // Off every native window, the pointer is over the shell's
                // page: the browser takes it there, before a touch presses.
                let into_pages = moves && input.at().is_some() && input.over().is_none();
                let mut work: Vec<Work> = Vec::new();
                let mut pointed = false;
                for request in requests {
                    if into_pages && !pointed && !matches!(request, ClientRequest::PointerLeave) {
                        work.push(Work::PagesPointer);
                        pointed = true;
                    }
                    work.push(Work::Request(request));
                }
                if into_pages && !pointed {
                    work.push(Work::PagesPointer);
                }
                let pending = self
                    .agent_seats
                    .mine(session)
                    .pending
                    .as_mut()
                    .expect("a step runs within its input");
                for each in work.into_iter().rev() {
                    pending.work.push_front(each);
                }
                Ok(None)
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
            AgentStep::Focus { window: said } => {
                // By the id list-windows gives it, or the compositor's or
                // engine's own. Refusals name it as the agent did.
                let listed = self.hub.host.lock().unwrap().window_listed_as(&said);
                let window = listed.unwrap_or_else(|| said.clone());
                if self.toplevel_for(&window).is_some() {
                    self.agent_focuses(session, &window, &said)?;
                    return Ok(None);
                }
                // Not native: a browser window's, if the browser has it.
                self.taken_said_as(&window, Some(said.as_str()))?;
                let serial =
                    self.agent_asks_the_browser(session, AgentPageInput::Focus { window }, false);
                Ok(serial.map(|serial| (serial, Asked::Focus)))
            }
        }
    }

    /// Carry out one request the translation made, on the agent's seat or,
    /// where its pointer or keyboard is in the browser's pages, in them.
    /// Answers the question it asked the browser, if it did.
    fn agent_request(
        &mut self,
        session: u32,
        request: ClientRequest,
    ) -> Result<Option<(u64, Asked)>, String> {
        let agent = self.agent_seats.mine(session);
        let (pointing_at, in_pages, typing_in_pages) = (
            agent.pointing_at.clone(),
            agent.in_pages,
            agent.typing_in_pages,
        );
        let (keyboard, pointer) = agent.devices();
        let (serial, time) = (SERIAL_COUNTER.next_serial(), self.now_ms());
        match request {
            ClientRequest::PointerButton { button, pressed } if in_pages => {
                if pressed {
                    if let Some(window) = &pointing_at {
                        self.taken(window)?;
                    }
                }
                let asked = self.agent_asks_the_browser(
                    session,
                    AgentPageInput::Button { button, pressed },
                    !pressed,
                );
                return Ok(asked.map(|serial| (serial, Asked::Press)));
            }
            ClientRequest::PointerAxis { dx, dy, .. } if in_pages => {
                let asked =
                    self.agent_asks_the_browser(session, AgentPageInput::Scroll { dx, dy }, false);
                return Ok(asked.map(|serial| (serial, Asked::Other)));
            }
            ClientRequest::Key { keycode, pressed } if typing_in_pages => {
                if pressed {
                    if let Some(window) = self.agent_seats.mine(session).typing_in.clone() {
                        self.taken(&window)?;
                    }
                }
                let asked = self.agent_asks_the_browser(
                    session,
                    AgentPageInput::Key { keycode, pressed },
                    !pressed,
                );
                return Ok(asked.map(|serial| (serial, Asked::Other)));
            }
            ClientRequest::PointerMotion { .. } if in_pages => {
                // Out of the pages, onto a native window.
                self.agent_asks_the_browser(session, AgentPageInput::Leave, true);
                let agent = self.agent_seats.mine(session);
                agent.in_pages = false;
                agent.pointing_at = None;
                return self.agent_request(session, request);
            }
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
                    (true, None) => return Err(NOWHERE.to_string()),
                    // A click gives the window the keyboard, as it would a
                    // hand's. A menu has the keyboard already.
                    (true, Some(window)) if self.toplevel_for(&window).is_some() => {
                        self.agent_focuses(session, &window, &window)?
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
                    return Err(NOWHERE.to_string());
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
        Ok(None)
    }

    /// Give window `window` agent `session`'s keyboard. Refusals name it
    /// `said`, as the agent did.
    fn agent_focuses(&mut self, session: u32, window: &str, said: &str) -> Result<(), String> {
        let Some(surface) = self.toplevel_for(window).map(|on| on.wl_surface().clone()) else {
            return Err(format!("window {said} has closed"));
        };
        self.taken_said_as(window, Some(said))?;
        self.someone_else_holds(session, &surface, true)?;
        if self.agent_seats.mine(session).typing_in_pages {
            // Out of the browser's pages, into a native window.
            self.agent_asks_the_browser(session, AgentPageInput::Blur, true);
            self.agent_seats.mine(session).typing_in_pages = false;
        }
        let (keyboard, _) = self.agent_seats.mine(session).devices();
        keyboard.set_focus(self, Some(surface), SERIAL_COUNTER.next_serial());
        self.agent_seats.mine(session).typing_in = Some(window.to_string());
        Ok(())
    }

    /// Why no agent can drive window `app_id`, or a popup over it: the user
    /// took it.
    fn taken(&self, app_id: &str) -> Result<(), String> {
        self.taken_said_as(app_id, None)
    }

    /// [`Self::taken`], naming the window `said` rather than the window
    /// `app_id` names.
    fn taken_said_as(&self, app_id: &str, said: Option<&str>) -> Result<(), String> {
        let window = self.window_named(app_id);
        let said = said.unwrap_or(window.as_str());
        if self
            .agent_seats
            .seats
            .values()
            .any(|agent| agent.taken.contains(&window))
        {
            return Err(format!(
                "the user took over window {said}: act on it by ref, or wait until they give it \
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

    /// Window `app_id` first drew, before the chromes hear of it. A window of
    /// a program an agent started is that agent's: its keyboard goes in, and
    /// the chromes hear it held before they hear of the window, so the shell
    /// leaves the user's keyboard where it is.
    pub fn agents_window_appeared(&mut self, app_id: &str, surface: &WlSurface) {
        let Ok(pid) = u32::try_from(crate::clients::owner_of(surface).pid) else {
            return;
        };
        let Some(session) = self.agent_seats.started_for(pid) else {
            return;
        };
        if let Err(why) = self.agent_seat(session) {
            debug!(
                session,
                app_id, why, "a window an agent started is the user's"
            );
            return;
        }
        if let Err(why) = self.someone_else_holds(session, surface, true) {
            debug!(
                session,
                app_id, why, "a window an agent started is the user's"
            );
            return;
        }
        debug!(session, app_id, "a window an agent started is held by it");
        let (keyboard, _) = self.agent_seats.mine(session).devices();
        keyboard.set_focus(self, Some(surface.clone()), SERIAL_COUNTER.next_serial());
        self.agent_seats.mine(session).typing_in = Some(app_id.to_string());
        self.tell_the_chromes_the_seats(false);
    }

    /// The browser windows open now, `open`: one that closed leaves every
    /// agent's seat, as a native window does.
    pub fn agents_browser_windows(&mut self, open: &[String]) {
        let gone = |window: &Option<String>| window.as_ref().is_some_and(|id| !open.contains(id));
        // A taken window that is neither: a browser window that closed.
        let closed: Vec<String> = self
            .agent_seats
            .seats
            .values()
            .flat_map(|agent| agent.taken.iter())
            .filter(|window| !open.contains(window) && self.toplevel_for(window).is_none())
            .cloned()
            .collect();
        for agent in self.agent_seats.seats.values_mut() {
            if agent.typing_in_pages && gone(&agent.typing_in) {
                agent.typing_in = None;
                agent.typing_in_pages = false;
            }
            if agent.in_pages && gone(&agent.pointing_at) {
                agent.pointing_at = None;
            }
            agent.taken.retain(|window| !closed.contains(window));
        }
        self.tell_the_chromes_the_seats(false);
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

#[cfg(test)]
mod tests {
    use super::parent_in;

    #[test]
    fn a_parent_is_read_past_a_command_name_with_spaces_and_parentheses() {
        assert_eq!(
            parent_in("4242 (my (odd) app) S 4100 4242 4242 0 -1 4194560"),
            Some(4100)
        );
    }

    #[test]
    fn the_first_process_has_no_parent() {
        assert_eq!(parent_in("1 (systemd) S 0 1 1 0 -1 4194560"), None);
    }
}
