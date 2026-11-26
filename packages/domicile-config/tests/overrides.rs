//! Temporary changes laid over the config: the Settings app's and a shell's
//! changes to a config the desktop cannot write, kept until the desktop stops.

use domicile_config::{ConfigError, ConfigKey, ConfigOverride, ConfigStore, ThemeMode, Written};
use serde_json::{json, Value};

fn store(text: &str) -> ConfigStore {
    ConfigStore::new(Written::parse(text).unwrap())
}

fn path(keys: &[&str]) -> Vec<ConfigKey> {
    keys.iter()
        .map(|key| ConfigKey::Name(key.to_string()))
        .collect()
}

const ONE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TWO: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/// A config's `browser` with the two profiles every config needs, and `more`.
fn browser(more: &str) -> String {
    format!(
        r##"{{ "browser": {{ "profiles": {{
            "default": {{ "name": "Default", "color": "#000000" }},
            "private": {{ "name": "Private", "color": "#ffffff", "private": true }}
            {more}
        }} }} }}"##
    )
}

fn mode() -> Vec<ConfigKey> {
    path(&["theme", "mode"])
}

#[test]
fn an_override_changes_the_live_config_and_is_listed() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), json!("dark")).unwrap();
    assert_eq!(store.current().theme.mode, ThemeMode::Dark);
    assert_eq!(
        store.overrides(),
        vec![ConfigOverride {
            path: mode(),
            value: json!("dark")
        }]
    );
}

#[test]
fn an_override_reaches_into_sections_and_lists_the_config_leaves_out() {
    let mut store = store(&browser(""));
    let first_extension = [
        path(&["browser", "profiles", "work", "extensions"]),
        vec![ConfigKey::Index(0)],
    ]
    .concat();
    store
        .set_override(
            path(&["browser", "profiles", "work"]),
            json!({ "name": "Work", "color": "#ff0000", "extensions": [ONE] }),
        )
        .unwrap();
    store.set_override(first_extension, json!(TWO)).unwrap();
    assert_eq!(
        store.current().browser.profiles["work"].extensions,
        Some(vec![TWO.to_string()])
    );
}

#[test]
fn an_override_adds_to_a_list_but_does_not_pad_it() {
    let mut store = store(&browser(
        r##", "work": { "name": "Work", "color": "#ff0000", "extensions": [] }"##,
    ));
    let extension = |index| {
        [
            path(&["browser", "profiles", "work", "extensions"]),
            vec![ConfigKey::Index(index)],
        ]
        .concat()
    };
    store.set_override(extension(0), json!(ONE)).unwrap();
    for index in [2, usize::MAX] {
        let err = store
            .set_override(extension(index), json!(TWO))
            .unwrap_err();
        assert!(matches!(err, ConfigError::Validation(_)), "{err:?}");
    }
    assert_eq!(
        store.current().browser.profiles["work"].extensions,
        Some(vec![ONE.to_string()])
    );
    assert_eq!(store.overrides().len(), 1);
}

#[test]
fn a_reload_that_shortens_a_list_ends_only_the_change_past_its_end() {
    let two = |extensions: &str| {
        browser(&format!(
            r##", "work": {{ "name": "Work", "color": "#ff0000", "extensions": {extensions} }}"##
        ))
    };
    let mut store = store(&two(&format!(r#"["{ONE}"]"#)));
    let added = [
        path(&["browser", "profiles", "work", "extensions"]),
        vec![ConfigKey::Index(1)],
    ]
    .concat();
    store.set_override(added, json!(TWO)).unwrap();
    store.set_override(mode(), json!("light")).unwrap();
    store.reload_from_str(&two("[]")).unwrap();
    assert_eq!(store.overrides().len(), 1, "{:?}", store.overrides());
    assert_eq!(store.current().theme.mode, ThemeMode::Light);
}

#[test]
fn null_takes_the_setting_back_to_its_default() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), Value::Null).unwrap();
    assert_eq!(store.current().theme.mode, ThemeMode::Dark);
    assert_eq!(store.overrides().len(), 1);
}

