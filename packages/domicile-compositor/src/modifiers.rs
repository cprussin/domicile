//! Which modifier keys the desktop's keyboard has down, and who has been told.
//!
//! The chrome cannot see this for itself. `wl_keyboard.modifiers` goes to the
//! surface that holds the keyboard, so the moment a window is focused the page
//! stops hearing about the modifiers — and a chrome whose windows answer to a
//! held one, alt to drag a window being the reason this exists, needs to know
//! exactly then. So the compositor says.

/// The modifiers held.
///
/// Its own type rather than Smithay's, which carries the toggles as well —
/// caps lock and num lock are states of the keyboard rather than keys a user
/// is holding, and matching on them would make a shortcut stop working the
/// moment Num Lock was on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub logo: bool,
}

/// What the chrome was last told, so that a change is a message and everything
/// else is silence.
///
/// Every key that arrives moves the seat's modifier state, and almost none of
/// them move *this* — a page told on every keystroke would be reading a
/// keystroke counter, and the answer it wanted was already on screen.
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
        // Every ordinary key pressed while alt is held arrives here with alt
        // still down, and none of them is news.
        assert_eq!(held.moved_to(ALT), None);
    }

    #[test]
    fn letting_go_is_a_message_too() {
        // The half a chrome most needs: a page that heard alt go down and
        // never heard it come up drags the next window the user clicks.
        let mut held = Held::default();
        held.moved_to(ALT);
        assert_eq!(
            held.moved_to(Modifiers::default()),
            Some(Modifiers::default())
        );
    }

    #[test]
    fn a_second_modifier_is_its_own_message() {
        // Alt+Shift is a different answer from Alt, and the chrome resizes
        // rather than moves on the strength of it.
        let mut held = Held::default();
        held.moved_to(ALT);
        let with_shift = Modifiers { shift: true, ..ALT };
        assert_eq!(held.moved_to(with_shift), Some(with_shift));
    }
}
