//! Taking the last of a burst, rather than acting on every event in it.
//!
//! One save of a config file is several filesystem events, and the ones in the
//! middle are of a file that is halfway written. A truncated config still
//! *parses* — it just says less — so acting on each event in turn means acting
//! on a desktop the user never described, then correcting it a moment later.
//!
//! Here rather than inline on the watcher thread so it can be tested: the
//! interesting behaviour is entirely about timing between two channel ends,
//! which is a `Receiver` and two `Duration`s and nothing else.

use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

/// The last value of the burst `first` opened.
///
/// Waits `settle` for another value, taking each one it gets, and stops when
/// that quiet passes — or when `burst` has elapsed since the first, whichever
/// comes first.
///
/// **Both bounds, and the second is not decoration.** Waiting only for quiet
/// restarts the budget on every value, so a sender that never goes quiet for
/// `settle` is never answered at all: the result is not delivered late, it is
/// not delivered. A config file whose *directory* is written to often — which
/// is the ordinary case, since the watch is on the directory so that an atomic
/// rename is caught — is exactly such a sender.
pub fn last_of_burst<T>(rx: &Receiver<T>, first: T, settle: Duration, burst: Duration) -> T {
    let deadline = Instant::now() + burst;
    let mut latest = first;
    // Never longer than what is left of the burst, so the wait cannot outlast
    // the deadline it is bounded by. Once that is zero `recv_timeout` returns
    // at once — either empty-handed, which ends the loop, or with one more
    // value, which the check below then ends on.
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

    // Generous against the sleeps below rather than tuned to them: these are
    // wall-clock tests, and a runner that stalls a thread for one settle window
    // would otherwise report a burst that ended early as a bug in the code.
    // Every margin here is at least four times the gap it has to beat.
    const SETTLE: Duration = Duration::from_millis(100);
    const BURST: Duration = Duration::from_millis(800);

    #[test]
    fn a_sender_that_has_gone_away_ends_the_burst_at_once() {
        // The disconnected arm, which is not the same as the quiet one below:
        // this returns as soon as the channel says there will be no more,
        // without waiting out `settle`. Named for that rather than for being
        // one event, which was the old name and described the other test.
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
        // The save: several writes close together, and only the final state is
        // the file the user meant.
        let (tx, rx) = channel();
        thread::spawn(move || {
            for value in 2..=4 {
                // Sent before the sleep, not after: a thread that is spawned
                // and then sleeps has to be scheduled *and* wait before its
                // first value, and a stall over one settle window there ends
                // the burst at `1` — a flake in the test, reported as the code
                // coalescing nothing.
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
        // The regression. Bounded by quiet alone, this never returns: each
        // value restarts the wait, so a directory written to faster than
        // `settle` defers the answer for as long as the writing goes on — and
        // the reload is not late, it never happens.
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
        // Two saves are two reloads, not one: the second is a separate edit and
        // the desktop between them was one the user asked for.
        let (tx, rx) = channel();
        thread::spawn(move || {
            thread::sleep(SETTLE * 4);
            let _ = tx.send(9);
        });
        assert_eq!(last_of_burst(&rx, 1, SETTLE, BURST), 1);
    }
}
