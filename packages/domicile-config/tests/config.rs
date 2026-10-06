//! Behavior tests for `domicile-config`.
//!
//! The key requirement is hot-reload safety: a bad config file keeps the last
//! good config active and reports the error.

use std::path::PathBuf;
use std::time::Duration;

use domicile_config::{Config, ConfigError, ConfigStore, DisplayConfig, LockVerifier, ThemeMode};

// ---- parsing & defaults ---------------------------------------------------

#[test]
fn a_desk_that_configured_no_keyboard_gets_nobodys_layout() {
    // A config with no keyboard gets plain `us`.
    let keyboard = Config::parse("{}").unwrap().input.keyboard;
    assert_eq!(keyboard.xkb_layout, "us");
    assert_eq!(keyboard.xkb_variant, "");
    assert!(
        keyboard.xkb_options.is_empty(),
        "{:?}",
        keyboard.xkb_options
    );
    // Empty rules and model use libxkbcommon's defaults.
    assert_eq!(keyboard.xkb_rules, "");
    assert_eq!(keyboard.xkb_model, "");
}

#[test]
fn a_desk_that_states_a_keyboard_gets_that_one() {
    // A layout other than `us` comes only from the config.
    let text = r#"
{
  "input": {
    "keyboard": { "xkb_variant": "dvp", "xkb_options": ["caps:escape"] }
  }
}
"#;
    let keyboard = Config::parse(text)
        .expect("valid config should parse")
        .input
        .keyboard;
    assert_eq!(keyboard.xkb_layout, "us");
    assert_eq!(keyboard.xkb_variant, "dvp");
    assert_eq!(keyboard.xkb_options, vec!["caps:escape".to_string()]);
}

// ---- keyboard / keymap ------------------------------------------------------

#[test]
fn parses_keyboard_settings() {
    let text = r#"
{
  "input": {
    "keyboard": {
      "xkb_rules": "evdev",
      "xkb_model": "pc105",
      "xkb_layout": "us,de",
      "xkb_variant": "dvp,",
      "xkb_options": ["caps:swapescape", "grp:alt_shift_toggle"]
    }
  }
}
"#;
    let keyboard = Config::parse(text)
        .expect("valid keyboard config should parse")
        .input
        .keyboard;
    assert_eq!(keyboard.xkb_rules, "evdev");
    assert_eq!(keyboard.xkb_model, "pc105");
    // Layout and variant are passed to xkb verbatim, so sway's comma-separated
    // multi-layout form works as-is.
    assert_eq!(keyboard.xkb_layout, "us,de");
    assert_eq!(keyboard.xkb_variant, "dvp,");
    assert_eq!(
        keyboard.xkb_options,
        vec![
            "caps:swapescape".to_string(),
            "grp:alt_shift_toggle".to_string()
        ]
    );
}

#[test]
fn joins_xkb_options_for_xkb() {
    let keyboard = Config::parse(
        r#"
{
  "input": { "keyboard": { "xkb_options": ["caps:swapescape", "compose:ralt"] } }
}
"#,
    )
    .unwrap()
    .input
    .keyboard;
    assert_eq!(
        keyboard.xkb_options_string(),
        "caps:swapescape,compose:ralt"
    );
}

#[test]
fn empty_xkb_options_disable_every_option() {
    // An empty list means "no options", not "use xkb's defaults".
    let keyboard = Config::parse(
        r#"
{ "input": { "keyboard": { "xkb_options": [] } } }
"#,
    )
    .unwrap()
    .input
    .keyboard;
    assert_eq!(keyboard.xkb_options_string(), "");
}

