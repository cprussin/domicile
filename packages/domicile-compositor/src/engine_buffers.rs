//! Which client buffers the engine is holding, and getting them back.
//!
//! Under the copy path a `wl_buffer` is released the moment its pixels have
//! been read: the compositor owns them from then on and the client may draw
//! again. Under the engine it may not. Viz samples the client's dmabuf
//! directly, so the release has to wait for viz to say it is done — that is
//! what `wl_buffer.release` means and it is the difference between a window and
//! a tear.
//!
//! Waiting introduces a way to hang that the copy path did not have. A
//! single-buffered client with one buffer outstanding cannot draw at all, so if
//! the release never comes it stops forever, and a compositor that quietly
//! stops a client is the defect `ERRORS.md` exists to prevent. So a hold has a
//! deadline: past it the buffer is released anyway and the caller is told, loud
//! enough to debug. A frame that tears once is worse than a frame that does
//! not; a client that never draws again is worse than both.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::engine::{BufferId, SurfaceId};

/// How long a buffer may sit with viz before the compositor takes it back.
///
/// Generous by the standards of a 60Hz display — tens of frames — because the
/// only thing on the other side of it is a bug, and a slow machine under load
/// is not one. Short enough that a stuck client is noticed in a session rather
/// than in a bug report.
pub const HOLD_DEADLINE: Duration = Duration::from_millis(500);

/// A buffer the engine was given and has not handed back.
#[derive(Debug)]
struct Held<B> {
    buffer: B,
    since: Instant,
}

/// Why a buffer came back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Returned {
    /// Viz released it, which is the ordinary path.
    Released,
    /// It sat past [`HOLD_DEADLINE`] and was taken back so the client could
    /// draw. Something is wrong and the caller is expected to say so.
    Expired,
    /// The surface or the engine went away, so nothing will ever release it.
    Abandoned,
}

/// The buffers the engine is holding, keyed by the surface **and** the id it
/// knows them by.
///
/// Both halves, and the second window is what says so. A `BufferId` is minted
/// by the browser's `BrokeredFrameSink`, one counter per sink, so the first
/// buffer of every window is 1 — the ids are only unique within a surface, and
/// the protocol says as much by qualifying every one of them with a
/// `frame_sink_id`. Keyed on the id alone, a second window's first buffer
/// evicted the first window's, whose client was then owed a release that could
/// never arrive; it stopped drawing, and the compositor reported that viz was
/// holding a buffer it had finished with. That is a plausible enough story to
/// have gone looking in viz for it, which is where the afternoon goes.
#[derive(Debug)]
pub struct HeldBuffers<B> {
    held: HashMap<(SurfaceId, BufferId), Held<B>>,
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

    /// Whether anything is outstanding. The compositor does not ask; the tests
    /// do, because "released" and "released twice" look the same from outside.
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    /// Records that `buffer` was submitted and must not be released yet.
    ///
    /// Submitting the same id on the same surface again — a client committing
    /// one buffer twice — replaces the hold and restarts its deadline, and
    /// hands back the previous entry. That entry is the *same* buffer, because
    /// a surface and an id together name one buffer, so it is the caller's to
    /// **drop and not release**: viz has just been handed it, and the client is
    /// owed exactly one release, when viz is done with the submission it
    /// actually has.
    pub fn hold(&mut self, surface: SurfaceId, id: BufferId, buffer: B, now: Instant) -> Option<B> {
        self.held
            .insert((surface, id), Held { buffer, since: now })
            .map(|previous| previous.buffer)
    }

    /// Viz released `id` on `surface`.
    pub fn release(&mut self, surface: SurfaceId, id: BufferId) -> Option<B> {
        self.held.remove(&(surface, id)).map(|held| held.buffer)
    }

