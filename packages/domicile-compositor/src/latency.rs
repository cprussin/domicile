//! Keystroke to pixel: the one number this fork answers to.
//!
//! Requirement 1 is that a client's window costs the user nothing a plain
//! Wayland compositor would not have cost them. Nothing measured it. The two
//! instruments that used to — `BridgeClient.roundTrip` and
//! `AppElements.drawTiming` — could only do it because the bridge drew the
//! frame, and the bridge does not draw any more; they were kept and emptied
//! against this. See ENGINE-FORK.md, *rebuild the latency measurement*.
//!
//! **The compositor is the only place it can be rebuilt.** It is the one
//! process that both puts the key into the client's seat and holds the engine
//! connection that can be asked what the display compositor actually drew. A
//! page cannot see the first and a producer cannot see the second.
//!
//! WHAT A ROUND MEASURES, and why it is three numbers rather than one:
//!
//! ```text
//!   press ──────────► the client commits ──────────► the pixel is drawn
//!         key→commit                   commit→pixel
//!         (the client's own            (ours: import, composite,
//!          think-and-redraw)            submit, viz aggregation)
//! ```
//!
//! Only the second is this design's to answer for. The first is whatever
//! toolkit the client is built on and would cost the same under any
//! compositor, so folding them into one number would let a slow client hide a
//! regression here — or report one that is not ours.
//!
//! THE FLOOR IS NOT OPTIONAL. Asking what colour a pixel is costs a
//! `CopyOutputRequest`, which forces the draw it then reads, so a round trip
//! that changed nothing still takes a display frame. Every number here is at
//! least that, and a reading with no floor beside it cannot be told from one.
//! So the run prices the probe first, against the same probe, and reports them
//! together — which is what `css_parity.cc` does for the producer's half, so
//! the two are read the same way.
//!
//! Pure, and driven by [`Latency::next`] plus the events below, because the
//! alternative is a measurement that can only be exercised on the one machine
//! that has a GPU.

use std::time::{Duration, Instant};

/// What the driver should do next.
///
/// The driver answers [`Step::Sample`] with [`Latency::sampled`] or
/// [`Latency::unreadable`], and [`Step::Press`] by actually pressing. Nothing
/// here advances on its own, so a driver that stops answering stops the run
/// rather than filling it with samples it never took.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// Nothing this tick.
    Wait,
    /// Give the client the keyboard and press a key into it.
    ///
    /// **The round's clock has already started when this is returned**, and
    /// that is deliberate rather than sloppy: getting the key into the seat is
    /// the compositor's own work, and a clock started after it would leave our
    /// half of the measurement out of our half of the number.
    Press,
    /// Ask the engine what colour is at the probe point.
    Sample,
}

/// A run of samples, and the three numbers worth reading off one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spread {
    pub count: usize,
    pub min: Duration,
    pub median: Duration,
    pub max: Duration,
}

impl Spread {
    /// `None` for an empty run: no samples is not a measurement of zero, and
    /// reporting it as one is how a run that never happened reads as a fast
    /// one.
    fn of(samples: &[Duration]) -> Option<Self> {
        if samples.is_empty() {
            return None;
        }
        let mut sorted = samples.to_vec();
        sorted.sort_unstable();
        Some(Self {
            count: sorted.len(),
            min: sorted[0],
            // The upper middle for an even count, as `css_parity.cc` takes it
            // (`sorted[size / 2]`). Which of the two is arbitrary; the numbers
            // only compare if both sides pick the same one.
            median: sorted[sorted.len() / 2],
            max: sorted[sorted.len() - 1],
        })
    }

    /// The median in display frames, which is the unit that makes any of this
    /// mean something: every number here is a wait for a compositor to draw.
    ///
    /// `None` for an interval of zero rather than an infinity, because that is
    /// a display whose refresh nobody reported and not a run that took no
    /// time.
    pub fn median_frames(&self, interval: Duration) -> Option<f64> {
        (!interval.is_zero()).then(|| self.median.as_secs_f64() / interval.as_secs_f64())
    }

