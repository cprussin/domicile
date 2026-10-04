//! Measures keystroke-to-pixel latency for a client's window.
//!
//! The compositor is the only process that both injects the key into the
//! client's seat and can ask the engine what the display compositor drew.
//!
//! A round has two parts:
//!
//! ```text
//!   press ──────────► the client commits ──────────► the pixel is drawn
//!         key→commit                   commit→pixel
//!         (mostly the client's         (ours: import, composite,
//!          think-and-redraw)            submit, viz aggregation)
//! ```
//!
//! They are reported separately so a slow client cannot hide a regression in
//! the compositor. Each probe costs a display frame, so the run first measures
//! the probe alone (the floor) and reports it beside the results, as
//! `css_parity.cc` does.
//!
//! Rules that tie a round to its keystroke:
//!
//! - The probe point is watched while waiting for the commit. A change there
//!   came from an earlier frame, so the round is dropped
//!   ([`Report::moved_before_commit`]).
//! - A commit later than [`MAX_WAIT_FRAMES`] frames after the key is dropped
//!   ([`Report::answered_too_late`]). One sooner than
//!   `frame / `[`MIN_WAIT_FRAME_SHARE`] is skipped and the round keeps waiting
//!   ([`Report::answered_too_soon`]). These bounds narrow, but do not remove,
//!   the chance of crediting an unrelated redraw.
//!
//! This module is pure state driven by [`Latency::next`] and the event methods,
//! so it can be tested without a GPU. See
//! `docs/architecture/ENGINE-FORK-MEASUREMENTS.md#keystroke-to-pixel`.

use std::time::{Duration, Instant};

/// What the driver should do next.
///
/// The driver answers [`Step::Sample`] with [`Latency::sampled`] or
/// [`Latency::unreadable`], and [`Step::Press`] by pressing a key. Nothing
/// advances on its own, so a stalled driver stalls the run.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// Nothing this tick.
    Wait,
    /// Give the client the keyboard and press a key into it.
    ///
    /// The round's clock has already started, so the driver's focus change and
    /// key injection count toward `key_to_commit`.
    Press,
    /// Ask the engine what color is at the probe point.
    Sample,
}

/// The min, median and max of a set of samples.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spread {
    pub count: usize,
    pub min: Duration,
    pub median: Duration,
    pub max: Duration,
}

impl Spread {
    /// `None` for no samples, so an empty run cannot read as a fast one.
    fn of(samples: &[Duration]) -> Option<Self> {
        if samples.is_empty() {
            return None;
        }
        let mut sorted = samples.to_vec();
        sorted.sort_unstable();
        Some(Self {
            count: sorted.len(),
            min: sorted[0],
            // The upper middle for an even count, matching `css_parity.cc`
            // (`sorted[size / 2]`) so the two medians compare.
            median: sorted[sorted.len() / 2],
            max: sorted[sorted.len() - 1],
        })
    }

    /// The median in display frames.
    ///
    /// `None` when `interval` is zero, which means no refresh rate was
    /// reported.
    pub fn median_frames(&self, interval: Duration) -> Option<f64> {
        (!interval.is_zero()).then(|| self.median.as_secs_f64() / interval.as_secs_f64())
    }

    /// The log line for this spread.
    ///
    /// `lib-latency.sh` parses this format, and
    /// `scripts/test-latency-report.sh` tests it from that side.
    pub fn line(&self, what: &str, interval: Duration) -> String {
        let frames = self
            .median_frames(interval)
            .map_or_else(|| "?".to_owned(), |frames| format!("{frames:.1}"));
        format!(
            "latency {what}: min {:.2}, median {:.2}, max {:.2} ms over {} (median {frames} frames)",
            self.min.as_secs_f64() * 1000.0,
            self.median.as_secs_f64() * 1000.0,
            self.max.as_secs_f64() * 1000.0,
            self.count,
        )
    }
}

/// The results of a finished run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// A probe round trip with nothing changing. Every other number includes
    /// at least this.
    pub floor: Option<Spread>,
    /// Press to the client's answering commit.
    ///
    /// Mostly client time, but also includes the compositor's key delivery
    /// and up to one probe round trip in progress when the commit arrives.
    pub key_to_commit: Option<Spread>,
    /// That commit to the new color reaching the display compositor's output.
    /// This is the number the compositor is responsible for.
    ///
    /// Rounded up to a multiple of the floor, since the probe is only asked
    /// after the commit and each ask costs a frame. A regression smaller than
    /// one probe round trip does not show here.
    pub commit_to_pixel: Option<Spread>,
    /// The sum of the two. Includes the probe's round trip, which a user does
    /// not wait for.
    pub key_to_pixel: Option<Spread>,
    /// Rounds where the color never changed within the poll budget: the client
    /// did not answer. This is what the negative control asserts.
    pub abandoned: usize,
    /// Rounds dropped because the probe point changed before the client
    /// committed.
    ///
    /// The change came from a frame committed before the key. Counted
    /// separately from `abandoned` because the client did not fail to answer,
    /// and a high count means the probe point is not still.
    pub moved_before_commit: usize,
    /// Rounds dropped because the commit came more than [`MAX_WAIT_FRAMES`]
    /// after the key: a self-redrawing client's unrelated commit.
    pub answered_too_late: usize,
    /// Commits skipped because they came less than
    /// `frame / `[`MIN_WAIT_FRAME_SHARE`] after the key.
    ///
    /// The round keeps waiting, since the key's answer is still coming. Ending
    /// the round would press the next key early; a client that draws both keys
    /// in one frame shows no change and the next round is abandoned.
    pub answered_too_soon: usize,
    /// Rounds whose key had no surface to go to.
    ///
    /// A compositor failure, not the client's, so not counted in `abandoned`.
    pub undelivered: usize,
    /// Rounds where the client committed again while the run was polling.
    ///
    /// Not a fault. It shows whether the client answered with one frame or
    /// several (for example, a toolkit that renders on `wl_surface.frame`).
    /// The run must not block the compositor's thread while polling, or these
    /// commits cannot arrive (see `step_the_latency`).
    ///
    /// For these rounds `commit_to_pixel` is timed from the first commit, so it
    /// includes some client time and overstates the compositor's cost. Timing
    /// from the last commit would understate it, and there is no way to tell
    /// which commit produced the pixel, so the count is reported instead.
    pub redrew_while_polling: usize,
    /// Why the run stopped.
    ///
    /// Separate from `abandoned`: these are probe or screen failures, not the
    /// client's.
    pub ended: Ended,
}

