//! When a desktop is idle, and what its screens do about it.
//!
//! One question — *has anybody touched this desktop inside the timeout* — and
//! the one answer that has somewhere to go today: the screens go dark, and
//! they come back on the next input. The effectful half is in `main.rs`, where
//! the engine session is; everything here is arithmetic over an instant that
//! is handed in, so a desk going dark can be tested on a machine with no
//! screen. There is no clock in this module for the same reason.
//!
//! **THE EDGE IS WHAT THIS REPORTS, not the state.** Lighting a connector is a
//! modeset, and a desktop that restated "be dark" on every tick — or "be lit"
//! on every keystroke — would ask for one several times a second. So both
//! answers come back only when the answer *changed*, and [`Idle::dark`] is
//! what everything else asks about the state.
//!
//! What the desktop is *doing* gets one say in it, and only one: a client
//! holding a `zwp_idle_inhibit_manager_v1` inhibitor — a film playing, with
//! nobody near the trackpad — vetoes the answer. A veto rather than a hand on
//! the desk or a clock that is paused; `Idle::should_be_dark` is where that
//! choice is argued, and [`StillThere`] is the half of it that says what an
//! inhibitor held by a client that *died* is worth.
//!
//! One thing this deliberately is not: **it is not a lock.** A dark screen is
//! a screen, and anybody can still type at this desktop. The lock needs the
//! shell, the host↔chrome protocol and a decision about where input stops;
//! `ROADMAP.md` carries it.

use std::time::{Duration, Instant};

use crate::engine::{Connector, Display};
use crate::ClientRequest;

/// What the screens have to do, on the one turn the answer changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blanking {
    /// Nobody has touched this desktop for the whole timeout: stop lighting
    /// the connectors.
    GoDark,
    /// Somebody is here again: light what the desktop wants lit.
    ComeBack,
}

/// Whether a client's inhibitor is still anybody's to hold.
///
/// A CLIENT THAT CRASHES SENDS NO DESTROY. Smithay reports an inhibitor gone
/// only for the request that asks — its own docs say the rest is the
/// compositor's — so an inhibitor forgotten only when asked is one a dead
/// client keeps forever, and that is a desktop whose screens never blank again
/// with nothing anywhere saying why. The compositor's answer is
/// `WlSurface::is_alive`, which is false for every object of a client that
/// went; this is that question with no Wayland in it, so the arithmetic below
/// can be tested against a client that dies on a machine with no display.
pub trait StillThere {
    fn still_there(&self) -> bool;
}

/// Whether anybody is at this desktop, and when that last changed.
///
/// Built only for a desktop that states a timeout — `None` is a desktop that
/// never blanks, which is what saying nothing means (`domicile_config`'s
/// `IdleConfig`), and there is then nothing here to hold and no timer to arm.
pub struct Idle<S> {
    blank_after: Duration,
    /// When somebody was last known to be here. The clock starts at whatever
    /// instant this was built at rather than at zero: a desktop that comes up
    /// and is left alone has been left alone since it came up.
    stirred_at: Instant,
    dark: bool,
    /// What is asking that the screens stay on whatever the clock says.
    ///
    /// A list rather than a count or a set, because a surface can carry more
    /// than one inhibitor — a player and the toolkit under it each take their
    /// own — and `zwp_idle_inhibitor_v1.destroy` names nothing but the
    /// surface. So letting one go has to take one of them rather than all.
    inhibitors: Vec<S>,
}

impl<S: StillThere + PartialEq> Idle<S> {
    pub fn after(blank_after: Option<Duration>, now: Instant) -> Option<Idle<S>> {
        blank_after.map(|blank_after| Idle {
            blank_after,
            stirred_at: now,
            dark: false,
            inhibitors: Vec::new(),
        })
    }

    /// Somebody is here. `Some` only on the edge out of a dark desktop.
    pub fn stirred(&mut self, now: Instant) -> Option<Blanking> {
        self.stirred_at = now;
        let was_dark = self.dark;
        self.dark = false;
        was_dark.then_some(Blanking::ComeBack)
    }

