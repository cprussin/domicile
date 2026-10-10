//! Tracks which client buffers the engine holds and returns them to clients.
//!
//! Viz samples a client's dmabuf directly, so the compositor may send
//! `wl_buffer.release` only after viz releases the buffer. Releasing earlier
//! lets the client draw into a buffer on screen.
//!
//! A hold that a newer submission replaced has a deadline, timed from the
//! replacement. Past it the buffer is released anyway and the caller logs an
//! error, so a missing release cannot stop a client forever. The newest hold
//! for a surface has no deadline: viz keeps it because it is the frame on
//! screen, for as long as the client is idle.
//!
//! A client that renders in place into a single dmabuf is not covered: its
//! only hold is its newest, so it is never taken back. Shm frames are copied
//! and released at once, and GL swapchains are at least double-buffered.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::engine::{BufferId, SurfaceId};

/// How long viz may keep a superseded buffer before the compositor takes it
/// back.
///
/// Tens of frames at 60Hz, so a slow machine under load does not trip it.
pub const HOLD_DEADLINE: Duration = Duration::from_millis(500);

/// A buffer the engine was given and has not handed back.
#[derive(Debug)]
struct Held<B> {
    buffer: B,
    /// When a newer submission for the same surface replaced this one. The
    /// deadline starts here. `None` while it is the frame on screen.
    superseded: Option<Instant>,
}

/// Why a buffer came back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Returned {
    /// Viz released it.
    Released,
    /// It sat past [`HOLD_DEADLINE`] and was taken back so the client can
    /// draw. The caller logs an error.
    Expired,
    /// The surface or the engine went away, so nothing will release it.
    Abandoned,
}

/// Everything a lost engine was holding. See [`HeldBuffers::take_all`].
#[derive(Debug)]
pub struct Taken<B> {
    /// The frame each surface had on screen. The caller submits it to the new
    /// engine and must not release it.
    pub on_screen: Vec<((SurfaceId, BufferId), B)>,
    /// Frames a newer one had replaced. The caller releases each to its
    /// client.
    pub superseded: Vec<((SurfaceId, BufferId), B)>,
}

/// The buffers the engine is holding, by surface and then buffer id.
///
/// `BrokeredFrameSink` counts buffer ids per sink, so ids are unique only
/// within a surface. Keying on the id alone lets one window's hold evict
/// another's, and the evicted client never gets its release. Keying by surface
/// first keeps a commit's work to its own window's holds.
#[derive(Debug)]
pub struct HeldBuffers<B> {
    held: HashMap<SurfaceId, HashMap<BufferId, Held<B>>>,
    deadline: Duration,
}

impl<B> Default for HeldBuffers<B> {
    fn default() -> Self {
        Self::with_deadline(HOLD_DEADLINE)
    }
}

impl<B> HeldBuffers<B> {
    pub fn with_deadline(deadline: Duration) -> Self {
        Self {
            held: HashMap::new(),
            deadline,
        }
    }

    /// Whether anything is outstanding, or any surface is still listed.
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    /// Holds `buffer` as the frame on screen for `surface` and starts the
    /// deadline of every other hold on `surface` at `now`.
    ///
    /// Resubmitting a held id returns the previous entry. It is the same
    /// buffer, which viz now holds, so the caller must drop it without
    /// releasing it.
    pub fn hold(&mut self, surface: SurfaceId, id: BufferId, buffer: B, now: Instant) -> Option<B> {
        let holds = self.held.entry(surface).or_default();
        for held in holds.values_mut() {
            if held.superseded.is_none() {
                held.superseded = Some(now);
            }
        }
        holds
            .insert(
                id,
                Held {
                    buffer,
                    superseded: None,
                },
            )
            .map(|previous| previous.buffer)
    }

    /// Viz released `id` on `surface`.
    pub fn release(&mut self, surface: SurfaceId, id: BufferId) -> Option<B> {
        let holds = self.held.get_mut(&surface)?;
        let released = holds.remove(&id).map(|held| held.buffer);
        if holds.is_empty() {
            self.held.remove(&surface);
        }
        released
    }