/// How a run finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// Every round ran.
    Completed,
    /// The screen never held still long enough to measure the floor, such as
    /// a blinking cursor over the probe point or a page that never settles.
    NeverSettled,
    /// The probe stopped answering, or never started.
    ProbeWentDark,
}

/// Where a run is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Sampling an unchanging screen to measure the probe's cost.
    ///
    /// `holding` is the color every sample must match. The first sample sets
    /// it and is not timed. A change restarts the floor, so a completed floor
    /// is a run of consecutive matching answers. That also waits out a page
    /// that is still painting and gives the first round a stable color.
    Floor {
        taken: usize,
        since: Option<Instant>,
        holding: Option<u32>,
        /// Every answer this floor has been given, restarts included.
        ///
        /// Bounds the floor, since the driver blocks the Wayland thread on each
        /// ask. A screen that never holds still ends as
        /// [`Ended::NeverSettled`].
        asked: usize,
        /// Refusals in a row, reset by any answer.
        ///
        /// Kept apart from `asked` so the end reason is accurate: a probe is
        /// dark when it refuses repeatedly, and a screen never settles when
        /// the whole budget passes without holding still.
        refused: usize,
    },
    /// Between rounds; the next step is a key press.
    Ready,
    /// A key was pressed. Waiting for the client to commit while watching the
    /// probe point: a change now came from a frame before the key.
    Pressed { at: Instant, before: u32 },
    /// The client committed; polling for the color to reach the screen.
    Polling {
        keyed: Instant,
        committed: Instant,
        before: u32,
        polls: u32,
    },
    /// Finished.
    Done(Ended),
}

/// Rounds per run, and samples for the floor.
///
/// 60 each, matching `css_parity.cc`, so the medians cover the same run size.
const ROUNDS: usize = 60;
const FLOOR_SAMPLES: usize = 60;

/// How many answers the floor asks for before giving up on ever settling.
///
/// Leaves room for restarts (a page's first paint causes one) while bounding
/// how long the driver blocks.
const MAX_FLOOR_ASKS: usize = 400;

/// How many refusals in a row mean the probe is not coming back.
///
/// Small, because the only recoverable cause (the window not composited yet)
/// clears within a frame or two. Other causes refuse every time.
const MAX_REFUSALS_RUNNING: usize = 8;

/// How many display frames after the key a commit may arrive and still count
/// as the answer to it.
///
/// A self-redrawing client commits for its own reasons. Without this bound, a
/// waiting round would take such a commit as its answer, and every number
/// would look valid.
///
/// This bound does not fully separate real answers from strays. Commits it
/// accepted in six `Engine` runs, in display frames:
///
/// ```text
///   a client that answers keys, 180 rounds over three jobs
///     0.96 .. 2.69      (15.93 .. 44.76 ms, medians 1.98 .. 2.00)
///   the control's client, which answers none
///     0.05, 0.92, 0.97, 2.48, 7.31   (0.82, 15.38, 16.16, 41.38, 121.95 ms)
/// ```
///
/// Strays at 0.92 to 2.48 frames overlap real answers, so the negative
/// control is still statistical (see `guard-latency.sh`). Six frames
/// (100 ms) is 2.2 times the worst real round and rejects the 7.31-frame
/// stray.
const MAX_WAIT_FRAMES: u32 = 6;

/// A commit sooner than `frame / MIN_WAIT_FRAME_SHARE` after the key is not
/// its answer.
///
/// The clock starts before key delivery, so a real answer includes dispatch,
/// the client waking, a repaint and a commit. The control produced a stray at
/// 0.82 ms. One eighth of a 16.67 ms frame is 2.08 ms; the fastest real
/// answer measured is 15.93 ms, 7.6 times that. Measured in frames so the
/// bound follows the refresh rate.
const MIN_WAIT_FRAME_SHARE: u32 = 8;

/// How many probe answers a round waits through before giving up on it.
///
/// A round normally finishes in one or two polls. This bound stops a client
/// that has stopped drawing from hanging the guard.
const MAX_POLLS: u32 = 200;

/// Limits on what a run may spend.
///
/// Each field bounds how long the Wayland thread blocks. A struct, since five
/// same-typed arguments are easy to swap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    /// Rounds to measure.
    pub rounds: usize,
    /// Timed probe answers for the floor.
    pub floor_samples: usize,
    /// Answers the floor may spend before giving up on the screen holding
    /// still.
    pub max_floor_asks: usize,
    /// Refusals in a row before giving up on the probe.
    pub max_refusals_running: usize,
    /// Answers one round waits through before giving up on the client.
    pub max_polls: u32,
}

impl Budget {
    /// Parses `rounds,floor_samples,max_polls`.
    ///
    /// The other two fields are derived so a short run keeps its hang
    /// protection: `max_floor_asks` scales with the floor, and
    /// `max_refusals_running` stays below it so the two end reasons stay
    /// distinct.
    ///
    /// Returns `None` for a budget [`Latency::new`] would reject, instead of
    /// silently substituting defaults.
    pub fn parse(raw: &str) -> Option<Self> {
        let mut parts = raw.split(',');
        let mut number = || parts.next()?.trim().parse::<usize>().ok();
        let (rounds, floor_samples, max_polls) = (number()?, number()?, number()?);
        if parts.next().is_some() {
            return None;
        }
        // Room for several floor restarts, so a short run that never settles
        // ends quickly. Clamped between 24 and the default. The refusal cap
        // below is derived from this.
        let max_floor_asks = floor_samples.saturating_mul(8).clamp(24, MAX_FLOOR_ASKS);
        let budget = Self {
            rounds,
            floor_samples,
            max_floor_asks,
            // Below `max_floor_asks`, so a probe refusing from the start hits
            // its own cap first. Cannot underflow: the clamp above is >= 24.
            max_refusals_running: MAX_REFUSALS_RUNNING.min(max_floor_asks - 1),
            max_polls: u32::try_from(max_polls).ok()?,
        };
        budget.usable().then_some(budget)
    }

