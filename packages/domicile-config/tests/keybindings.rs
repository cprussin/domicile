//! Behavior tests for a desk's keys — `[keybindings]`, `[modes.*]` and
//! `[shells.<name>]` — written before the implementation.
//!
//! The load-bearing requirement is that a table which could not do what it
//! says is refused here, by name, rather than shipped to a shell that would
//! do something else: a `mode` nothing declares, two spellings of one chord,
//! a `default` mode that would shadow `[keybindings]`.

use domicile_config::{Action, Binding, Chord, Config, ConfigError};

fn parsed(text: &str) -> Config {
    Config::parse(text).expect("the config should parse")
}

fn refusal(text: &str) -> String {
    Config::parse(text)
        .expect_err("the config should be refused")
        .to_string()
}

fn logo(keysym: &str) -> Chord {
    Chord {
        alt: false,
        ctrl: false,
        shift: false,
        logo: true,
        keysym: keysym.to_string(),
    }
}

fn send_shell(words: &[&str]) -> Action {
    Action::SendShell {
        args: words.iter().map(|word| word.to_string()).collect(),
    }
}

#[test]
fn a_desk_that_says_nothing_binds_nothing() {
    let config = parsed("");
    assert_eq!(config.keybindings.iter().count(), 0);
    assert!(config.modes.is_empty());
    assert!(config.shells.is_empty());
}

#[test]
fn every_table_is_read_into_bindings() {
    let config = parsed(
        r#"
[keybindings]
"Meta+Return" = "send-shell terminal"
"Meta+r" = "mode resize"

[modes.resize]
"Meta+Escape" = "mode default"

[shells.manganese.keybindings]
"Meta+l" = "send-shell focus right"

[shells.manganese.modes.resize]
"Meta+l" = "send-shell resize grow right"
"#,
    );

    assert_eq!(
        config.keybindings.iter().cloned().collect::<Vec<_>>(),
        [
            Binding {
                chord: logo("Return"),
                action: send_shell(&["terminal"]),
            },
            Binding {
                chord: logo("r"),
                action: Action::Mode {
                    name: "resize".into()
                },
            },
        ]
    );
    assert_eq!(
        config.modes["resize"].iter().cloned().collect::<Vec<_>>(),
        [Binding {
            chord: logo("Escape"),
            action: Action::Mode {
                name: "default".into()
            },
        }]
    );
    let manganese = &config.shells["manganese"];
    assert_eq!(
        manganese.keybindings.iter().cloned().collect::<Vec<_>>(),
        [Binding {
            chord: logo("l"),
            action: send_shell(&["focus", "right"]),
        }]
    );
    assert_eq!(
        manganese.modes["resize"]
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
        [Binding {
            chord: logo("l"),
            action: send_shell(&["resize", "grow", "right"]),
        }]
    );
}

#[test]
fn a_chord_or_an_action_that_is_not_one_is_refused_at_its_line() {
    for (text, named) in [
        ("[keybindings]\n\"Hyper+a\" = \"send-shell x\"\n", "Hyper"),
        ("[keybindings]\n\"Meta+a\" = \"frobnicate\"\n", "frobnicate"),
        (
            "[shells.manganese.modes.resize]\n\"Meta+a\" = \"mode\"\n",
            "exactly one mode name",
        ),
    ] {
        let err = Config::parse(text).expect_err(text);
        assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
        assert!(err.to_string().contains(named), "{text}: {err}");
    }
}

#[test]
fn two_spellings_of_one_chord_in_one_table_are_refused() {
    // toml sees two keys, so nothing but this can tell they are one chord —
    // and whichever won would leave the other a line that does nothing.
    let said = refusal(
        r#"
[keybindings]
"Meta+Shift+a" = "send-shell one"
"Shift+Super+a" = "send-shell two"
"#,
    );
    assert!(said.contains("Meta+Shift+a"), "{said}");
    assert!(said.contains("Shift+Super+a"), "{said}");
}

