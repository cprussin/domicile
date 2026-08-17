//! Behaviour tests for `domicile-config`, written before the implementation.
//!
//! The load-bearing requirement is hot-reload safety: a bad edit to the config
//! file on disk must NEVER take down the compositor — the last known-good
//! config stays active and the error is surfaced.

use domicile_config::{Config, ConfigError, ConfigStore, ShellRef};
use std::path::{Path, PathBuf};

// ---- parsing & defaults ---------------------------------------------------

#[test]
fn empty_config_uses_defaults() {
    let cfg = Config::parse("").expect("empty config should parse to defaults");
    assert_eq!(cfg.shell.package, ShellRef::Name("simple".into()));
    assert_eq!(cfg.compositor.nested_size, (1280, 800));
}

#[test]
fn default_keymap_is_programmers_dvorak_with_caps_swapped() {
    let keyboard = Config::parse("").unwrap().input.keyboard;
    assert_eq!(keyboard.xkb_layout, "us");
    assert_eq!(keyboard.xkb_variant, "dvp");
    assert_eq!(keyboard.xkb_options, vec!["caps:swapescape".to_string()]);
    // Empty rules/model mean "whatever libxkbcommon defaults to".
    assert_eq!(keyboard.xkb_rules, "");
    assert_eq!(keyboard.xkb_model, "");
}

#[test]
fn default_matches_parsed_empty() {
    assert_eq!(
        Config::default().shell.package,
        Config::parse("").unwrap().shell.package
    );
}

#[test]
fn parses_a_full_config() {
    let text = r##"
        [shell]
        package = "./apps/shell"

        [shell.settings]
        accent = "#ff0088"
        show_clock = true

        [compositor]
        nested_size = [1920, 1080]
    "##;
    let cfg = Config::parse(text).expect("valid config should parse");
    assert_eq!(
        cfg.shell.package,
        ShellRef::Path(PathBuf::from("./apps/shell"))
    );
    assert_eq!(cfg.compositor.nested_size, (1920, 1080));
    // Shell settings are opaque and passed through to the chrome package.
    assert_eq!(
        cfg.shell.settings.get("accent").and_then(|v| v.as_str()),
        Some("#ff0088")
    );
    assert_eq!(
        cfg.shell
            .settings
            .get("show_clock")
            .and_then(|v| v.as_bool()),
        Some(true)
    );
}

// ---- keyboard / keymap ------------------------------------------------------

#[test]
fn parses_keyboard_settings() {
    let text = r##"
        [input.keyboard]
        xkb_rules = "evdev"
        xkb_model = "pc105"
        xkb_layout = "us,de"
        xkb_variant = "dvp,"
        xkb_options = ["caps:swapescape", "grp:alt_shift_toggle"]
    "##;
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
    let keyboard =
        Config::parse("[input.keyboard]\nxkb_options = [\"caps:swapescape\", \"compose:ralt\"]\n")
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
    // An explicitly empty list means "no options", not "use xkb's defaults".
    let keyboard = Config::parse("[input.keyboard]\nxkb_options = []\n")
        .unwrap()
        .input
        .keyboard;
    assert_eq!(keyboard.xkb_options_string(), "");
}