    /// Whether a run with this budget can measure anything.
    ///
    /// Requires at least one round and poll, a floor of at least two samples,
    /// a floor budget larger than the floor, and a refusal cap below the floor
    /// budget (so a dead probe is reported as such).
    ///
    /// A check rather than an assertion so a caller parsing the environment
    /// can reject a run. [`Latency::new`] panics instead.
    fn usable(&self) -> bool {
        self.rounds > 0
            && self.floor_samples > 1
            && self.max_floor_asks > self.floor_samples
            && self.max_refusals_running > 0
            && self.max_refusals_running < self.max_floor_asks
            && self.max_polls > 0
    }
}

impl Default for Budget {
    /// The budget for a real run.
    fn default() -> Self {
        Self {
            rounds: ROUNDS,
            floor_samples: FLOOR_SAMPLES,
            max_floor_asks: MAX_FLOOR_ASKS,
            max_refusals_running: MAX_REFUSALS_RUNNING,
            max_polls: MAX_POLLS,
        }
    }
}

/// One run of the measurement.
#[derive(Debug)]
pub struct Latency {
    budget: Budget,
    /// One display frame, the unit for [`MAX_WAIT_FRAMES`].
    ///
    /// Passed in so the bound uses the same frame the report divides by.
    frame: Duration,
    phase: Phase,
    round: usize,
    /// The probe's last color, which the next round watches for a change from.
    last: Option<u32>,
    floor: Vec<Duration>,
    key_to_commit: Vec<Duration>,
    commit_to_pixel: Vec<Duration>,
    key_to_pixel: Vec<Duration>,
    abandoned: usize,
    moved_before_commit: usize,
    answered_too_late: usize,
    answered_too_soon: usize,
    redrew_while_polling: usize,
    undelivered: usize,
}

impl Latency {
    /// # Panics
    ///
    /// If [`Budget::usable`] rejects `budget`.
    pub fn new(budget: Budget, frame: Duration) -> Self {
        assert!(
            budget.usable(),
            "a budget that cannot measure anything: {budget:?}"
        );
        Self {
            budget,
            frame,
            phase: Phase::Floor {
                taken: 0,
                since: None,
                holding: None,
                asked: 0,
                refused: 0,
            },
            round: 0,
            last: None,
            floor: Vec::new(),
            key_to_commit: Vec::new(),
            commit_to_pixel: Vec::new(),
            key_to_pixel: Vec::new(),
            abandoned: 0,
            moved_before_commit: 0,
            answered_too_late: 0,
            answered_too_soon: 0,
            redrew_while_polling: 0,
            undelivered: 0,
        }
    }

    /// What to do now.
    ///
    /// Takes `now` because the floor's round trip is timed from this ask.
    pub fn next(&mut self, now: Instant) -> Step {
        match self.phase {
            Phase::Polling { .. } => Step::Sample,
            Phase::Floor {
                taken,
                holding,
                asked,
                refused,
                ..
            } => {
                self.phase = Phase::Floor {
                    taken,
                    since: Some(now),
                    holding,
                    asked,
                    refused,
                };
                Step::Sample
            }
            Phase::Ready => {
                self.phase = Phase::Pressed {
                    at: now,
                    // `Ready` is only entered from a completed floor, which has
                    // answered with a stable color.
                    before: self.last.expect("a completed floor has answered"),
                };
                Step::Press
            }
            // Watch the probe point while waiting for the commit. A change
            // here came from an earlier frame. See `sampled`.
            Phase::Pressed { .. } => Step::Sample,
            Phase::Done(_) => Step::Wait,
        }
    }

    /// The engine answered with the color at the probe point.
    pub fn sampled(&mut self, now: Instant, argb: u32) {
        self.last = Some(argb);
        match self.phase {
            Phase::Floor {
                taken,
                since,
                holding,
                asked,
                ..
            } => {
                let asked = asked + 1;
                // Spend the budget first, unconditionally, so the bound is
                // exactly `max_floor_asks` even with `floor_samples <= 1`.
                // A floor that would settle on its last ask gives up instead.
                self.phase = if asked >= self.budget.max_floor_asks {
                    Phase::Done(Ended::NeverSettled)
                } else {
                    match (holding, since) {
                        // The screen held still, and an earlier answer exists
                        // to time this one from.
                        (Some(held), Some(at)) if held == argb => {
                            self.floor.push(now.saturating_duration_since(at));
                            let taken = taken + 1;
                            if taken >= self.budget.floor_samples {
                                Phase::Ready
                            } else {
                                // `next` sets `since` when it asks.
                                Phase::Floor {
                                    taken,
                                    since,
                                    holding,
                                    asked,
                                    refused: 0,
                                }
                            }
                        }
                        // The first answer, or the screen moved. Either way,
                        // restart: a sample timed across a move is not the
                        // probe's cost.
                        _ => {
                            self.floor.clear();
                            Phase::Floor {
                                taken: 0,
                                since,
                                holding: Some(argb),
                                asked,
                                refused: 0,
                            }
                        }
                    }
                };
            }
            // A sample outside a round means nothing.
            Phase::Ready | Phase::Done(_) => {}
            // The screen changed before the client answered, so the change
            // came from an earlier frame. Drop the round instead of timing it
            // from the next commit.
            Phase::Pressed { before, .. } => {
                if argb != before {
                    self.moved_before_commit += 1;
                    self.end_round();
                }
            }
            Phase::Polling {
                keyed,
                committed,
                before,
                polls,
            } => {
                if argb == before {
                    if polls + 1 >= self.budget.max_polls {
                        self.abandoned += 1;
                        self.end_round();
                    } else {
                        self.phase = Phase::Polling {
                            keyed,
                            committed,
                            before,
                            polls: polls + 1,
                        };
                    }
                } else {
                    self.commit_to_pixel
                        .push(now.saturating_duration_since(committed));
                    self.key_to_pixel.push(now.saturating_duration_since(keyed));
                    self.end_round();
                }
            }
        }
    }

