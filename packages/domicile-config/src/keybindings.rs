//! A desk's keys: chords bound to actions, sway-style.
//!
//! ```toml
//! [keybindings]
//! "Meta+Return" = "send-shell terminal"
//! "Meta+r" = "mode resize"
//!
//! [modes.resize]
//! "Meta+Escape" = "mode default"
//! ```
//!
//! A chord names a keysym rather than a key, as sway's do, and nothing here
//! can say whether the keysym is on the keyboard: that takes the xkb keymap
//! `input.keyboard` compiles to, which is the compositor's. So this is every
//! refusal that needs no keymap, and the compositor makes the one that does.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::ConfigError;

/// A key, and exactly the modifiers held with it.
///
/// Exact rather than at-least: `Meta+l` is not `Meta+Shift+l`, which is what
/// lets a shell bind both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chord {
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub logo: bool,
    /// An xkb keysym name, as written: `l`, `Return`, `parenleft`.
    ///
    /// Case-sensitive, because xkb's names are: `l` and `L` are two keysyms.
    pub keysym: String,
}

/// What a chord does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// `send-shell <word>…`: the words, handed to the shell to interpret.
    ///
    /// The shell's vocabulary rather than this crate's, so nothing here knows
    /// what `focus right` means — only that it is something to say.
    SendShell { args: Vec<String> },
    /// `mode <name>`: the table of bindings that is live from now on.
    Mode { name: String },
}

/// One line of a bindings table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub chord: Chord,
    pub action: Action,
}

/// One table of bindings: `[keybindings]`, or one mode's.
///
/// Parsed as it is read, so a chord or an action that is not one is refused
/// with toml's own pointer at the line. Ordered by the chord as written, which
/// is as good an order as any and the same one every time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(try_from = "BTreeMap<String, String>")]
pub struct Bindings(Vec<Binding>);

impl Bindings {
    pub fn iter(&self) -> impl Iterator<Item = &Binding> {
        self.0.iter()
    }

    /// The mode each `mode` action in this table switches to.
    fn mode_targets(&self) -> impl Iterator<Item = &str> {
        self.0.iter().filter_map(|binding| match &binding.action {
            Action::Mode { name } => Some(name.as_str()),
            Action::SendShell { .. } => None,
        })
    }
}

/// Refuse a set of tables — `[keybindings]` and `[modes]`, or one shell's —
/// that names a mode it could never be in.
///
/// `at` is where the tables sit, `""` or `"shells.manganese."`, so that a
/// refusal names the table a person would open. `declared` says which modes
/// exist for these tables to switch to; `default` always does.
pub(crate) fn validate(
    at: &str,
    keybindings: &Bindings,
    modes: &BTreeMap<String, Bindings>,
    declared: impl Fn(&str) -> bool,
) -> Result<(), ConfigError> {
    // `[keybindings]` is mode `default`, and a second table under the name
    // would leave one of the two doing nothing.
    if modes.contains_key("default") {
        return Err(ConfigError::Validation(format!(
            "[{at}modes.default] is not a mode of its own; mode `default` is \
             [{at}keybindings]"
        )));
    }
    let tables = std::iter::once((format!("[{at}keybindings]"), keybindings)).chain(
        modes
            .iter()
            .map(|(name, bindings)| (format!("[{at}modes.{name}]"), bindings)),
    );
    for (table, bindings) in tables {
        if let Some(name) = bindings
            .mode_targets()
            .find(|name| *name != "default" && !declared(name))
        {
            return Err(ConfigError::Validation(format!(
                "{table} switches to mode `{name}`, which no table it can reach \
                 declares"
            )));
        }
    }
    Ok(())
}

impl TryFrom<BTreeMap<String, String>> for Bindings {
    type Error = String;

    fn try_from(table: BTreeMap<String, String>) -> Result<Bindings, String> {
        let mut bindings: Vec<(String, Binding)> = Vec::with_capacity(table.len());
        for (written, action_text) in table {
            let binding = Binding {
                chord: chord(&written)?,
                action: action(&action_text).map_err(|why| format!("{written:?}: {why}"))?,
            };
            // Two spellings of one chord: toml cannot see it, since the keys
            // differ, and whichever one won would leave the other a line that
            // does nothing.
            if let Some((earlier, _)) = bindings
                .iter()
                .find(|(_, earlier)| earlier.chord == binding.chord)
            {
                return Err(format!(
                    "{earlier:?} and {written:?} are the same chord, bound twice"
                ));
            }
            bindings.push((written, binding));
        }
        Ok(Bindings(
            bindings.into_iter().map(|(_, binding)| binding).collect(),
        ))
    }
}

/// The modifiers a chord can hold, in the order a message lists them.
const MODIFIERS: &str = "Meta/Super/Logo/Mod4, Shift, Ctrl/Control, Alt/Mod1";

