//! Compiles the config's keymap as text for the browser process.
//!
//! Wayland clients get the keymap as an fd from the seat. The browser's
//! `KeyboardLayoutEngine` decodes the shell's keys and gets no keymap outside
//! ChromeOS or the Wayland ozone platform, so the compositor sends it as text.
//! See [`domicile_protocol::HostMessage::Keymap`].
//!
//! This compiles separately from the seat because the chrome socket accepts
//! connections before the compositor state exists, and Smithay's
//! `KeyboardHandle::with_xkb_state` needs `&mut D`. Both compile the same
//! [`KeyboardConfig`]; the browser must never read `input.keyboard` itself.

use std::collections::BTreeMap;

use domicile_config::KeyboardConfig;
use smithay::input::keyboard::xkb;

/// xkb could not compile a keymap from the config.
///
/// Fatal at startup, so the desktop never runs on a fallback layout. On a
/// reload the new config is rejected instead, so a typo does not close every
/// window. See `retype_the_desktop`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "xkb cannot compile a keymap for input.keyboard: rules={rules:?} model={model:?} \
     layout={layout:?} variant={variant:?} options={options:?}"
)]
pub struct UnknownLayout {
    rules: String,
    model: String,
    layout: String,
    variant: String,
    options: String,
}

/// The config's keymap as `XKB_KEYMAP_FORMAT_TEXT_V1` text, the format a
/// `wl_keyboard.keymap` fd carries.
pub fn compiled_keymap(config: &KeyboardConfig) -> Result<String, UnknownLayout> {
    compiled(config).map(|keymap| keymap.get_as_string(xkb::KEYMAP_FORMAT_TEXT_V1))
}

/// The config's compiled keymap, used to map keybinding keysyms to keys.
pub struct Keyboard {
    keymap: xkb::Keymap,
}

impl Keyboard {
    pub fn compiled(config: &KeyboardConfig) -> Result<Keyboard, UnknownLayout> {
        compiled(config).map(|keymap| Keyboard { keymap })
    }
}

impl Keyboard {
    /// Maps each keysym name this keyboard can type to its evdev key. The shell
    /// resolves its keybindings against this.
    ///
    /// Each keysym maps to the lowest key with it on any level of the first
    /// layout. Lowest key, not lowest level, because xkb numbers the main block
    /// first, and `us` also puts `parenleft` and `less` unshifted on keys most
    /// boards lack. Modifiers come from the chord, not from the level.
    pub fn keys(&self) -> BTreeMap<String, u32> {
        let mut keys = BTreeMap::new();
        let all = self.keymap.min_keycode().raw()..=self.keymap.max_keycode().raw();
        for key in all.map(xkb::Keycode::new) {
            for level in 0..self.keymap.num_levels_for_key(key, 0) {
                for &keysym in self.keymap.key_get_syms_by_level(key, 0, level) {
                    // xkb keycodes are evdev codes plus 8. The chrome uses
                    // evdev, as `ChromeMessage::Key` does.
                    keys.entry(xkb::keysym_get_name(keysym))
                        .or_insert(key.raw() - 8);
                }
            }
        }
        keys
    }
}

