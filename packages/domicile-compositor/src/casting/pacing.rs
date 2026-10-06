//! When a stream's next frame is filled and sent.
//!
//! PipeWire lends the Wayland thread empty buffers. A damaged commit fills the
//! oldest lent buffer, and the buffer is sent no sooner than one frame interval
//! after the last. A commit that lands inside the interval refills the buffer
//! that is waiting, so the consumer gets the newest frame, not the first.
//!
//! A commit that finds no lent buffer is dropped. Its damage is kept and sent
//! with the next frame, because the consumer's copy has not seen it.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// A rectangle as `(x, y, width, height)` in buffer pixels.
pub type Rect = (i32, i32, i32, i32);

/// The most rectangles a frame's damage carries. More are merged into their
/// bounding box, as a consumer gains little from a long list.
pub const MOST_RECTS: usize = 16;

/// One stream's lent buffers and timing.
#[derive(Debug)]
pub struct Pacing<B> {
    interval: Duration,
    last_sent: Option<Instant>,
    lent: VecDeque<B>,
    /// The buffer holding a frame that waits for the interval to pass.
    filled: Option<B>,
    /// Everything damaged since the last frame sent.
    damage: Vec<Rect>,
}

/// What [`Pacing::due`] says to do.
#[derive(Debug, PartialEq, Eq)]
pub enum Due<B> {
    /// Send this buffer, with this damage.
    Send { buffer: B, damage: Vec<Rect> },
    /// A filled buffer waits; ask again at this instant.
    At(Instant),
    /// Nothing is filled.
    Nothing,
}

impl<B: Copy + PartialEq> Pacing<B> {
    /// Pacing for a stream that sends at most `framerate` frames a second.
    pub fn new(framerate: u32) -> Self {
        Self {
            interval: Duration::from_secs(1) / framerate,
            last_sent: None,
            lent: VecDeque::new(),
            filled: None,
            damage: Vec::new(),
        }
    }

    /// PipeWire lent `buffer` to be filled.
    pub fn lent(&mut self, buffer: B) {
        self.lent.push_back(buffer);
    }

    /// PipeWire took its buffers back to make new ones, as on a resize.
    pub fn forget_buffers(&mut self) {
        self.lent.clear();
        self.filled = None;
    }

    /// The source committed a frame damaged in `rects`. Returns the buffer to
    /// fill with it, or `None` when every buffer is with the consumer.
    pub fn damaged(&mut self, rects: &[Rect]) -> Option<B> {
        self.damage.extend_from_slice(rects);
        if self.damage.len() > MOST_RECTS {
            self.damage = vec![bounding_box(&self.damage)];
        }
        if self.filled.is_none() {
            self.filled = self.lent.pop_front();
        }
        self.filled
    }

    /// Whether damage waits for a buffer to be filled.
    pub fn owed(&self) -> bool {
        self.filled.is_none() && !self.damage.is_empty()
    }

    /// When the filled buffer that waits is due, if one does.
    pub fn waiting_until(&self) -> Option<Instant> {
        self.filled
            .and(self.last_sent)
            .map(|sent| sent + self.interval)
    }

    /// Whether a filled buffer is due at `now`. A `Send` counts as sent.
    pub fn due(&mut self, now: Instant) -> Due<B> {
        let at = self.last_sent.map(|sent| sent + self.interval);
        match (self.filled, at) {
            (None, _) => Due::Nothing,
            (Some(_), Some(at)) if now < at => Due::At(at),
            (Some(buffer), _) => {
                self.filled = None;
                self.last_sent = Some(now);
                Due::Send {
                    buffer,
                    damage: std::mem::take(&mut self.damage),
                }
            }
        }
    }
}

/// `damage` in buffer pixels, as the part of it inside `crop`, relative to
/// the crop's origin. `None` when it misses the crop.
pub fn within(damage: Rect, crop: Rect) -> Option<Rect> {
    let left = damage.0.max(crop.0);
    let top = damage.1.max(crop.1);
    let right = (damage.0.saturating_add(damage.2)).min(crop.0 + crop.2);
    let bottom = (damage.1.saturating_add(damage.3)).min(crop.1 + crop.3);
    (right > left && bottom > top)
        .then(|| (left - crop.0, top - crop.1, right - left, bottom - top))
}

