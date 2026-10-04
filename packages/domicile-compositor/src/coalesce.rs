//! Coalesces a burst of events into its last value.
//!
//! One save of a config file produces several filesystem events, and the
//! middle ones see a half-written file. A truncated config still parses, so
//! acting on each event would briefly apply the wrong config.

use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

/// Returns the last value of the burst that `first` started.
///
/// Stops after `settle` passes with no new value, or after `burst` since the
/// start, whichever comes first. The `burst` cap matters: the watch is on the
/// config's directory, which may be written to more often than `settle`, and
/// without the cap the function would never return.
pub fn last_of_burst<T>(rx: &Receiver<T>, first: T, settle: Duration, burst: Duration) -> T {
    let deadline = Instant::now() + burst;
    let mut latest = first;
    // Cap each wait at the time left before the deadline.
    while let Ok(next) =
        rx.recv_timeout(settle.min(deadline.saturating_duration_since(Instant::now())))
    {
        latest = next;
        if Instant::now() >= deadline {
            break;
        }
    }
    latest
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::channel;
    use std::thread;
    use std::time::Duration;

    use super::last_of_burst;

    // Wall-clock tests: every margin is at least four times the gap it must
    // beat, so a stalled runner does not cause a false failure.
    const SETTLE: Duration = Duration::from_millis(100);
    const BURST: Duration = Duration::from_millis(800);

    #[test]
    fn a_sender_that_has_gone_away_ends_the_burst_at_once() {
        // A disconnected channel returns at once, without waiting `settle`.
        let (tx, rx) = channel::<u8>();
        drop(tx);
        let started = std::time::Instant::now();
        assert_eq!(last_of_burst(&rx, 1, SETTLE, BURST), 1);
        assert!(
            started.elapsed() < SETTLE,
            "waited out the settle window for a sender that had gone"
        );
    }

    #[test]
    fn a_burst_comes_back_as_the_last_of_it() {
        // Several writes close together: only the last one counts.
        let (tx, rx) = channel();
        thread::spawn(move || {
            for value in 2..=4 {
                // Send before sleeping, so a slow thread start cannot end
                // the burst before the first value arrives.
                if tx.send(value).is_err() {
                    return;
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        assert_eq!(last_of_burst(&rx, 1, SETTLE, BURST), 4);
    }

    #[test]
    fn a_sender_that_never_goes_quiet_is_still_answered() {
        // Without the `burst` cap, a sender faster than `settle` would keep
        // restarting the wait and the function would never return.
        let (tx, rx) = channel();
        let sending = thread::spawn(move || {
            // Comfortably faster than `SETTLE`, for longer than `BURST`.
            for value in 0..600 {
                if tx.send(value).is_err() {
                    return;
                }
                thread::sleep(Duration::from_millis(5));
            }
        });
        let started = std::time::Instant::now();
        let got = last_of_burst(&rx, -1, SETTLE, BURST);
        let took = started.elapsed();
        assert!(
            took < BURST * 3,
            "gave up after {took:?}, which is not bounded by the burst"
        );
        assert!(got >= 0, "answered with the value it started on: {got}");
        drop(rx);
        let _ = sending.join();
    }

    #[test]
    fn a_gap_longer_than_the_quiet_ends_the_burst() {
        // Two separate saves are two reloads.
        let (tx, rx) = channel();
        thread::spawn(move || {
            thread::sleep(SETTLE * 4);
            let _ = tx.send(9);
        });
        assert_eq!(last_of_burst(&rx, 1, SETTLE, BURST), 1);
    }
}
