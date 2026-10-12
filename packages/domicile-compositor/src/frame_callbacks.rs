//! Frame callbacks and presentation feedback waiting on the engine.
//!
//! A commit's `wl_surface.frame` callbacks go out when viz takes its frame
//! (`Event::FrameDone`), so a client draws at the rate the screen shows it.
//! Its `wp_presentation_feedback` goes out when the frame reaches the screen
//! (`Event::Presented`). Each frame waits under its window's app id and the
//! number the engine gives it (`EngineSession::frame_of`).
//!
//! A frame the session holds back for an import or an embed has no number
//! yet. Its commit's callbacks and feedback are held by window until it goes
//! up ([`FrameCallbacks::submitted`]), and a newer frame answers them
//! ([`FrameCallbacks::hold`]).
//!
//! A frame the engine never reports still answers its client: after
//! [`DEADLINE`] its callbacks go out and its feedback is discarded
//! ([`FrameCallbacks::overdue`]).
//!
//! Times are on `CLOCK_MONOTONIC`, the engine's presentation clock.

use std::collections::{HashMap, VecDeque};
use std::time::Duration;

/// How long a frame waits for the engine before its client is answered
/// anyway.
pub const DEADLINE: Duration = Duration::from_millis(250);

/// What waits for each window's frames, by app id.
#[derive(Debug)]
pub struct FrameCallbacks<C, F> {
    waiting: HashMap<String, VecDeque<Waiting<C, F>>>,
    /// The commit of each window's frame that has not gone up yet.
    held: HashMap<String, Held<C, F>>,
}

/// A commit whose frame the session holds back.
#[derive(Debug)]
struct Held<C, F> {
    committed: Duration,
    callbacks: Vec<C>,
    feedback: Vec<F>,
}

/// One frame the engine has not finished reporting.
#[derive(Debug)]
struct Waiting<C, F> {
    frame: u64,
    committed: Duration,
    /// `None` once the frame is done.
    callbacks: Option<Vec<C>>,
    /// `None` once the frame is presented.
    feedback: Option<Vec<F>>,
}

/// A frame the engine reported presented.
#[derive(Debug, PartialEq)]
pub struct Presented<F> {
    pub feedback: Vec<F>,
    /// When it was committed, for the frame report's latency.
    pub committed: Duration,
}

/// What to send without the engine: callbacks to answer, feedback to discard.
#[derive(Debug, PartialEq)]
pub struct Unreported<C, F> {
    pub callbacks: Vec<C>,
    pub discarded: Vec<F>,
}

impl<C, F> FrameCallbacks<C, F> {
    pub fn new() -> Self {
        Self {
            waiting: HashMap::new(),
            held: HashMap::new(),
        }
    }

    /// `window` submitted `frame` at `committed`, with what its commit asked
    /// for. Returns the held commit it replaced, to answer.
    pub fn wait(
        &mut self,
        window: &str,
        frame: u64,
        callbacks: Vec<C>,
        feedback: Vec<F>,
        committed: Duration,
    ) -> Unreported<C, F> {
        self.waiting
            .entry(window.to_string())
            .or_default()
            .push_back(Waiting {
                frame,
                committed,
                callbacks: Some(callbacks),
                feedback: Some(feedback),
            });
        self.replace_held(window, None)
    }

    /// `window` committed at `committed` a frame the session holds back.
    /// Returns the held commit it replaced, to answer.
    pub fn hold(
        &mut self,
        window: &str,
        callbacks: Vec<C>,
        feedback: Vec<F>,
        committed: Duration,
    ) -> Unreported<C, F> {
        let held = Held {
            committed,
            callbacks,
            feedback,
        };
        self.replace_held(window, Some(held))
    }

    /// `window`'s held frame went up as `frame`. Nothing waits if
    /// [`DEADLINE`] already answered it.
    pub fn submitted(&mut self, window: &str, frame: u64) {
        if let Some(held) = self.held.remove(window) {
            self.wait(window, frame, held.callbacks, held.feedback, held.committed);
        }
    }

    /// The engine took `window`'s `frame`: the callbacks to answer. The engine
    /// reports frames in order, so older frames are done too.
    pub fn done(&mut self, window: &str, frame: u64) -> Vec<C> {
        let callbacks = self
            .frames_of(window)
            .filter(|waiting| waiting.frame <= frame)
            .filter_map(|waiting| waiting.callbacks.take())
            .flatten()
            .collect();
        self.drop_reported(window);
        callbacks
    }

    /// `window`'s `frame` reached the screen, or never will. `None` if it is
    /// not waiting: it went past [`DEADLINE`] or its window went away.
    pub fn presented(&mut self, window: &str, frame: u64) -> Option<Presented<F>> {
        let presented = self
            .frames_of(window)
            .find(|waiting| waiting.frame == frame)
            .and_then(|waiting| {
                let committed = waiting.committed;
                waiting.feedback.take().map(|feedback| Presented {
                    feedback,
                    committed,
                })
            });
        self.drop_reported(window);
        presented
    }

