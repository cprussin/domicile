//! Tests for `domicile check-config`.

use std::fs;

use domicile_launch::config_check::check;

#[test]
fn a_config_the_compositor_takes_passes() {
    let directory = tempfile::tempdir().unwrap();
    let config = directory.path().join("domicile.json");
    fs::write(&config, r#"{"theme": {"mode": "light"}}"#).unwrap();

    assert_eq!(check(&config), Ok(()));
}

#[test]
fn a_config_the_compositor_refuses_is_refused_with_its_reason() {
    // `applications` moved to manganese's options; a config still naming it
    // stops the compositor from starting.
    let directory = tempfile::tempdir().unwrap();
    let config = directory.path().join("domicile.json");
    fs::write(&config, r#"{"applications": {"omit": ["*"]}}"#).unwrap();

    let refused = check(&config).unwrap_err();
    assert!(
        refused.contains("unknown field `applications`"),
        "{refused}"
    );
}

#[test]
fn a_module_config_is_refused_because_only_its_built_json_can_be_checked() {
    let directory = tempfile::tempdir().unwrap();
    let config = directory.path().join("domicile.ts");
    fs::write(&config, "export const Shell = 1;").unwrap();

    let refused = check(&config).unwrap_err();
    assert!(refused.contains("JSON"), "{refused}");
}