#[test]
fn rejects_empty_keyboard_layout() {
    let err = Config::parse(
        r#"
{ "input": { "keyboard": { "xkb_layout": "" } } }
"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_blank_keyboard_option() {
    // A stray comma would otherwise reach xkb as an empty option.
    let err = Config::parse(
        r#"
{ "input": { "keyboard": { "xkb_options": ["caps:swapescape", ""] } } }
"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

// ---- idle -----------------------------------------------------------------

#[test]
fn a_desk_that_asked_for_no_timeout_never_blanks() {
    // No idle key means the screens never blank: a blank screen with no
    // warning looks like a crash.
    assert_eq!(Config::parse("{}").unwrap().idle.blank_after(), None);
}

#[test]
fn a_desk_that_states_a_timeout_gets_it() {
    let idle = Config::parse(
        r#"
{ "idle": { "blank_after_seconds": 600 } }
"#,
    )
    .unwrap()
    .idle;
    assert_eq!(idle.blank_after(), Some(Duration::from_secs(600)));
}

#[test]
fn rejects_a_timeout_of_no_time_at_all() {
    // Zero could mean "blank immediately" or "never"; "never" is spelled by
    // leaving the key out. So zero is refused.
    let err = Config::parse(
        r#"
{ "idle": { "blank_after_seconds": 0 } }
"#,
    )
    .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("a zero timeout is refused rather than taken: {err:?}");
    };
    assert!(
        message.contains("idle.blank_after_seconds"),
        "the message should name the key: {message}"
    );
}

// ---- lock -----------------------------------------------------------------

#[test]
fn a_desk_that_states_no_verifier_cannot_lock() {
    // No lock key means the desk never locks: a locked desk with no verifier
    // could not be unlocked.
    assert_eq!(Config::parse("{}").unwrap().lock.verifier(), None);
}

#[test]
fn a_desk_that_states_a_passphrase_is_opened_by_it() {
    let lock = Config::parse(
        r#"
{ "lock": { "passphrase": "open sesame" } }
"#,
    )
    .unwrap()
    .lock;
    assert_eq!(
        lock.verifier(),
        Some(LockVerifier::Passphrase("open sesame"))
    );
}

#[test]
fn a_desk_that_names_a_pam_service_is_opened_by_pam() {
    let lock = Config::parse(
        r#"
{ "lock": { "pam_service": "domicile" } }
"#,
    )
    .unwrap()
    .lock;
    assert_eq!(
        lock.verifier(),
        Some(LockVerifier::Pam {
            service: "domicile"
        })
    );
}

#[test]
fn rejects_a_desk_that_states_both_verifiers() {
    // A config with both is refused, so a passphrase is never mistaken for a
    // PAM fallback.
    let err = Config::parse(
        r#"
{ "lock": { "passphrase": "open sesame", "pam_service": "domicile" } }
"#,
    )
    .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("two verifiers are refused rather than one of them picked: {err:?}");
    };
    assert!(
        message.contains("lock.passphrase") && message.contains("lock.pam_service"),
        "the message should name both keys: {message}"
    );
}

#[test]
fn rejects_a_pam_service_of_nothing_at_all() {
    let err = Config::parse(
        r#"
{ "lock": { "pam_service": "" } }
"#,
    )
    .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("an empty service is refused rather than taken: {err:?}");
    };
    assert!(
        message.contains("lock.pam_service"),
        "the message should name the key: {message}"
    );
}

#[test]
fn rejects_a_passphrase_of_nothing_at_all() {
    // An empty passphrase could mean "anyone can unlock" or "never lock";
    // "never" is spelled by leaving the key out. So it is refused.
    let err = Config::parse(
        r#"
{ "lock": { "passphrase": "" } }
"#,
    )
    .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("an empty passphrase is refused rather than taken: {err:?}");
    };
    assert!(
        message.contains("lock.passphrase"),
        "the message should name the key: {message}"
    );
}

#[test]
fn a_passphrase_is_not_in_what_a_log_line_would_print() {
    // The config holds the passphrase and sits inside the compositor's
    // `Restatement`, so its `Debug` must redact it before anything prints it.
    // `domicile_protocol::Passphrase` does the same on the wire.
    let secret = "correct horse battery staple";
    let config = Config::parse(&format!(
        r#"
{{ "lock": {{ "passphrase": "{secret}" }} }}
"#
    ))
    .unwrap();

    assert!(!format!("{:?}", config.lock).contains(secret));
    assert!(
        !format!("{config:?}").contains(secret),
        "the whole config is what a reload would print"
    );
    assert!(
        !format!("{:?}", config.lock.verifier()).contains(secret),
        "and neither is the verifier the compositor chooses from it"
    );
    // Redaction must not lose the value.
    assert_eq!(
        config.lock.verifier(),
        Some(LockVerifier::Passphrase(secret))
    );
}