    /// Frames committed [`DEADLINE`] or longer before `now`, which stop
    /// waiting.
    pub fn overdue(&mut self, now: Duration) -> Unreported<C, F> {
        let mut unreported = Unreported {
            callbacks: Vec::new(),
            discarded: Vec::new(),
        };
        for frames in self.waiting.values_mut() {
            while frames
                .front()
                .is_some_and(|waiting| waiting.committed + DEADLINE <= now)
            {
                let waiting = frames.pop_front().expect("checked above");
                unreported.add(waiting);
            }
        }
        self.waiting.retain(|_, frames| !frames.is_empty());
        for (_, held) in self
            .held
            .extract_if(|_, held| held.committed + DEADLINE <= now)
        {
            unreported.add_held(held);
        }
        unreported
    }

    /// When the oldest waiting frame goes past [`DEADLINE`]. `None` when
    /// nothing waits.
    pub fn next_deadline(&self) -> Option<Duration> {
        self.waiting
            .values()
            .filter_map(|frames| frames.front())
            .map(|waiting| waiting.committed)
            .chain(self.held.values().map(|held| held.committed))
            .map(|committed| committed + DEADLINE)
            .min()
    }

    /// Everything waiting for `window`, which went away.
    pub fn forget(&mut self, window: &str) -> Unreported<C, F> {
        let mut unreported = Unreported {
            callbacks: Vec::new(),
            discarded: Vec::new(),
        };
        for waiting in self.waiting.remove(window).into_iter().flatten() {
            unreported.add(waiting);
        }
        if let Some(held) = self.held.remove(window) {
            unreported.add_held(held);
        }
        unreported
    }

    /// Everything waiting, for an engine that went away.
    pub fn take_all(&mut self) -> Unreported<C, F> {
        let mut unreported = Unreported {
            callbacks: Vec::new(),
            discarded: Vec::new(),
        };
        for waiting in self.waiting.drain().flat_map(|(_, frames)| frames) {
            unreported.add(waiting);
        }
        for (_, held) in self.held.drain() {
            unreported.add_held(held);
        }
        unreported
    }

    /// Puts `held` in place of `window`'s held commit, and returns the old one
    /// to answer.
    fn replace_held(&mut self, window: &str, held: Option<Held<C, F>>) -> Unreported<C, F> {
        let replaced = match held {
            Some(held) => self.held.insert(window.to_string(), held),
            None => self.held.remove(window),
        };
        let mut unreported = Unreported {
            callbacks: Vec::new(),
            discarded: Vec::new(),
        };
        if let Some(replaced) = replaced {
            unreported.add_held(replaced);
        }
        unreported
    }

    fn frames_of(&mut self, window: &str) -> impl Iterator<Item = &mut Waiting<C, F>> {
        self.waiting.get_mut(window).into_iter().flatten()
    }

    /// Forgets `window`'s frames that are done and presented.
    fn drop_reported(&mut self, window: &str) {
        if let Some(frames) = self.waiting.get_mut(window) {
            frames.retain(|waiting| waiting.callbacks.is_some() || waiting.feedback.is_some());
            if frames.is_empty() {
                self.waiting.remove(window);
            }
        }
    }
}

impl<C, F> Unreported<C, F> {
    fn add(&mut self, waiting: Waiting<C, F>) {
        self.callbacks
            .extend(waiting.callbacks.into_iter().flatten());
        self.discarded
            .extend(waiting.feedback.into_iter().flatten());
    }

    fn add_held(&mut self, held: Held<C, F>) {
        self.callbacks.extend(held.callbacks);
        self.discarded.extend(held.feedback);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: Duration = Duration::from_millis(10);

    #[test]
    fn a_frame_s_callbacks_wait_until_the_engine_takes_it() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.wait("term", 1, vec![1], vec![], AT);
        waiting.wait("term", 2, vec![2], vec![], AT);
        waiting.wait("editor", 1, vec![3], vec![], AT);

        assert_eq!(waiting.done("term", 1), vec![1]);
        assert_eq!(waiting.done("term", 2), vec![2]);
        assert_eq!(waiting.done("editor", 1), vec![3]);
    }

    /// The engine reports frames in order, so a later frame's report answers
    /// one whose report was lost.
    #[test]
    fn a_done_frame_answers_the_older_ones() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.wait("term", 1, vec![1], vec![], AT);
        waiting.wait("term", 2, vec![2], vec![], AT);
        waiting.wait("term", 3, vec![3], vec![], AT);

