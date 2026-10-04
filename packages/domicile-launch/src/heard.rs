//! Keeps the tail of the compositor's stderr to repeat when a run fails.
//!
//! A failing desktop restarts several times, each with hundreds of lines of
//! Chromium output, so the compositor's error scrolls out of view. The run
//! repeats it at the end. Live output is still shown.
//!
//! Only the compositor is kept. Its stderr is nearly always empty except for
//! fatal errors and panics (its tracing goes to stdout), while the engine's is
//! the noise this cuts through.

use std::collections::VecDeque;

/// The last lines a component wrote, which explain how it ended.
pub struct Heard {
    said: VecDeque<String>,
    keep: usize,
}

impl Heard {
    /// Keeps the last `keep` lines. `bin/domicile.rs` picks the count.
    pub fn new(keep: usize) -> Self {
        Heard {
            said: VecDeque::new(),
            keep,
        }
    }

    /// Records one line.
    ///
    /// Blank lines are dropped so they do not use up the tail, since one
    /// follows every real line.
    pub fn line(&mut self, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        if self.said.len() == self.keep {
            self.said.pop_front();
        }
        self.said.push_back(line.to_string());
    }

    /// The kept lines, or `None` if there are none, so the caller can skip
    /// the heading.
    pub fn said(&self) -> Option<String> {
        match self.said.is_empty() {
            true => None,
            false => Some(Vec::from_iter(self.said.iter().cloned()).join("\n")),
        }
    }
}