#[test]
fn one_chord_in_two_tables_is_two_bindings() {
    // A mode exists to give a chord a second meaning, and a shell's table to
    // give it a meaning of its own: neither is the same chord bound twice.
    parsed(
        r#"
[keybindings]
"Meta+l" = "send-shell focus right"

[modes.resize]
"Meta+l" = "send-shell resize grow right"

[shells.manganese.keybindings]
"Meta+l" = "send-shell focus left"
"#,
    );
}

#[test]
fn a_mode_named_default_is_refused_because_default_is_keybindings() {
    for text in [
        "[modes.default]\n\"Meta+a\" = \"send-shell x\"\n",
        "[shells.manganese.modes.default]\n\"Meta+a\" = \"send-shell x\"\n",
    ] {
        let err = Config::parse(text).expect_err(text);
        assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
        let said = err.to_string();
        assert!(said.contains("modes.default"), "{said}");
        assert!(said.contains("keybindings"), "{said}");
    }
}

#[test]
fn a_mode_nothing_declares_is_refused_naming_it_and_its_table() {
    for (text, table) in [
        (
            "[keybindings]\n\"Meta+r\" = \"mode resize\"\n",
            "[keybindings]",
        ),
        (
            "[modes.move]\n\"Meta+r\" = \"mode resize\"\n",
            "[modes.move]",
        ),
        (
            "[shells.manganese.keybindings]\n\"Meta+r\" = \"mode resize\"\n",
            "[shells.manganese.keybindings]",
        ),
    ] {
        let err = Config::parse(text).expect_err(text);
        assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
        let said = err.to_string();
        assert!(said.contains("resize"), "{said}");
        assert!(said.contains(table), "{said}");
    }
}

#[test]
fn default_is_always_a_mode_to_go_back_to() {
    parsed("[keybindings]\n\"Meta+Escape\" = \"mode default\"\n");
}

#[test]
fn a_shell_may_enter_its_own_modes_and_every_shells() {
    parsed(
        r#"
[modes.launch]
"Meta+Escape" = "mode default"

[shells.manganese.keybindings]
"Meta+r" = "mode resize"
"Meta+o" = "mode launch"

[shells.manganese.modes.resize]
"Meta+Escape" = "mode default"
"Meta+o" = "mode launch"
"#,
    );
}

#[test]
fn a_mode_one_shell_declares_is_not_every_shells() {
    // `[keybindings]` reaches every shell, and the one that did not declare
    // the mode would be handed a switch into nothing.
    let said = refusal(
        r#"
[keybindings]
"Meta+r" = "mode resize"

[shells.manganese.modes.resize]
"Meta+Escape" = "mode default"
"#,
    );
    assert!(said.contains("[keybindings]"), "{said}");

    // Nor another shell's.
    let said = refusal(
        r#"
[shells.simple.keybindings]
"Meta+r" = "mode resize"

[shells.manganese.modes.resize]
"Meta+Escape" = "mode default"
"#,
    );
    assert!(said.contains("[shells.simple.keybindings]"), "{said}");
}

#[test]
fn a_shells_options_are_whatever_it_wrote() {
    let config = parsed(
        r#"
[shells.manganese.options]
gaps = 8
bar = { position = "top" }
"#,
    );
    let options = &config.shells["manganese"].options;
    assert_eq!(options["gaps"].as_integer(), Some(8));
    assert_eq!(options["bar"]["position"].as_str(), Some("top"));
}

#[test]
fn a_shell_that_states_no_options_has_none() {
    let config = parsed("[shells.manganese.keybindings]\n\"Meta+a\" = \"send-shell x\"\n");
    assert!(config.shells["manganese"].options.is_empty());
}

#[test]
fn an_option_json_cannot_carry_is_refused() {
    // The options reach the shell as JSON, which has no spelling for these:
    // refused here rather than turned into something the shell never wrote.
    for text in [
        "[shells.manganese.options]\nratio = nan\n",
        "[shells.manganese.options]\nnested = { list = [1.0, inf] }\n",
    ] {
        let err = Config::parse(text).expect_err(text);
        assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
        assert!(
            err.to_string().contains("shells.manganese.options"),
            "{err}"
        );
    }
}

#[test]
fn a_key_a_shell_section_does_not_read_is_refused() {
    let err = Config::parse("[shells.manganese]\nkeybinding = {}\n").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}
