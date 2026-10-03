//! The keymap the desktop types in, compiled from the config.
//!
//! The seat compiles one of these for itself out of the same [`KeyboardConfig`]
//! — it is what every Wayland client is handed over `wl_keyboard.keymap` — and
//! this is the same keymap as text, for the one peer that cannot be handed a
//! file descriptor: the browser process drawing the desktop. Its own
//! `KeyboardLayoutEngine` decodes every key the shell is typed with, and off
//! ChromeOS nothing in Chromium ever gives that engine a keymap unless the
//! Wayland ozone platform is the one running — which here it is not. See
//! [`domicile_protocol::HostMessage::Keymap`].
//!
//! Compiled here rather than read back off the seat because it has to exist
//! before there is a compositor state to read it through: Smithay's
//! `KeyboardHandle::with_xkb_state` wants `&mut D`, and the chrome socket is
//! already accepting connections by the time that value is built. So xkb
//! compiles twice in this process — once for the seat, once here — off one
//! [`KeyboardConfig`] value and one libxkbcommon. That is a repeated
//! compilation of one reading, not a second reading: what the browser must
//! never do is read `input.keyboard` for itself, because then there are two
//! answers and nothing that compares them.

use std::collections::BTreeMap;

use domicile_config::KeyboardConfig;
use smithay::input::keyboard::xkb;

/// xkb would not build a keymap out of what the config names.
///
/// Fatal at startup, and deliberately so: a desktop that came up on whatever
/// layout libxkbcommon fell back to would be one typing in a layout nobody
/// chose, which is the failure this whole message exists to end rather than a
/// degraded mode to run in.
///
/// On a *reload* it is refused rather than fatal — the desk is already typing
/// on a layout that compiled, and taking it down over a typo in a file
/// somebody is mid-edit costs them every window that was open. Same error,
/// different answer, because the two moments have different things to lose;
/// see `retype_the_desktop`.
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

/// The config's keymap, in the `XKB_KEYMAP_FORMAT_TEXT_V1` text a
/// `wl_keyboard.keymap` fd carries.
pub fn compiled_keymap(config: &KeyboardConfig) -> Result<String, UnknownLayout> {
    compiled(config).map(|keymap| keymap.get_as_string(xkb::KEYMAP_FORMAT_TEXT_V1))
}

/// The config's keymap, compiled, for asking which key a keysym is on.
///
/// A keysym is what a binding names and a key is what a press arrives as, so
/// this is the one place a binding meets the keyboard.
pub struct Keyboard {
    keymap: xkb::Keymap,
}

impl Keyboard {
    pub fn compiled(config: &KeyboardConfig) -> Result<Keyboard, UnknownLayout> {
        compiled(config).map(|keymap| Keyboard { keymap })
    }

    /// The evdev key `keysym` is on.
    ///
    /// The lowest key that has it on any level of the first layout, the one a
    /// desk types in until something switches it. Lowest key rather than
    /// lowest level because xkb numbers the main block first, and a keysym
    /// is often also unshifted on a key a board may not have — `us` puts
    /// `parenleft` on the keypad's own parenthesis key, and `less` beside a
    /// left Shift that a US board lacks. Which modifiers are held is the
    /// binding's to say and not this: `Meta+Shift+parenleft` is the key
    /// `parenleft` is on, with Shift, whatever level that is.
    pub fn key_for(&self, keysym: &str) -> Result<u32, UnknownKeysym> {
        let wanted = xkb::keysym_from_name(keysym, xkb::KEYSYM_NO_FLAGS);
        if wanted == xkb::Keysym::NoSymbol {
            return Err(UnknownKeysym::NoSuchName(keysym.to_string()));
        }
        let keys = self.keymap.min_keycode().raw()..=self.keymap.max_keycode().raw();
        keys.map(xkb::Keycode::new)
            .find(|&key| {
                (0..self.keymap.num_levels_for_key(key, 0)).any(|level| {
                    self.keymap
                        .key_get_syms_by_level(key, 0, level)
                        .contains(&wanted)
                })
            })
            // An xkb keycode is the evdev one plus 8, and evdev is what the
            // chrome speaks — see `Shortcut::key`.
            .map(|key| key.raw() - 8)
            .ok_or_else(|| UnknownKeysym::OnNoKey(keysym.to_string()))
    }
}

impl Keyboard {
    /// Every keysym this keyboard can type, by name, and the evdev key
    /// [`Keyboard::key_for`] names for it.
    ///
    /// What a shell resolves its own chords against: a shell's keybindings
    /// are its props, so the page has the chords and only the compositor has
    /// the keymap. The same rule as `key_for` — the lowest key with the keysym
    /// on any level of the first layout — so a chord means one key whichever
    /// side resolved it.
    pub fn keys(&self) -> BTreeMap<String, u32> {
        let mut keys = BTreeMap::new();
        let all = self.keymap.min_keycode().raw()..=self.keymap.max_keycode().raw();
        for key in all.map(xkb::Keycode::new) {
            for level in 0..self.keymap.num_levels_for_key(key, 0) {
                for &keysym in self.keymap.key_get_syms_by_level(key, 0, level) {
                    // An xkb keycode is the evdev one plus 8 — see `key_for`.
                    keys.entry(xkb::keysym_get_name(keysym))
                        .or_insert(key.raw() - 8);
                }
            }
        }
        keys
    }
}

/// A binding names a keysym this keyboard cannot type.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UnknownKeysym {
    #[error("{0:?} is not the name of an xkb keysym")]
    NoSuchName(String),
    #[error("{0:?} is on no key of the keyboard input.keyboard names")]
    OnNoKey(String),
}

