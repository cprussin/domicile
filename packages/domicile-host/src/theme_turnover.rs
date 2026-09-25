//! The order a desk turns its theme over in.
//!
//! A shell animates a theme change by capturing the frame it is leaving and
//! wiping the new one in across it. The windows on the desk are in that frame,
//! so they must still be drawn the old way when it is captured and the new way
//! when the wipe starts -- otherwise the wipe passes over windows that had
//! already turned. So a turnover runs in three steps:
//!
//! 1. Every chrome is told the theme, and paints its own wipe.
//! 2. Once every chrome has captured ([`Turnover::captured`]), the desk's
//!    windows are told: the settings portal for Wayland clients.
//! 3. Once every mapped window has committed a frame since
//!    ([`Turnover::repainted`]), the chromes are told the windows have turned,
//!    and the browser draws its own pages the new way.
//!
//! Neither wait is allowed to hold the desk up for long. A shell that never
//! captures -- an old one, or a page with no wipe -- and a window that never
//! repaints are both ordinary, so each phase has a deadline, after which the
//! desk turns anyway: late and unanimated rather than never.
//!
//! Pure, and generic over what names a chrome, so the compositor's threads
//! and sockets stay out of it: it is told events and answers what to do next.

use std::collections::HashSet;
use std::hash::Hash;
use std::time::Duration;

use domicile_protocol::Theme;

/// How long the windows wait for every chrome to capture.
///
/// A shell captures after its toggle's 150ms set phase and one frame, so this
/// is several times what a working one takes. What it is sized against is
/// Chromium's four-second limit on a view transition's update callback: this,
/// [`REPAINT_WITHIN`] and the shell's own settle all happen inside it.
pub const CAPTURE_WITHIN: Duration = Duration::from_millis(1000);

/// How long the desk waits for its windows to repaint once they are told.
///
/// A toolkit repaints a theme change in a frame or two after the portal's
/// signal reaches it; a window that has not by this point is either hung or
/// not listening, and the wipe goes ahead over it.
pub const REPAINT_WITHIN: Duration = Duration::from_millis(300);

/// What the caller does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Nothing yet.
    Wait,
    /// Tell the windows, then hand [`Turnover::announced`] the ones mapped.
    Announce,
    /// The windows have turned: tell every chrome, and forget this turnover.
    Turned,
}

/// One theme change, from the chromes being told to the windows having
/// turned.
#[derive(Debug)]
pub struct Turnover<C> {
    theme: Theme,
    phase: Phase<C>,
}

#[derive(Debug)]
enum Phase<C> {
    Capturing(HashSet<C>),
    Announcing,
    Repainting(HashSet<String>),
    Turned,
}

impl<C: Eq + Hash> Turnover<C> {
    /// Start turning the desk to `theme`, waiting on `chromes` -- the ones
    /// that were told it. A desk with none has nothing to wait for.
    pub fn begin(theme: Theme, chromes: impl IntoIterator<Item = C>) -> (Self, Step) {
        let awaiting: HashSet<C> = chromes.into_iter().collect();
        let mut turnover = Turnover {
            theme,
            phase: Phase::Capturing(awaiting),
        };
        let step = turnover.announce_if_captured();
        (turnover, step)
    }

    /// The theme this turnover is to.
    pub fn theme(&self) -> Theme {
        self.theme
    }

    /// `chrome` has captured its frame for `theme`.
    pub fn captured(&mut self, chrome: &C, theme: Theme) -> Step {
        match &mut self.phase {
            Phase::Capturing(awaiting) if theme == self.theme => {
                awaiting.remove(chrome);
                self.announce_if_captured()
            }
            _ => Step::Wait,
        }
    }

    /// The chromes have had long enough.
    pub fn capture_deadline(&mut self) -> Step {
        match self.phase {
            Phase::Capturing(_) => {
                self.phase = Phase::Announcing;
                Step::Announce
            }
            _ => Step::Wait,
        }
    }

    /// The windows have been told; `windows` are the ones mapped, each of
    /// which is waited on for a frame.
    pub fn announced(&mut self, windows: impl IntoIterator<Item = String>) -> Step {
        let awaiting: HashSet<String> = windows.into_iter().collect();
        self.phase = Phase::Repainting(awaiting);
        self.turned_if_repainted()
    }

    /// `window` committed a frame.
    pub fn repainted(&mut self, window: &str) -> Step {
        match &mut self.phase {
            Phase::Repainting(awaiting) => {
                awaiting.remove(window);
                self.turned_if_repainted()
            }
            _ => Step::Wait,
        }
    }

    /// The windows have had long enough.
    pub fn repaint_deadline(&mut self) -> Step {
        match self.phase {
            Phase::Repainting(_) => {
                self.phase = Phase::Turned;
                Step::Turned
            }
            _ => Step::Wait,
        }
    }

    fn announce_if_captured(&mut self) -> Step {
        match &self.phase {
            Phase::Capturing(awaiting) if awaiting.is_empty() => {
                self.phase = Phase::Announcing;
                Step::Announce
            }
            _ => Step::Wait,
        }
    }

    fn turned_if_repainted(&mut self) -> Step {
        match &self.phase {
            Phase::Repainting(awaiting) if awaiting.is_empty() => {
                self.phase = Phase::Turned;
                Step::Turned
            }
            _ => Step::Wait,
        }
    }
}