    /// Every buffer that has sat longer than the deadline, taken back so the
    /// client can draw. The caller is expected to log each one.
    pub fn expired(&mut self, now: Instant) -> Vec<((SurfaceId, BufferId), B)> {
        let overdue: Vec<(SurfaceId, BufferId)> = self
            .held
            .iter()
            .filter(|(_, held)| now.duration_since(held.since) >= self.deadline)
            .map(|(key, _)| *key)
            .collect();
        overdue
            .into_iter()
            .filter_map(|key| self.held.remove(&key).map(|held| (key, held.buffer)))
            .collect()
    }

    /// Everything held for `surface`, because the surface is gone and no
    /// release will ever arrive for it.
    pub fn abandon(&mut self, surface: SurfaceId) -> Vec<((SurfaceId, BufferId), B)> {
        let orphaned: Vec<(SurfaceId, BufferId)> = self
            .held
            .iter()
            .filter(|((held_surface, _), _)| *held_surface == surface)
            .map(|(key, _)| *key)
            .collect();
        orphaned
            .into_iter()
            .filter_map(|key| self.held.remove(&key).map(|held| (key, held.buffer)))
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

    // The hazard this whole module exists for: a client with one buffer cannot
    // draw until it gets that buffer back, so a release that never arrives is a
    // client that stops forever. Past the deadline the compositor takes it back
    // rather than letting that happen.
    #[test]
    fn a_buffer_viz_never_releases_is_taken_back_past_the_deadline() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 7, "buffer", now);

        assert!(
            held.expired(at(now, 499)).is_empty(),
            "a buffer inside the deadline is viz's to hold"
        );
        assert_eq!(held.expired(at(now, 500)), vec![((SURFACE, 7), "buffer")]);
        assert!(held.is_empty(), "and it is not held twice over");
    }

    #[test]
    fn only_the_overdue_buffers_are_taken_back() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 1, "old", now);
        held.hold(SURFACE, 2, "new", at(now, 400));

        assert_eq!(held.expired(at(now, 600)), vec![((SURFACE, 1), "old")]);
        assert_eq!(held.release(SURFACE, 2), Some("new"));
    }

    // A client that commits the same buffer twice has not given the compositor
    // two buffers to release. The older entry comes back so the caller can drop
    // it — releasing it would hand the client a buffer viz has just been given
    // — and the deadline restarts on the submission viz actually has.
    #[test]
    fn resubmitting_a_buffer_hands_the_previous_hold_back() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 7, "first", now);

        assert_eq!(held.hold(SURFACE, 7, "second", at(now, 400)), Some("first"));
        assert!(
            held.expired(at(now, 600)).is_empty(),
            "the deadline runs from the newer submission"
        );
        assert_eq!(held.expired(at(now, 900)), vec![((SURFACE, 7), "second")]);
    }

    // A surface that goes away takes its buffers with it: no release will ever
    // arrive, and waiting out the deadline for each would stall the client for
    // no reason.
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

    // THE TWO-WINDOW BUG, and the reason this map is keyed by a pair.
    //
    // `BrokeredFrameSink` mints buffer ids from a counter of its own, one per
    // sink, so the first buffer of the second window is 1 exactly as the first
    // window's was. Keyed on the id alone, this hold evicted the other
    // window's — silently, and returning it to a caller whose contract is to
    // drop what comes back, because "the same id is the same buffer" was true
    // of one surface and of nothing else. The evicted client was then owed a
    // release that could never arrive, and stopped drawing.
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

    // The same collision seen from the deadline: with one key per id, the
    // second window's hold replaced the first's and the first's deadline went
    // with it, so nothing was ever reported overdue for a client that had in
    // fact stopped.
    #[test]
    fn each_surfaces_hold_has_its_own_deadline() {
        let now = Instant::now();
        let mut held = HeldBuffers::with_deadline(Duration::from_millis(500));
        held.hold(SURFACE, 1, "first window", now);
        held.hold(SURFACE + 1, 1, "second window", at(now, 400));

        assert_eq!(
            held.expired(at(now, 600)),
            vec![((SURFACE, 1), "first window")],
            "only the older window's buffer is overdue"
        );
        assert_eq!(held.release(SURFACE + 1, 1), Some("second window"));
    }
}