// ---- theme ----------------------------------------------------------------

#[test]
fn a_desk_that_says_nothing_about_the_theme_is_dark() {
    // Dark is the default: there is no system preference above the chrome to
    // follow, and the chrome is designed for dark.
    assert_eq!(Config::parse("{}").unwrap().theme.mode, ThemeMode::Dark);
}

#[test]
fn a_desk_that_states_a_theme_gets_it() {
    let theme = Config::parse(
        r#"
{ "theme": { "mode": "light" } }
"#,
    )
    .unwrap()
    .theme;
    assert_eq!(theme.mode, ThemeMode::Light);
}

#[test]
fn rejects_a_theme_that_is_neither() {
    // Only `dark` and `light` exist. `system` is refused: Domicile is the
    // system, so there is nothing to follow.
    let err = Config::parse(
        r#"
{ "theme": { "mode": "system" } }
"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

// ---- applications ---------------------------------------------------------

#[test]
fn applications_are_a_shell_s_and_the_section_is_refused() {
    // A shell lists applications and bookmarks itself, through the system
    // calls; manganese takes them as its `applications` option.
    let err = Config::parse(r#"{ "applications": { "omit": ["*"] } }"#).unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "{err:?}");
}

// ---- startup --------------------------------------------------------------

#[test]
fn a_desk_that_says_nothing_about_startup_runs_nothing() {
    assert!(Config::parse("{}").unwrap().startup.commands.is_empty());
}

#[test]
fn a_startup_command_is_an_argv() {
    let commands = Config::parse(
        r#"
{ "startup": { "commands": [["emacsclient", "-e", "t"], ["mako"]] } }
"#,
    )
    .unwrap()
    .startup
    .commands;
    assert_eq!(commands, [vec!["emacsclient", "-e", "t"], vec!["mako"]]);
}

#[test]
fn an_empty_startup_command_is_refused() {
    // An empty command is a mistake in the file.
    let err = Config::parse(
        r#"
{ "startup": { "commands": [[]] } }
"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

// ---- files ----------------------------------------------------------------

#[test]
fn a_desk_that_says_nothing_about_files_omits_what_is_hidden_at_any_depth() {
    // By default hidden paths, such as `.git` directories, are omitted.
    let omit = Config::parse("{}").unwrap().files.omit;
    assert!(omit.omits(".config"));
    assert!(omit.omits("src/.git"));
    assert!(!omit.omits("src"));
    assert!(!omit.omits("src/main.rs"));
}

#[test]
fn a_desk_that_states_what_to_omit_replaces_the_default() {
    // A configured list replaces the default, so a desk can offer its
    // dotfiles.
    let omit = Config::parse(
        r#"
{ "files": { "omit": ["Library/*/*"] } }
"#,
    )
    .unwrap()
    .files
    .omit;
    assert!(omit.omits("Library/Mail/inbox"));
    assert!(!omit.omits("Library/Mail"));
    assert!(!omit.omits("Projects/.archive"));
}

#[test]
fn the_last_pattern_to_match_a_path_decides_it() {
    // Gitignore's rule: a later `!` takes back what an earlier pattern
    // omitted. `*` stops at `/`, so `*/*` is two levels deep and no more.
    let omit = Config::parse(
        r#"
{ "files": { "omit": ["*/*", "!Scratch/*"] } }
"#,
    )
    .unwrap()
    .files
    .omit;
    assert!(!omit.omits("src"));
    assert!(omit.omits("src/domicile"));
    assert!(!omit.omits("Scratch/notes"));
    assert!(!omit.omits("Scratch/notes/today.org"));
}

#[test]
fn rejects_a_pattern_that_is_not_a_glob() {
    // Refused at load, where the file can be named. Otherwise the index would
    // be built silently without the rule.
    let err = Config::parse(
        r#"
{ "files": { "omit": ["Library/[unclosed"] } }
"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

// ---- extensions -----------------------------------------------------------

#[test]
fn a_desk_that_says_nothing_about_extensions_names_none() {
    let extensions = Config::parse("{}").unwrap().extensions;
    assert!(extensions.web_store.is_empty());
    assert!(extensions.unpacked.is_empty());
}

#[test]
fn a_desk_that_names_extensions_gets_them() {
    let extensions = Config::parse(
        r#"
{
  "extensions": {
    "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"],
    "unpacked": ["/home/you/src/my-extension"]
  }
}
"#,
    )
    .unwrap()
    .extensions;
    assert_eq!(extensions.web_store, ["ddkjiahejlhfcafbddmgiahcphecmpfh"]);
    assert_eq!(
        extensions.unpacked,
        [PathBuf::from("/home/you/src/my-extension")]
    );
}

#[test]
fn rejects_a_web_store_id_that_is_not_one() {
    // A Store id is 32 letters from `a` to `p`. Refusing others here avoids a
    // failure later in the engine's log.
    for id in [
        "ddkjiahejlhfcafbddmgiahcphecmpf",  // one short
        "ddkjiahejlhfcafbddmgiahcphecmpfz", // a letter past `p`
        "DDKJIAHEJLHFCAFBDDMGIAHCPHECMPFH", // shouted
    ] {
        let err = Config::parse(&format!(
            r#"{{ "extensions": {{ "web_store": [{id:?}] }} }}"#
        ))
        .unwrap_err();
        let ConfigError::Validation(message) = &err else {
            panic!("{id}: got {err:?}");
        };
        assert!(message.contains(id), "{id}: {message}");
    }
}

#[test]
fn rejects_an_unpacked_extension_that_is_not_an_absolute_path() {
    // A relative path has no defined base, so it is refused at load. `~` is
    // tested in the crate's unit tests, which can set the home directory.
    let err =
        Config::parse(r#"{ "extensions": { "unpacked": ["src/my-extension"] } }"#).unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("got {err:?}");
    };
    assert!(message.contains("src/my-extension"), "{message}");
}

#[test]
fn rejects_an_unpacked_extension_in_another_users_home() {
    // `~alice` would need a lookup of another user's home, so it is refused
    // as such rather than as a relative path.
    let err = Config::parse(r#"{ "extensions": { "unpacked": ["~alice/src/my-extension"] } }"#)
        .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("got {err:?}");
    };
    assert!(message.contains("~alice/src/my-extension"), "{message}");
    assert!(message.contains("another user's home"), "{message}");
}

#[test]
fn rejects_invalid_syntax() {
    let err = Config::parse("{ this is not json").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

/// An unknown key is refused rather than ignored.
///
/// A shell generates this file, so an unknown key is a bug in that program.
#[test]
fn rejects_a_key_nothing_reads() {
    // A misspelled key in an existing section.
    let err = Config::parse(
        r#"
{ "output": { "max_scaale": 2 } }
"#,
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
    assert!(
        format!("{err}").contains("max_scaale"),
        "the message should name the key: {err}"
    );

    // A misspelled section at the top level.
    let err = Config::parse(r#"{ "outputs": {} }"#).unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");

    // Every section with `deny_unknown_fields`, not just `Config`, so a
    // misspelled `xkb_optoins` is caught too.
    for section in [
        r#"
{ "idle": { "blank_after_secons": 600 } }
"#,
        r#"
{ "input": { "keyboard": { "xkb_optoins": [] } } }
"#,
        r#"{ "input": { "keyboardd": {} } }"#,
        r#"
{
  "output": { "displays": [{ "name": "a", "size": [1, 1], "scaale": 2 }] }
}
"#,
    ] {
        let err = Config::parse(section).unwrap_err();
        assert!(
            matches!(err, ConfigError::Parse(_)),
            "{section} should be refused, got {err:?}"
        );
    }
}

#[test]
fn the_startup_placeholder_is_not_a_setting() {
    // The startup desktop size is a compositor constant: DRM or the chrome's
    // `SetDesktopSize` replaces it right away. A `compositor` section is
    // refused.
    for stated in [
        r#"
{ "compositor": { "nested_size": [800, 600] } }
"#,
        r#"{ "compositor": {} }"#,
    ] {
        let err = Config::parse(stated).unwrap_err();
        assert!(
            matches!(err, ConfigError::Parse(_)),
            "{stated} should be refused, got {err:?}"
        );
    }
}

// ---- hot-reload semantics ---------------------------------------------------

#[test]
fn store_reload_valid_swaps_current_and_clears_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str(
            r#"
{ "output": { "max_scale": 3 } }
"#,
        )
        .unwrap();
    assert_eq!(store.current().output.max_scale, 3);
    assert!(store.last_error().is_none());
}

#[test]
fn store_reload_invalid_keeps_last_good_and_records_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str(
            r#"
{ "output": { "max_scale": 3 } }
"#,
        )
        .unwrap();

    // A later bad edit must not change the live config.
    let err = store
        .reload_from_str(r#"{ "output": { "max_scale": } }"#)
        .unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)));
    assert_eq!(
        store.current().output.max_scale,
        3,
        "last-good config must remain active after a bad edit"
    );
    assert!(store.last_error().is_some());
}

#[test]
fn store_recovers_after_fixing_a_bad_edit() {
    let mut store = ConfigStore::new(Config::default());
    let _ = store.reload_from_str(r#"{ "output": "#);
    assert!(store.last_error().is_some());

    store
        .reload_from_str(
            r#"
{ "output": { "max_scale": 4 } }
"#,
        )
        .unwrap();
    assert_eq!(store.current().output.max_scale, 4);
    assert!(
        store.last_error().is_none(),
        "error must clear once config is valid again"
    );
}

// ---- filesystem loading ----------------------------------------------------

#[test]
fn loads_from_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.json");
    std::fs::write(
        &path,
        r#"
{ "output": { "max_scale": 3 } }
"#,
    )
    .unwrap();

    let cfg = Config::load(&path).unwrap();
    assert_eq!(cfg.output.max_scale, 3);
}

#[test]
fn missing_file_is_an_io_error() {
    let err = Config::load("/no/such/domicile.json").unwrap_err();
    assert!(matches!(err, ConfigError::Io { .. }), "got {err:?}");
}

/// An error loading a file names the file.
///
/// A machine can have several configs, so the error must say which one.
/// `Config::parse` has no path; `load` adds it.
#[test]
fn a_file_that_will_not_load_says_which_file() {
    let dir = tempfile::tempdir().unwrap();

    let unparseable = dir.path().join("syntax.json");
    std::fs::write(&unparseable, r#"{ "compositor": {} }"#).unwrap();
    let err = Config::load(&unparseable).unwrap_err();
    let said = format!("{err}");
    assert!(
        said.contains(&unparseable.display().to_string()),
        "the complaint should name the file: {said}"
    );
    assert!(
        said.contains("`compositor`"),
        "and keep what the parser said about it: {said}"
    );

    // A config that parses but fails validation also names the file.
    let invalid = dir.path().join("validation.json");
    std::fs::write(&invalid, r#"{ "output": { "max_scale": 0 } }"#).unwrap();
    let err = Config::load(&invalid).unwrap_err();
    let said = format!("{err}");
    assert!(
        said.contains(&invalid.display().to_string()),
        "a config that will not validate names it too: {said}"
    );
    assert!(
        said.contains("max_scale"),
        "and keeps what was wrong with it: {said}"
    );
}

#[test]
fn store_reload_from_path_keeps_last_good_on_bad_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.json");
    std::fs::write(
        &path,
        r#"
{ "output": { "max_scale": 3 } }
"#,
    )
    .unwrap();

    let mut store = ConfigStore::new(Config::load(&path).unwrap());
    assert_eq!(store.current().output.max_scale, 3);

    // Simulate a user saving a broken file.
    std::fs::write(&path, r#"{ "output": { "max_scale": "#).unwrap();
    assert!(store.reload_from_path(&path).is_err());
    assert_eq!(store.current().output.max_scale, 3);
}

// ---- output ---------------------------------------------------------------

#[test]
fn output_scaling_is_on_by_default_up_to_a_retina_display() {
    // The default covers a common 2x display; higher scales cost more than
    // they are worth.
    assert_eq!(Config::parse("{}").unwrap().output.max_scale, 2);
}

#[test]
fn max_scale_one_turns_hidpi_off() {
    // A client at scale N renders N² times the pixels, so a user can trade
    // sharpness for speed without a rebuild.
    assert_eq!(
        Config::parse(
            r#"
{ "output": { "max_scale": 1 } }
"#
        )
        .unwrap()
        .output
        .max_scale,
        1
    );
}

#[test]
fn max_scale_must_leave_a_usable_scale() {
    let err = Config::parse(
        r#"
{ "output": { "max_scale": 0 } }
"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("output.max_scale"),
        "the message should name the setting: {err}"
    );
}

// ---- statically described displays -----------------------------------------

#[test]
fn no_displays_configured_means_the_output_follows_domiciles_window() {
    // With no displays configured, one output is sized to Domicile's window.
    assert_eq!(Config::parse("{}").unwrap().output.displays, vec![]);
}

#[test]
fn parses_a_side_by_side_desktop() {
    let text = r#"
{
  "output": {
    "displays": [
      { "name": "left", "position": [0, 0], "size": [1920, 1080] },
      {
        "name": "right",
        "position": [1920, 0],
        "size": [2560, 1440],
        "scale": 2
      }
    ]
  }
}
"#;
    let displays = Config::parse(text)
        .expect("a described desktop should parse")
        .output
        .displays;
    assert_eq!(
        displays,
        vec![
            DisplayConfig {
                name: "left".into(),
                position: (0, 0),
                scale: 1,
                size: (1920, 1080),
            },
            DisplayConfig {
                name: "right".into(),
                position: (1920, 0),
                scale: 2,
                size: (2560, 1440),
            },
        ]
    );
}

#[test]
fn a_display_sits_at_the_origin_unless_placed() {
    // With one display there is nothing for a position to be relative to.
    let displays = Config::parse(
        r#"
{ "output": { "displays": [{ "name": "only", "size": [800, 600] }] } }
"#,
    )
    .unwrap()
    .output
    .displays;
    assert_eq!(displays[0].position, (0, 0));
}

#[test]
fn a_display_needs_a_name_the_shell_can_tell_apart() {
    // The chrome addresses a display by name, so names must be unique.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "hdmi", "size": [800, 600] },
      { "name": "hdmi", "position": [800, 0], "size": [800, 600] }
    ]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a duplicate name should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("hdmi"),
        "the message should name the collision: {err}"
    );
}

#[test]
fn a_display_name_may_not_be_padded() {
    // Names are matched exactly, so a padded name would look like a missing
    // display. One entry, so a trim-and-deduplicate would not pass this test.
    let err = Config::parse(
        r#"
{ "output": { "displays": [{ "name": "left ", "size": [800, 600] }] } }
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a padded name should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("padded"),
        "the message should say what is wrong with the name: {err}"
    );
}

#[test]
fn a_display_named_nothing_is_rejected() {
    // A display with no name is reported by its index.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "real", "size": [800, 600] },
      { "name": "", "position": [800, 0], "size": [800, 600] }
    ]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a blank name should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("output.displays[1]"),
        "the message should say which entry: {err}"
    );
}

#[test]
fn a_display_with_no_pixels_is_rejected() {
    // Either axis: zero width or zero height.
    for size in ["[1920, 0]", "[0, 1080]"] {
        let err = Config::parse(&format!(
            r#"
{{ "output": {{ "displays": [{{ "name": "dead", "size": {size} }}] }} }}
"#
        ))
        .unwrap_err();
        assert!(
            matches!(err, ConfigError::Validation(_)),
            "size {size} should fail validation, not parsing: {err:?}"
        );
        assert!(
            format!("{err}").contains("dead"),
            "the message should name the display: {err}"
        );
    }
}

#[test]
fn a_display_must_have_a_usable_scale() {
    let err = Config::parse(
        r#"
{
  "output": { "displays": [{ "name": "tiny", "size": [800, 600], "scale": 0 }] }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "a zero scale should fail validation, not parsing: {err:?}"
    );
    assert!(
        format!("{err}").contains("scale"),
        "the message should name the setting: {err}"
    );
}

#[test]
fn a_display_may_not_run_off_the_edge_of_the_desktop() {
    // The far corner must fit `i32` too: the desktop's bounding box is
    // computed from it, so it is rejected here rather than wrapping later.
    for position in ["[2147483000, 0]", "[0, 2147483000]"] {
        let err = Config::parse(&format!(
            r#"
{{
  "output": {{
    "displays": [{{ "name": "far", "position": {position}, "size": [1920, 1080] }}]
  }}
}}
"#
        ))
        .unwrap_err();
        assert!(
            matches!(err, ConfigError::Validation(_)),
            "position {position} should fail validation, not parsing: {err:?}"
        );
        assert!(
            format!("{err}").contains("far"),
            "the message should name the display: {err}"
        );
    }
}

#[test]
fn displays_may_not_cover_the_same_ground() {
    // Overlapping displays leave no answer for which one owns a point.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1900, 0], "size": [1920, 1080] }
    ]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an overlap should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("left") && message.contains("right"),
        "the message should name both displays: {err}"
    );
}

#[test]
fn displays_that_only_touch_are_a_desktop_rather_than_a_collision() {
    // Side by side and stacked: displays that share an edge are adjacent,
    // not overlapping. Each layout overlaps fully on its other axis, so a
    // check that drops an axis or uses closed intervals fails here.
    Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [1920, 1080] }
    ]
  }
}
"#,
    )
    .expect("side-by-side displays should parse");
    Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "top", "size": [1920, 1080] },
      { "name": "bottom", "position": [0, 1080], "size": [1920, 1080] }
    ]
  }
}
"#,
    )
    .expect("stacked displays should parse");
}

