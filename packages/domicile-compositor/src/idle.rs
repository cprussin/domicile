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
//! Two things this deliberately is not:
//!
//! - **It is not a lock.** A dark screen is a screen, and anybody can still
//!   type at this desktop. The lock needs the shell, the host↔chrome protocol
//!   and a decision about where input stops; `ROADMAP.md` carries it.
//! - **It does not know what the desktop is doing**, only what the person at
//!   it is. A film playing full-screen with nobody touching the trackpad
//!   blanks after the timeout, which is wrong and is a known gap rather than a
//!   decision: Wayland's answer is `zwp_idle_inhibit_manager_v1`, Smithay
//!   ships it, and wiring it is its own change — a client's inhibitor has to
//!   reach here, and the compositor has to decide what an inhibitor held by a
//!   *dead* client means. `ROADMAP.md` carries that too.

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

/// Whether anybody is at this desktop, and when that last changed.
///
/// Built only for a desktop that states a timeout — `None` is a desktop that
/// never blanks, which is what saying nothing means (`domicile_config`'s
/// `IdleConfig`), and there is then nothing here to hold and no timer to arm.
pub struct Idle {
    blank_after: Duration,
    /// When somebody was last known to be here. The clock starts at whatever
    /// instant this was built at rather than at zero: a desktop that comes up
    /// and is left alone has been left alone since it came up.
    stirred_at: Instant,
    dark: bool,
}

impl Idle {
    pub fn after(blank_after: Option<Duration>, now: Instant) -> Option<Idle> {
        blank_after.map(|blank_after| Idle {
            blank_after,
            stirred_at: now,
            dark: false,
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
    /// is dark. A desktop comes back because a hand moved, which is
    /// [`Idle::stirred`], and never because a timer fired.
    pub fn elapsed(&mut self, now: Instant) -> Option<Blanking> {
        if self.dark || now.duration_since(self.stirred_at) < self.blank_after {
            None
        } else {
            self.dark = true;
            Some(Blanking::GoDark)
        }
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
    pub fn next_check(&self, now: Instant) -> Duration {
        if self.dark {
            self.blank_after
        } else {
            (self.stirred_at + self.blank_after).saturating_duration_since(now)
        }
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
    use std::time::{Duration, Instant};

    use super::{darkened, somebody_is_here, Blanking, Idle};
    use crate::engine::{Connector, Display};
    use crate::ClientRequest;

    const AFTER: Duration = Duration::from_secs(600);

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
        assert!(Idle::after(None, Instant::now()).is_none());
    }

    #[test]
    fn a_desktop_still_inside_its_timeout_stays_lit() {
        let start = Instant::now();
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
        assert_eq!(idle.elapsed(start + AFTER - Duration::from_millis(1)), None);
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_nobody_touched_for_the_whole_timeout_goes_dark() {
        let start = Instant::now();
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
        assert_eq!(idle.elapsed(start + AFTER), Some(Blanking::GoDark));
        assert!(idle.dark());
    }

    #[test]
    fn a_desktop_that_is_already_dark_is_not_darkened_again() {
        // THE EDGE IS THE WHOLE POINT. A configure per tick is a modeset per
        // tick, on a desk nobody is at.
        let start = Instant::now();
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
        idle.elapsed(start + AFTER);
        assert_eq!(idle.elapsed(start + AFTER * 2), None);
        assert!(idle.dark());
    }

    #[test]
    fn a_key_at_the_last_moment_puts_the_timeout_back() {
        let start = Instant::now();
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
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
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
        idle.elapsed(start + AFTER);
        assert_eq!(idle.stirred(start + AFTER * 2), Some(Blanking::ComeBack));
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_somebody_is_already_at_is_not_relit_on_every_keystroke() {
        // The other edge, and the one that would send a configure per key.
        let start = Instant::now();
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
        assert_eq!(idle.stirred(start + Duration::from_secs(1)), None);
        assert_eq!(idle.stirred(start + Duration::from_secs(2)), None);
    }

    #[test]
    fn a_lit_desktop_is_asked_again_when_its_timeout_would_be_up() {
        let start = Instant::now();
        let idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
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
        let mut idle = Idle::after(Some(AFTER), start).expect("a timeout was stated");
        idle.elapsed(start + AFTER);
        assert_eq!(idle.next_check(start + AFTER), AFTER);
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
