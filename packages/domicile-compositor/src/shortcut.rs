//! The desktop's own key combinations.
//!
//! A chrome shortcut cannot depend on the chrome holding the keyboard: the
//! moment a window is focused every key goes to it, including the combination
//! that would put a different window on screen. The chrome claims what it wants
//! with `grab_shortcut` and the compositor takes matching presses out of the
//! stream before anyone is given them — which is the only thing that makes a
//! shortcut global.

use std::collections::{HashMap, HashSet};

use domicile_protocol::Shortcut;

/// The combinations the chrome has claimed, and what became of the press
/// each key that is down was given.
#[derive(Debug, Default)]
pub struct Shortcuts {
    claimed: HashSet<Shortcut>,
    /// Each key that is down, and whether its press was taken out of the
    /// stream rather than given to the client.
    ///
    /// Kept because a release has to follow its own press: whether the client
    /// was given a key going down is a fact about that press, and asking the
    /// claims again when it comes up answers a different question — the
    /// modifiers have moved by then, and the chord that matches now may not be
    /// the one that was pressed. Also what the seat consults when a dead page
    /// leaves keys down: releasing those to a client that never saw them go
    /// down is the same half a chord.
    held: HashMap<u32, bool>,
}

impl Shortcuts {
    /// Claim a combination. Claiming one twice is one claim, not an error: a
    /// chrome that reconnects re-registers everything it wants.
    pub fn grab(&mut self, shortcut: Shortcut) {
        self.claimed.insert(shortcut);
    }

    /// The combination this press amounts to, if the chrome claimed it, and a
    /// record of which way this key went, so its release can go the same way.
    ///
    /// `x_keycode` is the keymap's, which is evdev + 8 — the conversion Wayland
    /// keymaps require and the one the chrome does not know about, since it
    /// registers and forwards in evdev.
    pub fn press(&mut self, x_keycode: u32, modifiers: Modifiers) -> Option<Shortcut> {
        match self.matching(x_keycode, modifiers) {
            // Only if the key is not already down. A held key repeats, and
            // every repeat arrives as a fresh press — so a key the client is
            // holding, whose modifier the user takes hold of afterwards,
            // starts matching a chord halfway through its own press. Taking
            // its release then would leave that client a key it can never
            // lift, which is the failure this whole record exists to avoid.
            Some(shortcut) => {
                self.held.entry(x_keycode).or_insert(true);
                Some(shortcut)
            }
            // A press that reaches the client is the authority on that key:
            // whatever was recorded before, the hold the client has now is one
            // it was given, so its release is the client's too. That is what
            // clears a record left behind when a press was taken and its
            // release never arrived.
            None => {
                self.held.insert(x_keycode, false);
                None
            }
        }
    }

    /// Whether this release belongs to a press that was taken, which is also
    /// what ends the hold it was recorded for.
    pub fn release(&mut self, x_keycode: u32) -> bool {
        self.held.remove(&x_keycode) == Some(true)
    }

    fn matching(&self, x_keycode: u32, modifiers: Modifiers) -> Option<Shortcut> {
        let shortcut = Shortcut {
            key: x_keycode.checked_sub(8)?,
            alt: modifiers.alt,
            ctrl: modifiers.ctrl,
            shift: modifiers.shift,
            logo: modifiers.logo,
        };
        self.claimed.contains(&shortcut).then_some(shortcut)
    }
}

/// The modifiers held when a key was pressed.
///
/// Its own type rather than Smithay's, which carries the toggles as well —
/// caps lock and num lock are states of the keyboard, not part of the chord a
/// user pressed, and matching on them would make a shortcut stop working the
/// moment Num Lock was on.
#[derive(Debug, Clone, Copy, Default)]
pub struct Modifiers {
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub logo: bool,
}

#[cfg(test)]
mod tests {
    use super::{Modifiers, Shortcuts};
    use domicile_protocol::Shortcut;

    /// Alt+Enter, as a chrome would claim it: evdev 28 is Enter.
    const ALT_ENTER: Shortcut = Shortcut {
        key: 28,
        alt: true,
        ctrl: false,
        shift: false,
        logo: false,
    };

    const ALT: Modifiers = Modifiers {
        alt: true,
        ctrl: false,
        shift: false,
        logo: false,
    };

    fn claimed() -> Shortcuts {
        let mut shortcuts = Shortcuts::default();
        shortcuts.grab(ALT_ENTER);
        shortcuts
    }

