//! The config's keybindings and shells, as the chrome is told them.
//!
//! The config names a keysym in every chord, as sway's does, and a press
//! arrives as a key — so somebody has to say which key each keysym is on, and
//! the compositor is the one holding the keymap `input.keyboard` compiles to.
//! This is that translation, plus the one thing the config crate leaves in
//! TOML: a shell's freeform `options`, which go out as JSON. See
//! [`domicile_protocol::HostMessage::ShellConfig`].

use std::collections::BTreeMap;

use domicile_config::{Action, Bindings, Config};
use domicile_protocol::{KeyAction, KeyBinding, ModeBindings, ShellBindings, Shortcut};

use crate::keymap::{Keyboard, UnknownKeysym, UnknownLayout};

/// [`domicile_protocol::HostMessage::ShellConfig`]'s fields, resolved.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub keybindings: ModeBindings,
    pub shells: BTreeMap<String, ShellBindings>,
}

/// Why a config's bindings could not be resolved against its keyboard.
///
/// Refused the way a keyboard that will not compile is: fatal at startup, and
/// on a reload the shells keep the bindings they were last told — see
/// `rebind_the_keys`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Unbindable {
    #[error(transparent)]
    Layout(#[from] UnknownLayout),
    #[error("{table} binds a keysym this keyboard cannot type: {why}")]
    Keysym { table: String, why: UnknownKeysym },
}

/// Every binding in `config`, on the keyboard `config` names.
///
/// Compiled from `input.keyboard` rather than handed the seat's keymap, for
/// the reason `crate::keymap` compiles twice: the seat's is only lent through
/// the compositor state, and this is called before there is one. One
/// `KeyboardConfig` and one libxkbcommon make the same keymap each time.
pub fn resolve(config: &Config) -> Result<Resolved, Unbindable> {
    let keyboard = Keyboard::compiled(&config.input.keyboard)?;
    let shells = config
        .shells
        .iter()
        .map(|(name, shell)| {
            let at = format!("shells.{name}.");
            modes(&keyboard, &at, &shell.keybindings, &shell.modes).map(|keybindings| {
                let options = shell
                    .options
                    .iter()
                    .map(|(key, value)| (key.clone(), json(value)))
                    .collect();
                (
                    name.clone(),
                    ShellBindings {
                        keybindings,
                        options,
                    },
                )
            })
        })
        .collect::<Result<_, _>>()?;
    Ok(Resolved {
        keybindings: modes(&keyboard, "", &config.keybindings, &config.modes)?,
        shells,
    })
}

/// One set of tables — `[keybindings]` as mode `default`, and each of
/// `[modes]` — resolved. `at` is where they sit, for a refusal to name.
fn modes(
    keyboard: &Keyboard,
    at: &str,
    default: &Bindings,
    modes: &BTreeMap<String, Bindings>,
) -> Result<ModeBindings, Unbindable> {
    std::iter::once(("default".to_string(), format!("[{at}keybindings]"), default))
        .chain(
            modes
                .iter()
                .map(|(name, bindings)| (name.clone(), format!("[{at}modes.{name}]"), bindings)),
        )
        .map(|(mode, table, bindings)| {
            bindings
                .iter()
                .map(|binding| {
                    let chord = &binding.chord;
                    keyboard
                        .key_for(&chord.keysym)
                        .map(|key| KeyBinding {
                            shortcut: Shortcut {
                                key,
                                alt: chord.alt,
                                ctrl: chord.ctrl,
                                shift: chord.shift,
                                logo: chord.logo,
                            },
                            action: match &binding.action {
                                Action::SendShell { args } => {
                                    KeyAction::SendShell { args: args.clone() }
                                }
                                Action::Mode { name } => KeyAction::Mode { name: name.clone() },
                            },
                        })
                        .map_err(|why| Unbindable::Keysym {
                            table: table.clone(),
                            why,
                        })
                })
                .collect::<Result<_, _>>()
                .map(|resolved| (mode, resolved))
        })
        .collect()
}

