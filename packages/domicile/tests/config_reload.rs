//! Behaviour tests for the daemon's config hot-reload step, written before the
//! implementation.
//!
//! `domicile-config` already parses safely and keeps the last known-good config
//! live; this is the piece the running daemon needs on top — deciding what a
//! reload actually changed, so it can act on it and say so.

use std::path::{Path, PathBuf};

use domicile::config_reload::{apply_reload, Reload};
use domicile_config::{Config, ConfigStore};

const SHELLS_DIR: &str = "/shells";

fn store() -> ConfigStore {
    ConfigStore::new(Config::default())
}

#[test]
fn a_new_shell_package_is_reported_with_its_resolved_path() {
    let mut store = store();
    let reload = apply_reload(
        &mut store,
        Path::new(SHELLS_DIR),
        Config::parse("[shell]\npackage = \"fancy\"\n"),
    );

    assert_eq!(reload, Reload::ShellChanged(Some("/shells/fancy".into())));
    assert_eq!(
        store
            .current()
            .shell
            .package
            .as_ref()
            .map(|package| package.resolve(Path::new(SHELLS_DIR))),
        Some(PathBuf::from("/shells/fancy"))
    );
}

#[test]
fn an_unrelated_edit_goes_live_without_a_shell_change() {
    let mut store = store();
    let reload = apply_reload(
        &mut store,
        Path::new(SHELLS_DIR),
        Config::parse("[compositor]\nnested_size = [640, 480]\n"),
    );

    assert_eq!(reload, Reload::Applied);
    assert_eq!(store.current().compositor.nested_size, (640, 480));
}

#[test]
fn a_bad_edit_is_rejected_and_the_live_config_survives() {
    let mut store = store();
    apply_reload(
        &mut store,
        Path::new(SHELLS_DIR),
        Config::parse("[shell]\npackage = \"fancy\"\n"),
    );

    let reload = apply_reload(
        &mut store,
        Path::new(SHELLS_DIR),
        Config::parse("[compositor]\nnested_size = [0, 0]\n"),
    );

    assert!(matches!(reload, Reload::Rejected(_)));
    // The typo did not take the good config down with it.
    assert_eq!(
        store
            .current()
            .shell
            .package
            .as_ref()
            .map(|package| package.resolve(Path::new(SHELLS_DIR))),
        Some(PathBuf::from("/shells/fancy"))
    );
}

#[test]
fn dropping_the_package_from_a_config_reports_a_shell_change_to_none() {
    // The new payload, and the case the `Option` was introduced to represent: a
    // user deleting `package` from a config that had one. It has a line of its
    // own behind it in the daemon, and without this nothing reaches it.
    //
    // It also restores what `an_unrelated_edit_goes_live_without_a_shell_change`
    // silently lost when the config's default shell was removed: that test now
    // starts from a config naming nothing, so its "unchanged" assertion compares
    // `None` with `None` and would survive `if after.is_none() { Applied }`.
    // This one would not.
    let mut store = ConfigStore::new(Config::parse("[shell]\npackage = \"fancy\"\n").unwrap());

    let reload = apply_reload(
        &mut store,
        Path::new(SHELLS_DIR),
        Config::parse("[compositor]\nnested_size = [800, 600]\n"),
    );

    assert_eq!(reload, Reload::ShellChanged(None));
    assert_eq!(store.current().shell.package, None);
}