/// The smallest rectangle holding every one of `rects`.
fn bounding_box(rects: &[Rect]) -> Rect {
    let (left, top, right, bottom) = rects.iter().fold(
        (i32::MAX, i32::MAX, i32::MIN, i32::MIN),
        |(left, top, right, bottom), &(x, y, width, height)| {
            (
                left.min(x),
                top.min(y),
                right.max(x + width),
                bottom.max(y + height),
            )
        },
    );
    (left, top, right - left, bottom - top)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{within, Due, Pacing, MOST_RECTS};

    const WHOLE: (i32, i32, i32, i32) = (0, 0, 320, 240);

    #[test]
    fn a_first_damaged_frame_is_sent_at_once() {
        let mut pacing = Pacing::new(60);
        pacing.lent(1);
        let now = Instant::now();

        assert_eq!(pacing.damaged(&[WHOLE]), Some(1));
        assert_eq!(
            pacing.due(now),
            Due::Send {
                buffer: 1,
                damage: vec![WHOLE],
            }
        );
        assert_eq!(pacing.due(now), Due::Nothing);
    }

    #[test]
    fn a_frame_inside_the_interval_waits_and_a_newer_one_replaces_it() {
        let mut pacing = Pacing::new(10);
        pacing.lent(1);
        pacing.lent(2);
        let start = Instant::now();
        pacing.damaged(&[WHOLE]);
        pacing.due(start);

        // Two commits inside the 100 ms interval: the second refills the
        // buffer the first filled.
        assert_eq!(pacing.damaged(&[(0, 0, 10, 10)]), Some(2));
        assert_eq!(pacing.damaged(&[(20, 20, 10, 10)]), Some(2));
        let later = start + Duration::from_millis(40);
        assert_eq!(
            pacing.due(later),
            Due::At(start + Duration::from_millis(100))
        );

        assert_eq!(
            pacing.due(start + Duration::from_millis(100)),
            Due::Send {
                buffer: 2,
                damage: vec![(0, 0, 10, 10), (20, 20, 10, 10)],
            }
        );
    }

    #[test]
    fn a_starved_commit_is_dropped_and_its_damage_rides_the_next_frame() {
        let mut pacing = Pacing::new(60);
        let start = Instant::now();

        assert_eq!(pacing.damaged(&[(0, 0, 10, 10)]), None);
        assert_eq!(pacing.due(start), Due::Nothing);

        pacing.lent(7);
        assert_eq!(pacing.damaged(&[(50, 50, 10, 10)]), Some(7));
        assert_eq!(
            pacing.due(start),
            Due::Send {
                buffer: 7,
                damage: vec![(0, 0, 10, 10), (50, 50, 10, 10)],
            }
        );
    }

    #[test]
    fn too_many_rectangles_become_their_bounding_box() {
        let mut pacing = Pacing::new(60);
        pacing.lent(1);
        let rects: Vec<_> = (0..=MOST_RECTS as i32)
            .map(|at| (at * 10, at * 5, 2, 3))
            .collect();

        pacing.damaged(&rects);

        let last = MOST_RECTS as i32;
        assert_eq!(
            pacing.due(Instant::now()),
            Due::Send {
                buffer: 1,
                damage: vec![(0, 0, last * 10 + 2, last * 5 + 3)],
            }
        );
    }

    #[test]
    fn forgotten_buffers_are_not_filled() {
        let mut pacing = Pacing::new(60);
        pacing.lent(1);
        pacing.lent(2);
        pacing.damaged(&[WHOLE]);

        pacing.forget_buffers();

        assert_eq!(pacing.due(Instant::now()), Due::Nothing);
        assert_eq!(pacing.damaged(&[WHOLE]), None);
    }

    #[test]
    fn damage_is_clipped_to_the_crop_and_moved_to_its_origin() {
        let crop = (10, 20, 100, 50);

        assert_eq!(within((0, 0, 30, 30), crop), Some((0, 0, 20, 10)));
        assert_eq!(within((50, 40, 1000, 5), crop), Some((40, 20, 60, 5)));
        assert_eq!(within((200, 0, 10, 10), crop), None);
    }

    #[test]
    fn damage_without_a_buffer_is_owed_until_one_is_filled() {
        let mut pacing = Pacing::new(60);
        assert!(!pacing.owed());

        pacing.damaged(&[WHOLE]);
        assert!(pacing.owed());

        pacing.lent(1);
        assert_eq!(pacing.damaged(&[]), Some(1));
        assert!(!pacing.owed());
    }

    #[test]
    fn only_a_filled_frame_inside_the_interval_waits() {
        let mut pacing = Pacing::new(10);
        pacing.lent(1);
        pacing.lent(2);
        let start = Instant::now();
        assert_eq!(pacing.waiting_until(), None);
        pacing.damaged(&[WHOLE]);
        pacing.due(start);
        assert_eq!(pacing.waiting_until(), None);

        pacing.damaged(&[WHOLE]);

        assert_eq!(
            pacing.waiting_until(),
            Some(start + Duration::from_millis(100))
        );
    }
}
