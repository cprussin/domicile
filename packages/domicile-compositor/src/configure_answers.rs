//! Which of the engine's configures a client's commit answers.
//!
//! The engine numbers each box the page lays an `<app>` out at and shows a
//! frame at the box it names. A commit answers the last `xdg_toplevel.configure`
//! the client acked, so naming that configure's box keeps an old buffer at its
//! old size instead of stretching it over the new one.
//!
//! It also paces resizes: at most one size change per toplevel is unanswered.
//! Newer boxes wait, and only the newest goes out when the client commits or
//! after [`PATIENCE`].

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::engine::LAST_SHOWN_BOX;

/// How long a resize waits for the client to answer the one before it. Past
/// it the newest size goes out anyway, so a client that never commits still
/// gets its final size.
pub const PATIENCE: Duration = Duration::from_millis(500);

/// A size for a toplevel, at one of the engine's boxes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resize {
    pub number: u64,
    pub device_size: (u32, u32),
    /// The logical size the configure carries.
    pub size: (u32, u32),
}

/// What to do with a resize. See [`ConfigureAnswers::resize`].
#[derive(Debug, PartialEq, Eq)]
pub enum Resized {
    /// Send it now, then call [`ConfigureAnswers::sent`].
    Send(Resize),
    /// It waits for the client. Call [`ConfigureAnswers::overdue`] at this
    /// time in case the client never answers.
    Waits(Instant),
    /// It replaced a resize already waiting, whose timer still runs.
    Coalesced,
}

/// The engine's configures sent to one toplevel and not yet answered, oldest
/// first, and the resize waiting behind them.
///
/// Paced as in mutter. During a drag the page lays the window out every frame,
/// and a client slower than that would fall further behind each frame.
#[derive(Debug)]
pub struct ConfigureAnswers<S> {
    sent: VecDeque<(S, u64, (u32, u32))>,
    /// The size last sent.
    size: Option<(u32, u32)>,
    /// The serial of the size change the client has not answered, and when it
    /// went out.
    unanswered: Option<(S, Instant)>,
    /// The newest resize, held until the client answers.
    waiting: Option<Resize>,
}

impl<S: PartialOrd + Copy> ConfigureAnswers<S> {
    pub fn new() -> Self {
        Self {
            sent: VecDeque::new(),
            size: None,
            unanswered: None,
            waiting: None,
        }
    }

    /// The engine laid the toplevel out at a new box. It goes out now unless
    /// a size change is unanswered. A resize back to the size last sent goes
    /// out at once: a client may not redraw for it, so nothing waits on it.
    pub fn resize(&mut self, resize: Resize, now: Instant) -> Resized {
        match self.unanswered {
            Some((_, since)) if self.size != Some(resize.size) && now < since + PATIENCE => {
                match self.waiting.replace(resize) {
                    Some(_) => Resized::Coalesced,
                    None => Resized::Waits(since + PATIENCE),
                }
            }
            _ => {
                self.waiting = None;
                Resized::Send(resize)
            }
        }
    }

    /// The configure with `serial` carried `resize`.
    pub fn sent(&mut self, serial: S, resize: Resize, now: Instant) {
        self.sent
            .push_back((serial, resize.number, resize.device_size));
        if self.size != Some(resize.size) {
            self.size = Some(resize.size);
            self.unanswered = Some((serial, now));
        }
    }

    /// The client committed after acking `acked`. The resize to send now, if
    /// one waited for this commit.
    pub fn committed(&mut self, acked: Option<S>) -> Option<Resize> {
        match (self.unanswered, acked) {
            (Some((serial, _)), Some(acked)) if serial <= acked => {
                self.unanswered = None;
                self.waiting.take()
            }
            _ => None,
        }
    }

    /// The resize to send now because the client took too long to answer.
    pub fn overdue(&mut self, now: Instant) -> Option<Resize> {
        match self.unanswered {
            Some((_, since)) if now >= since + PATIENCE => self.waiting.take(),
            _ => None,
        }
    }

    /// The box a commit answers, given the serial the client last acked. A
    /// client that acked no numbered configure answers [`LAST_SHOWN_BOX`].
    /// Forgets the boxes before the one answered.
    pub fn answered(&mut self, acked: Option<S>) -> u64 {
        let newest = acked.and_then(|acked| {
            self.sent
                .iter()
                .rposition(|(serial, _, _)| *serial <= acked)
        });
        match newest {
            Some(newest) => {
                self.sent.drain(..newest);
                self.sent[0].1
            }
            None => LAST_SHOWN_BOX,
        }
    }