/// Compiles `config` with xkb.
fn compiled(config: &KeyboardConfig) -> Result<xkb::Keymap, UnknownLayout> {
    let options = config.xkb_options_string();
    let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    xkb::Keymap::new_from_names(
        &context,
        &config.xkb_rules,
        &config.xkb_model,
        &config.xkb_layout,
        &config.xkb_variant,
        Some(options.clone()),
        xkb::KEYMAP_COMPILE_NO_FLAGS,
    )
    .ok_or_else(|| UnknownLayout {
        rules: config.xkb_rules.clone(),
        model: config.xkb_model.clone(),
        layout: config.xkb_layout.clone(),
        variant: config.xkb_variant.clone(),
        options,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Programmer Dvorak with caps lock swapped for escape.
    fn dvorak() -> KeyboardConfig {
        KeyboardConfig {
            xkb_variant: "dvp".into(),
            xkb_options: vec!["caps:swapescape".into()],
            ..KeyboardConfig::default()
        }
    }

    #[test]
    fn the_layout_the_config_names_is_the_keymap_that_comes_out() {
        // Check both the variant (`dvp` puts a semicolon on QWERTY's `q`) and
        // the option, which a keymap could drop while keeping the layout.
        let keymap = compiled_keymap(&dvorak()).expect("us(dvp) exists");

        assert!(
            keymap.starts_with("xkb_keymap"),
            "it is the text format a wl_keyboard.keymap fd carries"
        );
        assert!(
            symbols_for(&keymap, "AD01").contains("semicolon"),
            "the top-left letter key is dvp's semicolon, not qwerty's q"
        );
        assert!(
            symbols_for(&keymap, "CAPS").contains("Escape"),
            "caps:swapescape reached xkb too"
        );
    }

    #[test]
    fn a_keyboard_nobody_configured_is_the_plain_one() {
        // An unconfigured keyboard is plain `us`. Checked on the compiled
        // keymap in case xkb reads an empty field as something else.
        let keymap = compiled_keymap(&KeyboardConfig::default()).expect("plain us exists");

        assert!(
            symbols_for(&keymap, "AD01").contains('q'),
            "the top-left letter key is qwerty's q: {}",
            symbols_for(&keymap, "AD01")
        );
        assert!(
            !symbols_for(&keymap, "CAPS").contains("Escape"),
            "nothing remapped caps lock: {}",
            symbols_for(&keymap, "CAPS")
        );
    }

    #[test]
    fn a_layout_xkb_cannot_compile_is_an_error_rather_than_a_fallback() {
        // A fallback keymap could differ between the clients and the browser.
        let nonsense = KeyboardConfig {
            xkb_rules: "no-such-rules".into(),
            ..KeyboardConfig::default()
        };

        assert!(compiled_keymap(&nonsense).is_err());
    }

    /// Evdev codes from `linux/input-event-codes.h`.
    const KEY_5: u32 = 6;
    const KEY_9: u32 = 10;
    const KEY_P: u32 = 25;
    const KEY_ENTER: u32 = 28;
    const KEY_L: u32 = 38;
    const KEY_COMMA: u32 = 51;

    /// The key for `keysym` on the keyboard `config` names.
    fn key_for(config: &KeyboardConfig, keysym: &str) -> Option<u32> {
        Keyboard::compiled(config)
            .expect("the layout exists")
            .keys()
            .get(keysym)
            .copied()
    }

    #[test]
    fn a_keysym_is_the_key_it_is_on_in_the_layout_the_config_names() {
        // `l` is on a different key in each layout.
        assert_eq!(key_for(&KeyboardConfig::default(), "l"), Some(KEY_L));
        assert_eq!(key_for(&dvorak(), "l"), Some(KEY_P));
        assert_eq!(key_for(&dvorak(), "Return"), Some(KEY_ENTER));
    }

    #[test]
    fn a_keysym_is_its_key_whichever_level_it_is_on() {
        // `parenleft` is unshifted on `dvp`'s 5 key. The chord, not the level,
        // decides modifiers.
        assert_eq!(key_for(&dvorak(), "parenleft"), Some(KEY_5));
    }

    #[test]
    fn the_lowest_key_wins_whatever_level_it_is_on() {
        // `us` also has `parenleft` on a keypad key and `less` beside the left
        // Shift, both unshifted and both rare. The lowest key is in the main
        // block.
        assert_eq!(
            key_for(&KeyboardConfig::default(), "parenleft"),
            Some(KEY_9)
        );
        assert_eq!(key_for(&KeyboardConfig::default(), "less"), Some(KEY_COMMA));
    }

    #[test]
    fn a_keysym_the_keyboard_cannot_type_is_not_in_the_table() {
        assert_eq!(key_for(&KeyboardConfig::default(), "Retrun"), None);
        assert_eq!(key_for(&KeyboardConfig::default(), "Greek_alpha"), None);
    }

    /// The `key <NAME> { ... };` block of a compiled keymap, which may span
    /// several lines.
    fn symbols_for(keymap: &str, name: &str) -> String {
        let opens = format!("key <{name}>");
        let at = keymap
            .find(&opens)
            .unwrap_or_else(|| panic!("no key <{name}> in the keymap"));
        let rest = &keymap[at..];
        let ends = rest.find("};").expect("a key block closes");
        rest[..ends].to_string()
    }
}