#[test]
fn a_desktop_may_reach_exactly_as_far_as_a_position_can_and_no_further() {
    // The boundary: a far corner at `i32::MAX` normalizes to a valid position.
    //
    // Each axis is sized so that reading the other axis's length would
    // exceed the limit, which tells the two axis checks apart.
    Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "here", "size": [1920, 1080] },
      {
        "name": "far",
        "position": [2147479647, 2000],
        "size": [4000, 8000]
      }
    ]
  }
}
"#,
    )
    .expect("a desktop exactly as wide as a position can describe should parse");
    // One pixel past the limit, so the display's length must count toward
    // its reach. The near display sits at -1 so the far display's own corner
    // still fits and the per-display check does not reject it first.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "here", "position": [-1, 0], "size": [10, 10] },
      {
        "name": "far",
        "position": [2147479647, 2000],
        "size": [4000, 8000]
      }
    ]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("from here to far"),
        "the layout check should be the one that answers, not the per-display one: {err}"
    );
    Config::parse(
        r#"
{
  "output": {
    "displays": [
      { "name": "here", "size": [1920, 1080] },
      {
        "name": "below",
        "position": [3000, 2147482567],
        "size": [1920, 1080]
      }
    ]
  }
}
"#,
    )
    .expect("a desktop exactly as tall as a position can describe should parse");
}