#[test]
fn an_override_the_config_would_refuse_changes_nothing() {
    let mut store = store(r#"{ "output": { "max_scale": 2 } }"#);
    let err = store
        .set_override(path(&["output", "max_scale"]), json!("big"))
        .unwrap_err();
    assert!(matches!(err, ConfigError::Parse(_)), "{err:?}");
    assert_eq!(store.current().output.max_scale, 2);
    assert!(store.overrides().is_empty());
}

#[test]
fn setting_the_configs_own_value_leaves_no_override() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), json!("dark")).unwrap();
    store.set_override(mode(), json!("light")).unwrap();
    assert!(store.overrides().is_empty());
    assert_eq!(store.current().theme.mode, ThemeMode::Light);
}

#[test]
fn a_change_under_a_changed_section_back_to_the_files_value_stays() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store
        .set_override(path(&["theme"]), json!({ "mode": "dark" }))
        .unwrap();
    store.set_override(mode(), json!("light")).unwrap();
    assert_eq!(store.current().theme.mode, ThemeMode::Light);
    assert_eq!(store.overrides().len(), 2);
}

#[test]
fn resetting_drops_the_overrides_under_each_path() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), json!("dark")).unwrap();
    store
        .set_override(path(&["theme", "reduced_motion"]), json!(true))
        .unwrap();
    store
        .set_override(path(&["output", "max_scale"]), json!(3))
        .unwrap();
    store.reset_overrides(&[path(&["theme"])]).unwrap();
    assert_eq!(store.current().theme.mode, ThemeMode::Light);
    assert!(!store.current().theme.reduced_motion);
    assert_eq!(
        store.overrides(),
        vec![ConfigOverride {
            path: path(&["output", "max_scale"]),
            value: json!(3)
        }]
    );
}

#[test]
fn a_reload_keeps_an_override_whose_setting_it_left_alone() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), json!("dark")).unwrap();
    store
        .reload_from_str(r#"{ "theme": { "mode": "light" }, "output": { "max_scale": 3 } }"#)
        .unwrap();
    assert_eq!(store.current().theme.mode, ThemeMode::Dark);
    assert_eq!(store.current().output.max_scale, 3);
}

#[test]
fn a_reload_that_changes_the_setting_drops_its_override() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), json!("dark")).unwrap();
    store
        .reload_from_str(r#"{ "theme": { "mode": "light", "reduced_motion": true } }"#)
        .unwrap();
    // `theme.mode` itself is unchanged, so its override stays.
    assert_eq!(store.overrides().len(), 1);
    store.reload_from_str("{}").unwrap();
    assert!(store.overrides().is_empty());
    assert_eq!(store.current().theme.mode, ThemeMode::Dark);
}

#[test]
fn a_reload_the_overrides_no_longer_fit_drops_them() {
    let mut store = store(&browser(
        r##", "work": { "name": "Work", "color": "#00ff00" }"##,
    ));
    store
        .set_override(
            path(&["browser", "profiles", "work", "color"]),
            json!("#ff0000"),
        )
        .unwrap();
    // The profile is gone, so its color alone names no profile.
    store
        .reload_from_str(&browser(
            r##", "home": { "name": "Home", "color": "#0000ff" }"##,
        ))
        .unwrap();
    assert!(store.overrides().is_empty());
    assert!(store.current().browser.profiles.contains_key("home"));
}

#[test]
fn the_written_value_stays_under_an_override() {
    let mut store = store(r#"{ "theme": { "mode": "light" } }"#);
    store.set_override(mode(), json!("dark")).unwrap();
    assert_eq!(store.written_at(&mode()), json!("light"));
    assert_eq!(
        store.written_at(&path(&["output", "max_scale"])),
        Value::Null
    );
}
