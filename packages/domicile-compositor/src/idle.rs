//! Decides when the desktop is idle and its screens should blank.
//!
//! This module is pure logic over the current time and the surfaces with
//! windows, so it can be tested without a clock, a display or Wayland.
//! `main.rs` applies the result. See `docs/IDLE.md`.
//!
//! - Methods report only edges, since each change costs a modeset. Ask
//!   [`Idle::dark`] for the state.
//! - A `zwp_idle_inhibit_manager_v1` inhibitor vetoes blanking while its client
//!   is alive and its surface has a window. See [`holds`].
//! - The shell gets the state, not the edge, since a reloaded page missed
//!   earlier edges. See [`announced`].
//! - Blanking does not block input. The dark edge also engages
//!   [`crate::lock`], which does.

use std::time::{Duration, Instant};

use domicile_protocol::HostMessage;

use crate::engine::{Connector, Display};
use crate::ClientRequest;
use domicile_config::Transform;

/// A change in whether the screens should be lit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blanking {
    /// The timeout passed with no input: turn the connectors off.
    GoDark,
    /// Input resumed or an inhibitor started holding: light the connectors.
    ComeBack,
}

/// Whether an inhibitor's client is still alive.
///
/// A crashed client sends no destroy, and Smithay does not report it, so a dead
/// client's inhibitor would block blanking forever. The compositor implements
/// this with `WlSurface::is_alive`.
pub trait StillThere {
    fn still_there(&self) -> bool;
}

/// The idle timer and the inhibitors holding it off.
///
/// Exists only when the config sets a timeout. Without one (`IdleConfig`'s
/// `None`) the screens never blank.
pub struct Idle<S> {
    blank_after: Duration,
    /// The last input, or creation time if there has been none.
    stirred_at: Instant,
    dark: bool,
    /// Active inhibitors.
    ///
    /// A list, not a set: a surface can carry several inhibitors and a destroy
    /// names only the surface, so each destroy removes one entry.
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

    /// Records input. `Some` only when this lights a dark desktop.
    pub fn stirred(&mut self, now: Instant) -> Option<Blanking> {
        self.stirred_at = now;
        let was_dark = self.dark;
        self.dark = false;
        was_dark.then_some(Blanking::ComeBack)
    }

    /// Handles the timer firing. `Some` only when this darkens the desktop.
    ///
    /// It never relights: only [`Idle::stirred`] and the inhibitor methods do.
    pub fn elapsed(&mut self, now: Instant, on_the_desktop: &[S]) -> Option<Blanking> {
        if self.should_be_dark(now, on_the_desktop) {
            self.settle(now, on_the_desktop)
        } else {
            None
        }
    }

    /// Adds an inhibitor. `Some` only when this lights a dark desktop.
    pub fn inhibited_by(
        &mut self,
        inhibitor: S,
        now: Instant,
        on_the_desktop: &[S],
    ) -> Option<Blanking> {
        self.inhibitors.push(inhibitor);
        self.settle(now, on_the_desktop)
    }

    /// Removes one inhibitor on `inhibitor`'s surface. `Some` only when this
    /// darkens the desktop.
    ///
    /// An unknown inhibitor (taken while no timeout was set) changes nothing.
    pub fn uninhibited_by(
        &mut self,
        inhibitor: &S,
        now: Instant,
        on_the_desktop: &[S],
    ) -> Option<Blanking> {
        match self.inhibitors.iter().position(|held| held == inhibitor) {
            Some(one) => {
                self.inhibitors.remove(one);
                self.settle(now, on_the_desktop)
            }
            None => None,
        }
    }

    /// Removes inhibitors whose clients are gone.
    ///
    /// Called after every client dispatch, so it returns `None` when nothing
    /// was removed.
    pub fn the_dead_let_go(&mut self, now: Instant, on_the_desktop: &[S]) -> Option<Blanking> {
        let held = self.inhibitors.len();
        self.inhibitors.retain(StillThere::still_there);
        if self.inhibitors.len() == held {
            None
        } else {
            self.settle(now, on_the_desktop)
        }
    }

    /// Re-evaluates after windows were mapped or unmapped. `Some` only on an
    /// edge.
    ///
    /// A window mapping or closing can start or stop an inhibitor holding,
    /// with no inhibitor request. See `holds`.
    pub fn the_desktop_changed(&mut self, now: Instant, on_the_desktop: &[S]) -> Option<Blanking> {
        self.settle(now, on_the_desktop)
    }