    /// The clock came round. `Some` only on the edge into a dark desktop.
    ///
    /// Written so that it cannot relight anything: the only state it can reach
    /// is dark. A desktop comes back because a hand moved or because something
    /// asked it to stay awake — [`Idle::stirred`] and [`Idle::inhibited_by`] —
    /// and never because a timer fired.
    pub fn elapsed(&mut self, now: Instant) -> Option<Blanking> {
        if self.should_be_dark(now) {
            self.settle(now)
        } else {
            None
        }
    }

    /// A client asked that this desktop stay awake. `Some` only on the edge
    /// out of a dark desktop.
    pub fn inhibited_by(&mut self, inhibitor: S, now: Instant) -> Option<Blanking> {
        self.inhibitors.push(inhibitor);
        self.settle(now)
    }

    /// A client let one of them go. `Some` only on the edge into a dark
    /// desktop.
    ///
    /// One of them rather than every inhibitor on that surface, and nothing at
    /// all for a surface this desk is not holding one on — which is a client
    /// destroying an inhibitor it took while the config stated no timeout, so
    /// there was no clock to hold it. Nothing changed then, and a desk is
    /// blanked by the clock rather than by an answer to something that did not
    /// happen.
    pub fn uninhibited_by(&mut self, inhibitor: &S, now: Instant) -> Option<Blanking> {
        match self.inhibitors.iter().position(|held| held == inhibitor) {
            Some(one) => {
                self.inhibitors.remove(one);
                self.settle(now)
            }
            None => None,
        }
    }

    /// Let go of everything the clients that are gone were holding.
    ///
    /// Answers nothing when they were holding nothing, which is the ordinary
    /// case: this is asked after every turn of a compositor's clients, and
    /// almost none of them ever took an inhibitor.
    pub fn the_dead_let_go(&mut self, now: Instant) -> Option<Blanking> {
        let held = self.inhibitors.len();
        self.inhibitors.retain(StillThere::still_there);
        if self.inhibitors.len() == held {
            None
        } else {
            self.settle(now)
        }
    }

    /// Take over the inhibitors another clock was holding.
    ///
    /// For a reloaded `[idle]`, which replaces the clock outright: the timeout
    /// is the config's to change and the moment it changed is a fresh count,
    /// but *what is holding the screens on* belongs to the clients, and no
    /// client resends an inhibitor because a file on disk was rewritten. A
    /// clock that dropped them would blank a desk halfway through a film and
    /// stay blanked, the thing that would have vetoed it being gone.
    pub fn takes_over_from(mut self, previous: &mut Idle<S>) -> Idle<S> {
        self.inhibitors = std::mem::take(&mut previous.inhibitors);
        self
    }

    /// Whether the screens are off right now.
    ///
    /// Asked by everything that states the connectors for another reason — a
    /// monitor plugged in, a config reloaded — because a desktop that is dark
    /// has to stay dark through both.
    pub fn dark(&self) -> bool {
        self.dark
    }

    /// How long until this is worth asking again.
    ///
    /// The timer's own re-arm, so an untouched desktop wakes once at the
    /// moment it would blank rather than on a tick nobody chose. A dark one
    /// has nothing the clock can tell it — the next answer arrives on the
    /// input path — so it waits out another whole timeout, which keeps the
    /// source armed for one wake per timeout instead of one per second.
    ///
    /// **NEVER ZERO.** A desktop held awake past the moment it would have
    /// blanked is a deadline in the past, and re-arming a timer for the time
    /// left until it is re-arming for no time at all — an event loop spinning
    /// flat out for as long as the film lasts. There is nothing the clock can
    /// tell that desktop either, for the same reason a dark one has nothing:
    /// the next answer comes from whoever lets go.
    pub fn next_check(&self, now: Instant) -> Duration {
        let until_the_deadline =
            (self.stirred_at + self.blank_after).saturating_duration_since(now);
        if self.dark || until_the_deadline.is_zero() {
            self.blank_after
        } else {
            until_the_deadline
        }
    }