/// A TOML value as JSON.
///
/// A date becomes the text TOML wrote, JSON having no date of its own; a float
/// JSON cannot carry never gets here, because the config refuses it.
fn json(value: &toml::Value) -> serde_json::Value {
    match value {
        toml::Value::String(string) => serde_json::Value::String(string.clone()),
        toml::Value::Integer(integer) => serde_json::Value::from(*integer),
        toml::Value::Float(float) => serde_json::Number::from_f64(*float)
            .map(serde_json::Value::Number)
            .expect("the config refuses a float JSON has no number for"),
        toml::Value::Boolean(boolean) => serde_json::Value::Bool(*boolean),
        toml::Value::Datetime(datetime) => serde_json::Value::String(datetime.to_string()),
        toml::Value::Array(values) => values.iter().map(json).collect(),
        toml::Value::Table(table) => table
            .iter()
            .map(|(key, value)| (key.clone(), json(value)))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Escape`, `5` and `p` as evdev numbers them: on `dvp` the last two
    /// carry `parenleft` and `l`.
    const KEY_ESC: u32 = 1;
    const KEY_5: u32 = 6;
    const KEY_P: u32 = 25;

    fn resolved(text: &str) -> Resolved {
        resolve(&parsed(text)).expect("every keysym is on the keyboard")
    }

    fn parsed(text: &str) -> Config {
        Config::parse(text).expect("the fixtures are configs a desk could run")
    }

    fn shortcut(key: u32, shift: bool) -> Shortcut {
        Shortcut {
            key,
            alt: false,
            ctrl: false,
            shift,
            logo: true,
        }
    }

    #[test]
    fn a_desk_that_binds_nothing_still_has_a_default_mode() {
        // Always there, so a shell can read the table it starts in without
        // asking whether there is one.
        assert_eq!(
            resolved(""),
            Resolved {
                keybindings: [("default".to_string(), vec![])].into(),
                shells: [].into(),
            }
        );
    }

    #[test]
    fn every_chord_is_the_key_its_keysym_is_on_with_the_chord_s_modifiers() {
        let resolved = resolved(
            r#"
[input.keyboard]
xkb_variant = "dvp"

[keybindings]
"Meta+Shift+parenleft" = "send-shell move workspace 1"

[modes.resize]
"Meta+Escape" = "mode default"

[shells.manganese.modes.resize]
"Meta+l" = "send-shell resize grow right"
"#,
        );

        assert_eq!(
            resolved.keybindings,
            [
                (
                    "default".to_string(),
                    vec![KeyBinding {
                        shortcut: shortcut(KEY_5, true),
                        action: KeyAction::SendShell {
                            args: vec!["move".into(), "workspace".into(), "1".into()],
                        },
                    }],
                ),
                (
                    "resize".to_string(),
                    vec![KeyBinding {
                        shortcut: shortcut(KEY_ESC, false),
                        action: KeyAction::Mode {
                            name: "default".into(),
                        },
                    }],
                ),
            ]
            .into()
        );
        assert_eq!(
            resolved.shells["manganese"].keybindings,
            [
                // The shell's `default` too, though its table only named a
                // mode: the same promise as the desk's.
                ("default".to_string(), vec![]),
                (
                    "resize".to_string(),
                    vec![KeyBinding {
                        shortcut: shortcut(KEY_P, false),
                        action: KeyAction::SendShell {
                            args: vec!["resize".into(), "grow".into(), "right".into()],
                        },
                    }],
                ),
            ]
            .into()
        );
    }

    #[test]
    fn a_shell_s_options_go_out_as_the_json_it_wrote() {
        let resolved = resolved(
            r#"
[shells.manganese.options]
gaps = 8
ratio = 0.5
bar = { position = "top", shown = true }
workspaces = ["1", "2"]
since = 2026-10-01
"#,
        );

        assert_eq!(
            serde_json::Value::Object(resolved.shells["manganese"].options.clone()),
            serde_json::json!({
                "gaps": 8,
                "ratio": 0.5,
                "bar": { "position": "top", "shown": true },
                "workspaces": ["1", "2"],
                // JSON has no date, so a date is the text TOML wrote.
                "since": "2026-10-01",
            })
        );
    }

    #[test]
    fn a_keysym_the_keyboard_cannot_type_is_refused_naming_its_table() {
        let refused = resolve(&parsed(
            r#"
[shells.manganese.modes.resize]
"Meta+Greek_alpha" = "send-shell x"
"#,
        ))
        .expect_err("`us` has no alpha");

        assert_eq!(
            refused,
            Unbindable::Keysym {
                table: "[shells.manganese.modes.resize]".into(),
                why: UnknownKeysym::OnNoKey("Greek_alpha".into()),
            }
        );
    }

    #[test]
    fn a_keyboard_xkb_cannot_compile_resolves_nothing() {
        let refused = resolve(&parsed(
            r#"
[input.keyboard]
xkb_rules = "no-such-rules"
"#,
        ))
        .expect_err("there is no keymap to resolve against");

        assert!(matches!(refused, Unbindable::Layout(_)), "{refused:?}");
    }
}