    /// Moves the inhibitors from `previous` into this timer.
    ///
    /// Used when a config reload replaces the timer. Clients do not resend
    /// inhibitors, so dropping them would blank the screen mid-video.
    pub fn takes_over_from(mut self, previous: &mut Idle<S>) -> Idle<S> {
        self.inhibitors = std::mem::take(&mut previous.inhibitors);
        self
    }

    /// Whether the screens are off.
    ///
    /// Callers that configure connectors for other reasons (hotplug, reload)
    /// check this so the screens stay dark.
    pub fn dark(&self) -> bool {
        self.dark
    }

    /// The delay before the timer should fire again.
    ///
    /// When dark, or when inhibited past the deadline, this is a full timeout:
    /// only input or an inhibitor change can alter the state then. It is never
    /// zero, which would spin the event loop.
    pub fn next_check(&self, now: Instant) -> Duration {
        let until_the_deadline =
            (self.stirred_at + self.blank_after).saturating_duration_since(now);
        if self.dark || until_the_deadline.is_zero() {
            self.blank_after
        } else {
            until_the_deadline
        }
    }

    /// Updates the state and returns the edge, if any.
    fn settle(&mut self, now: Instant, on_the_desktop: &[S]) -> Option<Blanking> {
        let should_be_dark = self.should_be_dark(now, on_the_desktop);
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

    /// Whether the screens should be off.
    ///
    /// An inhibitor vetoes the result instead of resetting or pausing the
    /// timer. So an inhibitor added while dark relights at once, and removing
    /// the last one after the timeout darkens at once. See [`holds`].
    fn should_be_dark(&self, now: Instant, on_the_desktop: &[S]) -> bool {
        now.duration_since(self.stirred_at) >= self.blank_after
            && !self
                .inhibitors
                .iter()
                .any(|inhibitor| holds(inhibitor, on_the_desktop))
    }
}

/// Whether an inhibitor blocks blanking.
///
/// Its client must be alive ([`StillThere`]) and its surface must have a
/// window in `on_the_desktop`. The protocol leaves unmapped surfaces to the
/// compositor, and an invisible inhibitor would keep screens on with no
/// visible cause.
fn holds<S: StillThere + PartialEq>(inhibitor: &S, on_the_desktop: &[S]) -> bool {
    inhibitor.still_there() && on_the_desktop.contains(inhibitor)
}

/// Whether this request is user input that resets the idle timer.
///
/// The chrome forwards all input, so every user action arrives here. The match
/// is exhaustive so each new request gets an explicit decision.
///
/// `PointerLeave` does not count: a window moving under a still pointer sends
/// it too, and a real hand also sends motion. Requests the shell makes on its
/// own behalf do not count either, or a repainting clock would keep the
/// screens on.
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
        | ClientRequest::SetAppBounds { .. }
        | ClientRequest::CloseApp { .. }
        | ClientRequest::Spawn { .. }
        | ClientRequest::ChromeHello { .. }
        // Clients can copy without input, and a real Ctrl+C was already
        // counted as a `Key`. Clipboard history picks, like the other shell
        // actions below, come from clicks on the shell's own page, which do
        // not pass through here.
        | ClientRequest::ClipboardCopied { .. }
        | ClientRequest::CopyClipboardEntry { .. }
        | ClientRequest::ActivateTrayItem { .. }
        | ClientRequest::DismissNotifications { .. }
        | ClientRequest::InvokeNotificationAction { .. }
        | ClientRequest::AnswerPortalRequest { .. }
        // The lock chord landed on the shell, and locking must not light the
        // screens.
        | ClientRequest::Lock => false,
        // The lock screen's own field forwards no `Key`s, so an unlock attempt
        // is the only sign someone is typing. Lighting on any attempt lets the
        // user see a rejection.
        ClientRequest::Unlock { .. } => true,
        // A theme change is the shell redrawing itself.
        ClientRequest::TurnTheWindows { .. } | ClientRequest::ThemeCaptured { .. } => false,
    }
}

