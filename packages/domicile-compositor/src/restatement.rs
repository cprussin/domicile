//! What a config reload must restate, beyond the display list.
//!
//! A reload applies only what differs between the old and new [`Config`].
//! Computing that here, away from the seat, outputs and sockets, keeps it
//! testable; `main` applies the result. Restating only what changed matters:
//! an editor's save can fire several events, and a keyboard change sends
//! every client a new keymap.
//!
//! # Every field, and what a reload does with it
//!
//! | field | on a reload |
//! |---|---|
//! | `input.keyboard.*` | recompiled and sent to the seat and chrome (`retype_the_desktop`) |
//! | `output.max_scale` | applied to the running desktop (`cap_the_scale_at`) |
//! | `output.displays` | applied (`Screens::reloaded_into`, `adopt_the_desktop`) |
//! | `output.profiles` | re-matched against the connected monitors, same path |
//! | `idle.blank_after_seconds` | idle clock restarted and timer re-armed (`reset_the_idle_clock`) |
//! | `theme.mode` | sent to every chrome and the desk's clients (`take_up_the_theme`) |
//! | `theme.accent_color`, `contrast`, `reduced_motion` | sent to the desk's clients (`Portals::restyle`) |
//! | `files.omit` | sent to the index, which rewalks the home (`omit_from_the_index`) |
//! | `extensions.*` | sent to every chrome, whose browser installs them (`hand_over_the_extensions`) |
//! | `keybindings` | resolved on the keyboard and sent to every chrome (`rebind_the_keys`) |
//! | `modes` | the same, with `keybindings` |
//! | `shells` | the same, with `keybindings` |
//!
//! The last three are also restated when `input.keyboard` changes, because a
//! chord names a keysym and the layout decides which key that is.
//!
//! Limits:
//! - `output.max_scale` only affects the output that follows Domicile's own
//!   window. A described display sets its own scale.
//! - A keyboard xkb cannot compile, or a keysym it cannot type, is refused
//!   (see `retype_the_desktop` and `rebind_the_keys`).
//! - Changing the idle timeout wakes blanked screens (see
//!   `reset_the_idle_clock`).
//!
//! A field added to [`Config`] needs a row here, plus either a field in
//! [`Restatement`] and an arm in `adopt_the_rest_of_the_config`, or a row that
//! says why a reload cannot apply it. Copy the tests below: a changed field is
//! restated and an unchanged one is not.

use domicile_config::{
    Config, ExtensionsConfig, IdleConfig, KeyboardConfig, Omit, ThemeConfig, ThemeMode,
};

/// What a reloaded config asks the compositor to restate.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Restatement {
    /// The keyboard to compile a keymap from, or `None` if unchanged.
    pub keyboard: Option<KeyboardConfig>,
    /// The new cap on the scale advertised to clients, or `None` if
    /// unchanged.
    pub max_scale: Option<u32>,
    /// When the screens blank, or `None` if unchanged.
    ///
    /// The whole section, so an absent section (never blank) is distinct from
    /// `None`.
    pub idle: Option<IdleConfig>,
    /// The theme mode, or `None` if unchanged.
    ///
    /// Just the mode, unlike `idle`: an absent `theme` means dark, so it needs
    /// no separate value.
    pub theme: Option<ThemeMode>,
    /// The theme, or `None` if nothing but the mode changed. Clients read
    /// the rest through the settings portal.
    pub appearance: Option<ThemeConfig>,
    /// What the file index leaves out, or `None` if unchanged.
    pub omit: Option<Omit>,
    /// The extensions the browser process installs, or `None` if unchanged.
    pub extensions: Option<ExtensionsConfig>,
    /// Whether to resend the key config to the chromes, because keysyms
    /// depend on the layout.
    pub shell_config: bool,
}

impl Restatement {
    /// What changed between the config that was live and the one replacing it.
    pub fn between(was: &Config, now: &Config) -> Restatement {
        Restatement {
            keyboard: (was.input.keyboard != now.input.keyboard)
                .then(|| now.input.keyboard.clone()),
            max_scale: (was.output.max_scale != now.output.max_scale)
                .then_some(now.output.max_scale),
            idle: (was.idle != now.idle).then(|| now.idle.clone()),
            theme: (was.theme.mode != now.theme.mode).then_some(now.theme.mode),
            appearance: (ThemeConfig {
                mode: now.theme.mode,
                ..was.theme
            } != now.theme)
                .then_some(now.theme),
            omit: (was.files.omit != now.files.omit).then(|| now.files.omit.clone()),
            extensions: (was.extensions != now.extensions).then(|| now.extensions.clone()),
            shell_config: was.input.keyboard != now.input.keyboard,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_config_that_did_not_change_restates_nothing() {
        let was = parsed(A_DVORAK_DESK);

        assert_eq!(
            Restatement::between(&was, &parsed(A_DVORAK_DESK)),
            Restatement::default()
        );
    }

    #[test]
    fn a_keyboard_that_moved_is_restated() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_PLAIN_DESK);

        let restated = Restatement::between(&was, &now);

        assert_eq!(
            restated.keyboard.expect("the layout moved").xkb_variant,
            "",
            "the keyboard handed back is the new one, not the one being replaced"
        );
    }

