//! Decides when the desktop is idle: when its screens should blank, and when
//! it should lock.
//!
//! This module is pure logic over the current time and the surfaces with
//! windows, so it can be tested without a clock, a display or Wayland.
//! `blanking.rs` applies the result. See `docs/IDLE.md`.
//!
//! - Methods report only edges, since each change costs a modeset. Ask
//!   [`Idle::dark`] for the state.
//! - With `idle.warn_before_seconds`, a [`Blanking::Warn`] edge comes that
//!   long before [`Blanking::GoDark`], and input or an inhibitor in between
//!   calls it off. The compositor passes it to the shell through
//!   `domicile_host::idle_warnings`.
//! - A `zwp_idle_inhibit_manager_v1` inhibitor vetoes blanking while its client
//!   is alive and its surface has a window. See [`holds`].
//! - An idle inhibitor from the Inhibit portal vetoes blanking while held. See
//!   [`Idle::held_by_portals`].
//! - The shell gets the state, not the edge, since a reloaded page missed
//!   earlier edges. See [`announced`].
//! - `idle.lock_after_seconds` runs a second clock from the same input and
//!   inhibitors. [`Idle::lock_due`] reports its edge, and the compositor
//!   engages [`crate::lock`]. Blanking itself does not block input.

use std::time::{Duration, Instant};

use domicile_protocol::HostMessage;

use crate::client_requests::ClientRequest;
use crate::engine::{Connector, Display};
use crate::lock::LOCK_SCREEN_DRAWS_WITHIN;
use domicile_config::{IdleConfig, Transform};

/// A change in whether the screens should be lit, or are about to go dark.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blanking {
    /// The warning time before the timeout passed with no input: tell the
    /// shell. See [`Idle::blanks_at`].
    Warn,
    /// Input or an inhibitor during a warning: the screens stay lit.
    CallOff,
    /// The timeout passed with no input: turn the connectors off.
    GoDark,
    /// Input resumed or an inhibitor started holding: light the connectors.
    ComeBack,
}

/// Where the desktop stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Lit,
    Warned,
    Dark,
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
/// Exists only when the config sets a blank or lock timeout. Without one the
/// screens never blank and the desktop locks only when its shell asks.
pub struct Idle<S> {
    /// `None` for screens that never blank.
    blank_after: Option<Duration>,
    /// How long before the timeout the shell is warned, if at all. Less than
    /// `blank_after`, which `IdleConfig` checks.
    warn_before: Option<Duration>,
    /// `None` for a desktop that locks only when its shell asks.
    lock_after: Option<Duration>,
    /// When [`Idle::lock_due`] fired, if it has since the last input.
    locked_at: Option<Instant>,
    /// The last input, or creation time if there has been none.
    stirred_at: Instant,
    stage: Stage,
    /// Active inhibitors.
    ///
    /// A list, not a set: a surface can carry several inhibitors and a destroy
    /// names only the surface, so each destroy removes one entry.
    inhibitors: Vec<S>,
    /// Whether an application holds an idle inhibitor through the portal.
    held_by_portals: bool,
}

impl<S: StillThere + PartialEq> Idle<S> {
    pub fn after(idle: &IdleConfig, now: Instant) -> Option<Idle<S>> {
        (idle.blank_after().is_some() || idle.lock_after().is_some()).then(|| Idle {
            blank_after: idle.blank_after(),
            warn_before: idle.warn_before(),
            lock_after: idle.lock_after(),
            locked_at: None,
            stirred_at: now,
            stage: Stage::Lit,
            inhibitors: Vec::new(),
            held_by_portals: false,
        })
    }

    /// Records input. `Some` only when this lights a dark desktop or calls a
    /// warning off.
    pub fn stirred(&mut self, now: Instant) -> Option<Blanking> {
        self.stirred_at = now;
        self.locked_at = None;
        let was = self.stage;
        self.stage = Stage::Lit;
        match was {
            Stage::Lit => None,
            Stage::Warned => Some(Blanking::CallOff),
            Stage::Dark => Some(Blanking::ComeBack),
        }
    }

    /// Handles the timer firing. `Some` only when this warns or darkens the
    /// desktop.
    ///
    /// It never relights: only [`Idle::stirred`] and the inhibitor methods do.
    pub fn elapsed(&mut self, now: Instant, on_the_desktop: &[S]) -> Option<Blanking> {
        if self.stage == Stage::Dark {
            None
        } else {
            self.settle(now, on_the_desktop)
        }
    }

