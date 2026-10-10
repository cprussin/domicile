//! The order of steps in a theme change.
//!
//! A shell animates a theme change by capturing the old frame and wiping the
//! new one in over it. Windows switch after the capture and before the wipe:
//!
//! 1. Every chrome gets the theme and starts its wipe.
//! 2. Once every chrome has captured ([`Turnover::captured`]), the settings
//!    portal tells Wayland clients.
//! 3. Once every mapped window has committed a frame
//!    ([`Turnover::repainted`]), the chromes are told the windows switched.
//!
//! Browser windows are in the old frame. Wayland windows are not, so they
//! change before the wipe reaches them (`ROADMAP.md`, "Theme").
//!
//! Each phase has a deadline, because some shells never capture and some
//! windows never repaint. Past it, the theme switches without animation.
//!
//! This type is pure and generic over the chrome's id. It takes events and
//! returns the next [`Step`].

use std::collections::HashSet;
use std::hash::Hash;
use std::time::Duration;

use domicile_protocol::Theme;

/// How long the windows wait for every chrome to capture.
///
/// A shell captures after about 150ms. The bound that matters is Chromium's
/// four-second limit on a view transition's update callback, which must cover
/// this, [`REPAINT_WITHIN`] and the shell's own work.
pub const CAPTURE_WITHIN: Duration = Duration::from_millis(1000);

/// How long to wait for windows to repaint after the portal signal.
///
/// Toolkits repaint within a frame or two. A window that has not by then is
/// hung or ignoring the signal.
pub const REPAINT_WITHIN: Duration = Duration::from_millis(300);

/// What the caller does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Nothing yet.
    Wait,
    /// Tell the windows, then pass the mapped ones to [`Turnover::announced`].
    Announce,
    /// The windows switched: tell every chrome and drop this turnover.
    Turned,
}

/// One theme change, from telling the chromes to the windows switching.
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
    /// Start a change to `theme`, waiting on the `chromes` that were told.
    pub fn begin(theme: Theme, chromes: impl IntoIterator<Item = C>) -> (Self, Step) {
        let awaiting: HashSet<C> = chromes.into_iter().collect();
        let mut turnover = Turnover {
            theme,
            phase: Phase::Capturing(awaiting),
        };
        let step = turnover.announce_if_captured();
        (turnover, step)
    }

    /// The target theme.
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

    /// The capture deadline passed.
    pub fn capture_deadline(&mut self) -> Step {
        match self.phase {
            Phase::Capturing(_) => {
                self.phase = Phase::Announcing;
                Step::Announce
            }
            _ => Step::Wait,
        }
    }

    /// The windows were told. Waits for a frame from each of `windows`.
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

    /// The repaint deadline passed.
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
