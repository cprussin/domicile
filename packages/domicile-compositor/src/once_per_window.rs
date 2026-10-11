//! Windows something was already logged for, so it is logged once per window
//! rather than once per frame.

use std::collections::HashSet;

/// App ids already logged. A window that closes is forgotten, so the set does
/// not grow with every window the session opens.
#[derive(Default)]
pub struct OncePerWindow(HashSet<String>);

impl OncePerWindow {
    /// Whether `app_id` is not logged yet. Marks it logged.
    pub fn first(&mut self, app_id: &str) -> bool {
        // Check before inserting, to avoid allocating a `String` every frame.
        !self.0.contains(app_id) && self.0.insert(app_id.to_string())
    }

    /// `app_id`'s window closed.
    pub fn forget(&mut self, app_id: &str) {
        self.0.remove(app_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_is_logged_once() {
        let mut logged = OncePerWindow::default();
        assert!(logged.first("term"));
        assert!(!logged.first("term"));
        assert!(logged.first("editor"));
    }

    #[test]
    fn a_closed_window_is_forgotten() {
        let mut logged = OncePerWindow::default();
        logged.first("term");
        logged.forget("term");
        assert!(logged.first("term"));
    }
}