    #[test]
    fn a_claimed_combination_is_recognised_through_the_keycode_offset() {
        // The keymap counts from evdev + 8. Matching without the conversion
        // silently claims a different key — 36 is `y` in evdev.
        assert_eq!(claimed().press(28 + 8, ALT), Some(ALT_ENTER));
    }

    #[test]
    fn the_same_key_without_the_modifier_is_not_the_shortcut() {
        // Enter has to keep working in a terminal.
        assert_eq!(claimed().press(28 + 8, Modifiers::default()), None);
    }

    #[test]
    fn an_extra_modifier_makes_it_a_different_combination() {
        // Alt+Shift+Enter is its own chord, and claiming one must not claim it.
        let with_shift = Modifiers { shift: true, ..ALT };
        assert_eq!(claimed().press(28 + 8, with_shift), None);
    }

    #[test]
    fn an_unclaimed_key_passes_through() {
        assert_eq!(claimed().press(30 + 8, ALT), None);
    }

    #[test]
    fn claiming_twice_is_one_claim() {
        let mut shortcuts = claimed();
        shortcuts.grab(ALT_ENTER);
        assert_eq!(shortcuts.press(28 + 8, ALT), Some(ALT_ENTER));
    }

    #[test]
    fn the_release_of_a_taken_press_is_taken_too() {
        // A client that was not given the press must not be given the release:
        // half a chord reads as a key that went up on its own.
        let mut shortcuts = claimed();
        assert_eq!(shortcuts.press(28 + 8, ALT), Some(ALT_ENTER));
        assert!(shortcuts.release(28 + 8));
    }

    #[test]
    fn the_release_of_a_forwarded_press_is_forwarded() {
        // The modifiers move between a press and its release, and the chord
        // the release *would* match is not the question — the question is what
        // happened to its press. Enter alone reaches the client, so a user who
        // takes hold of alt before letting go of it must still be given the
        // release, or that client has a key it can never lift.
        let mut shortcuts = claimed();
        assert_eq!(shortcuts.press(28 + 8, Modifiers::default()), None);
        assert!(!shortcuts.release(28 + 8));
    }

    #[test]
    fn a_modifier_taken_hold_of_halfway_through_a_press() {
        // Enter is held in a terminal — the client has that press — and the
        // user then takes hold of alt. The repeats that follow match
        // Alt+Enter, but the press the client is holding was given to it, so
        // the release that ends it is the client's.
        let mut shortcuts = claimed();
        assert_eq!(shortcuts.press(28 + 8, Modifiers::default()), None);
        assert_eq!(shortcuts.press(28 + 8, ALT), Some(ALT_ENTER));
        assert!(!shortcuts.release(28 + 8));
    }

    #[test]
    fn a_key_that_comes_up_does_not_answer_for_another_still_down() {
        // A chord is two keys down at once and they come up in either order:
        // alt itself reaches the client, Enter with alt held does not. Letting
        // go of alt first must not answer for the record Enter is holding.
        const LEFT_ALT: u32 = 56 + 8;
        let mut shortcuts = claimed();
        assert_eq!(shortcuts.press(LEFT_ALT, ALT), None);
        assert_eq!(shortcuts.press(28 + 8, ALT), Some(ALT_ENTER));
        assert!(!shortcuts.release(LEFT_ALT));
        assert!(shortcuts.release(28 + 8));
    }

    #[test]
    fn a_press_the_client_was_given_clears_what_was_left_behind() {
        // A taken press whose release never came — the seat drains those, but
        // the record must not depend on it. The next press of that key reaches
        // the client, and from then on the key is the client's.
        let mut shortcuts = claimed();
        assert_eq!(shortcuts.press(28 + 8, ALT), Some(ALT_ENTER));
        assert_eq!(shortcuts.press(28 + 8, Modifiers::default()), None);
        assert!(!shortcuts.release(28 + 8));
    }

    #[test]
    fn a_held_chord_that_repeats_is_still_taken_once() {
        // A held key repeats, and every repeat is another press. The release
        // that ends them is one release — and it ends the record with it.
        let mut shortcuts = claimed();
        shortcuts.press(28 + 8, ALT);
        shortcuts.press(28 + 8, ALT);
        assert!(shortcuts.release(28 + 8));
        assert!(!shortcuts.release(28 + 8));
    }

    #[test]
    fn a_keycode_below_the_offset_is_not_a_key() {
        // Nothing sends these, but subtracting past zero would wrap to a very
        // large keycode and could collide with a real claim.
        assert_eq!(claimed().press(4, ALT), None);
    }
}
