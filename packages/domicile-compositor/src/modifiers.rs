//! Tracks the modifier keys held on the desktop's keyboard and tells the
//! chrome when they change.
//!
//! `wl_keyboard.modifiers` goes only to the surface with keyboard focus, so
//! the chrome stops seeing modifiers once a window is focused. It needs them
//! then, for example to drag a window while alt is held.

/// The modifiers held.
///
/// Not Smithay's type, which includes caps lock and num lock. Those are
/// keyboard states, not held keys, and matching on them would break shortcuts
/// while Num Lock is on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub logo: bool,
}

/// The modifiers the chrome was last sent, so only changes are sent.
///
/// Most key events leave the held modifiers unchanged and should not reach
/// the chrome.
#[derive(Debug, Default)]
pub struct Held(Modifiers);

impl Held {
    /// The modifiers to send now, or `None` when they are the ones already
    /// sent.
    pub fn moved_to(&mut self, now: Modifiers) -> Option<Modifiers> {
        (self.0 != now).then(|| {
            self.0 = now;
            now
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{Held, Modifiers};

    const ALT: Modifiers = Modifiers {
        alt: true,
        ctrl: false,
        shift: false,
        logo: false,
    };

    #[test]
    fn a_modifier_going_down_is_a_message() {
        assert_eq!(Held::default().moved_to(ALT), Some(ALT));
    }

    #[test]
    fn a_key_that_leaves_the_modifiers_alone_says_nothing() {
        let mut held = Held::default();
        held.moved_to(ALT);
        // Ordinary keys pressed with alt held still report alt down.
        assert_eq!(held.moved_to(ALT), None);
    }

    #[test]
    fn letting_go_is_a_message_too() {
        // Without the release, the chrome thinks alt is still held and drags
        // the next window the user clicks.
        let mut held = Held::default();
        held.moved_to(ALT);
        assert_eq!(
            held.moved_to(Modifiers::default()),
            Some(Modifiers::default())
        );
    }

    #[test]
    fn a_second_modifier_is_its_own_message() {
        // The chrome resizes on Alt+Shift but moves on Alt.
        let mut held = Held::default();
        held.moved_to(ALT);
        let with_shift = Modifiers { shift: true, ..ALT };
        assert_eq!(held.moved_to(with_shift), Some(with_shift));
    }
}