    /// The size of the box `number`, if this toplevel still answers it.
    pub fn box_size(&self, number: u64) -> Option<(u32, u32)> {
        self.sent
            .iter()
            .find(|(_, sent, _)| *sent == number)
            .map(|(_, _, size)| *size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZE: (u32, u32) = (640, 480);

    #[test]
    fn a_commit_answers_the_newest_box_the_client_acked() {
        let mut answers = ConfigureAnswers::new();
        answers.sent(10_u32, resize(1, SIZE), Instant::now());
        answers.sent(11, resize(2, SIZE), Instant::now());
        answers.sent(12, resize(3, SIZE), Instant::now());
        assert_eq!(answers.answered(Some(11)), 2);
        // Still the same box until the client acks a newer one.
        assert_eq!(answers.answered(Some(11)), 2);
        assert_eq!(answers.answered(Some(12)), 3);
    }

    #[test]
    fn a_commit_before_any_numbered_configure_answers_the_box_shown_last() {
        let mut answers = ConfigureAnswers::new();
        assert_eq!(answers.answered(None), LAST_SHOWN_BOX);
        answers.sent(10_u32, resize(1, SIZE), Instant::now());
        // The initial configure, sent before the page laid the window out.
        assert_eq!(answers.answered(Some(9)), LAST_SHOWN_BOX);
    }

    #[test]
    fn the_box_a_commit_answers_has_the_size_the_engine_sent() {
        let mut answers = ConfigureAnswers::new();
        answers.sent(10_u32, resize(1, (640, 480)), Instant::now());
        answers.sent(11, resize(2, (800, 600)), Instant::now());

        let answered = answers.answered(Some(10));

        assert_eq!(answers.box_size(answered), Some((640, 480)));
        // Which box was shown last is the engine's to know.
        assert_eq!(answers.box_size(LAST_SHOWN_BOX), None);
    }

    fn resize(number: u64, size: (u32, u32)) -> Resize {
        Resize {
            number,
            device_size: size,
            size,
        }
    }

    #[test]
    fn a_resize_waits_for_the_client_to_answer_the_last_one() {
        let start = Instant::now();
        let mut answers = ConfigureAnswers::new();
        assert_eq!(
            answers.resize(resize(1, (640, 480)), start),
            Resized::Send(resize(1, (640, 480)))
        );
        answers.sent(10_u32, resize(1, (640, 480)), start);

        assert_eq!(
            answers.resize(resize(2, (650, 480)), start),
            Resized::Waits(start + PATIENCE)
        );
        assert_eq!(
            answers.resize(resize(3, (660, 480)), start),
            Resized::Coalesced
        );
        // A commit that acked an older configure answers nothing.
        assert_eq!(answers.committed(Some(9)), None);

        // Only the newest size goes out.
        assert_eq!(answers.committed(Some(10)), Some(resize(3, (660, 480))));
        assert_eq!(answers.committed(Some(10)), None);
    }

    #[test]
    fn a_resize_to_the_size_last_sent_goes_out_at_once() {
        let start = Instant::now();
        let mut answers = ConfigureAnswers::new();
        answers.sent(10_u32, resize(1, (640, 480)), start);
        answers.resize(resize(2, (650, 480)), start);

        // The newest box replaces the one waiting, and names a size the
        // client may never redraw for, so nothing waits on it.
        assert_eq!(
            answers.resize(resize(3, (640, 480)), start),
            Resized::Send(resize(3, (640, 480)))
        );
        answers.sent(11, resize(3, (640, 480)), start);
        assert_eq!(answers.committed(Some(10)), None);
        assert_eq!(
            answers.resize(resize(4, (700, 480)), start),
            Resized::Send(resize(4, (700, 480)))
        );
    }

    #[test]
    fn a_client_that_never_answers_gets_the_newest_size_after_a_while() {
        let start = Instant::now();
        let mut answers = ConfigureAnswers::new();
        answers.sent(10_u32, resize(1, (640, 480)), start);
        answers.resize(resize(2, (650, 480)), start);

        assert_eq!(answers.overdue(start + PATIENCE / 2), None);
        assert_eq!(
            answers.overdue(start + PATIENCE),
            Some(resize(2, (650, 480)))
        );
        assert_eq!(answers.overdue(start + PATIENCE), None);
        // And a resize past the patience goes out without waiting.
        assert_eq!(
            answers.resize(resize(3, (660, 480)), start + PATIENCE),
            Resized::Send(resize(3, (660, 480)))
        );
    }
}