/// `Meta+Shift+parenleft`, read.
fn chord(written: &str) -> Result<Chord, String> {
    if written.chars().any(char::is_whitespace) {
        return Err(format!(
            "chord {written:?} has whitespace in it; write it as `Meta+Shift+a`"
        ));
    }
    let mut components: Vec<&str> = written.split('+').collect();
    let keysym = components.pop().expect("a split always yields one");
    if keysym.is_empty() || modifier(keysym).is_some() {
        return Err(format!(
            "chord {written:?} names no key; its last part is the keysym, after \
             any of {MODIFIERS}"
        ));
    }
    let mut chord = Chord {
        alt: false,
        ctrl: false,
        shift: false,
        logo: false,
        keysym: keysym.to_string(),
    };
    for component in components {
        if component.is_empty() {
            return Err(format!("chord {written:?} has an empty part"));
        }
        let held = match modifier(component) {
            Some(Modifier::Alt) => &mut chord.alt,
            Some(Modifier::Ctrl) => &mut chord.ctrl,
            Some(Modifier::Shift) => &mut chord.shift,
            Some(Modifier::Logo) => &mut chord.logo,
            None => {
                return Err(format!(
                    "chord {written:?}: {component:?} is not a modifier, which is one \
                     of {MODIFIERS}"
                ))
            }
        };
        if *held {
            return Err(format!(
                "chord {written:?} holds {component:?} twice, under one spelling or two"
            ));
        }
        *held = true;
    }
    Ok(chord)
}

#[derive(Debug, Clone, Copy)]
enum Modifier {
    Alt,
    Ctrl,
    Shift,
    Logo,
}

/// The modifier `component` spells, in any case.
fn modifier(component: &str) -> Option<Modifier> {
    match component.to_ascii_lowercase().as_str() {
        "meta" | "super" | "logo" | "mod4" => Some(Modifier::Logo),
        "shift" => Some(Modifier::Shift),
        "ctrl" | "control" => Some(Modifier::Ctrl),
        "alt" | "mod1" => Some(Modifier::Alt),
        _ => None,
    }
}

/// `send-shell focus right`, read.
fn action(written: &str) -> Result<Action, String> {
    let words: Vec<&str> = written.split_whitespace().collect();
    match words.as_slice() {
        ["send-shell"] => Err(format!(
            "action {written:?} sends the shell nothing; it takes at least one word"
        )),
        ["send-shell", args @ ..] => Ok(Action::SendShell {
            args: args.iter().map(|word| word.to_string()).collect(),
        }),
        ["mode", name] => Ok(Action::Mode {
            name: name.to_string(),
        }),
        ["mode", ..] => Err(format!(
            "action {written:?} takes exactly one mode name, as `mode resize`"
        )),
        _ => Err(format!(
            "action {written:?} is neither `send-shell <word>...` nor `mode <name>`"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(alt: bool, ctrl: bool, shift: bool, logo: bool, keysym: &str) -> Chord {
        Chord {
            alt,
            ctrl,
            shift,
            logo,
            keysym: keysym.to_string(),
        }
    }

    #[test]
    fn a_chord_is_its_modifiers_and_a_keysym() {
        assert_eq!(
            chord("Meta+Shift+parenleft"),
            Ok(held(false, false, true, true, "parenleft"))
        );
        assert_eq!(
            chord("Return"),
            Ok(held(false, false, false, false, "Return"))
        );
    }

    #[test]
    fn every_spelling_of_a_modifier_in_any_case_is_that_modifier() {
        for logo in ["Meta", "Super", "Logo", "Mod4", "META", "super"] {
            assert_eq!(
                chord(&format!("{logo}+a")),
                Ok(held(false, false, false, true, "a"))
            );
        }
        for ctrl in ["Ctrl", "Control", "cTrL"] {
            assert_eq!(
                chord(&format!("{ctrl}+a")),
                Ok(held(false, true, false, false, "a"))
            );
        }
        for alt in ["Alt", "Mod1", "alt"] {
            assert_eq!(
                chord(&format!("{alt}+a")),
                Ok(held(true, false, false, false, "a"))
            );
        }
        assert_eq!(chord("SHIFT+a"), Ok(held(false, false, true, false, "a")));
    }

    #[test]
    fn the_keysym_keeps_its_case() {
        // xkb's names are case-sensitive: `L` is the capital, a keysym of its
        // own, so folding it would bind a different key.
        assert_eq!(chord("Meta+L"), Ok(held(false, false, false, true, "L")));
    }

    #[test]
    fn a_chord_that_is_not_one_is_refused_and_named() {
        for (written, why) in [
            ("Meta++a", "empty part"),
            ("Hyper+a", "\"Hyper\" is not a modifier"),
            ("Meta+Super+a", "twice"),
            ("Shift+shift+a", "twice"),
            ("Meta+", "names no key"),
            ("", "names no key"),
            ("Meta+Shift", "names no key"),
            ("Meta + a", "whitespace"),
        ] {
            let refused = chord(written).expect_err(written);
            assert!(refused.contains(why), "{written:?}: {refused}");
            assert!(
                refused.contains(&format!("{written:?}")),
                "the refusal names the chord: {refused}"
            );
        }
    }

    #[test]
    fn an_action_is_send_shell_with_words_or_mode_with_a_name() {
        assert_eq!(
            action("send-shell focus  right"),
            Ok(Action::SendShell {
                args: vec!["focus".into(), "right".into()]
            })
        );
        assert_eq!(
            action("mode resize"),
            Ok(Action::Mode {
                name: "resize".into()
            })
        );
    }

    #[test]
    fn an_action_that_is_not_one_is_refused_and_named() {
        for written in ["send-shell", "mode", "mode a b", "frobnicate", ""] {
            let refused = action(written).expect_err(written);
            assert!(
                refused.contains(&format!("{written:?}")),
                "the refusal names the action: {refused}"
            );
        }
    }
}
