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
//!         (mostly the client's         (ours: import, composite,
//!          think-and-redraw)            submit, viz aggregation)
//! ```
//!
//! Only the second is this design's to answer for, and it is the one kept
//! clean: the import and the submit are inside it because they are ours. The
//! first is *mostly* the client's — whatever toolkit it is built on, which
//! would cost the same under any compositor — and not purely, because the
//! clock starts before the key is delivered, so this compositor's own
//! key-delivery and the commit callback's first few lines are in there too.
//! Small, and named rather than hidden. Folding the two together would let a
//! slow client hide a regression in ours, or report one that is not.
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
    /// **The round's clock has already started when this is returned.** So
    /// the driver's focus change and key injection are inside `key_to_commit`
    /// — see there — rather than outside every number. Starting it after
    /// delivery would drop that work out of the measurement altogether, which
    /// is worse than having it in a bucket that says so.
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
    /// Here, and tested, because something reads it: `lib-latency.sh` greps
    /// this shape and `scripts/test-latency-report.sh` pins it from that side,
    /// so the contract holds from both ends. A format string nobody checks is
    /// one a rewording breaks silently.
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
    /// this one's min, median and max collapse onto multiples of the floor —
    /// only this one: `key_to_commit` is timed to the real commit callback and
    /// `key_to_pixel` is that added to this, so neither lands on a multiple.
    ///
    /// That is what makes
    /// "indistinguishable from the floor" the result rather than a hedge — and
    /// it is also the instrument's resolution: a regression in this half
    /// smaller than one probe round trip does not show up here.
    pub commit_to_pixel: Option<Spread>,
    /// The whole of it. Not what a user feels: it has the probe's round trip
    /// in it, and a user waits for no `CopyOutputRequest`.
    pub key_to_pixel: Option<Spread>,
    /// Rounds that ran out of polls rather than seeing the colour change.
    ///
    /// The client was asked and did not answer — which is what a run against a
    /// client that ignores the keyboard looks like, and is the whole of what a
    /// negative control asserts.
    pub abandoned: usize,
    /// Rounds whose key was never delivered, because there was no surface to
    /// deliver it to.
    ///
    /// **Its own count, not `abandoned`.** The client was never asked, so
    /// counting it against the client would be the wrong-end report this whole
    /// instrument keeps having to fix. Nothing here is the client's fault and
    /// nothing here is a measurement; it is this compositor failing to do the
    /// one thing a round starts with.
    pub undelivered: usize,
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
        /// Refusals in a row, reset by any answer.
        ///
        /// Its own counter, and that is the whole of what makes the two
        /// give-up reasons mean what they say. Sharing one budget let the
        /// label be decided by whichever kind of ask happened to spend the
        /// last of it — seven moving answers and then a single refusal
        /// reported a dark probe — which is a report that sends the reader to
        /// the wrong end. A probe is dark when it refuses repeatedly; a screen
        /// never settles when the whole budget goes without one holding still.
        refused: usize,
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

/// How many rounds a run measures, and how many samples price the probe.
///
/// Sixty of each, which is what `css_parity.cc` takes, so a median here is over
/// the same size of run as the producer-side one it is read beside.
const ROUNDS: usize = 60;
const FLOOR_SAMPLES: usize = 60;

/// How many answers the floor asks for before giving up on ever settling.
///
/// Generous against `FLOOR_SAMPLES`, because a restart is normal — a page
/// finishing its first paint costs one — and stingy against for ever, because
/// the driver blocks on every one of these.
const MAX_FLOOR_ASKS: usize = 400;

/// How many refusals in a row mean the probe is not coming back.
///
/// Small, because the survivable case is narrow: the window not being
/// composited yet, which resolves within a frame or two of the page drawing.
/// A missing symbol or a point outside the window refuses every time and
/// should be reported in a moment rather than after the whole floor budget.
const MAX_REFUSALS_RUNNING: usize = 8;

/// How many probe answers a round waits through before giving up on it.
///
/// A round that is going to finish finishes in one or two, since each poll is
/// itself a display frame. This is not a timeout in disguise — it is the point
/// past which the client has plainly stopped drawing, and a run that waited
/// for ever would hang the guard rather than report it.
const MAX_POLLS: u32 = 200;