#[test]
fn rejects_empty_keyboard_layout() {
    let err = Config::parse("[input.keyboard]\nxkb_layout = \"\"\n").unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_blank_keyboard_option() {
    // A stray comma in a hand-edited list would otherwise reach xkb as junk.
    let err =
        Config::parse("[input.keyboard]\nxkb_options = [\"caps:swapescape\", \"\"]\n").unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

#[test]
fn rejects_invalid_syntax() {
    let err = Config::parse("this is = = not toml").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

#[test]
fn rejects_unknown_top_level_shell_key() {
    // Typos in known sections should surface, not be silently ignored.
    let err = Config::parse("[shell]\npackag = \"simple\"\n").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "got {err:?}");
}

#[test]
fn rejects_zero_nested_size() {
    let err = Config::parse("[compositor]\nnested_size = [0, 600]\n").unwrap_err();
    assert!(matches!(err, ConfigError::Validation(_)), "got {err:?}");
}

// ---- chrome-package reference resolution -----------------------------------

#[test]
fn shellref_parses_bare_name() {
    assert_eq!(
        "simple".parse::<ShellRef>().unwrap(),
        ShellRef::Name("simple".into())
    );
}

#[test]
fn shellref_parses_paths() {
    for s in ["./x", "../x", "/opt/x", "a/b"] {
        let parsed = s.parse::<ShellRef>().unwrap();
        assert!(
            matches!(parsed, ShellRef::Path(_)),
            "{s} should parse as a Path, got {parsed:?}"
        );
    }
}

#[test]
fn shellref_rejects_empty() {
    assert!("".parse::<ShellRef>().is_err());
    assert!("   ".parse::<ShellRef>().is_err());
}

#[test]
fn shellref_resolves_name_under_shells_dir() {
    let name = ShellRef::Name("simple".into());
    assert_eq!(
        name.resolve(Path::new("/etc/domicile/shells")),
        PathBuf::from("/etc/domicile/shells/simple")
    );
}

#[test]
fn shellref_resolves_absolute_path_unchanged() {
    let p = ShellRef::Path(PathBuf::from("/opt/mychrome"));
    assert_eq!(
        p.resolve(Path::new("/etc/domicile/shells")),
        PathBuf::from("/opt/mychrome")
    );
}

// ---- hot-reload semantics (the important part) ----------------------------

#[test]
fn store_reload_valid_swaps_current_and_clears_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str("[compositor]\nnested_size = [800, 600]\n")
        .unwrap();
    assert_eq!(store.current().compositor.nested_size, (800, 600));
    assert!(store.last_error().is_none());
}

#[test]
fn store_reload_invalid_keeps_last_good_and_records_error() {
    let mut store = ConfigStore::new(Config::default());
    store
        .reload_from_str("[compositor]\nnested_size = [800, 600]\n")
        .unwrap();

    // A subsequent bad edit must NOT change the live config.
    let err = store.reload_from_str("nested_size = = broken").unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)));
    assert_eq!(
        store.current().compositor.nested_size,
        (800, 600),
        "last-good config must remain active after a bad edit"
    );
    assert!(store.last_error().is_some());
}

#[test]
fn store_recovers_after_fixing_a_bad_edit() {
    let mut store = ConfigStore::new(Config::default());
    let _ = store.reload_from_str("broken = = =");
    assert!(store.last_error().is_some());

    store
        .reload_from_str("[compositor]\nnested_size = [640, 480]\n")
        .unwrap();
    assert_eq!(store.current().compositor.nested_size, (640, 480));
    assert!(
        store.last_error().is_none(),
        "error must clear once config is valid again"
    );
}

// ---- filesystem loading ----------------------------------------------------

#[test]
fn loads_from_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.toml");
    std::fs::write(&path, "[compositor]\nnested_size = [1024, 768]\n").unwrap();

    let cfg = Config::load(&path).unwrap();
    assert_eq!(cfg.compositor.nested_size, (1024, 768));
}

#[test]
fn missing_file_is_an_io_error() {
    let err = Config::load("/no/such/domicile.toml").unwrap_err();
    assert!(matches!(err, ConfigError::Io { .. }), "got {err:?}");
}

#[test]
fn store_reload_from_path_keeps_last_good_on_bad_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("domicile.toml");
    std::fs::write(&path, "[compositor]\nnested_size = [1024, 768]\n").unwrap();

    let mut store = ConfigStore::new(Config::load(&path).unwrap());
    assert_eq!(store.current().compositor.nested_size, (1024, 768));

    // Simulate a user saving a broken file.
    std::fs::write(&path, "nested_size = = nope").unwrap();
    assert!(store.reload_from_path(&path).is_err());
    assert_eq!(store.current().compositor.nested_size, (1024, 768));
}
