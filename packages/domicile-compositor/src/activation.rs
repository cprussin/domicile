//! Decides which `xdg-activation` requests reach the shell.
//!
//! A request carries the serial of the input or focus event its token was made
//! for. A window that asks with a serial older than the keyboard's last
//! handover is asking on its own, not for the user, so it is dropped. A real
//! one (a click in one app that opens another) still reaches the shell, which
//! grants it.

use smithay::utils::Serial;

/// Whether a token made for `asked` may move the keyboard, given the serial of
/// the keyboard's last `enter`.
pub fn earned(asked: Option<Serial>, last_enter: Option<Serial>) -> bool {
    match (asked, last_enter) {
        (Some(asked), Some(last_enter)) => asked.is_no_older_than(&last_enter),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_from_input_since_the_keyboard_last_moved_moves_it() {
        assert!(earned(Some(Serial::from(7)), Some(Serial::from(5))));
        assert!(earned(Some(Serial::from(5)), Some(Serial::from(5))));
    }

    #[test]
    fn a_token_from_before_the_keyboard_last_moved_does_not() {
        // A window handing itself the keyboard back after the user moved on.
        assert!(!earned(Some(Serial::from(4)), Some(Serial::from(5))));
    }

    #[test]
    fn a_token_without_a_serial_does_not() {
        assert!(!earned(None, Some(Serial::from(5))));
    }
}