    /// Removes and returns every superseded buffer past its deadline. The
    /// caller logs each one.
    ///
    /// The newest hold for a surface never expires: viz keeps it because it is
    /// on screen. The deadline runs from replacement, so viz has time to draw
    /// the newer frame before the old one is taken back.
    pub fn expired(&mut self, now: Instant) -> Vec<((SurfaceId, BufferId), B)> {
        let deadline = self.deadline;
        let expired = self
            .held
            .iter_mut()
            .flat_map(|(surface, holds)| {
                holds
                    .extract_if(|_, held| {
                        held.superseded
                            .is_some_and(|superseded| now.duration_since(superseded) >= deadline)
                    })
                    .map(|(id, held)| ((*surface, id), held.buffer))
            })
            .collect();
        self.held.retain(|_, holds| !holds.is_empty());
        expired
    }

    /// Removes every hold after the engine is lost, split into each surface's
    /// on-screen frame and the rest.
    ///
    /// The new engine knows none of these ids, so nothing may stay held.
    /// Resubmitting the on-screen frames keeps windows from coming back blank.
    pub fn take_all(&mut self) -> Taken<B> {
        let (kept, returned) = self
            .held
            .drain()
            .flat_map(|(surface, holds)| {
                holds
                    .into_iter()
                    .map(move |(id, held)| ((surface, id), held))
            })
            .partition::<Vec<_>, _>(|(_, held)| held.superseded.is_none());
        Taken {
            on_screen: kept
                .into_iter()
                .map(|(key, held)| (key, held.buffer))
                .collect(),
            superseded: returned
                .into_iter()
                .map(|(key, held)| (key, held.buffer))
                .collect(),
        }
    }

    /// Removes every hold for `surface` after the surface is gone.
    pub fn abandon(&mut self, surface: SurfaceId) -> Vec<((SurfaceId, BufferId), B)> {
        self.held
            .remove(&surface)
            .unwrap_or_default()
            .into_iter()
            .map(|(id, held)| ((surface, id), held.buffer))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SURFACE: SurfaceId = 1;

    fn at(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    #[test]
    fn a_held_buffer_is_not_released_until_viz_says_so() {
        let now = Instant::now();
        let mut held = HeldBuffers::default();

        assert!(held.hold(SURFACE, 7, "buffer", now).is_none());
        assert!(!held.is_empty());
        assert_eq!(held.release(SURFACE, 7), Some("buffer"));
        assert!(held.is_empty());
    }

    #[test]
    fn a_release_for_something_never_held_is_not_a_buffer() {
        let mut held: HeldBuffers<&str> = HeldBuffers::default();

        assert_eq!(held.release(SURFACE, 7), None);
    }

    // Viz keeps an idle client's last buffer because it is on screen.
    #[test]
    fn the_latest_submission_is_never_overdue() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 7, "on screen", now);

        assert!(
            held.expired(at(now, 5_000)).is_empty(),
            "an idle client's displayed buffer is viz's to hold for as long as \
             it is displayed"
        );
    }