    #[test]
    fn an_idle_timeout_that_moved_is_restated() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DESK_THAT_BLANKS);

        assert_eq!(
            Restatement::between(&was, &now)
                .idle
                .expect("the timeout moved")
                .blank_after_seconds,
            Some(60)
        );
    }

    #[test]
    fn a_theme_that_moved_is_restated() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DESK_DRAWN_LIGHT);

        assert_eq!(
            Restatement::between(&was, &now).theme,
            Some(ThemeMode::Light)
        );
    }

    #[test]
    fn a_file_that_restates_the_theme_it_already_had_restates_nothing() {
        // `theme` is generated with the rest of the file, so an edit to
        // another field rewrites it unchanged. Restating it would re-theme
        // every page for nothing.
        let was = parsed(A_DESK_DRAWN_LIGHT);

        assert_eq!(
            Restatement::between(&was, &parsed(A_DESK_DRAWN_LIGHT)).theme,
            None
        );
    }

    #[test]
    fn a_look_that_moved_is_restated_without_the_mode() {
        // Repainting every page for an accent change would flash the desk.
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DVORAK_DESK_WITH_AN_ACCENT);

        let restated = Restatement::between(&was, &now);

        assert_eq!(restated.theme, None);
        assert_eq!(restated.appearance, Some(now.theme));
        assert_eq!(
            Restatement::between(&was, &parsed(A_DESK_DRAWN_LIGHT)).appearance,
            None
        );
    }

    #[test]
    fn what_the_index_omits_is_restated_when_it_moved() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DESK_OFFERING_ITS_DOTFILES);

        let omit = Restatement::between(&was, &now)
            .omit
            .expect("the omitted paths moved");
        assert!(
            !omit.omits(".config"),
            "the rule handed back is the new one, not the one being replaced"
        );
    }

    #[test]
    fn extensions_that_moved_are_restated() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DESK_WITH_AN_EXTENSION);

        assert_eq!(
            Restatement::between(&was, &now)
                .extensions
                .expect("the extensions moved")
                .web_store,
            ["ddkjiahejlhfcafbddmgiahcphecmpfh"],
            "the list handed back is the new one, not the one being replaced"
        );
    }

    #[test]
    fn the_keys_are_restated_when_the_keyboard_moved() {
        // A chord names a keysym, and the layout decides which key that is.
        let was = parsed(A_DVORAK_DESK);
        assert!(Restatement::between(&was, &parsed(A_PLAIN_DESK)).shell_config);
    }

    #[test]
    fn a_cap_on_the_scale_that_moved_is_restated() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_CAPPED_DESK);

        assert_eq!(Restatement::between(&was, &now).max_scale, Some(1));
    }

    #[test]
    fn a_desk_that_only_moved_its_displays_restates_neither() {
        // An edit to the display list must not resend every client a keymap
        // or scale it already has.
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DVORAK_DESK_WITH_A_SECOND_DISPLAY);

        assert_eq!(
            Restatement::between(&was, &now),
            Restatement::default(),
            "nothing but the displays moved, and the displays are not this function's"
        );
    }

    const A_DVORAK_DESK: &str = r#"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "output": { "displays": [{ "name": "one", "size": [1024, 768] }] }
}
"#;

    /// The same desk, with nothing left out of its file index.
    const A_DESK_OFFERING_ITS_DOTFILES: &str = r#"
{
  "files": { "omit": [] },
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "output": { "displays": [{ "name": "one", "size": [1024, 768] }] }
}
"#;

    /// The same desk, running one extension from the Web Store.
    const A_DESK_WITH_AN_EXTENSION: &str = r#"
{
  "extensions": { "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"] },
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "output": { "displays": [{ "name": "one", "size": [1024, 768] }] }
}
"#;

    /// The same desk with the default US QWERTY layout.
    const A_PLAIN_DESK: &str = r#"
{ "output": { "displays": [{ "name": "one", "size": [1024, 768] }] } }
"#;

    /// The same desk, blanking after a minute idle.
    const A_DESK_THAT_BLANKS: &str = r#"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "idle": { "blank_after_seconds": 60 },
  "output": { "displays": [{ "name": "one", "size": [1024, 768] }] }
}
"#;

    /// The same desk, with the scale capped at 1.
    const A_CAPPED_DESK: &str = r#"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "output": {
    "max_scale": 1,
    "displays": [{ "name": "one", "size": [1024, 768] }]
  }
}
"#;

    /// The same desk in light mode.
    const A_DESK_DRAWN_LIGHT: &str = r#"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "theme": { "mode": "light" },
  "output": { "displays": [{ "name": "one", "size": [1024, 768] }] }
}
"#;

    /// The same desk with an accent color, high contrast and less motion.
    const A_DVORAK_DESK_WITH_AN_ACCENT: &str = r##"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "theme": { "accent_color": "#3584e4", "contrast": "high", "reduced_motion": true },
  "output": { "displays": [{ "name": "one", "size": [1024, 768] }] }
}
"##;

    const A_DVORAK_DESK_WITH_A_SECOND_DISPLAY: &str = r#"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:swapescape"] }
  },
  "output": {
    "displays": [
      { "name": "one", "size": [1024, 768] },
      { "name": "two", "position": [1024, 0], "size": [1024, 768] }
    ]
  }
}
"#;

    fn parsed(text: &str) -> Config {
        Config::parse(text).expect("the fixtures are configs a desk could run")
    }
}