    /// The line a run reports this spread on.
    ///
    /// Here, and tested, because a guard is going to read it: the text is the
    /// interface between the measurement and whatever asserts on it, and a
    /// format string nobody checks is one a rewording breaks silently. No
    /// guard drives this yet — when one does, it greps this shape.
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

/// What a finished run measured.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// A probe round trip with nothing changing. The floor under everything
    /// else here.
    pub floor: Option<Spread>,
    /// Press to the client's answering commit.
    ///
    /// Mostly the client's own think-and-redraw, and **not purely** — the
    /// compositor's own work of putting the key into the seat is in here too,
    /// because the clock starts before the key is delivered. Small, and named
    /// rather than hidden: the alternative was starting it after delivery,
    /// which drops that work out of every number instead of putting it in a
    /// declared one.
    pub key_to_commit: Option<Spread>,
    /// That commit to the new colour being in the display compositor's
    /// output. **This is the number this design is answerable for.**
    ///
    /// **Quantised to the floor, and it cannot not be.** The probe is only
    /// asked after the commit and each ask costs a display frame, so this is
    /// the true value rounded up to the next probe boundary and is never below
    /// one floor even when the pixel was already on screen. Over sixty rounds
    /// the three numbers collapse onto multiples of it. That is what makes
    /// "indistinguishable from the floor" the result rather than a hedge — and
    /// it is also the instrument's resolution: a regression in this half
    /// smaller than one probe round trip does not show up here. `key_to_commit`
    /// is not quantised, being timed to the real commit callback, so the two
    /// do not have the same resolution.
    pub commit_to_pixel: Option<Spread>,
    /// The whole of it. Not what a user feels: it has the probe's round trip
    /// in it, and a user waits for no `CopyOutputRequest`.
    pub key_to_pixel: Option<Spread>,
    /// Rounds that ran out of polls rather than seeing the colour change.
    ///
    /// The client stopped answering, or never answered a key at all — which is
    /// what a run against a client that ignores the keyboard looks like, and
    /// is the whole of what the negative control asserts.
    pub abandoned: usize,
    /// Why the run stopped, when it was not by running out of rounds.
    ///
    /// Separate from `abandoned` because they are different accusations: an
    /// abandoned round is the *client* not answering, and every one of these
    /// is the *probe* or the screen. Reporting them as one number sent whoever
    /// read it to the wrong end.
    pub ended: Ended,
}

/// How a run finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// Every round it set out to do.
    Completed,
    /// The screen never held still long enough to price the probe against it.
    /// A client repainting on its own — a blinking cursor over the probe point
    /// — looks exactly like this, and so does a page that never settles.
    NeverSettled,
    /// The probe stopped answering, or never started. Distinct from the screen
    /// moving: this is no reading at all rather than a different one.
    ProbeWentDark,
}

/// Where a run has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Sampling with nothing changing, to price the probe itself — and, on
    /// the way, to wait out a page that is still painting itself.
    ///
    /// `holding` is what nothing-changing means. `None` is the very first
    /// sample, which sets it and is timed as nothing: there is no earlier
    /// answer to have timed it from.
    ///
    /// **It is enforced, and that is what makes this one phase rather than
    /// two.** A screen that moves partway through throws away everything timed
    /// so far and starts the floor again, so a completed floor is by
    /// construction a run of consecutive answers that all agreed. That is
    /// strictly more than "it settled" — which is why there is no separate
    /// settling phase to get out of step with this one — and it is what lets
    /// the first round trust the colour it is watching for a change from.
    Floor {
        taken: usize,
        since: Option<Instant>,
        holding: Option<u32>,
        /// Every answer this floor has been given, restarts included.
        ///
        /// **The floor has to be able to give up, and for the same reason the
        /// poll does.** A screen that never holds still — a terminal blinking
        /// its cursor over the probe point is the obvious one — leaves the
        /// floor asking for ever, and the driver asking for ever is a
        /// compositor that has stopped serving clients. Bounded, so that case
        /// reports itself as [`Ended::NeverSettled`] rather than hanging the
        /// desktop.
        asked: usize,
    },
    /// Between rounds: the next thing to do is press a key.
    Ready,
    /// A key has gone in; waiting for the client to commit.
    Pressed { at: Instant, before: u32 },
    /// The client committed; polling for the colour to reach the screen.
    Polling {
        keyed: Instant,
        committed: Instant,
        before: u32,
        polls: u32,
    },
    /// Over. Nothing moves out of this.
    Done(Ended),
}