    // The deadline runs from the replacement, since the old frame stays on
    // screen until then.
    #[test]
    fn a_superseded_buffer_viz_never_releases_is_taken_back() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 1, "old", now);
        held.hold(SURFACE, 2, "new", at(now, 2_600));

        assert!(
            held.expired(at(now, 3_099)).is_empty(),
            "the old one was on screen until 2600, so viz has had 499 ms to \
             hand it back, not 3099"
        );
        assert_eq!(held.expired(at(now, 3_100)), vec![((SURFACE, 1), "old")]);
        assert_eq!(
            held.release(SURFACE, 2),
            Some("new"),
            "and the one on screen is still there"
        );
    }

    // A surface whose last hold expires is not left listed, empty.
    #[test]
    fn a_surface_whose_holds_all_expire_is_dropped() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 1, "old", now);
        held.hold(SURFACE, 2, "new", now);
        held.release(SURFACE, 2);

        assert_eq!(held.expired(at(now, 500)), vec![((SURFACE, 1), "old")]);
        assert!(held.is_empty());
    }

    // Two surfaces do not supersede each other. Each keeps its own latest.
    #[test]
    fn one_windows_new_frame_does_not_strand_anothers() {
        const OTHER: SurfaceId = 99;
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 1, "mine", now);
        held.hold(OTHER, 1, "theirs", at(now, 10));

        assert!(held.expired(at(now, 5_000)).is_empty());
    }

    // A buffer committed twice is owed one release. The older entry comes back
    // for the caller to drop.
    #[test]
    fn resubmitting_a_buffer_hands_the_previous_hold_back() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 7, "first", now);

        assert_eq!(held.hold(SURFACE, 7, "second", at(now, 400)), Some("first"));
        assert!(
            held.expired(at(now, 5_000)).is_empty(),
            "and what is left is the surface's only hold, which is the frame \
             on screen rather than something viz forgot"
        );
        assert_eq!(held.release(SURFACE, 7), Some("second"));
    }

    // No release arrives for a lost surface, so its buffers return at once.
    #[test]
    fn a_lost_surface_gives_its_buffers_back_at_once() {
        let now = Instant::now();
        let mut held = HeldBuffers::default();
        held.hold(SURFACE, 1, "mine", now);
        held.hold(SURFACE + 1, 2, "theirs", now);

        assert_eq!(held.abandon(SURFACE), vec![((SURFACE, 1), "mine")]);
        assert_eq!(
            held.release(SURFACE + 1, 2),
            Some("theirs"),
            "the other surface keeps its own"
        );
    }

    // A new engine knows none of the old ids, so every hold comes back, with
    // each surface's on-screen frame marked for resubmission.
    #[test]
    fn a_new_engine_takes_every_hold_and_says_which_was_on_screen() {
        let now = Instant::now();
        let mut held = HeldBuffers::default();
        held.hold(SURFACE, 1, "superseded", now);
        held.hold(SURFACE, 2, "on screen", at(now, 10));
        held.hold(SURFACE + 1, 1, "the other window", at(now, 5));

        let mut taken = held.take_all();
        taken.on_screen.sort_by_key(|(key, _)| *key);
        taken.superseded.sort_by_key(|(key, _)| *key);

        assert_eq!(
            taken.on_screen,
            vec![
                ((SURFACE, 2), "on screen"),
                ((SURFACE + 1, 1), "the other window"),
            ]
        );
        assert_eq!(taken.superseded, vec![((SURFACE, 1), "superseded")]);
        assert!(
            held.is_empty(),
            "a hold kept past a reconnect is a release nothing will ever send"
        );
    }

    // Submission order, not the timestamp, decides which frame is on screen.
    #[test]
    fn two_frames_stamped_the_same_instant_leave_one_on_screen() {
        let now = Instant::now();
        let mut held = HeldBuffers::default();
        held.hold(SURFACE, 1, "first", now);
        held.hold(SURFACE, 2, "second", now);

        let taken = held.take_all();

        assert_eq!(taken.on_screen, vec![((SURFACE, 2), "second")]);
        assert_eq!(taken.superseded, vec![((SURFACE, 1), "first")]);
    }

    // `BrokeredFrameSink` counts buffer ids per sink, so two windows can both
    // have buffer 1.
    #[test]
    fn two_surfaces_may_use_the_same_buffer_id() {
        let now = Instant::now();
        let mut held = HeldBuffers::default();

        assert!(held.hold(SURFACE, 1, "first window", now).is_none());
        assert!(
            held.hold(SURFACE + 1, 1, "second window", now).is_none(),
            "the second window's buffer 1 is not the first window's"
        );

        assert_eq!(held.release(SURFACE, 1), Some("first window"));
        assert_eq!(
            held.release(SURFACE + 1, 1),
            Some("second window"),
            "and releasing one does not release the other"
        );
        assert!(held.is_empty());
    }

    #[test]
    // Each surface's holds expire based on its own submissions.
    fn each_surfaces_hold_has_its_own_deadline() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 1, "leaked", now);
        held.hold(SURFACE, 2, "on screen", at(now, 10));
        held.hold(SURFACE + 1, 1, "second window", at(now, 400));

        assert_eq!(
            held.expired(at(now, 600)),
            vec![((SURFACE, 1), "leaked")],
            "only the superseded buffer is overdue"
        );
        assert_eq!(held.release(SURFACE, 2), Some("on screen"));
        assert_eq!(held.release(SURFACE + 1, 1), Some("second window"));
    }
}