#[test]
fn the_desktop_must_fit_the_coordinate_space_on_both_axes() {
    // Stacked, to check that the vertical case reads the right fields.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "north",
        "position": [0, -2000000000],
        "size": [1920, 1080]
      },
      {
        "name": "south",
        "position": [0, 2000000000],
        "size": [1920, 1080]
      }
    ]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable desktop should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("from north to south") && message.contains("down"),
        "the message should name the outliers near-to-far, and the axis: {err}"
    );
}

#[test]
fn a_display_too_big_on_its_own_is_reported_as_itself() {
    // A single display whose far corner overflows gets a per-display error,
    // not the layout-wide "span N across" one.
    //
    // A billion at scale 1 is a valid mode, so the earlier mode check does
    // not reject it first.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "huge",
        "position": [2000000000, 0],
        "size": [1000000000, 1080]
      }
    ]
  }
}
"#,
    )
    .unwrap_err();
    let message = format!("{err}");
    assert!(
        message.contains("output.displays[0]") && message.contains("far corner"),
        "the message should name the display and its own far corner: {err}"
    );

    // With two displays, both checks fail, so their order decides the
    // message. The per-display check runs first because it names `far`, the
    // display at fault.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "west",
        "position": [-2000000000, 0],
        "size": [1920, 1080]
      },
      {
        "name": "far",
        "position": [2147483000, 0],
        "size": [1920, 1080]
      }
    ]
  }
}
"#,
    )
    .unwrap_err();
    let message = format!("{err}");
    assert!(
        message.contains("far corner") && message.contains("far's"),
        "the display at fault should be named, not the pair: {err}"
    );
}

