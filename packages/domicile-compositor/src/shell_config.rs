//! The keysym-to-key map a shell resolves its keybindings against.
//!
//! A shell binds chords by keysym, but presses arrive as keys. The compositor
//! compiles the keymap, so it sends the map. See
//! [`domicile_protocol::HostMessage::ShellConfig`] and
//! `docs/architecture/KEYBINDINGS.md`.

use std::collections::BTreeMap;

use domicile_config::Config;

use crate::keymap::{Keyboard, UnknownLayout};

/// Every keysym `config`'s keyboard can type, mapped to the key it is on.
///
/// Compiles `input.keyboard` itself because this runs before the compositor
/// state, which owns the seat's keymap, exists. The same config always
/// compiles to the same keymap.
pub fn keys(config: &Config) -> Result<BTreeMap<String, u32>, UnknownLayout> {
    Keyboard::compiled(&config.input.keyboard).map(|keyboard| keyboard.keys())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Evdev codes for `Escape` and `p`. On `dvp`, the `p` key types `l`.
    const KEY_ESC: u32 = 1;
    const KEY_P: u32 = 25;

    fn parsed(text: &str) -> Config {
        Config::parse(text).expect("the fixtures are configs a desk could run")
    }

    #[test]
    fn every_keysym_the_keyboard_types_goes_out_for_a_shell_s_chords() {
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
