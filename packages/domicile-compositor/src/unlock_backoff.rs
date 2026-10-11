//! How long the lock refuses passphrases after repeated refused ones.
//!
//! The compositor enforces the wait, so a shell cannot guess faster by sending
//! `unlock` itself. See `docs/LOCK.md`.

use std::time::{Duration, Instant};

/// The refused passphrase, counted from 1, that starts the first wait.
///
/// One the verifier could not check counts too: some PAM stacks fail a wrong
/// passphrase with an error, and not counting those would allow unlimited
/// guesses.
const WAITS_FROM: u32 = 3;

/// The wait after refused passphrase [`WAITS_FROM`]. Each further one doubles it.
const FIRST: Duration = Duration::from_secs(5);

/// The longest wait.
const LONGEST: Duration = Duration::from_secs(5 * 60);

/// Refused passphrases since the desktop last opened, and when the next may be
/// checked.
#[derive(Debug, Default)]
pub struct Backoff {
    failures: u32,
    not_before: Option<Instant>,
}

impl Backoff {
    /// Refused passphrases since the desktop last opened.
    pub fn failures(&self) -> u32 {
        self.failures
    }

    /// How long from `now` until a passphrase may be checked. Zero when one
    /// may be checked now.
    pub fn wait(&self, now: Instant) -> Duration {
        self.not_before.map_or(Duration::ZERO, |not_before| {
            not_before.saturating_duration_since(now)
        })
    }

    /// Counts a passphrase refused at `now`, wrong or unverifiable, and
    /// returns the wait it starts.
    pub fn failed(&mut self, now: Instant) -> Duration {
        self.failures += 1;
        let wait = after(self.failures);
        self.not_before = Some(now + wait);
        wait
    }

    /// Forgets every refused passphrase: the desktop opened.
    pub fn opened(&mut self) {
        *self = Backoff::default();
    }
}

/// The wait after `failures` refused passphrases in a row.
fn after(failures: u32) -> Duration {
    match failures.checked_sub(WAITS_FROM) {
        None => Duration::ZERO,
        Some(past) => FIRST
            .checked_mul(2u32.saturating_pow(past))
            .map_or(LONGEST, |wait| wait.min(LONGEST)),
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::Backoff;

    #[test]
    fn a_few_wrong_passphrases_cost_nothing_and_then_each_doubles_the_wait() {
        // A typo or two must not lock someone out.
        let now = Instant::now();
        let mut backoff = Backoff::default();

        let waits: Vec<u64> = (0..6).map(|_| backoff.failed(now).as_secs()).collect();

        assert_eq!(waits, [0, 0, 5, 10, 20, 40]);
        assert_eq!(backoff.failures(), 6);
    }

    #[test]
    fn the_wait_stops_growing_at_five_minutes() {
        // A doubling wait would otherwise lock someone out for days.
        let now = Instant::now();
        let mut backoff = Backoff::default();

        let last = (0..40).map(|_| backoff.failed(now)).last();

        assert_eq!(last, Some(Duration::from_secs(300)));
    }

    #[test]
    fn the_wait_counts_down_from_the_refusal() {
        let refused = Instant::now();
        let mut backoff = Backoff::default();
        for _ in 0..3 {
            backoff.failed(refused);
        }

        assert_eq!(backoff.wait(refused), Duration::from_secs(5));
        assert_eq!(
            backoff.wait(refused + Duration::from_secs(2)),
            Duration::from_secs(3)
        );
        assert_eq!(
            backoff.wait(refused + Duration::from_secs(6)),
            Duration::ZERO
        );
    }

    #[test]
    fn opening_the_desk_forgets_every_wrong_passphrase() {
        // The next lock starts afresh, so the next typo costs nothing.
        let now = Instant::now();
        let mut backoff = Backoff::default();
        for _ in 0..4 {
            backoff.failed(now);
        }

        backoff.opened();

        assert_eq!(backoff.failures(), 0);
        assert_eq!(backoff.wait(now), Duration::ZERO);
    }
}
