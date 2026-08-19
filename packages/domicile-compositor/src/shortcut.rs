//! The desktop's own key combinations.
//!
//! A chrome shortcut cannot depend on the chrome holding the keyboard: the
//! moment a window is focused every key goes to it, including the combination
//! that would put a different window on screen. The chrome claims what it wants
//! with `grab_shortcut` and the compositor takes matching presses out of the
//! stream before anyone is given them — which is the only thing that makes a
//! shortcut global.

use std::collections::HashSet;

use domicile_protocol::Shortcut;

/// The combinations the chrome has claimed.
#[derive(Debug, Default)]
pub struct Shortcuts(HashSet<Shortcut>);

impl Shortcuts {
    /// Claim a combination. Claiming one twice is one claim, not an error: a
    /// chrome that reconnects re-registers everything it wants.
    pub fn grab(&mut self, shortcut: Shortcut) {
        self.0.insert(shortcut);
    }

    /// The combination this press amounts to, if the chrome claimed it.
    ///
    /// `x_keycode` is the keymap's, which is evdev + 8 — the conversion Wayland
    /// keymaps require and the one the chrome does not know about, since it
    /// registers and forwards in evdev.
    pub fn pressed(&self, x_keycode: u32, modifiers: Modifiers) -> Option<Shortcut> {
        let shortcut = Shortcut {
            key: x_keycode.checked_sub(8)?,
            alt: modifiers.alt,
            ctrl: modifiers.ctrl,
            shift: modifiers.shift,
            logo: modifiers.logo,
        };
        self.0.contains(&shortcut).then_some(shortcut)
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
        assert_eq!(claimed().pressed(28 + 8, ALT), Some(ALT_ENTER));
    }

    #[test]
    fn the_same_key_without_the_modifier_is_not_the_shortcut() {
        // Enter has to keep working in a terminal.
        assert_eq!(claimed().pressed(28 + 8, Modifiers::default()), None);
    }

    #[test]
    fn an_extra_modifier_makes_it_a_different_combination() {
        // Alt+Shift+Enter is its own chord, and claiming one must not claim it.
        let with_shift = Modifiers { shift: true, ..ALT };
        assert_eq!(claimed().pressed(28 + 8, with_shift), None);
    }

    #[test]
    fn an_unclaimed_key_passes_through() {
        assert_eq!(claimed().pressed(30 + 8, ALT), None);
    }

    #[test]
    fn claiming_twice_is_one_claim() {
        let mut shortcuts = claimed();
        shortcuts.grab(ALT_ENTER);
        assert_eq!(shortcuts.pressed(28 + 8, ALT), Some(ALT_ENTER));
    }

    #[test]
    fn a_keycode_below_the_offset_is_not_a_key() {
        // Nothing sends these, but subtracting past zero would wrap to a very
        // large keycode and could collide with a real claim.
        assert_eq!(claimed().pressed(4, ALT), None);
    }
}