/// How many rounds, and how many floor samples. Sixty of each, which is what
/// `css_parity.cc` takes, so a median here is over the same size of run as the
/// producer-side one it is read beside.
pub const ROUNDS: usize = 60;
pub const FLOOR_SAMPLES: usize = 60;

/// How many answers the floor asks for before giving up on ever settling.
///
/// Generous against `FLOOR_SAMPLES`, because a restart is normal — a page
/// finishing its first paint costs one — and stingy against for ever, because
/// the driver blocks on every one of these.
pub const MAX_FLOOR_ASKS: usize = 400;

/// How many probe answers a round waits through before giving up on it.
///
/// A round that is going to finish finishes in one or two, since each poll is
/// itself a display frame. This is not a timeout in disguise — it is the point
/// past which the client has plainly stopped drawing, and a run that waited
/// for ever would hang the guard rather than report it.
pub const MAX_POLLS: u32 = 200;

/// One run of the measurement.
#[derive(Debug)]
pub struct Latency {
    rounds: usize,
    floor_samples: usize,
    max_floor_asks: usize,
    max_polls: u32,
    phase: Phase,
    round: usize,
    /// The last colour the probe answered with, which is what the next round
    /// watches for a change from. Read rather than assumed: what the client
    /// draws between rounds is the client's business.
    last: Option<u32>,
    floor: Vec<Duration>,
    key_to_commit: Vec<Duration>,
    commit_to_pixel: Vec<Duration>,
    key_to_pixel: Vec<Duration>,
    abandoned: usize,
}

impl Latency {
    pub fn new(rounds: usize, floor_samples: usize, max_floor_asks: usize, max_polls: u32) -> Self {
        Self {
            rounds,
            floor_samples,
            max_floor_asks,
            max_polls,
            phase: Phase::Floor {
                taken: 0,
                since: None,
                holding: None,
                asked: 0,
            },
            round: 0,
            last: None,
            floor: Vec::new(),
            key_to_commit: Vec::new(),
            commit_to_pixel: Vec::new(),
            key_to_pixel: Vec::new(),
            abandoned: 0,
        }
    }

    /// What to do now.
    ///
    /// Takes `now` because this is where the floor's clock starts: the round
    /// trip being priced is from asking to being answered, and asking is here.
    pub fn next(&mut self, now: Instant) -> Step {
        match self.phase {
            Phase::Polling { .. } => Step::Sample,
            Phase::Floor {
                taken,
                holding,
                asked,
                ..
            } => {
                self.phase = Phase::Floor {
                    taken,
                    since: Some(now),
                    holding,
                    asked,
                };
                Step::Sample
            }
            Phase::Ready => {
                self.phase = Phase::Pressed {
                    at: now,
                    // A completed floor is a run of answers that all agreed,
                    // so this is a colour the probe really did report and one
                    // that was holding still when it did.
                    // `expect` rather than a fallback: `Ready` is only ever
                    // entered out of a completed floor, and a completed floor
                    // has answered. A default here would be a silent one, and
                    // the round would watch for a change from a colour nobody
                    // reported.
                    before: self.last.expect("a completed floor has answered"),
                };
                Step::Press
            }
            Phase::Pressed { .. } | Phase::Done(_) => Step::Wait,
        }
    }