/// What a run is allowed to spend.
///
/// A struct rather than five arguments, because five of the same type in a row
/// is a call nobody can read and a swap the compiler cannot catch. Every one is
/// a bound on how long the Wayland thread blocks, which is why they are all
/// here together and none of them is optional.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    /// Rounds to measure.
    pub rounds: usize,
    /// Timed probe answers to price the probe with.
    pub floor_samples: usize,
    /// Answers the floor may spend before giving up on the screen ever
    /// holding still.
    pub max_floor_asks: usize,
    /// Refusals in a row before giving up on the probe.
    pub max_refusals_running: usize,
    /// Answers one round waits through before giving up on the client.
    pub max_polls: u32,
}

impl Budget {
    /// A budget from `rounds,floor_samples,max_polls`, the three a caller has
    /// any reason to change.
    ///
    /// The other two are bounds on hanging rather than on measuring, and are
    /// left at their defaults so a short run cannot accidentally remove the
    /// protection: `max_floor_asks` scales with the floor so a smaller floor
    /// still gets room to restart, and `max_refusals_running` stays below it,
    /// which is what keeps the two give-up reasons apart.
    ///
    /// `None` for anything `Latency::new` would refuse, rather than a clamp
    /// or a default: a caller who asked for a run of no rounds asked for
    /// something, and quietly giving them sixty is how a control that was
    /// meant to be short becomes a four-minute one nobody notices.
    pub fn parse(raw: &str) -> Option<Self> {
        let mut parts = raw.split(',');
        let mut number = || parts.next()?.trim().parse::<usize>().ok();
        let (rounds, floor_samples, max_polls) = (number()?, number()?, number()?);
        if parts.next().is_some() {
            return None;
        }
        // Room for the floor to restart several times over, scaled to the
        // floor asked for: a short control that never settles should say so in
        // about a second rather than block a desktop for the default's six and
        // three quarters. Never below the floor it has to contain, never above
        // the default. Computed once, because the refusal cap below is derived
        // from it and two copies of this arithmetic could drift into breaking
        // the invariant between them with nothing to catch it.
        let max_floor_asks = floor_samples.saturating_mul(8).clamp(24, MAX_FLOOR_ASKS);
        let budget = Self {
            rounds,
            floor_samples,
            max_floor_asks,
            // Kept under `max_floor_asks`, which is the condition that lets a
            // probe refusing from the first ask reach its own cap first and so
            // be reported as the probe. The `- 1` cannot underflow: the clamp
            // above has a floor of 24.
            max_refusals_running: MAX_REFUSALS_RUNNING.min(max_floor_asks - 1),
            max_polls: u32::try_from(max_polls).ok()?,
        };
        budget.usable().then_some(budget)
    }

    /// Whether a run built on this could measure anything.
    ///
    /// Each condition is one that silently disabled something when it did not
    /// hold: a floor of one sample prices the probe against nothing; a floor
    /// budget no larger than the floor cannot let one complete; a refusal cap
    /// at or above the floor's budget means a probe refusing from the first
    /// ask is reported as a screen that would not hold still; and no rounds or
    /// no polls measure nothing at all.
    ///
    /// A question rather than an assertion so a caller reading an environment
    /// can refuse a run instead of panicking a desktop. [`Latency::new`] is
    /// the one that panics, because by then it is a bug rather than a typo.
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
    /// What a real run takes. Sixty of each, which is what `css_parity.cc`
    /// takes, so a median here is over the same size of run as the
    /// producer-side one it is read beside.
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
    undelivered: usize,
}

