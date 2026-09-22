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
    .map(|keymap| keymap.get_as_string(xkb::KEYMAP_FORMAT_TEXT_V1))
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