/// `config`, compiled by xkb, or the names it would not compile.
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

    /// A keyboard somebody wrote down: programmer Dvorak with caps lock
    /// swapped for escape.
    ///
    /// STATED RATHER THAN TAKEN FROM THE DEFAULT, which is what it used to be.
    /// The default is nobody's layout now -- see
    /// `a_desk_that_configured_no_keyboard_gets_nobodys_layout` in
    /// domicile-config -- and a test about what a config NAMES should name
    /// one anyway.
    fn dvorak() -> KeyboardConfig {
        KeyboardConfig {
            xkb_variant: "dvp".into(),
            xkb_options: vec!["caps:swapescape".into()],
            ..KeyboardConfig::default()
        }
    }

    #[test]
    fn the_layout_the_config_names_is_the_keymap_that_comes_out() {
        // Both halves of that keyboard are in the text: on `dvp` the key a
        // QWERTY keyboard has `q` printed on is a semicolon, and
        // `caps:swapescape` is an option rather than a layout, so a keymap
        // carrying the layout and not the options would pass on the first line
        // and fail on the second.
        //
        // This is the bug, one layer down: the browser process decoded every
        // printable key off a positional US-QWERTY table, so what the config
        // said was a semicolon arrived as nothing at all.
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
        // The other side of the same seam, and what the default stopped being:
        // a desk that says nothing about its keyboard gets `us` as it comes.
        // Asserted here rather than only on the struct because this is where
        // it becomes a keymap -- an empty variant that xkb quietly read as
        // something else would pass a test on the field and fail a user.
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
        // What a typo in the config buys, and the reason it must not buy a
        // desktop: xkb is perfectly willing to hand back *something*, and a
        // compositor that shipped that something would advertise one keymap to
        // its clients and tell the browser another.
        let nonsense = KeyboardConfig {
            xkb_rules: "no-such-rules".into(),
            ..KeyboardConfig::default()
        };

        assert!(compiled_keymap(&nonsense).is_err());
    }

    /// The evdev codes, as `linux/input-event-codes.h` numbers them.
    const KEY_5: u32 = 6;
    const KEY_9: u32 = 10;
    const KEY_P: u32 = 25;
    const KEY_ENTER: u32 = 28;
    const KEY_L: u32 = 38;
    const KEY_COMMA: u32 = 51;

    fn key_for(config: &KeyboardConfig, keysym: &str) -> Result<u32, UnknownKeysym> {
        Keyboard::compiled(config)
            .expect("the layout exists")
            .key_for(keysym)
    }

    #[test]
    fn a_keysym_is_the_key_it_is_on_in_the_layout_the_config_names() {
        // What a hand-kept table of Programmer's Dvorak got right on exactly
        // one keyboard: `l` is a different key on each of these.
        assert_eq!(key_for(&KeyboardConfig::default(), "l"), Ok(KEY_L));
        assert_eq!(key_for(&dvorak(), "l"), Ok(KEY_P));
        assert_eq!(key_for(&dvorak(), "Return"), Ok(KEY_ENTER));
    }

    #[test]
    fn a_keysym_is_its_key_whichever_level_it_is_on() {
        // `parenleft` is shifted on `us` and unshifted on the key `us` prints
        // a 5 on in `dvp`. The key either way, and the modifiers stay the
        // chord's: `Meta+Shift+parenleft` on dvp is that key with Shift held,
        // which is what the shell asked for.
        assert_eq!(key_for(&dvorak(), "parenleft"), Ok(KEY_5));
    }

    #[test]
    fn the_lowest_key_wins_whatever_level_it_is_on() {
        // `us` has `parenleft` twice: Shift+9, and unshifted on the keypad's
        // own parenthesis key, which hardly a keyboard has. And `less` twice:
        // Shift+comma, and unshifted on the extra key beside the left Shift,
        // which a US board does not have. Preferring the unshifted level would
        // bind both to a key nobody can press; xkb numbers the main block
        // first, so the lowest key is the one a person types the keysym on.
        assert_eq!(key_for(&KeyboardConfig::default(), "parenleft"), Ok(KEY_9));
        assert_eq!(key_for(&KeyboardConfig::default(), "less"), Ok(KEY_COMMA));
    }

    #[test]
    fn a_keysym_the_keyboard_cannot_type_is_refused_and_named() {
        assert_eq!(
            key_for(&KeyboardConfig::default(), "Retrun"),
            Err(UnknownKeysym::NoSuchName("Retrun".into()))
        );
        assert_eq!(
            key_for(&KeyboardConfig::default(), "Greek_alpha"),
            Err(UnknownKeysym::OnNoKey("Greek_alpha".into()))
        );
    }

    #[test]
    fn every_keysym_on_the_keyboard_is_the_key_key_for_names() {
        // The table a shell resolves its own chords against, which has to
        // agree with the config's resolution chord for chord.
        let keyboard = Keyboard::compiled(&dvorak()).expect("the layout exists");
        let keys = keyboard.keys();
        assert_eq!(keys.get("l"), Some(&KEY_P));
        assert_eq!(keys.get("parenleft"), Some(&KEY_5));
        assert_eq!(keys.get("Return"), Some(&KEY_ENTER));
        for (keysym, key) in &keys {
            assert_eq!(keyboard.key_for(keysym), Ok(*key), "{keysym}");
        }
    }

    #[test]
    fn a_keysym_on_no_key_is_not_in_the_table() {
        let keys = Keyboard::compiled(&KeyboardConfig::default())
            .expect("the layout exists")
            .keys();
        assert_eq!(keys.get("Greek_alpha"), None);
        assert_eq!(keys.get("less"), Some(&KEY_COMMA));
    }

    /// The `key <NAME> { ... };` block of a compiled keymap.
    ///
    /// A block rather than a line because xkb writes both: a key with one
    /// symbol per level fits on one, and one with a type to name does not.
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
