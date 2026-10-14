//! Which frame of a window tells the page it reached the screen.
//!
//! The page hears `HostMessage::AppPresented` once for the first frame viz
//! shows after a window or popup appears, and after each configure that
//! changes a window's size: the first frame its client drew for that box
//! (`crate::configure_answers`). A frame viz discards does not count; a later
//! one does.

use std::collections::HashMap;

use crate::engine::LAST_SHOWN_BOX;

/// What each window waits to have presented, by app id.
#[derive(Debug, Default)]
pub struct Presentations {
    awaited: HashMap<String, Awaited>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Awaited {
    /// A commit for this engine box or a newer one.
    Box(u64),
    /// A frame numbered above this one: that commit's frame, or a later one.
    After(u64),
}

impl Presentations {
    pub fn new() -> Self {
        Self::default()
    }

    /// `window` appeared, so its first frame counts.
    pub fn appeared(&mut self, window: &str) {
        self.awaited
            .insert(window.to_string(), Awaited::Box(LAST_SHOWN_BOX));
    }

    /// `window` was configured at a new size for the engine's box `number`.
    pub fn resized(&mut self, window: &str, number: u64) {
        self.awaited
            .insert(window.to_string(), Awaited::Box(number));
    }

    /// `window` committed a frame for the box `at_box`. `last` is the number of
    /// the last frame the engine has of it, before this commit's.
    pub fn committed(&mut self, window: &str, at_box: u64, last: Option<u64>) {
        if let Some(awaited) = self.awaited.get_mut(window) {
            if matches!(*awaited, Awaited::Box(number) if at_box >= number) {
                *awaited = Awaited::After(last.unwrap_or(0));
            }
        }
    }

    /// The engine reported `window`'s `frame`, which reached the screen when
    /// `shown`. True when the page is to hear that `window` was presented.
    pub fn presented(&mut self, window: &str, frame: u64, shown: bool) -> bool {
        let heard = shown
            && matches!(
                self.awaited.get(window),
                Some(Awaited::After(last)) if frame > *last
            );
        if heard {
            self.awaited.remove(window);
        }
        heard
    }

    /// `window` closed.
    pub fn forget(&mut self, window: &str) {
        self.awaited.remove(window);
    }

    /// The engine was replaced, and numbers its boxes and frames afresh.
    pub fn clear(&mut self) {
        self.awaited.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_window_is_presented_once_by_its_first_shown_frame() {
        let mut presentations = Presentations::new();
        presentations.appeared("term");
        presentations.committed("term", LAST_SHOWN_BOX, None);
        assert!(presentations.presented("term", 1, true));
        // Later frames say nothing.
        presentations.committed("term", LAST_SHOWN_BOX, Some(1));
        assert!(!presentations.presented("term", 2, true));
    }

    #[test]
    fn a_discarded_frame_waits_for_a_later_one() {
        let mut presentations = Presentations::new();
        presentations.appeared("term");
        presentations.committed("term", LAST_SHOWN_BOX, None);
        assert!(!presentations.presented("term", 1, false));
        assert!(presentations.presented("term", 2, true));
    }

    #[test]
    fn a_resize_is_presented_by_the_first_frame_drawn_for_its_box() {
        let mut presentations = Presentations::new();
        presentations.resized("term", 3);
        // Drawn for the box before; its frame says nothing.
        presentations.committed("term", 2, Some(4));
        assert!(!presentations.presented("term", 5, true));
        presentations.committed("term", 3, Some(5));
        assert!(presentations.presented("term", 6, true));
    }

    #[test]
    fn a_newer_resize_waits_for_its_own_box() {
        let mut presentations = Presentations::new();
        presentations.resized("term", 3);
        presentations.committed("term", 3, Some(5));
        presentations.resized("term", 4);
        assert!(!presentations.presented("term", 6, true));
        presentations.committed("term", 4, Some(6));
        assert!(presentations.presented("term", 7, true));
    }

    #[test]
    fn a_frame_from_before_the_answering_commit_says_nothing() {
        let mut presentations = Presentations::new();
        presentations.resized("term", 3);
        presentations.committed("term", 3, Some(5));
        // Frame 5 was drawn for the old size.
        assert!(!presentations.presented("term", 5, true));
    }

    #[test]
    fn a_window_waiting_for_nothing_is_never_presented() {
        let mut presentations = Presentations::new();
        presentations.committed("term", LAST_SHOWN_BOX, None);
        assert!(!presentations.presented("term", 1, true));
        presentations.appeared("term");
        presentations.forget("term");
        presentations.committed("term", LAST_SHOWN_BOX, None);
        assert!(!presentations.presented("term", 1, true));
    }
}