    /// The engine answered with the colour at the probe point.
    pub fn sampled(&mut self, now: Instant, argb: u32) {
        self.last = Some(argb);
        match self.phase {
            Phase::Floor {
                taken,
                since,
                holding,
                asked,
            } => {
                let asked = asked + 1;
                self.phase = match (holding, since) {
                    // The screen held still, and there is an earlier answer to
                    // have timed this one from.
                    (Some(held), Some(at)) if held == argb => {
                        self.floor.push(now.saturating_duration_since(at));
                        let taken = taken + 1;
                        if taken >= self.floor_samples {
                            Phase::Ready
                        } else {
                            // `since` is not written here: `next` sets it when
                            // it asks, which is the moment being timed from.
                            Phase::Floor {
                                taken,
                                since,
                                holding,
                                asked,
                            }
                        }
                    }
                    // Out of patience. A screen that will not hold still is a
                    // real answer about this run — see `Ended::NeverSettled` —
                    // and it is the one the driver would otherwise ask for
                    // until the desktop stopped.
                    _ if asked >= self.max_floor_asks => Phase::Done(Ended::NeverSettled),
                    // Either the first answer of all, or the screen moved.
                    // Both start the floor from here: what was timed before a
                    // move was timed across one, and a floor is the probe's
                    // cost and nothing else's.
                    _ => {
                        self.floor.clear();
                        Phase::Floor {
                            taken: 0,
                            since,
                            holding: Some(argb),
                            asked,
                        }
                    }
                };
            }
            // A sample answered while we wait for the commit was asked for
            // before the key went in, so it says nothing about this round.
            Phase::Ready | Phase::Pressed { .. } | Phase::Done(_) => {}
            Phase::Polling {
                keyed,
                committed,
                before,
                polls,
            } => {
                if argb == before {
                    if polls + 1 >= self.max_polls {
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
    /// Ignored outside a round, which is most commits: a client redraws
    /// unprompted and the floor must not be interrupted by one. (What a
    /// self-repainting client *does* interrupt is the floor's stillness, which
    /// is `Ended::NeverSettled`'s job and not this one's.)
    pub fn committed(&mut self, now: Instant) {
        if let Phase::Pressed { at, before } = self.phase {
            self.key_to_commit.push(now.saturating_duration_since(at));
            self.phase = Phase::Polling {
                keyed: at,
                committed: now,
                before,
                polls: 0,
            };
        }
    }

    /// The probe could not read the window at all.
    ///
    /// Distinct from "the colour has not changed": that is a reading, this is
    /// the absence of one. `spike_pixel` gives it for three unrelated reasons
    /// — a missing symbol, a point outside the window, and a window the
    /// browser has not composited yet — and only the last is survivable.
    ///
    /// **Survivable during the floor, and only there.** The first commit is
    /// exactly when the page may not have drawn the `<app>` yet, so ending the
    /// run on one refusal there would end most runs before they started. The
    /// floor spends an ask on it and carries on. Once rounds are running there
    /// is nothing to wait for: every number is a difference between two probe
    /// answers, and one with a hole in it measures the hole.
    ///
    /// Either way this is the *probe's* failure, never the client's, so it
    /// lands in `ended` and not in `abandoned`.
    pub fn unreadable(&mut self) {
        self.phase = match self.phase {
            Phase::Floor {
                taken,
                since,
                holding,
                asked,
            } if asked + 1 < self.max_floor_asks => Phase::Floor {
                taken,
                since,
                holding,
                asked: asked + 1,
            },
            _ => Phase::Done(Ended::ProbeWentDark),
        };
    }

    /// The run's numbers, and how it ended. `None` while it is still running:
    /// a median over a third of a run is a number somebody will quote.
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
            ended,
        })
    }

    fn end_round(&mut self) {
        self.round += 1;
        self.phase = if self.round >= self.rounds {
            Phase::Done(Ended::Completed)
        } else {
            Phase::Ready
        };
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{Ended, Latency, Spread, Step};

    fn ms(count: u64) -> Duration {
        Duration::from_millis(count)
    }

    /// Drives a run the way the compositor does: ask, answer, ask again. The
    /// clock is ours, so every number below is exact rather than approximate.
    struct Driver {
        latency: Latency,
        now: Instant,
        colour: u32,
        floor_samples: usize,
    }

    impl Driver {
        fn new(rounds: usize, floor_samples: usize, max_polls: u32) -> Self {
            Self::with_floor_budget(rounds, floor_samples, 400, max_polls)
        }

        fn with_floor_budget(
            rounds: usize,
            floor_samples: usize,
            max_floor_asks: usize,
            max_polls: u32,
        ) -> Self {
            Self {
                latency: Latency::new(rounds, floor_samples, max_floor_asks, max_polls),
                now: Instant::now(),
                colour: 0xFF00_0000,
                floor_samples,
            }
        }

        fn tick(&mut self, by: Duration) -> Step {
            self.now += by;
            self.latency.next(self.now)
        }

        fn answer(&mut self, by: Duration) {
            self.now += by;
            let colour = self.colour;
            self.latency.sampled(self.now, colour);
        }

        /// Take a whole floor at one colour, leaving the run one tick away
        /// from its first press. Every test below starts from here because
        /// every real run does.
        ///
        /// A fixed count rather than a loop on `Step::Press`, because `next`
        /// *is* the press: a helper that looked for one would consume the
        /// round it was setting up. One priming answer, which has no earlier
        /// answer to be timed from, then the floor itself.
        fn reach_first_press(&mut self, floor_cost: Duration) {
            for _ in 0..=self.floor_samples {
                assert_eq!(self.tick(ms(0)), Step::Sample);
                self.answer(floor_cost);
            }
        }

        /// One whole round: press, the client answers after `think`, the pixel
        /// changes after `draw`.
        fn round(&mut self, think: Duration, draw: Duration) {
            assert_eq!(self.tick(ms(0)), Step::Press);
            self.now += think;
            self.latency.committed(self.now);
            assert_eq!(self.latency.next(self.now), Step::Sample);
            self.now += draw;
            self.colour = self.colour.wrapping_add(0x0000_1000);
            let colour = self.colour;
            self.latency.sampled(self.now, colour);
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

    /// The guard greps this. It is asserted whole rather than by substring for
    /// the reason `test-annotate.sh` asserts whole lines: a rewording that
    /// keeps the words but moves them is exactly what breaks a grep.
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

    /// A display nobody reported a refresh for gets a `?` rather than a
    /// number, because "0.0 frames" would read as a measurement.
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

    /// A display nobody reported a refresh for is not a run that took no time.
    #[test]
    fn frames_over_no_interval_are_not_reported() {
        let spread = Spread::of(&[ms(16)]).unwrap();
        assert_eq!(spread.median_frames(Duration::ZERO), None);
    }

    /// The floor waits out a page that is still painting itself, because it
    /// refuses to complete until its whole run of answers agreed. Without
    /// that, round one would take its "before" colour from a screen that was
    /// going to change on its own — and would report the page's own settling
    /// as a keystroke's answer, fast and in the flattering direction.
    #[test]
    fn a_page_still_painting_itself_is_waited_out_rather_than_measured() {
        let mut driver = Driver::with_floor_budget(1, 3, 40, 10);
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
        // And then it settles, and the floor is the settled screen's.
        driver.colour = 0xFF77_7777;
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.floor.unwrap().max, ms(17));
    }

    /// A screen that NEVER holds still has to end the run, because the driver
    /// blocks the Wayland thread on every ask. Without a budget here the
    /// desktop stops serving clients for as long as a cursor keeps blinking
    /// over the probe point — which is the client this instrument expects.
    #[test]
    fn a_screen_that_never_settles_gives_up_instead_of_asking_for_ever() {
        let mut driver = Driver::with_floor_budget(1, 3, 8, 10);
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

    /// The first commit is exactly when the page may not have drawn the <app>
    /// yet, so one refusal during the floor must not end the run — it would
    /// end most runs before they started.
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

    /// A probe that refuses for ever is the floor's other way to hang the
    /// desktop: `sampled` is never reached, so the budget has to be spent from
    /// here too or nothing ever ends the run.
    #[test]
    fn a_probe_that_refuses_for_ever_gives_up_rather_than_asking_for_ever() {
        let mut driver = Driver::with_floor_budget(1, 3, 5, 10);
        for _ in 0..5 {
            assert_eq!(driver.tick(ms(1)), Step::Sample);
            driver.latency.unreadable();
        }
        assert_eq!(driver.tick(ms(1)), Step::Wait, "it must have given up");
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::ProbeWentDark);
        assert_eq!(report.floor, None);
    }

    /// Once rounds are running there is nothing to wait for: every number is a
    /// difference between two probe answers. This is the arm the driver
    /// actually hits, since `unreadable` is called from inside the poll loop.
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

    /// Every round watches for a change from what the probe last answered, so
    /// the last answer has to be kept in every phase. Kept only during the
    /// floor, round two would watch for a change from a stale colour and
    /// complete on its first poll — a fabricated fast number.
    #[test]
    fn each_round_watches_for_a_change_from_the_previous_rounds_colour() {
        let mut driver = Driver::new(2, 3, 10);
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        // Round two's press, then a poll answering round one's colour: that is
        // no change, and must be waited through rather than counted.
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.now += ms(5);
        driver.latency.committed(driver.now);
        assert_eq!(driver.latency.next(driver.now), Step::Sample);
        driver.answer(ms(17));
        assert_eq!(driver.latency.report(), None, "that was not a change");

        driver.colour = driver.colour.wrapping_add(0x0000_1000);
        let colour = driver.colour;
        driver.now += ms(16);
        driver.latency.sampled(driver.now, colour);
        let report = driver.latency.report().unwrap();
        assert_eq!(report.commit_to_pixel.unwrap().max, ms(33));
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

    /// The colour not having changed yet is the normal answer for a poll or
    /// two — each one is a display frame — so it must not end the round.
    #[test]
    fn a_colour_that_has_not_changed_yet_is_waited_through() {
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

    /// A client that stops drawing must end the run with the round counted,
    /// not leave the guard polling for ever.
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

    /// A probe that goes dark ends the run. The alternative is a median over
    /// samples from either side of a hole, which reads like a measurement.
    #[test]
    fn a_probe_that_stops_reading_ends_the_run_and_says_so() {
        let mut driver = Driver::new(10, 3, 10);
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        assert_eq!(driver.latency.report(), None);

        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.latency.unreadable();

        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::ProbeWentDark);
        assert_eq!(report.commit_to_pixel.unwrap().count, 1);
    }

    /// A commit with no key behind it is a blinking cursor, and timing to one
    /// would report the blink interval as the client's think time.
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

    /// The floor is the probe's cost and nothing else's, so a screen that
    /// moves partway through invalidates what was timed rather than being
    /// averaged into it.
    #[test]
    fn a_screen_that_moves_during_the_floor_throws_the_floor_away() {
        let mut driver = Driver::new(1, 3, 10);
        // Prime, then two good samples, then one timed across a move.
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.now += ms(99);
        driver.colour = 0xFF44_4444;
        let moved = driver.colour;
        driver.latency.sampled(driver.now, moved);

        // That move re-primed the floor, so a whole clean one is still owed —
        // and the 99 is not in it.
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        driver.round(ms(5), ms(16));
        let floor = driver.latency.report().unwrap().floor.unwrap();
        assert_eq!(floor.count, 3);
        assert_eq!(floor.max, ms(17), "the sample across the move survived");
    }

    /// Nothing advances without the driver, so a driver that stops answering
    /// stops the run rather than filling it with samples nobody took.
    #[test]
    fn a_press_that_is_never_answered_leaves_the_run_waiting() {
        let mut driver = Driver::new(1, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);

        for _ in 0..5 {
            assert_eq!(driver.tick(ms(100)), Step::Wait);
        }
        assert_eq!(driver.latency.report(), None);
    }
}