    /// The client this run is watching committed a frame.
    ///
    /// Ignored outside a round: a client redraws unprompted, and the floor
    /// handles a self-repainting screen ([`Ended::NeverSettled`]).
    pub fn committed(&mut self, now: Instant) {
        match self.phase {
            Phase::Pressed { at, before } => {
                let waited = now.saturating_duration_since(at);
                // Checked when the commit arrives, not at a deadline. Otherwise
                // the late commit would land in the next round looking like
                // its answer.
                if waited > self.frame * MAX_WAIT_FRAMES {
                    self.answered_too_late += 1;
                    self.end_round();
                } else if waited < self.frame / MIN_WAIT_FRAME_SHARE {
                    // Skip it and keep the round open: the key's answer is
                    // still coming. Ending the round would press the next key
                    // early, and a client that draws both in one frame shows no
                    // change.
                    self.answered_too_soon += 1;
                } else {
                    self.key_to_commit.push(waited);
                    self.phase = Phase::Polling {
                        keyed: at,
                        committed: now,
                        before,
                        polls: 0,
                    };
                }
            }
            // A second frame for the same key. Counted only; see
            // `Report::redrew_while_polling`.
            Phase::Polling { .. } => self.redrew_while_polling += 1,
            Phase::Floor { .. } | Phase::Ready | Phase::Done(_) => {}
        }
    }

    /// The probe could not read the window.
    ///
    /// `spike_pixel` returns `None` for a missing symbol, a point outside the
    /// window, or a window not composited yet; the driver also reports a
    /// missing engine connection here. Only the third clears on its own,
    /// within a frame or two, so the floor tolerates `max_refusals_running`
    /// refusals in a row.
    ///
    /// A refusal restarts the floor, which must be consecutive matching
    /// answers. During a round it ends the run. Either way it is the probe's
    /// failure, so it goes in `ended`, not `abandoned`.
    pub fn unreadable(&mut self) {
        self.phase = match self.phase {
            Phase::Floor {
                since,
                asked,
                refused,
                ..
            } => {
                // The floor budget is checked first: if a refusal spends it,
                // the floor never completed, so the screen is reported.
                // `Budget` keeps `max_refusals_running` smaller, so a probe
                // refusing from the start hits its own cap first.
                if asked + 1 >= self.budget.max_floor_asks {
                    Phase::Done(Ended::NeverSettled)
                } else if refused + 1 >= self.budget.max_refusals_running {
                    Phase::Done(Ended::ProbeWentDark)
                } else {
                    // Clear the samples, as for a moved screen. Otherwise a
                    // run ending in refusals reports a floor of one or two
                    // samples, and `lib-latency.sh` reads it as real.
                    self.floor.clear();
                    Phase::Floor {
                        taken: 0,
                        since,
                        holding: None,
                        asked: asked + 1,
                        refused: refused + 1,
                    }
                }
            }
            _ => Phase::Done(Ended::ProbeWentDark),
        };
    }

    /// Gives up a round whose key had no surface to go to.
    ///
    /// Without this the run would stay in `Pressed` forever, since only a
    /// commit leaves it. Counted as `undelivered`, not `abandoned`. Called only
    /// after `Step::Press`.
    pub fn press_went_nowhere(&mut self) {
        self.undelivered += 1;
        self.end_round();
    }

    /// The run's results, or `None` while it is still running, so a partial
    /// median is never reported.
    pub fn report(&self) -> Option<Report> {
        let Phase::Done(ended) = self.phase else {
            return None;
        };
        Some(Report {
            floor: Spread::of(&self.floor),
            key_to_commit: Spread::of(&self.key_to_commit),
            commit_to_pixel: Spread::of(&self.commit_to_pixel),
            key_to_pixel: Spread::of(&self.key_to_pixel),
            abandoned: self.abandoned,
            moved_before_commit: self.moved_before_commit,
            answered_too_late: self.answered_too_late,
            answered_too_soon: self.answered_too_soon,
            redrew_while_polling: self.redrew_while_polling,
            undelivered: self.undelivered,
            ended,
        })
    }

