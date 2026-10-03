//! The keyboard, as the chrome is told it for the keys a shell binds.
//!
//! A shell's keys are its props, written as chords that name keysyms, and a
//! press arrives as a key — so somebody has to say which key each keysym is
//! on, and the compositor is the one holding the keymap `input.keyboard`
//! compiles to. See [`domicile_protocol::HostMessage::ShellConfig`].

use std::collections::BTreeMap;

use domicile_config::Config;

use crate::keymap::{Keyboard, UnknownLayout};

/// Every keysym the keyboard `config` names can type, and the key it is on.
///
/// Compiled from `input.keyboard` rather than handed the seat's keymap, for
/// the reason `crate::keymap` compiles twice: the seat's is only lent through
/// the compositor state, and this is called before there is one. One
/// `KeyboardConfig` and one libxkbcommon make the same keymap each time.
pub fn keys(config: &Config) -> Result<BTreeMap<String, u32>, UnknownLayout> {
    Keyboard::compiled(&config.input.keyboard).map(|keyboard| keyboard.keys())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Escape` and `p` as evdev numbers them: on `dvp` the last carries `l`.
    const KEY_ESC: u32 = 1;
    const KEY_P: u32 = 25;

    fn parsed(text: &str) -> Config {
        Config::parse(text).expect("the fixtures are configs a desk could run")
    }

    #[test]
    fn every_keysym_the_keyboard_types_goes_out_for_a_shell_s_chords() {
        // `l` on `dvp` is the key `us` prints a p on.
        let keys = keys(&parsed(
            r#"{ "input": { "keyboard": { "xkb_variant": "dvp" } } }"#,
        ))
        .expect("the layout compiles");
        assert_eq!(keys.get("l"), Some(&KEY_P));
        assert_eq!(keys.get("Escape"), Some(&KEY_ESC));
    }

    #[test]
    fn a_keyboard_xkb_cannot_compile_has_no_keys() {
        assert!(keys(&parsed(
            r#"
{ "input": { "keyboard": { "xkb_rules": "no-such-rules" } } }
"#,
        ))
        .is_err());
    }
}