    /// Take up the answer the facts now give, and report it only if it
    /// changed.
    fn settle(&mut self, now: Instant) -> Option<Blanking> {
        let should_be_dark = self.should_be_dark(now);
        let changed = should_be_dark != self.dark;
        self.dark = should_be_dark;
        if !changed {
            None
        } else if should_be_dark {
            Some(Blanking::GoDark)
        } else {
            Some(Blanking::ComeBack)
        }
    }

    /// Whether the screens belong off, from the facts alone.
    ///
    /// The whole decision, and a function of nothing but when somebody was
    /// last here, how long a timeout is, what is inhibiting and what time it
    /// is now. An inhibitor is a **veto on the answer** rather than a hand on
    /// the desk or a clock that is paused, and that is what makes both of the
    /// cases that are easy to get wrong fall out of it: a film starting on a
    /// desk that is already dark flips the answer back to lit, and the last
    /// inhibitor going away on a desk nobody has touched in an hour flips it
    /// to dark then and there rather than a timeout later.
    ///
    /// An inhibitor nobody is left to hold is not one. See [`StillThere`].
    fn should_be_dark(&self, now: Instant) -> bool {
        now.duration_since(self.stirred_at) >= self.blank_after
            && !self.inhibitors.iter().any(StillThere::still_there)
    }
}

/// Whether this request is a person at the desk.
///
/// The chrome owns the input on this system and forwards it, so every hand on
/// this desktop arrives as one of these — which is what makes a single honest
/// answer possible at all. Exhaustive on purpose: a request added later does
/// not get a default, it gets a decision.
///
/// **A POINTER LEAVING A WINDOW IS NOT SOMEBODY AT THE DESK.** The page sends
/// it when the pointer leaves an `<app>`, which a *window* moving out from
/// under a still pointer does as readily as a hand does — a window closing, a
/// layout settling, the shell animating a tile. Every leave a hand caused is
/// bracketed by motion that says so anyway, so counting it buys nothing and
/// hands a desktop a way to stay awake with nobody in the room.
///
/// The rest are the desktop talking about itself: what the chrome reports
/// about its own window, what it asks be done to a client, and a page saying
/// hello. A shell that repaints a clock must not hold the screens on.
pub fn somebody_is_here(request: &ClientRequest) -> bool {
    match request {
        ClientRequest::Key { .. }
        | ClientRequest::PointerMotion { .. }
        | ClientRequest::PointerButton { .. }
        | ClientRequest::PointerAxis { .. } => true,
        ClientRequest::PointerLeave
        | ClientRequest::KeyboardFocus { .. }
        | ClientRequest::SetOutputScale { .. }
        | ClientRequest::SetOutputSize { .. }
        | ClientRequest::CloseApp { .. }
        | ClientRequest::ChromeHello { .. }
        // NEITHER HALF OF THE CLIPBOARD IS A HAND. A client sets the
        // selection whenever it likes — a program copying on a timer is a
        // client, and the Ctrl+C that a person did press has already arrived
        // as a `Key` and been counted. And picking a row out of the history
        // is the chrome asking for something on a person's behalf, which is
        // what `CloseApp` above is: the click that chose it landed on the
        // shell's own page and never came through here at all.
        | ClientRequest::ClipboardCopied { .. }
        | ClientRequest::CopyClipboardEntry { .. } => false,
    }
}

