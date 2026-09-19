//! What a component said on the way out, kept so the run can say it again.
//!
//! THE REASON A DESK WILL NOT COME UP IS NOT WHERE ANYONE LOOKS. A desktop
//! that fails is started again, four times, and each attempt is a Chromium
//! launch: the compositor's own six lines about the config it could not read
//! land somewhere around line 11 of 220, between an ozone modeset and a GLib
//! assertion, and then four more times at even worse odds. Measured on a real
//! desk, and the line the run *ended* on was "Every one of them said why
//! above" — a pointer, at the one place on the terminal a person actually
//! reads, to a sentence two hundred lines up.
//!
//! So the run keeps what the compositor wrote and says it again at the bottom.
//! Nothing is suppressed on the way past: the live output is what a desk that
//! comes up on the fifth try wants, and the repeat is for the one that never
//! does.
//!
//! THE COMPOSITOR AND NOT THE ENGINE. The engine's stderr is Chromium's, which
//! is the volume this exists to cut through — repeating its tail would repeat
//! the noise. The compositor's is its own and is nearly always empty: its
//! tracing goes to stdout, so what arrives here is the fatal complaint
//! `main` prints and a panic if it had one, which is exactly what a person
//! reading the bottom of a failed run wants.

use std::collections::VecDeque;

/// The tail of what one component wrote.
///
/// The last lines rather than the first, because this is about how a component
/// *ended*: a compositor that ran for an hour and then panicked says nothing
/// useful in its first twenty lines.
pub struct Heard {
    said: VecDeque<String>,
    keep: usize,
}

impl Heard {
    /// One that keeps the last `keep` lines it is given.
    ///
    /// How many is the caller's, the way a restart policy is: what is worth
    /// repeating is a fact about the terminal a run is watched on rather than
    /// about a queue. `bin/domicile.rs` argues the number this run uses.
    pub fn new(keep: usize) -> Self {
        Heard {
            said: VecDeque::new(),
            keep,
        }
    }

    /// Take one line of what it said.
    ///
    /// Blank lines are dropped rather than kept, which is not tidying: the
    /// complaint ends in a newline, so one arrives after every real line, and
    /// a tail of twenty that counted them would repeat ten. It also settles
    /// the trailing blank that would otherwise sit between the repeat and
    /// whatever the shell prints next.
    pub fn line(&mut self, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        if self.said.len() == self.keep {
            self.said.pop_front();
        }
        self.said.push_back(line.to_string());
    }

    /// What to say again, or `None` from a component that said nothing.
    ///
    /// `None` rather than an empty string because the caller prints a heading
    /// over this, and a heading over an empty quote is worse than no heading —
    /// every desktop that came up and was used ends that way.
    pub fn said(&self) -> Option<String> {
        match self.said.is_empty() {
            true => None,
            false => Some(Vec::from_iter(self.said.iter().cloned()).join("\n")),
        }
    }
}