#[test]
fn the_desktop_as_a_whole_must_fit_the_coordinate_space() {
    // Each display fitting is not enough: two can be four billion apart, and
    // the normalized desktop spans that distance.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "west",
        "position": [-2000000000, 0],
        "size": [1920, 1080]
      },
      {
        "name": "east",
        "position": [2000000000, 0],
        "size": [1920, 1080]
      }
    ]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable desktop should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("from west to east") && message.contains("across"),
        "the message should name the outliers near-to-far, and the axis: {err}"
    );
}

#[test]
fn a_displays_mode_must_fit_the_coordinate_space() {
    // The `wl_output` mode is size times scale, which can overflow even when
    // each fits. Rejected here because the Smithay backend computes the mode
    // where no test can reach it.
    //
    // Scale is at least 1, so this also bounds the logical size.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [{ "name": "dense", "size": [1920, 1080], "scale": 2000000 }]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        matches!(err, ConfigError::Validation(_)),
        "an unrepresentable mode should fail validation, not parsing: {err:?}"
    );
    let message = format!("{err}");
    assert!(
        message.contains("output.displays[0]") && message.contains("dense"),
        "the message should name the display: {err}"
    );
    // A single display that does not fit gets a per-display error. The
    // layout-wide message compares two displays.
    assert!(
        !message.contains("dense and dense"),
        "one display cannot be a distance from itself: {err}"
    );

    // The boundary: `>` is correct and `>=` would reject a legal desktop.
    // `i32::MAX` is prime, so only scale 1 reaches it exactly.
    Config::parse(
        r#"
{
  "output": { "displays": [{ "name": "exact", "size": [2147483647, 1080] }] }
}
"#,
    )
    .expect("a mode exactly as wide as a coordinate should parse");
    Config::parse(
        r#"
{
  "output": { "displays": [{ "name": "over", "size": [2147483648, 1080] }] }
}
"#,
    )
    .expect_err("one pixel more than a coordinate should not");

    // Each axis alone, with the other well inside the bound, so each check is
    // tested separately.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [{ "name": "wide", "size": [2147483647, 1], "scale": 2 }]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("wide"),
        "the width half is checked with a height that fits: {err}"
    );
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [{ "name": "tall", "size": [1, 2147483647], "scale": 2 }]
  }
}
"#,
    )
    .unwrap_err();
    assert!(
        format!("{err}").contains("tall"),
        "the height half is checked with a width that fits: {err}"
    );

    // The largest inputs the types allow. A check in `i64` would panic on
    // them in debug.
    //
    // Assert on the message: this display's far corner also overflows, so a
    // wrapping mode check would still be rejected by the corner check.
    let err = Config::parse(
        r#"
{
  "output": {
    "displays": [
      {
        "name": "huge",
        "size": [4294967295, 4294967295],
        "scale": 4294967295
      }
    ]
  }
}
"#,
    )
    .unwrap_err();
    let ConfigError::Validation(message) = &err else {
        panic!("the biggest mode the types allow is rejected, not a panic or a wrap: {err:?}");
    };
    assert!(
        message.contains("a mode of"),
        "rejected for its mode rather than for its far corner: {message}"
    );
}

// ---- shell ------------------------------------------------------------------

#[test]
fn a_config_may_name_the_shell_domicile_runs() {
    // `domicile` reads it when given no shell; the compositor ignores it.
    let config = Config::parse(r#"{ "shell": "@domicile-desktop/manganese" }"#).unwrap();
    assert_eq!(config.shell.as_deref(), Some("@domicile-desktop/manganese"));
}

#[test]
fn keys_are_a_shell_s_now_and_the_tables_are_refused() {
    // A shell binds its own keys. The `keybindings`, `modes` and `shells`
    // tables are refused.
    for table in [
        r#"{ "keybindings": {} }"#,
        r#"{ "modes": { "resize": {} } }"#,
        r#"{ "shells": { "manganese": {} } }"#,
    ] {
        let err = Config::parse(table).unwrap_err();
        assert!(matches!(err, ConfigError::Parse(_)), "{table}: {err:?}");
    }
}
