//! Whether the screens are asleep because somebody asked, as
//! `domicile sleep-displays` does. See `docs/IDLE.md#sleeping-on-demand`.

use std::time::{Duration, Instant};

/// How long input after sleeping is ignored.
///
/// Whoever asked is still letting go: of the chord a keybinding ran it from,
/// or of a terminal's Enter. That release must not light the screens again.
pub const GRACE: Duration = Duration::from_secs(1);

/// Whether the screens sleep, and since when.
#[derive(Debug, Default)]
pub struct DisplaySleep {
    since: Option<Instant>,
}

impl DisplaySleep {
    /// Whether the screens are asleep.
    pub fn asleep(&self) -> bool {
        self.since.is_some()
    }

    /// Put the screens to sleep at `now`. Returns whether they were awake.
    /// Asking again restarts the [`GRACE`].
    pub fn sleep(&mut self, now: Instant) -> bool {
        self.since.replace(now).is_none()
    }

    /// Wake the screens. Returns whether they were asleep.
    pub fn wake(&mut self) -> bool {
        self.since.take().is_some()
    }

    /// Input arrived at `now`. Returns whether it woke the screens: it does
    /// once the [`GRACE`] is over.
    pub fn stirred(&mut self, now: Instant) -> bool {
        match self.since {
            Some(since) if now.duration_since(since) >= GRACE => self.wake(),
            Some(_) | None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{DisplaySleep, GRACE};

    #[test]
    fn a_desktop_starts_awake() {
        assert!(!DisplaySleep::default().asleep());
    }

    #[test]
    fn sleeping_turns_the_screens_off_once() {
        let mut sleep = DisplaySleep::default();
        let now = Instant::now();
        assert!(sleep.sleep(now));
        assert!(sleep.asleep());
        assert!(!sleep.sleep(now + GRACE * 2));
    }

    #[test]
    fn input_wakes_the_screens() {
        let mut sleep = DisplaySleep::default();
        let now = Instant::now();
        sleep.sleep(now);
        assert!(sleep.stirred(now + GRACE));
        assert!(!sleep.asleep());
    }

    #[test]
    fn input_right_after_sleeping_does_not_wake_the_screens() {
        // Letting go of the key that asked, or of a terminal's Enter.
        let mut sleep = DisplaySleep::default();
        let now = Instant::now();
        sleep.sleep(now);
        assert!(!sleep.stirred(now + GRACE - Duration::from_millis(1)));
        assert!(sleep.asleep());
    }

    #[test]
    fn asking_again_restarts_the_grace() {
        let mut sleep = DisplaySleep::default();
        let now = Instant::now();
        sleep.sleep(now);
        sleep.sleep(now + GRACE);
        assert!(!sleep.stirred(now + GRACE * 3 / 2));
    }

    #[test]
    fn input_while_awake_changes_nothing() {
        assert!(!DisplaySleep::default().stirred(Instant::now()));
    }

    #[test]
    fn waking_lights_the_screens_at_once() {
        let mut sleep = DisplaySleep::default();
        let now = Instant::now();
        sleep.sleep(now);
        assert!(sleep.wake());
        assert!(!sleep.asleep());
        assert!(!sleep.wake());
    }
}