    fn end_round(&mut self) {
        self.round += 1;
        self.phase = if self.round >= self.budget.rounds {
            Phase::Done(Ended::Completed)
        } else {
            Phase::Ready
        };
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{Budget, Ended, Latency, Spread, Step};

    fn ms(count: u64) -> Duration {
        Duration::from_millis(count)
    }

    /// Drives a run like the compositor does, on a controlled clock so every
    /// number is exact.
    struct Driver {
        latency: Latency,
        now: Instant,
        color: u32,
        floor_samples: usize,
    }

    impl Driver {
        fn new(rounds: usize, floor_samples: usize, max_polls: u32) -> Self {
            Self::of(Budget {
                rounds,
                floor_samples,
                max_polls,
                ..Budget::default()
            })
        }

        fn of(budget: Budget) -> Self {
            let floor_samples = budget.floor_samples;
            Self {
                latency: Latency::new(budget, Duration::from_micros(16_667)),
                now: Instant::now(),
                color: 0xFF00_0000,
                floor_samples,
            }
        }

        fn tick(&mut self, by: Duration) -> Step {
            self.now += by;
            self.latency.next(self.now)
        }

        fn answer(&mut self, by: Duration) {
            self.now += by;
            let color = self.color;
            self.latency.sampled(self.now, color);
        }

        /// Takes a whole floor at one color, leaving the run one tick from its
        /// first press.
        ///
        /// Counts samples instead of looping until `Step::Press`, because
        /// `next` returning `Press` starts the round. One untimed priming
        /// answer, then the floor.
        fn reach_first_press(&mut self, floor_cost: Duration) {
            for _ in 0..=self.floor_samples {
                assert_eq!(self.tick(ms(0)), Step::Sample);
                self.answer(floor_cost);
            }
        }

        /// One round: press, the client commits after `think`, the pixel
        /// changes after `draw`.
        fn round(&mut self, think: Duration, draw: Duration) {
            assert_eq!(self.tick(ms(0)), Step::Press);
            self.now += think;
            self.latency.committed(self.now);
            assert_eq!(self.latency.next(self.now), Step::Sample);
            self.now += draw;
            self.color = self.color.wrapping_add(0x0000_1000);
            let color = self.color;
            self.latency.sampled(self.now, color);
        }
    }

    /// Only the three caller-facing numbers are parsed.
    #[test]
    fn a_budget_is_three_numbers_and_the_rest_is_not_a_callers_business() {
        let short = Budget::parse("3,4,5").unwrap();
        assert_eq!(short.rounds, 3);
        assert_eq!(short.floor_samples, 4);
        assert_eq!(short.max_polls, 5);
        // Scaled to the floor, and still larger than it.
        assert!(short.max_floor_asks > short.floor_samples);
        assert!(short.max_refusals_running < short.max_floor_asks);
        assert!(short.usable());
    }

    /// Rejected, not clamped, so a short control is never silently replaced
    /// by a 60-round run.
    #[test]
    fn a_budget_that_could_not_measure_anything_is_refused() {
        for raw in [
            "0,4,5",     // no rounds
            "3,1,5",     // a floor of one prices the probe against nothing
            "3,4,0",     // no polls
            "3,4",       // not three numbers
            "3,4,5,6",   // nor four
            "3,-4,5",    // nor a negative one
            "three,4,5", // nor a word
            "",
        ] {
            assert_eq!(Budget::parse(raw), None, "{raw:?} was accepted");
        }
    }

    #[test]
    fn a_run_of_no_samples_is_not_a_run_of_zeroes() {
        assert_eq!(Spread::of(&[]), None);
    }

    #[test]
    fn a_spread_is_the_three_numbers_and_the_upper_middle() {
        let spread = Spread::of(&[ms(30), ms(10), ms(20), ms(40)]).unwrap();
        assert_eq!(spread.count, 4);
        assert_eq!(spread.min, ms(10));
        assert_eq!(spread.median, ms(30));
        assert_eq!(spread.max, ms(40));
    }

    /// `lib-latency.sh` parses this. Asserted as a whole line, since a
    /// reworded line breaks the parser.
    #[test]
    fn a_spread_reports_itself_in_the_shape_the_guard_reads() {
        let spread = Spread::of(&[ms(16), ms(17), ms(50)]).unwrap();
        let want = concat!(
            "latency commit to pixel: min 16.00, median 17.00, max 50.00 ms ",
            "over 3 (median 1.0 frames)"
        );
        assert_eq!(
            spread.line("commit to pixel", Duration::from_micros(16_667)),
            want
        );
    }

    /// No refresh rate gives `?`, since "0.0 frames" would read as a
    /// measurement.
    #[test]
    fn a_spread_with_no_interval_says_so_rather_than_reporting_zero() {
        let spread = Spread::of(&[ms(16)]).unwrap();
        let line = spread.line("floor", Duration::ZERO);
        assert!(line.ends_with("(median ? frames)"), "{line}");
    }

    #[test]
    fn frames_are_the_median_over_the_display_interval() {
        let spread = Spread::of(&[ms(33), ms(33), ms(33)]).unwrap();
        let frames = spread.median_frames(Duration::from_micros(16_667)).unwrap();
        assert!((frames - 1.98).abs() < 0.01, "{frames}");
    }

    /// No refresh rate gives no frame count.
    #[test]
    fn frames_over_no_interval_are_not_reported() {
        let spread = Spread::of(&[ms(16)]).unwrap();
        assert_eq!(spread.median_frames(Duration::ZERO), None);
    }

    /// The floor waits for a page that is still painting. Otherwise round one
    /// would take its starting color from a changing screen and report the
    /// page's own repaint as a fast answer.
    #[test]
    fn a_page_still_painting_itself_is_waited_out_rather_than_measured() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 40,
            max_polls: 10,
            ..Budget::default()
        });
        // A screen that changes on every answer, for longer than the floor.
        for step in 0..12 {
            assert_eq!(driver.tick(ms(1)), Step::Sample);
            driver.now += ms(17);
            driver.latency.sampled(driver.now, 0xFF00_0000 + step);
        }
        assert_eq!(
            driver.tick(ms(1)),
            Step::Sample,
            "it must still be flooring"
        );
        assert_eq!(driver.latency.report(), None);
        // Then it settles, and the floor uses the settled screen.
        driver.color = 0xFF77_7777;
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.floor.unwrap().max, ms(17));
    }

    /// A screen that never holds still must end the run, since the driver
    /// blocks the Wayland thread on every ask.
    #[test]
    fn a_screen_that_never_settles_gives_up_instead_of_asking_for_ever() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 8,
            max_refusals_running: 4,
            max_polls: 10,
        });
        for step in 0..8 {
            assert_eq!(driver.tick(ms(1)), Step::Sample);
            driver.now += ms(17);
            driver.latency.sampled(driver.now, 0xFF00_0000 + step);
        }
        assert_eq!(driver.tick(ms(1)), Step::Wait, "it must have given up");
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::NeverSettled);
        assert_eq!(
            report.floor, None,
            "nothing it timed was against a still screen"
        );
        assert_eq!(report.abandoned, 0, "the client is not what failed here");
    }

    /// The page may not have drawn the `<app>` yet at the first commit, so one
    /// refusal during the floor must not end the run.
    #[test]
    fn a_probe_that_refuses_during_the_floor_is_waited_through() {
        let mut driver = Driver::new(1, 3, 10);
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.latency.unreadable();
        assert_eq!(driver.latency.report(), None, "one refusal is not the end");

        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.commit_to_pixel.unwrap().median, ms(16));
    }

    /// A probe that always refuses never reaches `sampled`, so `unreadable`
    /// must spend the budget too.
    #[test]
    fn a_probe_that_refuses_for_ever_gives_up_rather_than_asking_for_ever() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 40,
            max_refusals_running: 5,
            max_polls: 10,
        });
        for _ in 0..5 {
            assert_eq!(driver.tick(ms(1)), Step::Sample);
            driver.latency.unreadable();
        }
        assert_eq!(driver.tick(ms(1)), Step::Wait, "it must have given up");
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::ProbeWentDark);
        assert_eq!(report.floor, None);
    }

    /// During a round, a refusal ends the run. This is the common case, since
    /// the driver calls `unreadable` from the poll loop.
    #[test]
    fn a_probe_that_goes_dark_mid_poll_ends_the_run_as_the_probes_fault() {
        let mut driver = Driver::new(10, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        assert_eq!(driver.latency.next(driver.now), Step::Sample);
        driver.latency.unreadable();

        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::ProbeWentDark);
        assert_eq!(report.abandoned, 0, "the probe failed, not the client");
        assert_eq!(report.commit_to_pixel, None);
    }

    /// The last color is kept across rounds. Otherwise round two would compare
    /// against a stale color and finish on its first poll.
    #[test]
    fn each_round_watches_for_a_change_from_the_previous_rounds_color() {
        let mut driver = Driver::new(2, 3, 10);
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        // Round two's poll returns round one's color: no change yet.
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        assert_eq!(driver.latency.next(driver.now), Step::Sample);
        driver.answer(ms(17));
        assert_eq!(driver.latency.report(), None, "that was not a change");

        driver.color = driver.color.wrapping_add(0x0000_1000);
        let color = driver.color;
        driver.now += ms(16);
        driver.latency.sampled(driver.now, color);
        let report = driver.latency.report().unwrap();
        assert_eq!(report.commit_to_pixel.unwrap().max, ms(33));
    }

    /// A color change before the commit is not the keystroke's answer.
    ///
    /// The control's client answers no keys but commits every 200 ms. A change
    /// during the wait came from a frame committed before the key.
    #[test]
    fn a_color_that_changed_before_the_commit_is_not_the_keystrokes_answer() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);

        // A frame the key did not cause reaches the screen during the wait.
        assert_eq!(driver.tick(ms(1)), Step::Sample, "the wait is watched");
        driver.color = 0xFF44_4444;
        driver.answer(ms(17));

        // The client commits much later. The first poll would see the changed
        // color and time the whole wait as the answer.
        driver.now += ms(1180);
        driver.latency.committed(driver.now);
        driver.tick(ms(0));
        driver.answer(ms(17));

        let report = driver.latency.report().unwrap();
        assert_eq!(
            report.commit_to_pixel, None,
            "the pixel had changed before the commit, so no commit caused it"
        );
        assert_eq!(
            report.key_to_pixel, None,
            "and the whole of it is no more a keystroke's than its second half"
        );
        assert_eq!(
            report.moved_before_commit, 1,
            "a round given up is counted, not quietly missing from the run"
        );
        assert_eq!(report.abandoned, 0, "the client was not what failed here");
    }

    /// A commit 55 frames after the key is not its answer.
    ///
    /// From `Engine` run 35670079403, where the control's client (which
    /// answers no keys) produced:
    ///
    /// ```text
    ///   key to commit    max 914.87 ms
    ///   commit to pixel      16.23 ms
    ///   key to pixel        931.10 ms  (55.9 frames)
    ///   0 moved before the client answered
    /// ```
    ///
    /// The probe point held still, so the check above did not fire. The order
    /// and every number look valid; only the delay shows it is a periodic
    /// redraw.
    #[test]
    fn a_commit_tens_of_frames_after_the_key_is_not_its_answer() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);
        let keyed = driver.now;

        // The probe point holds still: the control draws at the top left and
        // the probe watches the center.
        for _ in 0..8 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }

        // A redraw commits most of a second after the key, and its pixels
        // follow one frame later.
        driver.now = keyed + ms(915);
        driver.latency.committed(driver.now);
        driver.tick(ms(0));
        driver.color = 0xFF44_4444;
        driver.answer(ms(16));

        let report = driver.latency.report().unwrap();
        assert_eq!(
            report.commit_to_pixel, None,
            "a commit the key did not cause cannot be timed to the key's pixel"
        );
        assert_eq!(
            report.key_to_pixel, None,
            "nor can the whole of it, which is that plus a wait for a dot"
        );
        assert_eq!(
            report.key_to_commit, None,
            "and 915 ms is not what this client's toolkit costs to think"
        );
        assert_eq!(
            report.moved_before_commit, 0,
            "the pixel moved after the commit, which is the right order"
        );
        assert_eq!(
            report.answered_too_late, 1,
            "a round given up is counted, not quietly missing from the run"
        );
        assert_eq!(report.abandoned, 0, "the round never got as far as polling");
    }

    /// The worst real answer measured (44.76 ms, 2.69 frames) must still be
    /// accepted. This is the headroom [`MAX_WAIT_FRAMES`] leaves.
    #[test]
    fn a_commit_a_few_frames_after_the_key_is_still_its_answer() {
        let worst = Duration::from_micros(44_760);
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        driver.round(worst, ms(16));

        let report = driver.latency.report().unwrap();
        assert_eq!(report.key_to_commit.unwrap().median, worst);
        assert_eq!(report.commit_to_pixel.unwrap().median, ms(16));
        assert_eq!(
            report.answered_too_late, 0,
            "2.2 times the worst real round is the headroom the bound leaves"
        );
    }

    /// A commit 7.3 frames after the key is not its answer.
    ///
    /// From `Engine` run 35681982140, where the control's client produced:
    ///
    /// ```text
    ///   key to commit    min 0.82, median 121.95, max 121.95 ms over 2
    ///   commit to pixel      38.02 ms over 1
    ///   key to pixel        159.97 ms over 1  (9.6 frames)
    ///   0 answered too late
    /// ```
    #[test]
    fn a_commit_seven_frames_after_the_key_is_not_its_answer() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);
        let keyed = driver.now;

        // The probe point holds still: the control draws at the top left and
        // the probe watches the center.
        for _ in 0..6 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }

        driver.now = keyed + Duration::from_micros(121_950);
        driver.latency.committed(driver.now);
        driver.tick(ms(0));
        driver.color = 0xFF44_4444;
        driver.answer(Duration::from_micros(38_020));

        let report = driver.latency.report().unwrap();
        assert_eq!(
            report.commit_to_pixel, None,
            "a redraw the key did not cause cannot be timed to the key's pixel"
        );
        assert_eq!(
            report.key_to_commit, None,
            "nor is 7.3 frames what this client's toolkit costs to think"
        );
        assert_eq!(
            report.answered_too_late, 1,
            "a round given up is counted, not quietly missing from the run"
        );
    }

    /// A commit 0.82 ms after the key is skipped, and the round waits for the
    /// real answer.
    ///
    /// No client can wake, repaint and commit in under a millisecond; the
    /// fastest real answer is 15.93 ms. Ending the round instead (as in
    /// `Engine` run 36758359911) pressed the next key early; both changes
    /// landed in one frame and the next round was reported abandoned:
    ///
    /// ```text
    ///   key to commit    over 59
    ///   commit to pixel  over 58
    ///   1 abandoned by the client, 1 whose commit came too soon
    /// ```
    #[test]
    fn a_commit_that_arrives_with_the_key_is_passed_over_for_its_answer() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);
        let keyed = driver.now;

        driver.now += Duration::from_micros(820);
        driver.latency.committed(driver.now);
        assert_eq!(
            driver.tick(ms(0)),
            Step::Sample,
            "the key's answer is still coming, so the next key must wait for it"
        );
        driver.answer(ms(1));

        driver.now = keyed + ms(18);
        driver.latency.committed(driver.now);
        driver.tick(ms(0));
        driver.color = 0xFF44_4444;
        driver.answer(ms(17));

        let report = driver.latency.report().unwrap();
        assert_eq!(
            report.key_to_commit.unwrap().median,
            ms(18),
            "timed to the answer, not to the frame already in flight"
        );
        assert_eq!(report.commit_to_pixel.unwrap().median, ms(17));
        assert_eq!(report.abandoned, 0);
        assert_eq!(
            report.answered_too_soon, 1,
            "a stray passed over is counted, not quietly missing from the run"
        );
    }

    #[test]
    fn a_round_splits_the_clients_half_from_ours() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));

        let report = driver.latency.report().unwrap();
        assert_eq!(report.key_to_commit.unwrap().median, ms(5));
        assert_eq!(report.commit_to_pixel.unwrap().median, ms(16));
        assert_eq!(report.key_to_pixel.unwrap().median, ms(21));
        assert_eq!(report.abandoned, 0);
    }

    #[test]
    fn every_round_is_measured_not_just_the_first() {
        let mut driver = Driver::new(3, 3, 10);
        driver.reach_first_press(ms(17));
        driver.round(ms(4), ms(16));
        driver.round(ms(6), ms(16));
        assert_eq!(driver.latency.report(), None, "not over after two of three");
        driver.round(ms(8), ms(16));

        let report = driver.latency.report().unwrap();
        assert_eq!(report.key_to_commit.clone().unwrap().count, 3);
        assert_eq!(report.key_to_commit.unwrap().median, ms(6));
        assert_eq!(report.commit_to_pixel.unwrap().count, 3);
    }

    /// An unchanged color is normal for a poll or two, so it does not end the
    /// round.
    #[test]
    fn a_color_that_has_not_changed_yet_is_waited_through() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));

        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        for _ in 0..2 {
            assert_eq!(driver.latency.next(driver.now), Step::Sample);
            driver.answer(ms(17));
        }
        assert_eq!(driver.latency.report(), None);
        driver.now += ms(17);
        driver.latency.sampled(driver.now, 0xFF99_9999);

        let report = driver.latency.report().unwrap();
        assert_eq!(report.commit_to_pixel.unwrap().median, ms(51));
        assert_eq!(report.abandoned, 0);
    }

    /// A second frame for one key is counted and does not restart the round,
    /// which would sample one keystroke twice.
    #[test]
    fn a_second_frame_for_one_key_is_counted_and_changes_nothing_else() {
        let mut driver = Driver::new(1, 3, 8);
        driver.reach_first_press(ms(17));

        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        // The client draws again before its first frame reached the screen.
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        driver.now += ms(5);
        driver.latency.committed(driver.now);

        driver.color = 0xFF00_FF00;
        driver.answer(ms(17));

        let report = driver.latency.report().unwrap();
        assert_eq!(
            report.redrew_while_polling, 2,
            "both extra frames are the same fact and both are counted"
        );
        assert_eq!(
            report.abandoned, 0,
            "the color changed, so nothing was abandoned"
        );
        assert_eq!(
            report.key_to_commit.unwrap().count,
            1,
            "one keystroke is one sample of what the client took to answer it, \
             however many frames the answer was"
        );
        assert_eq!(
            report.commit_to_pixel.unwrap().median,
            ms(27),
            "timed from the first commit and not moved to either later one — \
             see Report::redrew_while_polling"
        );
    }

    /// A run with no redraws reports zero, not nothing, since the count
    /// qualifies `commit to pixel`.
    #[test]
    fn a_run_the_client_answered_in_one_frame_says_so() {
        let mut driver = Driver::new(1, 3, 8);
        driver.reach_first_press(ms(17));

        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        driver.color = 0xFF00_FF00;
        driver.answer(ms(17));

        assert_eq!(driver.latency.report().unwrap().redrew_while_polling, 0);
    }

    #[test]
    fn a_round_that_never_changes_is_abandoned_rather_than_waited_on() {
        let mut driver = Driver::new(1, 3, 4);
        driver.reach_first_press(ms(17));

        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        for _ in 0..4 {
            driver.answer(ms(17));
        }

        let report = driver.latency.report().unwrap();
        assert_eq!(report.abandoned, 1);
        assert_eq!(report.commit_to_pixel, None, "nothing was measured");
        assert_eq!(report.key_to_commit.unwrap().count, 1);
    }

    /// The end reason must not depend on which kind of ask spent a shared
    /// budget. A moving screen followed by one refusal is a moving screen.
    #[test]
    fn a_moving_screen_with_one_refusal_in_it_is_still_a_moving_screen() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 8,
            max_refusals_running: 5,
            max_polls: 10,
        });
        for step in 0..7 {
            assert_eq!(driver.tick(ms(1)), Step::Sample);
            driver.now += ms(17);
            driver.latency.sampled(driver.now, 0xFF00_0000 + step);
        }
        assert_eq!(driver.tick(ms(1)), Step::Sample);
        driver.latency.unreadable();

        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::NeverSettled);
    }

    /// An answer resets the refusal count. Otherwise scattered refusals on a
    /// moving screen would add up and report a dark probe.
    #[test]
    fn an_answer_clears_the_refusals_before_it() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 400,
            max_refusals_running: 3,
            max_polls: 10,
        });
        // Two refusals, an answer, repeated: six refusals in all, twice the
        // cap, never three in a row.
        for _ in 0..4 {
            for _ in 0..2 {
                assert_eq!(driver.tick(ms(0)), Step::Sample);
                driver.latency.unreadable();
            }
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
            assert_eq!(driver.latency.report(), None, "no run of three refusals");
        }
        // The last answer above primed the floor, so three timed answers
        // complete it.
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        driver.round(ms(5), ms(16));
        assert_eq!(driver.latency.report().unwrap().ended, Ended::Completed);
    }

    /// When both caps are reached on the same refusal, the floor's wins: the
    /// floor never completed.
    #[test]
    fn a_refusal_that_spends_the_floors_budget_is_the_screen_not_the_probe() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 5,
            max_refusals_running: 4,
            max_polls: 10,
        });
        // Four refusals: the fourth is both the fourth in a row and the fifth
        // ask of five, after one answer.
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.answer(ms(17));
        for _ in 0..4 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.latency.unreadable();
        }
        assert_eq!(driver.latency.report().unwrap().ended, Ended::NeverSettled);
    }

    /// A run ending in refusals reports no floor. `lib-latency.sh` would read
    /// a partial floor as real.
    #[test]
    fn a_run_that_ends_in_refusals_reports_no_floor_at_all() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 400,
            max_refusals_running: 3,
            max_polls: 10,
        });
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.latency.unreadable();
        }
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::ProbeWentDark);
        assert_eq!(report.floor, None, "two timed samples are not a floor");
    }

    /// A refusal restarts the floor, which must be consecutive matching
    /// answers.
    #[test]
    fn a_refusal_restarts_the_floor_rather_than_leaving_a_hole_in_it() {
        let mut driver = Driver::new(1, 3, 10);
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        // Two of three floor samples are in, then a refusal.
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.latency.unreadable();

        // A whole fresh floor is needed: a priming answer and three timed ones,
        // as `reach_first_press` does.
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.floor.unwrap().count, 3);
    }

    /// An undelivered key ends its round, since no commit will.
    #[test]
    fn a_press_that_went_nowhere_gives_the_round_up() {
        let mut driver = Driver::new(2, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.latency.press_went_nowhere();

        // On to the next round.
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.latency.press_went_nowhere();

        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.undelivered, 2, "we never asked the client");
        assert_eq!(report.abandoned, 0, "and must not blame it for that");
        assert_eq!(report.commit_to_pixel, None);
    }

    /// A commit with no key behind it, such as a blinking cursor, is not
    /// timed.
    #[test]
    fn a_commit_outside_a_round_is_not_an_answer_to_anything() {
        let mut driver = Driver::new(1, 3, 10);
        driver.tick(ms(1));
        driver.latency.committed(driver.now);
        driver.reach_first_press(ms(17));
        driver.now += ms(500);
        driver.latency.committed(driver.now);

        driver.round(ms(5), ms(16));
        let report = driver.latency.report().unwrap();
        assert_eq!(report.key_to_commit.unwrap().median, ms(5));
    }

    /// A screen that moves during the floor discards the samples taken so far.
    #[test]
    fn a_screen_that_moves_during_the_floor_throws_the_floor_away() {
        let mut driver = Driver::new(1, 3, 10);
        // Prime, two good samples, then one timed across a move.
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.now += ms(99);
        driver.color = 0xFF44_4444;
        let moved = driver.color;
        driver.latency.sampled(driver.now, moved);

        // The move re-primed the floor, so a whole new one is needed, without
        // the 99 ms sample.
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        driver.round(ms(5), ms(16));
        let floor = driver.latency.report().unwrap().floor.unwrap();
        assert_eq!(floor.count, 3);
        assert_eq!(floor.max, ms(17), "the sample across the move survived");
    }

    /// A press with no commit leaves the run waiting.
    ///
    /// Samples during the wait that match the starting color do not change
    /// the round's state.
    #[test]
    fn a_press_that_is_never_answered_leaves_the_run_waiting() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);

        for _ in 0..5 {
            assert_eq!(driver.tick(ms(100)), Step::Sample);
            driver.answer(ms(17));
        }
        assert_eq!(driver.latency.report(), None);
    }
}
