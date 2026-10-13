//! Temporary, part of the spike. The keystroke-to-pixel run that
//! `DOMICILE_SPIKE_LATENCY` starts. Measurements are `crate::latency`'s.

use std::time::{Duration, Instant};

use smithay::utils::SERIAL_COUNTER;
use tracing::warn;

use crate::latency;
use crate::latency::{Latency, Step as LatencyStep};
use crate::spike_probes::parse_point;
use crate::DomicileCompositor;

/// The display refresh rate the latency run assumes, in mHz.
///
/// An assumption: viz's real interval is not reachable from here. `wl_output`'s
/// rate is not used, since it may be
/// [`UNKNOWN_REFRESH_MHZ`](crate::screens::UNKNOWN_REFRESH_MHZ).
const SPIKE_REFRESH_MHZ: i32 = 60_000;

/// Temporary, part of the spike. The key the latency run presses.
///
/// Enter, since a line-buffered program in a terminal reliably redraws on it.
const LATENCY_KEY: u32 = 28;

/// Temporary, part of the spike. Where the latency run watches for the client's
/// answer, from `DOMICILE_SPIKE_LATENCY`.
///
/// - `center`: the middle of the browser window, over the client on a
///   one-`<app>` page, so guards need no coordinates. `guard-client-window.sh`
///   does the same.
/// - `x,y`: a point, when the center is not over the client.
///
/// Unset means no run. The run presses keys into whatever has focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LatencyPoint {
    Center,
    At(i32, i32),
}

impl DomicileCompositor {
    /// Record a commit for the keystroke-to-pixel run, if one is going.
    ///
    /// Called on the commit path because a round ends with the client's
    /// answering commit, which only arrives here. See `latency.rs` for the
    /// measurements. Off unless `DOMICILE_SPIKE_LATENCY` is set.
    pub fn drive_latency(&mut self, app_id: &str, committed: Instant, held: bool) {
        let (Some(_), Some(budget)) = (spike_latency_point(), spike_latency_budget()) else {
            return;
        };
        // Start only once the engine has taken a frame. Before that the probe
        // refuses instantly, and the floor would spend its budget in one
        // callback and end as `ProbeWentDark`.
        if !held {
            return;
        }
        // Measure only the first app to commit, so a second window does not add
        // commits to rounds its keys did not cause.
        if self.latency_app.get_or_insert_with(|| app_id.to_string()) != app_id {
            return;
        }
        // Taken out and put back; a dropped run restarts from an empty floor.
        let frame = self.display_interval();
        let mut run = self
            .latency
            .take()
            .unwrap_or_else(|| Latency::new(budget, frame));
        // Use the caller's timestamp from before `publish_frame`, so the import
        // and submit count in `commit_to_pixel`, not the client's time.
        run.committed(committed);
        self.latency = Some(run);
        // Sampling happens in `step_the_latency`, not here.
    }

    /// Run one step of the latency run, then return to the event loop.
    ///
    /// Must not loop. Everything runs on one calloop thread, so a polling loop
    /// here would block engine releases and frame callbacks, and a client that
    /// needs a second commit could never answer. The round would be wrongly
    /// blamed on the client. A timer in `run` calls this again.
    ///
    /// Each `Sample` step blocks this thread for one `CopyOutputRequest`
    /// readback. It cannot deadlock: `SamplePixel` waits while the engine's
    /// thread runs a nested loop.
    ///
    /// The probe point must not repaint by itself (e.g. a blinking cursor), or
    /// the floor never settles and the run ends `NeverSettled`.
    ///
    /// Returns whether the run wants another step immediately.
    pub fn step_the_latency(&mut self) -> bool {
        let (Some(point), Some(_)) = (spike_latency_point(), spike_latency_budget()) else {
            return false;
        };
        let Some(mut run) = self.latency.take() else {
            return false;
        };
        let app_id = self.latency_app.clone();
        let wants_more = match run.next(Instant::now()) {
            LatencyStep::Sample => {
                match self.engine.as_mut().and_then(|engine| match point {
                    LatencyPoint::Center => engine.spike_window_center(),
                    LatencyPoint::At(x, y) => engine.spike_pixel(x, y),
                }) {
                    Some(argb) => run.sampled(Instant::now(), argb),
                    None => run.unreadable(),
                }
                true
            }
            LatencyStep::Press => {
                // Focus every round, in case something else moved the keyboard.
                match app_id
                    .as_deref()
                    .and_then(|app_id| self.surface_for(app_id))
                {
                    Some(surface) => {
                        let keyboard = self.seat.get_keyboard().unwrap();
                        let serial = SERIAL_COUNTER.next_serial();
                        keyboard.set_focus(self, Some(surface), serial);
                        self.inject_key(LATENCY_KEY, true);
                        self.inject_key(LATENCY_KEY, false);
                    }
                    // `next` already started this round, and only a commit
                    // answering the key can end it. Give the round up instead
                    // of waiting forever with no report.
                    None => {
                        warn!(
                            ?app_id,
                            "the latency run has no surface to press a key into; \
                             giving the round up"
                        );
                        run.press_went_nowhere();
                    }
                }
                // Return so the client can redraw.
                false
            }
            LatencyStep::Wait => false,
        };
        self.latency = Some(run);
        self.report_latency();
        wants_more
    }