impl Latency {
    /// # Panics
    ///
    /// On a budget [`Budget::usable`] rejects, which is a caller's mistake
    /// rather than a run's outcome and is therefore loud. Asked there rather
    /// than repeated here, because two copies of the same conditions are two
    /// copies to drift apart.
    pub fn new(budget: Budget) -> Self {
        assert!(
            budget.usable(),
            "a budget that cannot measure anything: {budget:?}"
        );
        Self {
            budget,
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
            undelivered: 0,
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
                ..
            } => {
                let asked = asked + 1;
                // The budget is spent first, before anything can advance past
                // it, and unconditionally. Checked after the still-arm, a run
                // of agreeing answers could carry `taken` up regardless and the
                // real bound became `max_floor_asks + floor_samples`. Guarded
                // by "unless this ask would complete the floor", it was dead
                // whenever `floor_samples <= 1` — `taken + 1 >= 1` always — and
                // a moving screen could then ask for ever, which is the hang
                // these budgets exist to stop. A floor that would have settled
                // on its very last permitted ask gives up instead; that costs
                // one run in four hundred asks and buys a bound that is simply
                // `max_floor_asks`.
                self.phase = if asked >= self.budget.max_floor_asks {
                    Phase::Done(Ended::NeverSettled)
                } else {
                    match (holding, since) {
                        // The screen held still, and there is an earlier answer
                        // to have timed this one from.
                        (Some(held), Some(at)) if held == argb => {
                            self.floor.push(now.saturating_duration_since(at));
                            let taken = taken + 1;
                            if taken >= self.budget.floor_samples {
                                Phase::Ready
                            } else {
                                // `since` is not written here: `next` sets it
                                // when it asks, which is the moment being timed
                                // from.
                                Phase::Floor {
                                    taken,
                                    since,
                                    holding,
                                    asked,
                                    refused: 0,
                                }
                            }
                        }
                        // Either the first answer of all, or the screen moved.
                        // Both start the floor from here: what was timed before
                        // a move was timed across one, and a floor is the
                        // probe's cost and nothing else's.
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
    /// the absence of one. `spike_pixel` answers `None` for a missing symbol,
    /// a point outside the window, and a window the browser has not
    /// composited yet — and the driver funnels a browser it has no connection
    /// to into here as well. **Nothing here can tell them apart**, so the
    /// floor survives all four for a bounded run of them and then calls it:
    /// only the third resolves on its own, and it resolves within a frame or
    /// two of the page drawing, so a probe still refusing after
    /// `max_refusals_running` in a row is one of the three that never will.
    ///
    /// It restarts the floor rather than merely spending an ask, because the
    /// floor's whole claim is a run of consecutive answers that all agreed,
    /// and a refusal punches a hole in exactly that. Once rounds are running
    /// there is nothing to wait for: every number is a difference between two
    /// probe answers, and one with a hole in it measures the hole.
    ///
    /// Either way this is the *probe's* failure, never the client's, so it
    /// lands in `ended` and not in `abandoned`.
    pub fn unreadable(&mut self) {
        self.phase = match self.phase {
            Phase::Floor {
                since,
                asked,
                refused,
                ..
            } => {
                // Which budget ran out is which end failed, and the two are
                // counted separately for exactly that reason. The floor's own
                // budget is asked first, so a refusal that happens to spend the
                // last of it is the screen — what that budget measures is a
                // floor that never completed, whatever the last ask was. Only a
                // run of refusals with the floor's budget still in hand is the
                // probe, and `Budget` requires `max_refusals_running` to be the
                // smaller of the two so that a probe refusing from the start
                // always reaches its own cap first.
                if asked + 1 >= self.budget.max_floor_asks {
                    Phase::Done(Ended::NeverSettled)
                } else if refused + 1 >= self.budget.max_refusals_running {
                    Phase::Done(Ended::ProbeWentDark)
                } else {
                    // Cleared, as the moved-screen restart clears: a refusal is
                    // not an answer, so what was timed before it is a run of
                    // answers with a hole in it. Left populated, a run that
                    // ends in refusals reports a real-looking floor over one or
                    // two samples, and `lib-latency.sh` reads it as the floor.
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

    /// A round's key could not be delivered, because the client has no surface
    /// to deliver it to.
    ///
    /// **Called, rather than left to time out, because nothing would.** `next`
    /// has already moved the run into `Pressed`, and the only way out of
    /// `Pressed` is a commit — which is what the key was for. A client that
    /// does not redraw on its own would leave the run there for ever and no
    /// report would ever be printed, which is the shape of the bug this whole
    /// file has been fixing.
    ///
    /// Counted as `undelivered` rather than `abandoned`: the client was never
    /// asked. Only ever called out of the `Press` arm, so the phase is
    /// `Pressed` and there is nothing to check for.
    pub fn press_went_nowhere(&mut self) {
        self.undelivered += 1;
        self.end_round();
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
                latency: Latency::new(budget),
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

    /// The three a caller changes, and nothing else. A short control is the
    /// only reason this exists, so the cases that matter are a short one being
    /// accepted and a useless one being refused rather than quietly replaced.
    #[test]
    fn a_budget_is_three_numbers_and_the_rest_is_not_a_callers_business() {
        let short = Budget::parse("3,4,5").unwrap();
        assert_eq!(short.rounds, 3);
        assert_eq!(short.floor_samples, 4);
        assert_eq!(short.max_polls, 5);
        // Scaled to the floor, and still large enough to contain it.
        assert!(short.max_floor_asks > short.floor_samples);
        assert!(short.max_refusals_running < short.max_floor_asks);
        assert!(short.usable());
    }

    /// Refused rather than clamped or defaulted: a caller who asked for a run
    /// of no rounds asked for something, and quietly handing them sixty is how
    /// a control meant to be short becomes a four-minute one nobody notices.
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

    /// `lib-latency.sh` greps this. Asserted whole rather than by substring,
    /// for the reason `test-annotate.sh` asserts whole lines: a rewording that
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

    /// The two give-up reasons blame opposite ends, so neither may be decided
    /// by whichever kind of ask happened to spend the last of a shared budget.
    /// A screen that moves and then one refusal is a moving screen.
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

    /// The refusal counter is a run of them, so an answer clears it. Without
    /// that, a screen that moves with the odd refusal in it accumulates
    /// refusals across the whole floor and is reported as a dark probe — which
    /// is the wrong-end report this counter was split out to prevent.
    #[test]
    fn an_answer_clears_the_refusals_before_it() {
        let mut driver = Driver::of(Budget {
            rounds: 1,
            floor_samples: 3,
            max_floor_asks: 400,
            max_refusals_running: 3,
            max_polls: 10,
        });
        // Two refusals, an answer, two more, an answer — six refusals in all,
        // twice the cap, and never three running.
        for _ in 0..4 {
            for _ in 0..2 {
                assert_eq!(driver.tick(ms(0)), Step::Sample);
                driver.latency.unreadable();
            }
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
            assert_eq!(driver.latency.report(), None, "no run of three refusals");
        }
        // The last answer above already primed the floor, so three timed ones
        // complete it rather than the four `reach_first_press` spends.
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        driver.round(ms(5), ms(16));
        assert_eq!(driver.latency.report().unwrap().ended, Ended::Completed);
    }

    /// When both caps land on the same refusal the floor's is the answer, for
    /// the reason the floor's budget exists: what it measures is a floor that
    /// never completed, whatever the last ask happened to be.
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
        // ask of five, since one answer went before them.
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.answer(ms(17));
        for _ in 0..4 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.latency.unreadable();
        }
        assert_eq!(driver.latency.report().unwrap().ended, Ended::NeverSettled);
    }

    /// A run that ends in refusals must not report the samples it took before
    /// them as a floor: nothing completed, and `lib-latency.sh` would read a
    /// one-sample "floor" as the number every threshold is against.
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

    /// A refusal is not an answer, so it cannot sit in the middle of the run
    /// of agreeing answers the floor's whole claim rests on. It restarts it.
    #[test]
    fn a_refusal_restarts_the_floor_rather_than_leaving_a_hole_in_it() {
        let mut driver = Driver::new(1, 3, 10);
        for _ in 0..3 {
            assert_eq!(driver.tick(ms(0)), Step::Sample);
            driver.answer(ms(17));
        }
        // Two of the three floor samples are in. A refusal now, and the floor
        // owes a whole fresh run rather than one more sample.
        assert_eq!(driver.tick(ms(0)), Step::Sample);
        driver.latency.unreadable();

        // A whole fresh floor is owed — a priming answer and three timed ones,
        // which is what `reach_first_press` spends — not one more sample.
        driver.reach_first_press(ms(17));
        driver.round(ms(5), ms(16));
        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.floor.unwrap().count, 3);
    }

    /// A key that could not be delivered leaves the round started and nothing
    /// able to finish it: the only way out is a commit answering the key. The
    /// round is given up rather than waited on for ever.
    #[test]
    fn a_press_that_went_nowhere_gives_the_round_up() {
        let mut driver = Driver::new(2, 3, 10);
        driver.reach_first_press(ms(17));
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.latency.press_went_nowhere();

        // Straight on to the next round rather than stuck.
        assert_eq!(driver.tick(ms(0)), Step::Press);
        driver.latency.press_went_nowhere();

        let report = driver.latency.report().unwrap();
        assert_eq!(report.ended, Ended::Completed);
        assert_eq!(report.undelivered, 2, "we never asked the client");
        assert_eq!(report.abandoned, 0, "and must not blame it for that");
        assert_eq!(report.commit_to_pixel, None);
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
