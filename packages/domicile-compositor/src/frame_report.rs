//! The compositor's frame report: timings the Wayland thread records and the
//! writer thread logs as one `frames` line every few seconds.
//!
//! How to read it: `docs/COMPOSITOR-DEBUGGING.md`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tracing::debug;

use crate::chrome_hub::ChromeHub;
use crate::timing_window::TimingWindow;

/// How often the writer thread reports frame timings.
pub const REPORT_EVERY: Duration = Duration::from_secs(5);

/// Print one line, if the window that just closed saw anything.
pub fn report(window: &mut FrameWindow, hub: &Arc<ChromeHub>) {
    let Some(report) = window.due(hub) else {
        return;
    };
    debug!(
        composited = report.composited,
        fps = report.fps,
        commit_ms = report.commit_ms,
        composite_ms = report.composite_ms,
        composite_worst_ms = report.composite_worst_ms,
        submit_ms = report.submit_ms,
        submit_worst_ms = report.submit_worst_ms,
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
    /// Drawing time, up to but not including the submit. Excludes the
    /// client-buffer import, which is on the commit path.
    composite: TimingWindow,
    /// The submit alone. See `docs/COMPOSITOR-DEBUGGING.md` for reading it with
    /// `composite`.
    submit: TimingWindow,
    /// Frames composited in this window.
    composited: usize,
}

/// When the writer thread last reported.
#[derive(Default)]
pub struct FrameWindow {
    since: Option<Instant>,
}

/// One window's worth of numbers, rounded for reading.
struct FrameReport {
    /// Frames drawn into the window.
    composited: usize,
    fps: u32,
    commit_ms: u32,
    idle_ms: u32,
    response_ms: u32,
    response_worst_ms: u32,
    /// Drawing time, excluding the submit. See `docs/COMPOSITOR-DEBUGGING.md`.
    composite_ms: u32,
    composite_worst_ms: u32,
    /// The submit, which on a nested window blocks for a frame callback.
    submit_ms: u32,
    submit_worst_ms: u32,
}

impl FrameWindow {
    fn due(&mut self, hub: &ChromeHub) -> Option<FrameReport> {
        let since = *self.since.get_or_insert_with(Instant::now);
        let elapsed = since.elapsed();
        if elapsed < REPORT_EVERY {
            None
        } else {
            let mut timings = hub.timings.lock().unwrap();
            // Stay quiet when nothing was composited, so an idle desktop does
            // not fill the log.
            let composited = std::mem::take(&mut timings.composited);
            let report = (composited > 0).then(|| {
                // A stage that recorded nothing reports zero.
                let (commit, idle, response, composite) = (
                    timings.commit.take().unwrap_or_default(),
                    timings.idle.take().unwrap_or_default(),
                    timings.response.take().unwrap_or_default(),
                    timings.composite.take().unwrap_or_default(),
                );
                let submit = timings.submit.take().unwrap_or_default();
                FrameReport {
                    composited,
                    fps: (composited as f64 / elapsed.as_secs_f64()).round() as u32,
                    commit_ms: commit.average.as_millis() as u32,
                    idle_ms: idle.average.as_millis() as u32,
                    response_ms: response.average.as_millis() as u32,
                    response_worst_ms: response.worst.as_millis() as u32,
                    composite_ms: composite.average.as_millis() as u32,
                    composite_worst_ms: composite.worst.as_millis() as u32,
                    submit_ms: submit.average.as_millis() as u32,
                    submit_worst_ms: submit.worst.as_millis() as u32,
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