/// The connector list that asks the engine to light nothing.
///
/// Built from the engine's own last reading of the monitors rather than from
/// `Screens::scanout`, and the difference is a lit panel: a scanout list names
/// the displays a *profile* named, so a monitor no profile mentions is absent
/// from it — and absent means untouched, which means still on.
///
/// The origins are the engine's own, which is where it has already put each
/// connector on its desktop. Nothing is drawn on a dark one, so the only thing
/// that matters about them is that they are the positions the engine is not
/// being asked to change.
///
/// **EMPTY MEANS THERE IS NOTHING TO TURN OFF, AND MUST NOT BE SENT.** An
/// empty list is the compositor having no opinion, which the engine answers by
/// lighting what the hardware reports — see
/// [`Engine::configure_displays`](crate::engine::Engine::configure_displays).
/// That is a nested run, whose screens are the host's monitors and never this
/// compositor's to blank.
pub fn darkened(displays: &[Display]) -> Vec<Connector> {
    displays
        .iter()
        .map(|display| Connector {
            id: display.id,
            enabled: false,
            origin: display.position,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    use super::{darkened, somebody_is_here, Blanking, Idle, StillThere};
    use crate::engine::{Connector, Display};
    use crate::ClientRequest;

    const AFTER: Duration = Duration::from_secs(600);

    /// A client's inhibitor, as `Idle` has to see one.
    ///
    /// Two facts and no Wayland: which surface it was taken on, which is all a
    /// client destroying one names, and whether the client that took it is
    /// still there — `WlSurface::is_alive` on the compositor's side, and a
    /// flag a test can put out here.
    #[derive(Clone)]
    struct Inhibitor {
        surface: u32,
        client: Rc<Cell<bool>>,
    }

    impl Inhibitor {
        fn on(surface: u32) -> Inhibitor {
            Inhibitor {
                surface,
                client: Rc::new(Cell::new(true)),
            }
        }

        fn the_client_died(&self) {
            self.client.set(false);
        }
    }

    impl StillThere for Inhibitor {
        fn still_there(&self) -> bool {
            self.client.get()
        }
    }

    /// Two inhibitors are alike when they name the same surface, because that
    /// is the whole of what a destroyed one arrives as.
    impl PartialEq for Inhibitor {
        fn eq(&self, other: &Inhibitor) -> bool {
            self.surface == other.surface
        }
    }

    /// A desk that blanks after [`AFTER`] alone, counting from `start`.
    fn desk(start: Instant) -> Idle<Inhibitor> {
        Idle::after(Some(AFTER), start).expect("a timeout was stated")
    }

    fn monitor(id: i64, position: (i32, i32)) -> Display {
        Display {
            id,
            description: String::new(),
            position,
            size: (1920, 1080),
            physical_mm: (600, 340),
            refresh_mhz: 60_000,
        }
    }

    #[test]
    fn a_desktop_that_states_no_timeout_has_nothing_to_watch() {
        assert!(Idle::<Inhibitor>::after(None, Instant::now()).is_none());
    }

    #[test]
    fn a_desktop_still_inside_its_timeout_stays_lit() {
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(idle.elapsed(start + AFTER - Duration::from_millis(1)), None);
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_nobody_touched_for_the_whole_timeout_goes_dark() {
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(idle.elapsed(start + AFTER), Some(Blanking::GoDark));
        assert!(idle.dark());
    }

    #[test]
    fn a_desktop_that_is_already_dark_is_not_darkened_again() {
        // THE EDGE IS THE WHOLE POINT. A configure per tick is a modeset per
        // tick, on a desk nobody is at.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER);
        assert_eq!(idle.elapsed(start + AFTER * 2), None);
        assert!(idle.dark());
    }

    #[test]
    fn a_key_at_the_last_moment_puts_the_timeout_back() {
        let start = Instant::now();
        let mut idle = desk(start);
        let stirred = start + AFTER - Duration::from_millis(1);
        assert_eq!(idle.stirred(stirred), None);
        assert_eq!(
            idle.elapsed(start + AFTER),
            None,
            "the deadline moved with the key"
        );
        assert_eq!(idle.elapsed(stirred + AFTER), Some(Blanking::GoDark));
    }

    #[test]
    fn the_next_input_lights_a_dark_desktop_back_up() {
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER);
        assert_eq!(idle.stirred(start + AFTER * 2), Some(Blanking::ComeBack));
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_somebody_is_already_at_is_not_relit_on_every_keystroke() {
        // The other edge, and the one that would send a configure per key.
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(idle.stirred(start + Duration::from_secs(1)), None);
        assert_eq!(idle.stirred(start + Duration::from_secs(2)), None);
    }

    #[test]
    fn a_lit_desktop_is_asked_again_when_its_timeout_would_be_up() {
        let start = Instant::now();
        let idle = desk(start);
        assert_eq!(
            idle.next_check(start + Duration::from_secs(60)),
            AFTER - Duration::from_secs(60)
        );
    }

    #[test]
    fn a_dark_desktop_is_asked_no_more_often_than_a_timeout() {
        // Nothing the clock can do to a dark desktop -- the next answer comes
        // from a hand, off the input path -- so this is only the wake that
        // keeps the timer armed, once a timeout rather than once a second.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER);
        assert_eq!(idle.next_check(start + AFTER), AFTER);
    }

    #[test]
    fn a_film_playing_holds_a_desktop_nobody_is_touching_awake() {
        // The gap this whole seam exists for: the clock counts hands, and
        // nobody's hand is on a trackpad during a film.
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(
            idle.inhibited_by(Inhibitor::on(1), start),
            None,
            "a desk somebody is at is already lit"
        );
        assert_eq!(idle.elapsed(start + AFTER), None);
        assert!(!idle.dark());
    }

    #[test]
    fn a_film_starting_on_a_dark_desk_brings_the_screens_back() {
        // A video begun on a blanked screen, which is the ordinary way of it:
        // the answer changed without a hand, so the edge is real.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER);
        assert_eq!(
            idle.inhibited_by(Inhibitor::on(1), start + AFTER),
            Some(Blanking::ComeBack)
        );
        assert!(!idle.dark());
    }

    #[test]
    fn the_desk_goes_dark_when_the_film_ends_rather_than_waiting_for_a_hand() {
        // The veto lifting is the whole of what changed, and the desk has been
        // untouched throughout — so it belongs dark now, not a timeout later.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start);
        idle.elapsed(start + AFTER);
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER * 2),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn an_inhibitor_let_go_inside_the_timeout_leaves_the_clock_where_it_was() {
        // AN INHIBITOR IS NOT A HAND. Counting it as one would put the
        // deadline a whole timeout past the film rather than past the last
        // person, which is a desk that stays lit ten minutes after a
        // notification sound.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start);
        assert_eq!(idle.uninhibited_by(&film, start + AFTER / 2), None);
        assert_eq!(idle.elapsed(start + AFTER), Some(Blanking::GoDark));
    }

    #[test]
    fn a_surface_carrying_two_inhibitors_is_let_go_of_twice() {
        // A player and the toolkit under it each take their own, and the
        // destroy names nothing but the surface: dropping both on the first
        // one is a film that blanks halfway through.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start);
        idle.inhibited_by(film.clone(), start);
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER),
            None,
            "the other one still holds"
        );
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn an_inhibitor_whose_client_died_holds_nothing() {
        // The half that makes this correct rather than plausible, and it does
        // not wait on anybody having noticed the death: a leaked inhibitor is
        // a desktop that never blanks again and nobody would know why.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start);
        film.the_client_died();
        assert_eq!(idle.elapsed(start + AFTER), Some(Blanking::GoDark));
    }

    #[test]
    fn the_desk_goes_dark_when_the_client_holding_it_awake_dies() {
        // The same death, noticed rather than waited out: the compositor asks
        // this the moment it has finished with a client's last message, so a
        // player that crashed mid-film does not keep the glass lit until the
        // clock next comes round.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start);
        idle.elapsed(start + AFTER);
        film.the_client_died();
        assert_eq!(idle.the_dead_let_go(start + AFTER), Some(Blanking::GoDark));
        assert!(idle.dark());
    }

    #[test]
    fn nothing_is_decided_by_an_inhibitor_this_desk_never_had() {
        // Neither of these is the thing that blanks a desk nobody is at — the
        // clock is, and it says so in a line of its own. One is asked after
        // every turn of the clients, most of which were holding nothing; the
        // other answers a client destroying an inhibitor it took before a
        // reload gave this desk a clock at all. An answer from either would be
        // a desk going dark for a film that never played.
        let start = Instant::now();
        let mut idle = desk(start);

        assert_eq!(idle.the_dead_let_go(start + AFTER), None);
        assert_eq!(idle.uninhibited_by(&Inhibitor::on(1), start + AFTER), None);
        assert!(!idle.dark());
    }

    #[test]
    fn a_reloaded_clock_goes_on_holding_the_film_the_old_one_was() {
        // A config rewritten is not a film ending: no client resends an
        // inhibitor because a file on disk changed, so a clock that dropped
        // them would blank the desk halfway through — and stay blanked, since
        // the thing that would have vetoed it is gone.
        let start = Instant::now();
        let mut old = desk(start);
        old.inhibited_by(Inhibitor::on(1), start);

        let mut reloaded = desk(start).takes_over_from(&mut old);

        assert_eq!(reloaded.elapsed(start + AFTER), None);
        assert!(!reloaded.dark());
    }

    #[test]
    fn a_desk_held_awake_past_its_deadline_is_not_asked_again_at_once() {
        // A zero here is a timer that re-arms for no time at all, which is
        // this compositor's event loop spinning flat out for as long as the
        // film lasts.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.inhibited_by(Inhibitor::on(1), start);
        assert_eq!(idle.next_check(start + AFTER * 2), AFTER);
    }

    #[test]
    fn a_dark_desktop_asks_for_every_connector_the_engine_reported_turned_off() {
        // The real list with the light taken out of it, and every entry of it:
        // an empty list is the compositor having NO OPINION, which the engine
        // answers by lighting what the hardware reports -- the exact opposite
        // of what a blanked desktop is asking for.
        assert_eq!(
            darkened(&[monitor(3, (0, 0)), monitor(7, (1920, 0))]),
            vec![
                Connector {
                    id: 3,
                    enabled: false,
                    origin: (0, 0),
                },
                Connector {
                    id: 7,
                    enabled: false,
                    origin: (1920, 0),
                },
            ]
        );
    }

    #[test]
    fn a_desktop_with_no_monitors_read_has_nothing_to_turn_off() {
        // A nested run, where the screens belong to the host's compositor and
        // this one has never been told about a connector.
        assert!(darkened(&[]).is_empty());
    }

    #[test]
    fn a_hand_on_the_keyboard_or_the_pointer_is_somebody_here() {
        for (what, request) in [
            (
                "a key",
                ClientRequest::Key {
                    keycode: 30,
                    pressed: true,
                },
            ),
            (
                "the pointer moving over a window",
                ClientRequest::PointerMotion {
                    app_id: "app-1".into(),
                    x: 4.0,
                    y: 8.0,
                },
            ),
            (
                "a click",
                ClientRequest::PointerButton {
                    button: 272,
                    pressed: true,
                },
            ),
            (
                "the wheel",
                ClientRequest::PointerAxis {
                    dx: 0.0,
                    dy: 1.0,
                    v120_x: 0,
                    v120_y: 120,
                },
            ),
        ] {
            assert!(somebody_is_here(&request), "{what} is somebody at the desk");
        }
    }

    #[test]
    fn what_the_desktop_does_to_itself_is_not_somebody_here() {
        for (what, request) in [
            ("the pointer leaving a window", ClientRequest::PointerLeave),
            (
                "the chrome handing a window the keyboard",
                ClientRequest::KeyboardFocus {
                    app_id: Some("app-1".into()),
                },
            ),
            (
                "the chrome reporting its density",
                ClientRequest::SetOutputScale {
                    ratio: 2.0,
                    scale: 2,
                },
            ),
            (
                "the chrome reporting its size",
                ClientRequest::SetOutputSize {
                    logical: (1920, 1080),
                },
            ),
            (
                "a window being closed",
                ClientRequest::CloseApp {
                    app_id: "app-1".into(),
                },
            ),
            (
                "a page saying hello",
                ClientRequest::ChromeHello { served_by: None },
            ),
            (
                "a client putting something on the clipboard",
                ClientRequest::ClipboardCopied {
                    text: "what was copied".into(),
                },
            ),
            (
                "the shell putting a copy back on the clipboard",
                ClientRequest::CopyClipboardEntry { entry: 1 },
            ),
        ] {
            assert!(
                !somebody_is_here(&request),
                "{what} would keep every desktop awake forever"
            );
        }
    }
}
