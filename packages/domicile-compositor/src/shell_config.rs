//! What the config says to the shell: the keysym-to-key map it resolves its
//! keybindings against, and the values of its options.
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

/// The config's `shell_options` as JSON text. The compositor does not read
/// them; the shell does.
pub fn options(config: &Config) -> String {
    serde_json::to_string(&config.shell_options).expect("a JSON object serializes")
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
    fn the_shell_s_options_go_out_as_the_config_wrote_them() {
        assert_eq!(
            options(&parsed(
                r#"{ "shell_options": { "clock": { "format": "12h" } } }"#
            )),
            r#"{"clock":{"format":"12h"}}"#
        );
        assert_eq!(options(&parsed("{}")), "{}");
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