        assert_eq!(waiting.done("term", 2), vec![1, 2]);
        assert_eq!(waiting.done("term", 2), Vec::<u32>::new());
    }

    #[test]
    fn a_frame_s_feedback_waits_until_it_is_presented() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.wait("term", 1, vec![1], vec!['a'], AT);
        waiting.wait("term", 2, vec![], vec!['b'], AT * 2);

        assert_eq!(waiting.done("term", 2), vec![1]);
        assert_eq!(
            waiting.presented("term", 2),
            Some(Presented {
                feedback: vec!['b'],
                committed: AT * 2,
            })
        );
        assert_eq!(
            waiting.presented("term", 1),
            Some(Presented {
                feedback: vec!['a'],
                committed: AT,
            })
        );
        assert_eq!(waiting.presented("term", 1), None);
        assert_eq!(waiting.next_deadline(), None, "nothing is left waiting");
    }

    #[test]
    fn a_frame_the_engine_never_reports_is_answered_at_the_deadline() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.wait("term", 1, vec![1], vec!['a'], AT);
        waiting.wait("term", 2, vec![2], vec!['b'], AT * 2);
        assert_eq!(waiting.next_deadline(), Some(AT + DEADLINE));

        let early = waiting.overdue(AT + DEADLINE - Duration::from_nanos(1));
        assert!(early.callbacks.is_empty() && early.discarded.is_empty());

        assert_eq!(
            waiting.overdue(AT + DEADLINE),
            Unreported {
                callbacks: vec![1],
                discarded: vec!['a'],
            }
        );
        assert_eq!(waiting.done("term", 1), Vec::<u32>::new());
        assert_eq!(waiting.presented("term", 1), None);
        assert_eq!(waiting.next_deadline(), Some(AT * 2 + DEADLINE));
    }

    /// A frame held back for an import or an embed has no number until it
    /// goes up, and its callbacks wait for that.
    #[test]
    fn a_held_frame_s_callbacks_wait_until_it_goes_up_and_is_reported() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.wait("term", 1, vec![1], vec![], AT);
        assert_eq!(waiting.hold("term", vec![2], vec!['b'], AT * 2), none());

        assert_eq!(waiting.done("term", 1), vec![1], "a held frame is not done");
        waiting.submitted("term", 2);
        assert_eq!(waiting.done("term", 2), vec![2]);
        assert_eq!(
            waiting.presented("term", 2),
            Some(Presented {
                feedback: vec!['b'],
                committed: AT * 2,
            })
        );
        waiting.submitted("term", 3);
        assert_eq!(
            waiting.done("term", 3),
            Vec::<u32>::new(),
            "nothing was held"
        );
    }

    #[test]
    fn a_newer_frame_answers_the_held_one_it_replaces() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.hold("term", vec![1], vec!['a'], AT);

        assert_eq!(
            waiting.hold("term", vec![2], vec!['b'], AT * 2),
            Unreported {
                callbacks: vec![1],
                discarded: vec!['a'],
            }
        );
        assert_eq!(
            waiting.wait("term", 1, vec![3], vec![], AT * 3),
            Unreported {
                callbacks: vec![2],
                discarded: vec!['b'],
            }
        );
        waiting.submitted("term", 2);
        assert_eq!(
            waiting.done("term", 2),
            vec![3],
            "the replaced frame is gone"
        );
    }

    #[test]
    fn a_held_frame_is_answered_at_the_deadline() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.hold("term", vec![1], vec!['a'], AT);
        assert_eq!(waiting.next_deadline(), Some(AT + DEADLINE));

        assert_eq!(
            waiting.overdue(AT + DEADLINE),
            Unreported {
                callbacks: vec![1],
                discarded: vec!['a'],
            }
        );
        waiting.submitted("term", 1);
        assert_eq!(waiting.done("term", 1), Vec::<u32>::new());
        assert_eq!(waiting.next_deadline(), None);
    }

    #[test]
    fn a_window_that_goes_answers_what_it_waited_for() {
        let mut waiting = FrameCallbacks::<u32, char>::new();
        waiting.wait("term", 1, vec![1], vec!['a'], AT);
        waiting.hold("term", vec![2], vec!['b'], AT);
        waiting.wait("editor", 1, vec![3], vec!['c'], AT);
        waiting.hold("editor", vec![4], vec!['d'], AT);

        assert_eq!(
            waiting.forget("term"),
            Unreported {
                callbacks: vec![1, 2],
                discarded: vec!['a', 'b'],
            }
        );
        assert_eq!(
            waiting.take_all(),
            Unreported {
                callbacks: vec![3, 4],
                discarded: vec!['c', 'd'],
            }
        );
        assert_eq!(waiting.next_deadline(), None);
    }

    fn none() -> Unreported<u32, char> {
        Unreported {
            callbacks: vec![],
            discarded: vec![],
        }
    }
}
