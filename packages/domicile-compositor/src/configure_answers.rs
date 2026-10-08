//! Which of the engine's configures a client's commit answers.
//!
//! The engine numbers each box the page lays an `<app>` out at and shows a
//! frame at the box it names. A commit answers the last `xdg_toplevel.configure`
//! the client acked, so naming that configure's box keeps an old buffer at its
//! old size instead of stretching it over the new one.

use std::collections::VecDeque;

use crate::engine::LAST_SHOWN_BOX;

/// The engine's configures sent to one toplevel and not yet answered, oldest
/// first.
#[derive(Debug)]
pub struct ConfigureAnswers<S> {
    sent: VecDeque<(S, u64)>,
}

impl<S: PartialOrd + Copy> ConfigureAnswers<S> {
    pub fn new() -> Self {
        Self {
            sent: VecDeque::new(),
        }
    }

    /// The configure with `serial` carried the engine's box `number`.
    pub fn sent(&mut self, serial: S, number: u64) {
        self.sent.push_back((serial, number));
    }

    /// The box a commit answers, given the serial the client last acked. A
    /// client that acked no numbered configure answers [`LAST_SHOWN_BOX`].
    /// Forgets the boxes before the one answered.
    pub fn answered(&mut self, acked: Option<S>) -> u64 {
        let newest =
            acked.and_then(|acked| self.sent.iter().rposition(|(serial, _)| *serial <= acked));
        match newest {
            Some(newest) => {
                self.sent.drain(..newest);
                self.sent[0].1
            }
            None => LAST_SHOWN_BOX,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_commit_answers_the_newest_box_the_client_acked() {
        let mut answers = ConfigureAnswers::new();
        answers.sent(10_u32, 1);
        answers.sent(11, 2);
        answers.sent(12, 3);
        assert_eq!(answers.answered(Some(11)), 2);
        // Still the same box until the client acks a newer one.
        assert_eq!(answers.answered(Some(11)), 2);
        assert_eq!(answers.answered(Some(12)), 3);
    }

    #[test]
    fn a_commit_before_any_numbered_configure_answers_the_box_shown_last() {
        let mut answers = ConfigureAnswers::new();
        assert_eq!(answers.answered(None), LAST_SHOWN_BOX);
        answers.sent(10_u32, 1);
        // The initial configure, sent before the page laid the window out.
        assert_eq!(answers.answered(Some(9)), LAST_SHOWN_BOX);
    }
}