    /// Whether the desktop should lock now: `true` once for each spell
    /// without input that outlasts `idle.lock_after_seconds`.
    ///
    /// Inhibitors hold it off as they hold off blanking, and releasing the
    /// last one after the timeout locks at once. Called after every client
    /// dispatch, so it lists the desktop only once the timeout has passed.
    pub fn lock_due(&mut self, now: Instant, on_the_desktop: impl FnOnce() -> Vec<S>) -> bool {
        let due = self.locked_at.is_none()
            && self
                .lock_after
                .is_some_and(|lock_after| now.duration_since(self.stirred_at) >= lock_after)
            && !self.held(&on_the_desktop());
        if due {
            self.locked_at = Some(now);
        }
        due
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

    /// Whether portal idle inhibitors are held. `Some` only on an edge.
    ///
    /// The portal names no surface, so these hold with no window showing.
    pub fn held_by_portals(
        &mut self,
        held: bool,
        now: Instant,
        on_the_desktop: &[S],
    ) -> Option<Blanking> {
        self.held_by_portals = held;
        self.settle(now, on_the_desktop)
    }

    /// Removes inhibitors whose clients are gone.
    ///
    /// Called after every client dispatch, so it returns `None` when nothing
    /// was removed, and lists the desktop only when something was.
    pub fn the_dead_let_go(
        &mut self,
        now: Instant,
        on_the_desktop: impl FnOnce() -> Vec<S>,
    ) -> Option<Blanking> {
        let held = self.inhibitors.len();
        self.inhibitors.retain(StillThere::still_there);
        if self.inhibitors.len() == held {
            None
        } else {
            self.settle(now, &on_the_desktop())
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
        self.held_by_portals = previous.held_by_portals;
        self
    }

    /// Whether the screens ever blank. A desktop that only locks says nothing
    /// to the shell about idleness.
    pub fn blanks(&self) -> bool {
        self.blank_after.is_some()
    }

    /// Whether the screens are off.
    ///
    /// Callers that configure connectors for other reasons (hotplug, reload)
    /// check this so the screens stay dark.
    pub fn dark(&self) -> bool {
        self.stage == Stage::Dark
    }

    /// When the screens go dark, while the shell is being warned of it.
    pub fn blanks_at(&self) -> Option<Instant> {
        self.darkens_at().filter(|_| self.stage == Stage::Warned)
    }

    /// The delay before the timer should fire again.
    ///
    /// The soonest of the warning, the blanking and the lock still to come, so
    /// an inhibitor released between them still acts on time. When none is to
    /// come, it is the time from input to its first check: input resets the
    /// clock without re-arming the timer, so the timer must come round before
    /// that input's first deadline. It is never zero, which would spin the
    /// event loop.
    pub fn next_check(&self, now: Instant) -> Duration {
        let warns_after = self
            .blank_after
            .map(|blank_after| blank_after - self.warn_before.unwrap_or_default());
        let first_check = [warns_after, self.lock_after]
            .into_iter()
            .flatten()
            .min()
            .expect("a clock has a blank or a lock timeout");
        let warns_at = warns_after.map(|after| self.stirred_at + after);
        let blanking_to_come = match self.stage {
            Stage::Lit => [warns_at, self.darkens_at()],
            Stage::Warned => [None, self.darkens_at()],
            Stage::Dark => [None, None],
        };
        let locking_to_come = self
            .lock_after
            .filter(|_| self.locked_at.is_none())
            .map(|after| self.stirred_at + after);
        blanking_to_come
            .into_iter()
            .chain([locking_to_come])
            .flatten()
            .filter(|at| *at > now)
            .min()
            .map_or(first_check, |at| at - now)
    }

    /// Updates the state and returns the edge, if any.
    fn settle(&mut self, now: Instant, on_the_desktop: &[S]) -> Option<Blanking> {
        let was = self.stage;
        self.stage = self.due(now, on_the_desktop);
        match (was, self.stage) {
            (Stage::Lit, Stage::Lit)
            | (Stage::Warned, Stage::Warned)
            | (Stage::Dark, Stage::Dark) => None,
            (Stage::Lit, Stage::Warned) => Some(Blanking::Warn),
            (Stage::Warned, Stage::Lit) => Some(Blanking::CallOff),
            (Stage::Lit | Stage::Warned, Stage::Dark) => Some(Blanking::GoDark),
            (Stage::Dark, Stage::Lit) => Some(Blanking::ComeBack),
            (Stage::Dark, Stage::Warned) => {
                unreachable!("only input relights a dark desktop's clock, and it lights it")
            }
        }
    }

    /// Where the desktop should stand.
    ///
    /// An inhibitor vetoes the result instead of resetting or pausing the
    /// timer. So an inhibitor added while dark relights at once, and removing
    /// the last one after the timeout darkens at once, with no warning. See
    /// [`holds`].
    fn due(&self, now: Instant, on_the_desktop: &[S]) -> Stage {
        let still = now.duration_since(self.stirred_at);
        match self.blank_after {
            None => Stage::Lit,
            Some(_) if self.held(on_the_desktop) => Stage::Lit,
            Some(_) if self.darkens_at().is_some_and(|at| now >= at) => Stage::Dark,
            Some(blank_after)
                if self
                    .warn_before
                    .is_some_and(|warn_before| still >= blank_after - warn_before) =>
            {
                Stage::Warned
            }
            Some(_) => Stage::Lit,
        }
    }

    /// When the screens go dark if nothing stirs or holds them, or `None` for
    /// screens that never blank.
    ///
    /// No sooner than [`LOCK_SCREEN_DRAWS_WITHIN`] after the lock, so the shell
    /// has drawn its lock screen. A monitor can show the last frame it drew
    /// when it lights again.
    fn darkens_at(&self) -> Option<Instant> {
        self.blank_after.map(|blank_after| {
            let timeout = self.stirred_at + blank_after;
            self.locked_at.map_or(timeout, |locked_at| {
                timeout.max(locked_at + LOCK_SCREEN_DRAWS_WITHIN)
            })
        })
    }

    /// Whether an inhibitor holds the desktop awake.
    fn held(&self, on_the_desktop: &[S]) -> bool {
        self.held_by_portals
            || self
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
/// it too, and a real hand also sends motion. Nor does motion that did not
/// move: see [`ClientRequest::PointerMotion`]'s `moved`. Requests the shell makes on its
/// own behalf do not count either, or a repainting clock would keep the
/// screens on.
pub fn somebody_is_here(request: &ClientRequest) -> bool {
    match request {
        ClientRequest::Key { .. }
        | ClientRequest::Activity
        | ClientRequest::PointerButton { .. }
        | ClientRequest::PointerAxis { .. } => true,
        ClientRequest::PointerLeave
        | ClientRequest::KeyboardFocus { .. }
        | ClientRequest::SetOutputScale { .. }
        | ClientRequest::SetOutputSize { .. }
        | ClientRequest::SetAppBounds { .. }
        | ClientRequest::SetWindowStates { .. }
        | ClientRequest::SetWhitePoint { .. }
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
        | ClientRequest::ReplyToNotification { .. }
        | ClientRequest::AnswerPortalRequest { .. }
        // The browser sends `Activity` for the same input.
        | ClientRequest::DeskPointer { .. }
        // A page's pointer changing under a still hand, or the same input.
        | ClientRequest::DeskCursor { .. }
        // An application, not a person.
        | ClientRequest::HeldAwakeByThePortal { .. }
        // The lock chord landed on the shell, and locking must not light the
        // screens.
        | ClientRequest::Lock => false,
        // The browser restates a still pointer after a window changes, and
        // turning the screens off changes them.
        ClientRequest::PointerMotion { moved, .. } => *moved,
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
    use crate::client_requests::ClientRequest;
    use crate::engine::{Clipboard, Connector, Display};
    use crate::lock::LOCK_SCREEN_DRAWS_WITHIN;
    use domicile_config::{IdleConfig, Transform};

    const AFTER: Duration = Duration::from_secs(600);
    const WARNING: Duration = Duration::from_secs(30);

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
        Idle::after(
            &IdleConfig {
                blank_after_seconds: Some(AFTER.as_secs()),
                warn_before_seconds: None,
                lock_after_seconds: None,
            },
            start,
        )
        .expect("a timeout was stated")
    }

    /// A timer like [`desk`]'s that warns [`WARNING`] before it blanks.
    fn warning_desk(start: Instant) -> Idle<Inhibitor> {
        Idle::after(
            &IdleConfig {
                blank_after_seconds: Some(AFTER.as_secs()),
                warn_before_seconds: Some(WARNING.as_secs()),
                lock_after_seconds: None,
            },
            start,
        )
        .expect("a timeout was stated")
    }

    /// A timer that locks after `lock_after` and blanks after `blank_after`,
    /// if at all, starting at `start`.
    fn locking_desk(
        blank_after: Option<Duration>,
        lock_after: Duration,
        start: Instant,
    ) -> Idle<Inhibitor> {
        Idle::after(
            &IdleConfig {
                blank_after_seconds: blank_after.map(|after| after.as_secs()),
                warn_before_seconds: None,
                lock_after_seconds: Some(lock_after.as_secs()),
            },
            start,
        )
        .expect("a lock timeout was stated")
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
            connector: String::new(),
            position,
            size: (1920, 1080),
            physical_mm: (600, 340),
            refresh_mhz: 60_000,
        }
    }

    #[test]
    fn a_desktop_that_states_no_timeout_has_nothing_to_watch() {
        assert!(Idle::<Inhibitor>::after(&IdleConfig::default(), Instant::now()).is_none());
    }

    #[test]
    fn a_desktop_that_only_locks_has_a_clock_and_never_goes_dark() {
        let start = Instant::now();
        let mut idle = locking_desk(None, AFTER, start);
        assert_eq!(idle.next_check(start), AFTER);
        assert!(!idle.lock_due(start + AFTER / 2, || SHOWING_NOTHING.to_vec()));
        assert!(idle.lock_due(start + AFTER, || SHOWING_NOTHING.to_vec()));
        assert_eq!(idle.elapsed(start + AFTER * 2, SHOWING_NOTHING), None);
        assert!(!idle.dark());
    }

    #[test]
    fn a_desktop_that_only_blanks_never_locks_on_its_own() {
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER, SHOWING_NOTHING);
        assert!(!idle.lock_due(start + AFTER * 10, || SHOWING_NOTHING.to_vec()));
    }

    #[test]
    fn the_lock_comes_once_for_each_spell_without_input() {
        // Shutting a locked desk again would redraw the lock screen.
        let start = Instant::now();
        let mut idle = locking_desk(None, AFTER, start);
        assert!(idle.lock_due(start + AFTER, || SHOWING_NOTHING.to_vec()));
        assert!(!idle.lock_due(start + AFTER * 2, || SHOWING_NOTHING.to_vec()));

        let back = start + AFTER * 3;
        idle.stirred(back);
        assert!(!idle.lock_due(back + AFTER / 2, || SHOWING_NOTHING.to_vec()));
        assert!(idle.lock_due(back + AFTER, || SHOWING_NOTHING.to_vec()));
    }

    #[test]
    fn a_lock_sooner_than_blanking_locks_a_lit_desktop_then_blanks_it() {
        let start = Instant::now();
        let lock_after = AFTER / 2;
        let mut idle = locking_desk(Some(AFTER), lock_after, start);
        assert_eq!(idle.next_check(start), lock_after);

        assert_eq!(idle.elapsed(start + lock_after, SHOWING_NOTHING), None);
        assert!(idle.lock_due(start + lock_after, || SHOWING_NOTHING.to_vec()));
        assert_eq!(idle.next_check(start + lock_after), AFTER - lock_after);
        assert_eq!(
            idle.elapsed(start + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn a_lock_at_the_blanking_timeout_is_drawn_before_the_screens_go_dark() {
        // A monitor can show the last frame it drew when it lights again, so
        // that frame must be the lock screen.
        let start = Instant::now();
        let mut idle = locking_desk(Some(AFTER), AFTER, start);
        assert!(idle.lock_due(start + AFTER, || SHOWING_NOTHING.to_vec()));
        assert_eq!(idle.elapsed(start + AFTER, SHOWING_NOTHING), None);
        assert_eq!(idle.next_check(start + AFTER), LOCK_SCREEN_DRAWS_WITHIN);
        assert_eq!(
            idle.elapsed(start + AFTER + LOCK_SCREEN_DRAWS_WITHIN, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
    }

    #[test]
    fn the_warning_counts_down_to_the_wait_for_the_lock_screen() {
        let start = Instant::now();
        let mut idle = Idle::after(
            &IdleConfig {
                blank_after_seconds: Some(AFTER.as_secs()),
                warn_before_seconds: Some(WARNING.as_secs()),
                lock_after_seconds: Some(AFTER.as_secs()),
            },
            start,
        )
        .expect("a timeout was stated");
        idle.elapsed(start + AFTER - WARNING, SHOWING_NOTHING);
        assert!(idle.lock_due(start + AFTER, || SHOWING_NOTHING.to_vec()));
        assert_eq!(
            idle.blanks_at(),
            Some(start + AFTER + LOCK_SCREEN_DRAWS_WITHIN)
        );
    }

    #[test]
    fn a_lock_later_than_blanking_locks_a_dark_desktop() {
        let start = Instant::now();
        let lock_after = AFTER * 2;
        let mut idle = locking_desk(Some(AFTER), lock_after, start);
        assert_eq!(
            idle.elapsed(start + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
        assert!(!idle.lock_due(start + AFTER, || SHOWING_NOTHING.to_vec()));
        assert_eq!(idle.next_check(start + AFTER), lock_after - AFTER);
        assert!(idle.lock_due(start + lock_after, || SHOWING_NOTHING.to_vec()));
    }

    #[test]
    fn a_film_holds_the_lock_off_and_its_end_locks_at_once() {
        // The same veto as for blanking: nobody touching a desk playing a
        // video is still watching it.
        let start = Instant::now();
        let mut idle = locking_desk(None, AFTER, start);
        let film = Inhibitor::on(1);
        idle.inhibited_by(film.clone(), start, &showing(1));
        assert!(!idle.lock_due(start + AFTER, || showing(1).to_vec()));

        idle.uninhibited_by(&film, start + AFTER * 2, &showing(1));
        assert!(idle.lock_due(start + AFTER * 2, || showing(1).to_vec()));
    }

    #[test]
    fn a_desktop_that_warns_says_so_before_it_goes_dark() {
        let start = Instant::now();
        let mut idle = warning_desk(start);
        let warned = start + AFTER - WARNING;
        assert_eq!(
            idle.elapsed(warned - Duration::from_millis(1), SHOWING_NOTHING),
            None
        );
        assert_eq!(idle.elapsed(warned, SHOWING_NOTHING), Some(Blanking::Warn));
        assert_eq!(idle.blanks_at(), Some(start + AFTER));
        assert!(!idle.dark());

        assert_eq!(
            idle.elapsed(start + AFTER, SHOWING_NOTHING),
            Some(Blanking::GoDark)
        );
        assert_eq!(idle.blanks_at(), None, "the warning ends with the dark");
    }

    #[test]
    fn a_desktop_with_no_warning_never_warns() {
        let start = Instant::now();
        let mut idle = desk(start);
        assert_eq!(idle.elapsed(start + AFTER - WARNING, SHOWING_NOTHING), None);
        assert_eq!(idle.blanks_at(), None);
    }

    #[test]
    fn input_during_the_warning_calls_the_blanking_off() {
        let start = Instant::now();
        let mut idle = warning_desk(start);
        let warned = start + AFTER - WARNING;
        idle.elapsed(warned, SHOWING_NOTHING);

        assert_eq!(idle.stirred(warned), Some(Blanking::CallOff));
        assert_eq!(idle.blanks_at(), None);
        assert_eq!(
            idle.stirred(warned),
            None,
            "only the first key calls it off"
        );
    }

    #[test]
    fn a_film_starting_during_the_warning_calls_the_blanking_off() {
        let start = Instant::now();
        let mut idle = warning_desk(start);
        let warned = start + AFTER - WARNING;
        idle.elapsed(warned, &showing(1));

        assert_eq!(
            idle.inhibited_by(Inhibitor::on(1), warned, &showing(1)),
            Some(Blanking::CallOff)
        );
        assert_eq!(idle.blanks_at(), None);
    }

    #[test]
    fn a_desktop_that_warns_is_asked_again_when_the_warning_is_due_and_then_at_the_timeout() {
        let start = Instant::now();
        let mut idle = warning_desk(start);
        assert_eq!(idle.next_check(start), AFTER - WARNING);
        let warned = start + AFTER - WARNING;
        idle.elapsed(warned, SHOWING_NOTHING);
        assert_eq!(idle.next_check(warned), WARNING);
    }

    #[test]
    fn a_film_ending_during_the_warning_still_blanks_at_the_timeout() {
        let start = Instant::now();
        let mut idle = warning_desk(start);
        let warned = start + AFTER - WARNING;
        idle.inhibited_by(Inhibitor::on(1), start, &showing(1));
        assert_eq!(idle.elapsed(warned, &showing(1)), None);
        assert_eq!(
            idle.next_check(warned),
            WARNING,
            "asked again at the timeout, in case the film ends first"
        );

        let ended = warned + Duration::from_secs(10);
        assert_eq!(
            idle.uninhibited_by(&Inhibitor::on(1), ended, &showing(1)),
            Some(Blanking::Warn)
        );
        assert_eq!(idle.next_check(ended), WARNING - Duration::from_secs(10));
    }

    #[test]
    fn a_desktop_held_past_its_timeout_is_asked_again_in_time_to_warn() {
        // Input resets the clock without re-arming the timer, so the timer
        // must come round before the warning that input would be due.
        let start = Instant::now();
        let mut idle = warning_desk(start);
        idle.inhibited_by(Inhibitor::on(1), start, &showing(1));
        assert_eq!(idle.elapsed(start + AFTER, &showing(1)), None);
        assert_eq!(idle.next_check(start + AFTER), AFTER - WARNING);
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
    fn a_portal_inhibitor_holds_with_no_window_and_survives_a_reload() {
        // The portal names no surface, so nothing on the desk need show.
        let start = Instant::now();
        let mut idle = desk(start);
        idle.elapsed(start + AFTER, SHOWING_NOTHING);

        assert_eq!(
            idle.held_by_portals(true, start + AFTER, SHOWING_NOTHING),
            Some(Blanking::ComeBack)
        );
        let mut reloaded = desk(start).takes_over_from(&mut idle);
        assert_eq!(reloaded.elapsed(start + AFTER, SHOWING_NOTHING), None);
        assert_eq!(
            reloaded.held_by_portals(false, start + AFTER, SHOWING_NOTHING),
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
            idle.the_dead_let_go(start + AFTER, || showing(1).to_vec()),
            Some(Blanking::GoDark)
        );
        assert!(idle.dark());
    }

    #[test]
    fn nothing_is_decided_by_an_inhibitor_this_desk_never_had() {
        // Only the timer blanks the screens. Neither a no-op dead-client sweep
        // nor destroying an unknown inhibitor may report an edge. The sweep
        // runs after every client dispatch, so it lists the desktop only when
        // an inhibitor went.
        let start = Instant::now();
        let mut idle = desk(start);

        assert_eq!(
            idle.the_dead_let_go(start + AFTER, || unreachable!("nobody died")),
            None
        );
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
                    moved: true,
                },
            ),
            (
                "a click",
                ClientRequest::PointerButton {
                    button: 272,
                    pressed: true,
                },
            ),
            ("a key typed into a browser window", ClientRequest::Activity),
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
                "the pointer's place on the desk, which comes with activity",
                ClientRequest::DeskPointer {
                    at: Some((4.0, 8.0)),
                    windows: Vec::new(),
                },
            ),
            (
                "the pointer changing shape over a page",
                ClientRequest::DeskCursor { image: None },
            ),
            (
                "the browser restating a still pointer after a window changed",
                ClientRequest::PointerMotion {
                    app_id: "app-1".into(),
                    x: 4.0,
                    y: 8.0,
                    moved: false,
                },
            ),
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
                "the page setting a window's states",
                ClientRequest::SetWindowStates {
                    app_id: "app-1".into(),
                    states: vec![domicile_protocol::WindowState::TiledLeft],
                },
            ),
            (
                "the page warming the monitors",
                ClientRequest::SetWhitePoint {
                    white_point: domicile_host::white_point::white_point(3400),
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
                    contents: domicile_host::clipboard::Contents::text("what was copied"),
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
                "the shell replying to a notification",
                ClientRequest::ReplyToNotification {
                    id: 7,
                    text: "On my way".into(),
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
