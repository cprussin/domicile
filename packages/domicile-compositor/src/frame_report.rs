//! The compositor's frame report: timings the Wayland thread records and the
//! writer thread logs as one `frames` line every few seconds.
//!
//! How to read it: `docs/COMPOSITOR-DEBUGGING.md`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tracing::debug;

use crate::chrome_hub::ChromeHub;
use crate::timing_window::TimingWindow;

/// How often the writer thread reports frame timings.
pub const REPORT_EVERY: Duration = Duration::from_secs(5);

/// Print one line, if the window that just closed saw anything.
pub fn report(window: &mut FrameWindow, hub: &Arc<ChromeHub>) {
    let Some(report) = window.due(&hub.timings) else {
        return;
    };
    debug!(
        commits = report.commits,
        commit_ms = report.commit_ms,
        idle_ms = report.idle_ms,
        response_ms = report.response_ms,
        response_worst_ms = report.response_worst_ms,
        chromes = hub.chromes.lock().unwrap().len(),
        "frames"
    );
}

/// Frame timings recorded on the Wayland thread, reported by the writer thread.
///
/// Shows whether a low frame rate comes from the compositor working or from
/// waiting on clients.
#[derive(Default)]
pub struct FrameTimings {
    /// Time handling one commit end to end, on the Wayland thread.
    pub commit: TimingWindow,
    /// Time between one commit finishing and the next arriving. Large means we
    /// are waiting on the client or the throttle.
    pub idle: TimingWindow,
    /// Time from injecting a keystroke into a client to its next commit.
    ///
    /// Subtract this from the chrome's `rt_ms` to get the time a keystroke
    /// takes to reach the client. Measured from the oldest unanswered
    /// keystroke, as the chrome does, so the two compare.
    pub response: TimingWindow,
}

/// When the writer thread last reported.
#[derive(Default)]
pub struct FrameWindow {
    since: Option<Instant>,
}

/// One window's worth of numbers, rounded for reading.
struct FrameReport {
    /// Buffer commits handled in the window.
    commits: usize,
    commit_ms: u32,
    idle_ms: u32,
    response_ms: u32,
    response_worst_ms: u32,
}

impl FrameWindow {
    fn due(&mut self, timings: &Mutex<FrameTimings>) -> Option<FrameReport> {
        let since = *self.since.get_or_insert_with(Instant::now);
        let elapsed = since.elapsed();
        if elapsed < REPORT_EVERY {
            None
        } else {
            let mut timings = timings.lock().unwrap();
            // Stay quiet when nothing was committed, so an idle desktop does
            // not fill the log.
            let report = timings.commit.take().map(|commit| {
                // A stage that recorded nothing reports zero.
                let (idle, response) = (
                    timings.idle.take().unwrap_or_default(),
                    timings.response.take().unwrap_or_default(),
                );
                FrameReport {
                    commits: commit.count,
                    commit_ms: commit.average.as_millis() as u32,
                    idle_ms: idle.average.as_millis() as u32,
                    response_ms: response.average.as_millis() as u32,
                    response_worst_ms: response.worst.as_millis() as u32,
                }
            });
            drop(timings);
            *self = FrameWindow {
                since: Some(Instant::now()),
            };
            report
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::{FrameTimings, FrameWindow, REPORT_EVERY};

    fn closed_window() -> FrameWindow {
        FrameWindow {
            since: Some(Instant::now() - REPORT_EVERY),
        }
    }

    #[test]
    fn a_window_with_commits_reports_them() {
        let timings = Mutex::new(FrameTimings::default());
        timings
            .lock()
            .unwrap()
            .commit
            .record(Duration::from_millis(4));
        let report = closed_window().due(&timings);
        assert_eq!(report.map(|report| report.commits), Some(1));
    }

    #[test]
    fn a_window_without_commits_stays_quiet() {
        let timings = Mutex::new(FrameTimings::default());
        assert!(closed_window().due(&timings).is_none());
    }
}
