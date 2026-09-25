//! What a reload has to restate, beyond the display list.
//!
//! A reload is an edit rather than a file: the desktop is already running on
//! the old config, so what has to happen is whatever the two of them differ
//! by. Deciding that here — arithmetic over two [`Config`]s, with no seat, no
//! `wl_output` and no socket in reach — is what makes it testable, and leaves
//! the effectful half in `main` a walk down this answer.
//!
//! It is also what keeps a reload quiet. A config file is rewritten for all
//! sorts of reasons and an editor's atomic-rename save produces several events
//! for one edit; every client on the desktop is handed a keymap when the
//! keyboard changes, so "restate everything each time" is a desk that
//! re-advertises itself whenever anything writes to its directory.
//!
//! # Every field, and what a reload does with it
//!
//! | field | on a reload |
//! |---|---|
//! | `input.keyboard.*` | recompiled, given to the seat and to the chrome — `retype_the_desktop` |
//! | `output.max_scale` | the new cap, applied to the desktop that is up — `cap_the_scale_at` |
//! | `output.displays` | the desktop it describes — `Screens::reloaded_into`, `adopt_the_desktop` |
//! | `output.profiles` | re-matched against the monitors that are plugged in, same path |
//! | `idle.blank_after_seconds` | the clock restarted and its timer re-armed — `reset_the_idle_clock` |
//! | `theme.mode` | told to every chrome and to the desk's clients — `take_up_the_theme` |
//!
//! Six rows for the six fields [`Config`] has: a reload acts on each of them
//! rather than storing it. Three limits read like gaps and are not.
//! `output.max_scale` governs only the output that follows Domicile's own
//! window — a described display states its own scale, and a desktop the config
//! describes refuses a density from anywhere else. A keyboard xkb cannot
//! compile is refused rather than taken up, which is `retype_the_desktop`'s own
//! doc comment. And an edited idle timeout lights a desk whose screens were
//! off, which `reset_the_idle_clock` argues is the only honest answer rather
//! than a convenience.
//!
//! **This table is the account of record, so a field added to [`Config`] has
//! to appear in it** — with a line in [`Restatement`] and an arm in
//! `adopt_the_rest_of_the_config` where a reload can act on it, or with its
//! row saying outright that a reload cannot and why. A field that is neither
//! is the gap this module closed, growing back one entry at a time and with
//! nothing anywhere saying so. The unit tests below are the shape to copy:
//! what moved is restated, and what did not is not.

use domicile_config::{Config, IdleConfig, KeyboardConfig, ThemeMode};

/// What a reloaded config asks the compositor to restate.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Restatement {
    /// The keyboard to compile a keymap from, or `None` where the live one is
    /// still the config's.
    pub keyboard: Option<KeyboardConfig>,
    /// The new cap on the scale advertised to clients, or `None` where it did
    /// not move.
    pub max_scale: Option<u32>,
    /// When the screens go dark, or `None` where that did not move.
    ///
    /// The whole section rather than its one duration, so that "says nothing
    /// about idle" — a desktop that never blanks — is a value this can carry
    /// rather than a second `None` meaning the opposite of the first.
    pub idle: Option<IdleConfig>,
    /// Which way round the desk is drawn, or `None` where the file did not
    /// move it.
    ///
    /// The mode rather than the whole `[theme]` section, which is the
    /// opposite of what `idle` above does, and the difference is that a theme
    /// has no absence: saying nothing about `[theme]` is dark, the same value
    /// as saying `mode = "dark"`, where saying nothing about `[idle]` is a
    /// desk that never blanks and has no spelling of its own.
    pub theme: Option<ThemeMode>,
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
            theme: (was.theme != now.theme).then_some(now.theme.mode),
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
        // The edit that matters here is the one somebody made to a *different*
        // field: `[theme]` is generated along with the rest of the file, so a
        // reload that moved a display rewrites the theme line untouched. A
        // restatement for it would run the wipe on every page on the desk over
        // a theme that did not change.
        let was = parsed(A_DESK_DRAWN_LIGHT);

        assert_eq!(
            Restatement::between(&was, &parsed(A_DESK_DRAWN_LIGHT)).theme,
            None
        );
    }

    #[test]
    fn a_cap_on_the_scale_that_moved_is_restated() {
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_CAPPED_DESK);

        assert_eq!(Restatement::between(&was, &now).max_scale, Some(1));
    }

    #[test]
    fn a_desk_that_only_moved_its_displays_restates_neither() {
        // The discipline `adopt_the_desktop` already applies, from this side:
        // a config file is rewritten for all sorts of reasons, and an edit to
        // the display list must not hand every client a keymap or a density it
        // already has.
        let was = parsed(A_DVORAK_DESK);
        let now = parsed(A_DVORAK_DESK_WITH_A_SECOND_DISPLAY);

        assert_eq!(
            Restatement::between(&was, &now),
            Restatement::default(),
            "nothing but the displays moved, and the displays are not this function's"
        );
    }

    const A_DVORAK_DESK: &str = r#"
[input.keyboard]
xkb_variant = "dvp"
xkb_options = ["caps:swapescape"]

[[output.displays]]
name = "one"
size = [1024, 768]
"#;

    /// The same desk typing US QWERTY as it comes.
    const A_PLAIN_DESK: &str = r#"
[[output.displays]]
name = "one"
size = [1024, 768]
"#;

    /// The same desk, told to turn its screens off after a minute alone.
    const A_DESK_THAT_BLANKS: &str = r#"
[input.keyboard]
xkb_variant = "dvp"
xkb_options = ["caps:swapescape"]

[idle]
blank_after_seconds = 60

[[output.displays]]
name = "one"
size = [1024, 768]
"#;

    /// The same keyboard, with scaling turned off.
    const A_CAPPED_DESK: &str = r#"
[input.keyboard]
xkb_variant = "dvp"
xkb_options = ["caps:swapescape"]

[output]
max_scale = 1

[[output.displays]]
name = "one"
size = [1024, 768]
"#;

    /// The same desk, stated the other way round.
    const A_DESK_DRAWN_LIGHT: &str = r#"
[input.keyboard]
xkb_variant = "dvp"
xkb_options = ["caps:swapescape"]

[theme]
mode = "light"

[[output.displays]]
name = "one"
size = [1024, 768]
"#;

    const A_DVORAK_DESK_WITH_A_SECOND_DISPLAY: &str = r#"
[input.keyboard]
xkb_variant = "dvp"
xkb_options = ["caps:swapescape"]

[[output.displays]]
name = "one"
size = [1024, 768]

[[output.displays]]
name = "two"
position = [1024, 0]
size = [1024, 768]
"#;

    fn parsed(text: &str) -> Config {
        Config::parse(text).expect("the fixtures are configs a desk could run")
    }
}