    /// The display frame interval the latency run assumes.
    ///
    /// Assumed 60Hz; viz's real interval is not reachable from here. The
    /// measured floor is reported alongside, for calibration.
    fn display_interval(&self) -> Duration {
        Duration::from_secs_f64(1000.0 / f64::from(SPIKE_REFRESH_MHZ))
    }

    /// Log the run's results once, in the format the guard reads.
    fn report_latency(&mut self) {
        if self.latency_reported {
            return;
        }
        let Some(report) = self.latency.as_ref().and_then(Latency::report) else {
            return;
        };
        self.latency_reported = true;
        let interval = self.display_interval();
        // Text comes from `Spread::line`, tested there because the guard greps
        // it.
        let say = |what: &str, spread: Option<&latency::Spread>| match spread {
            Some(spread) => tracing::info!(
                target: "domicile::engine::spike",
                "{}", spread.line(what, interval)
            ),
            // Log missing data explicitly, so it cannot be mistaken for a fast
            // result.
            None => tracing::info!(
                target: "domicile::engine::spike",
                "latency {what}: nothing measured"
            ),
        };
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: the display frame is {:.2} ms",
            interval.as_secs_f64() * 1000.0
        );
        say("floor", report.floor.as_ref());
        say("key to commit", report.key_to_commit.as_ref());
        say("commit to pixel", report.commit_to_pixel.as_ref());
        say("key to pixel", report.key_to_pixel.as_ref());
        // Separate from how the run ended: a run that never settled has no
        // rounds, and "0 abandoned" alone would look clean.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) abandoned by the client",
            report.abandoned
        );
        // Rounds discarded because the probe pixel changed before the client
        // answered: an older frame reached the screen. Always logged, since the
        // median excludes them.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose pixel moved before the client answered",
            report.moved_before_commit
        );
        // Rounds where the commit came too long after the key to be its answer.
        // Always logged.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose commit came too late to be the key's answer",
            report.answered_too_late
        );
        // Commits too soon after the key to answer it (a frame already in
        // flight). The round keeps waiting, so these count commits, not rounds.
        // Always logged.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} commit(s) passed over for coming too soon to be the key's answer",
            report.answered_too_soon
        );
        // Rounds the client answered with more than one frame. `commit to
        // pixel` is timed from the first, so a high count means some of the
        // client's own redraw is counted as ours. Always logged.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) where the client drew again while polling",
            report.redrew_while_polling
        );
        // Keys we failed to deliver. Kept separate from client failures so the
        // fault is attributed correctly.
        tracing::info!(
            target: "domicile::engine::spike",
            "latency: {} round(s) whose key was never delivered",
            report.undelivered
        );
        match report.ended {
            latency::Ended::Completed => tracing::info!(
                target: "domicile::engine::spike",
                "latency: the run completed"
            ),
            latency::Ended::NeverSettled => tracing::info!(
                target: "domicile::engine::spike",
                "latency: the run gave up — the screen at the probe point never held \
                 still, so the probe could not be priced against it"
            ),
            latency::Ended::ProbeWentDark => tracing::info!(
                target: "domicile::engine::spike",
                "latency: the run gave up — the probe stopped answering"
            ),
        }
    }
}

pub fn spike_latency_point() -> Option<LatencyPoint> {
    static POINT: std::sync::OnceLock<Option<LatencyPoint>> = std::sync::OnceLock::new();
    *POINT.get_or_init(|| {
        let raw = std::env::var("DOMICILE_SPIKE_LATENCY").ok()?;
        let raw = raw.trim();
        if raw.eq_ignore_ascii_case("center") {
            return Some(LatencyPoint::Center);
        }
        match parse_point(raw) {
            Some((x, y)) => Some(LatencyPoint::At(x, y)),
            None => {
                warn!(
                    raw,
                    "DOMICILE_SPIKE_LATENCY: not `center` or an `x,y` point; no latency run"
                );
                None
            }
        }
    })
}

/// Temporary, part of the spike. The latency run's budget, from
/// `DOMICILE_SPIKE_LATENCY_BUDGET` as `rounds,floor_samples,max_polls`.
///
/// Unset uses the real measurement's defaults. Negative controls set it small,
/// since each abandoned round spends its whole poll budget. Clients stay served
/// throughout; see `step_the_latency`.
///
/// An unusable value logs a warning and disables the run instead of clamping;
/// see `Budget::parse`.
fn spike_latency_budget() -> Option<latency::Budget> {
    static BUDGET: std::sync::OnceLock<Option<latency::Budget>> = std::sync::OnceLock::new();
    *BUDGET.get_or_init(|| {
        let Ok(raw) = std::env::var("DOMICILE_SPIKE_LATENCY_BUDGET") else {
            return Some(latency::Budget::default());
        };
        let parsed = latency::Budget::parse(raw.trim());
        if parsed.is_none() {
            warn!(
                raw,
                "DOMICILE_SPIKE_LATENCY_BUDGET: not `rounds,floor,polls`, or nothing \
                 a run could measure with; no latency run"
            );
        }
        parsed
    })
}
