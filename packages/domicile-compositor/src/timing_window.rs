//! Accumulating a run of durations and reporting them on an interval.
//!
//! The frame path spans two threads, and telling "we are slow" from "we are
//! waiting" needs both halves timed. This is the accumulate-and-report shape
//! both use; the clock is a parameter so the arithmetic can be tested without
//! one.

use std::time::Duration;

/// What one reporting window saw.
///
/// The default is the empty window's reading — nothing recorded, no time spent
/// — which is what a report shows for a path that did not run in that window.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Timings {
    pub count: usize,
    pub average: Duration,
    pub worst: Duration,
}

/// Durations recorded since the last report.
#[derive(Debug, Default)]
pub struct TimingWindow {
    count: usize,
    total: Duration,
    worst: Duration,
}

impl TimingWindow {
    pub fn record(&mut self, elapsed: Duration) {
        self.count += 1;
        self.total += elapsed;
        self.worst = self.worst.max(elapsed);
    }

    /// Take what was recorded and start a fresh window.
    ///
    /// `None` when nothing was recorded: a window with nothing in it has
    /// nothing to say, and an idle desktop should not fill the log.
    pub fn take(&mut self) -> Option<Timings> {
        let taken = (self.count > 0).then(|| Timings {
            count: self.count,
            average: self.total / self.count as u32,
            worst: self.worst,
        });
        *self = TimingWindow::default();
        taken
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{TimingWindow, Timings};

    fn ms(count: u64) -> Duration {
        Duration::from_millis(count)
    }

    #[test]
    fn an_empty_window_has_nothing_to_report() {
        assert_eq!(TimingWindow::default().take(), None);
    }

    #[test]
    fn reports_the_average_and_the_worst_case() {
        // The worst case is reported alongside the average because a path that
        // is usually fast and occasionally terrible is what a stutter is, and
        // an average alone hides exactly that.
        let mut window = TimingWindow::default();
        window.record(ms(2));
        window.record(ms(10));
        window.record(ms(6));
        assert_eq!(
            window.take(),
            Some(Timings {
                count: 3,
                average: ms(6),
                worst: ms(10),
            })
        );
    }

    #[test]
    fn taking_starts_a_fresh_window() {
        let mut window = TimingWindow::default();
        window.record(ms(100));
        window.take();
        window.record(ms(1));
        assert_eq!(
            window.take(),
            Some(Timings {
                count: 1,
                average: ms(1),
                worst: ms(1),
            })
        );
    }
}
