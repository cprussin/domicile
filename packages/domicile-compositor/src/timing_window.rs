//! Accumulates durations and reports them on an interval.
//!
//! Both threads of the frame path use it, so slow work can be told apart from
//! waiting. Callers pass the durations in, so the arithmetic is testable
//! without a clock.

use std::time::Duration;

/// The summary of one reporting window.
///
/// The default (all zeros) is what a report shows for a path that did not run.
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

    /// Returns the summary and starts a fresh window.
    ///
    /// `None` when nothing was recorded, so an idle desktop does not fill the
    /// log.
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
        // The worst case shows stutters that the average hides.
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