/// The connector list that turns every display off.
///
/// - Built from the engine's `displays`, not `scanout`, which omits monitors no
///   profile names; an omitted connector stays lit.
/// - Keeps the engine's origins, so nothing moves.
/// - Keeps each connector's transform and scale from `scanout`, so the page is
///   not laid out again on blank and wake.
/// - Must not be sent when empty: the engine reads an empty list as "light
///   what the hardware reports". See
///   [`Engine::configure_displays`](crate::engine::Engine::configure_displays).
///   `displays` is empty only in a nested run, whose screens belong to the
///   host.
pub fn darkened(displays: &[Display], scanout: &[Connector]) -> Vec<Connector> {
    displays
        .iter()
        .map(|display| {
            let drawn = scanout.iter().find(|connector| connector.id == display.id);
            Connector {
                id: display.id,
                enabled: false,
                origin: display.position,
                transform: drawn.map_or(Transform::Normal, |connector| connector.transform),
                scale: drawn.map_or(1.0, |connector| connector.scale),
                // The pointer cannot enter a dark screen.
                desk: None,
            }
        })
        .collect()
}

/// The idle message for the shell.
///
/// Takes the state, not a [`Blanking`] edge, so it also serves a page that
/// reloads while dark. See [`HostMessage::Idle`] for what a shell may do with
/// it.
pub fn announced(nobody_is_here: bool) -> HostMessage {
    HostMessage::Idle {
        idle: nobody_is_here,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    use domicile_protocol::{HostMessage, PortalAnswer, TrayAction};

    use super::{announced, darkened, somebody_is_here, Blanking, Idle, StillThere};
    use crate::engine::{Clipboard, Connector, Display};
    use crate::ClientRequest;
    use domicile_config::Transform;

    const AFTER: Duration = Duration::from_secs(600);

    /// A fake inhibitor: a surface and a flag for whether its client is alive.
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

    /// Inhibitors are equal when they name the same surface, since a destroy
    /// names only the surface.
    impl PartialEq for Inhibitor {
        fn eq(&self, other: &Inhibitor) -> bool {
            self.surface == other.surface
        }
    }

    /// A timer that blanks after [`AFTER`], starting at `start`.
    fn desk(start: Instant) -> Idle<Inhibitor> {
        Idle::after(Some(AFTER), start).expect("a timeout was stated")
    }

    /// A desktop with a window on `surface`.
    fn showing(surface: u32) -> [Inhibitor; 1] {
        [Inhibitor::on(surface)]
    }

    /// A desktop with no windows on it.
    const SHOWING_NOTHING: &[Inhibitor] = &[];

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
        assert_eq!(
            idle.elapsed(start + AFTER - Duration::from_millis(1), SHOWING_NOTHING),
            None
        );
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_nobody_touched_for_the_whole_timeout_goes_dark() {
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(
            idle.elapsed(start + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn a_desktop_that_is_already_dark_is_not_darkened_again() {
        // Each edge costs a modeset, so repeats must not be reported.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER, SHOWING_NOTHING);
        assert_eq!(idle.elapsed(start + AFTER * 2, SHOWING_NOTHING), None);
        assert!(idle.dark());
    }

    #[test]
    fn a_key_at_the_last_moment_puts_the_timeout_back() {
        let start = Instant::now();
        let mut idle = desk(start);
        let stirred = start + AFTER - Duration::from_millis(1);
        assert_eq!(idle.stirred(stirred), None);
        assert_eq!(
            idle.elapsed(start + AFTER, SHOWING_NOTHING),
            None,
            "the deadline moved with the key"
        );
        assert_eq!(
            idle.elapsed(stirred + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn the_next_input_lights_a_dark_desktop_back_up() {
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER, SHOWING_NOTHING);
        assert_eq!(idle.stirred(start + AFTER * 2), Some(Blanking::ComeBack));
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_somebody_is_already_at_is_not_relit_on_every_keystroke() {
        // Otherwise every key would cost a modeset.
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
        // Only input can relight a dark desktop, so the timer just stays
        // armed at one wake per timeout.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER, SHOWING_NOTHING);
        assert_eq!(idle.next_check(start + AFTER), AFTER);
    }

    #[test]
    fn a_film_playing_holds_a_desktop_nobody_is_touching_awake() {
        // Watching a video produces no input.
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(
            idle.inhibited_by(Inhibitor::on(1), start, &showing(1)),
            None,
            "a desk somebody is at is already lit"
        );
        assert_eq!(idle.elapsed(start + AFTER, &showing(1)), None);
        assert!(!idle.dark());
    }

    #[test]
    fn a_film_starting_on_a_dark_desk_brings_the_screens_back() {
        // A video started on a dark screen relights it without input.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER, &showing(1));
        assert_eq!(
            idle.inhibited_by(Inhibitor::on(1), start + AFTER, &showing(1)),
            Some(Blanking::ComeBack)
        );
        assert!(!idle.dark());
    }

    #[test]
    fn the_desk_goes_dark_when_the_film_ends_rather_than_waiting_for_a_hand() {
        // The desktop was idle throughout, so it darkens now, not a timeout
        // later.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start, &showing(1));
        idle.elapsed(start + AFTER, &showing(1));
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER * 2, &showing(1)),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn an_inhibitor_let_go_inside_the_timeout_leaves_the_clock_where_it_was() {
        // An inhibitor does not reset the timer, or a short sound would keep
        // the screens on for another full timeout.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start, &showing(1));
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER / 2, &showing(1)),
            None
        );
        assert_eq!(
            idle.elapsed(start + AFTER, &showing(1)),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn a_surface_carrying_two_inhibitors_is_let_go_of_twice() {
        // A player and its toolkit may each take one, and a destroy names only
        // the surface, so one destroy must remove only one.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start, &showing(1));
        idle.inhibited_by(film.clone(), start, &showing(1));
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER, &showing(1)),
            None,
            "the other one still holds"
        );
        assert_eq!(
            idle.uninhibited_by(&film, start + AFTER, &showing(1)),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn an_inhibitor_whose_client_died_holds_nothing() {
        // A dead client sends no destroy, so its inhibitor must stop counting
        // on its own.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start, &showing(1));
        film.the_client_died();
        assert_eq!(
            idle.elapsed(start + AFTER, &showing(1)),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn an_inhibitor_on_a_surface_this_desktop_shows_no_window_for_holds_nothing() {
        // An inhibitor on a surface with no window would keep the screens on
        // with no visible cause.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.inhibited_by(Inhibitor::on(1), start, SHOWING_NOTHING);
        assert_eq!(
            idle.elapsed(start + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn a_window_appearing_under_an_inhibitor_brings_a_dark_desk_back() {
        // An inhibitor taken before its window maps starts holding when the
        // window appears.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.inhibited_by(Inhibitor::on(1), start, SHOWING_NOTHING);
        idle.elapsed(start + AFTER, SHOWING_NOTHING);

        assert_eq!(
            idle.the_desktop_changed(start + AFTER, &showing(1)),
            Some(Blanking::ComeBack)
        );
        assert!(!idle.dark());
    }

    #[test]
    fn the_window_an_inhibitor_was_taken_on_closing_lets_the_screens_go() {
        // The client is alive and sent no destroy, but nothing is visible, so
        // the desktop darkens at once.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.inhibited_by(Inhibitor::on(1), start, &showing(1));
        idle.elapsed(start + AFTER, &showing(1));

        assert_eq!(
            idle.the_desktop_changed(start + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn the_desk_goes_dark_when_the_client_holding_it_awake_dies() {
        // The compositor checks after each client dispatch, so a crash darkens
        // the desktop without waiting for the timer.
        let start = Instant::now();
        let mut idle = desk(start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start, &showing(1));
        idle.elapsed(start + AFTER, &showing(1));
        film.the_client_died();
        assert_eq!(
            idle.the_dead_let_go(start + AFTER, &showing(1)),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn nothing_is_decided_by_an_inhibitor_this_desk_never_had() {
        // Only the timer blanks the screens. Neither a no-op dead-client sweep
        // nor destroying an unknown inhibitor may report an edge.
        let start = Instant::now();
        let mut idle = desk(start);

        assert_eq!(idle.the_dead_let_go(start + AFTER, SHOWING_NOTHING), None);
        assert_eq!(
            idle.uninhibited_by(&Inhibitor::on(1), start + AFTER, SHOWING_NOTHING),
            None
        );
        assert!(!idle.dark());
    }

    #[test]
    fn a_reloaded_clock_goes_on_holding_the_film_the_old_one_was() {
        // Clients do not resend inhibitors on a config reload.
        let start = Instant::now();
        let mut old = desk(start);
        old.inhibited_by(Inhibitor::on(1), start, &showing(1));

        let mut reloaded = desk(start).takes_over_from(&mut old);

        assert_eq!(reloaded.elapsed(start + AFTER, &showing(1)), None);
        assert!(!reloaded.dark());
    }

    #[test]
    fn a_desk_held_awake_past_its_deadline_is_not_asked_again_at_once() {
        // Zero would spin the event loop.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.inhibited_by(Inhibitor::on(1), start, &showing(1));
        assert_eq!(idle.next_check(start + AFTER * 2), AFTER);
    }

    #[test]
    fn a_dark_desktop_asks_for_every_connector_the_engine_reported_turned_off() {
        // Every connector must be listed: the engine reads an empty list as
        // "light what the hardware reports".
        assert_eq!(
            darkened(&[monitor(3, (0, 0)), monitor(7, (1920, 0))], &[]),
            vec![
                Connector {
                    id: 3,
                    enabled: false,
                    origin: (0, 0),
                    transform: Transform::Normal,
                    scale: 1.0,
                    desk: None,
                },
                Connector {
                    id: 7,
                    enabled: false,
                    origin: (1920, 0),
                    transform: Transform::Normal,
                    scale: 1.0,
                    desk: None,
                },
            ]
        );
    }

    #[test]
    fn a_dark_connector_keeps_the_turn_and_scale_its_window_is_drawn_at() {
        // Dropping them would lay the page out again on blank and on wake.
        let lit = Connector {
            id: 7,
            enabled: true,
            origin: (1920, 0),
            transform: Transform::Rotate270,
            scale: 1.2,
            desk: None,
        };
        assert_eq!(
            darkened(&[monitor(7, (1920, 0))], &[lit]),
            vec![Connector {
                enabled: false,
                ..lit
            }]
        );
    }

    #[test]
    fn a_desktop_with_no_monitors_read_has_nothing_to_turn_off() {
        // A nested run, where the host's compositor owns the screens.
        assert!(darkened(&[], &[]).is_empty());
    }

    #[test]
    fn the_shell_is_told_where_the_desk_stands_rather_than_which_way_it_went() {
        // Check both directions, since an inversion passes either check alone.
        assert_eq!(announced(true), HostMessage::Idle { idle: true });
        assert_eq!(announced(false), HostMessage::Idle { idle: false });
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
                "the page reporting where a window is",
                ClientRequest::SetAppBounds {
                    app_id: "app-1".into(),
                    bounds: domicile_scene::Bounds {
                        min: domicile_scene::Point::new(0.0, 0.0),
                        max: domicile_scene::Point::new(800.0, 600.0),
                    },
                },
            ),
            (
                "a window being closed",
                ClientRequest::CloseApp {
                    app_id: "app-1".into(),
                },
            ),
            (
                "a program being started",
                ClientRequest::Spawn {
                    command: vec!["foot".into()],
                },
            ),
            (
                "a page saying hello",
                ClientRequest::ChromeHello { served_by: None },
            ),
            (
                "a client putting something on the clipboard",
                ClientRequest::ClipboardCopied {
                    clipboard: Clipboard::Copy,
                    text: "what was copied".into(),
                },
            ),
            (
                "the shell putting a copy back on the clipboard",
                ClientRequest::CopyClipboardEntry { entry: 1 },
            ),
            (
                "the shell clicking a tray icon",
                ClientRequest::ActivateTrayItem {
                    id: ":1.9/StatusNotifierItem".into(),
                    action: TrayAction::Primary,
                },
            ),
            (
                "the shell clearing notifications",
                ClientRequest::DismissNotifications { ids: vec![7] },
            ),
            (
                "the shell pressing a notification",
                ClientRequest::InvokeNotificationAction {
                    id: 7,
                    action: "default".into(),
                },
            ),
            (
                "the shell answering a dialog",
                ClientRequest::AnswerPortalRequest {
                    id: 1,
                    answer: PortalAnswer::Canceled,
                },
            ),
            ("the shell locking the desk", ClientRequest::Lock),
        ] {
            assert!(
                !somebody_is_here(&request),
                "{what} would keep every desktop awake forever"
            );
        }
    }
}
