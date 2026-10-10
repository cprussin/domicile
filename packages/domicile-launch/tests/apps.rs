//! Tests for listing Domicile's own apps.

use std::path::Path;

use domicile_launch::apps::{
    apps_in, list_the_settings_host, settings_host_manifest, settings_host_manifest_path,
};

#[test]
fn each_directory_in_the_apps_directory_is_an_app() {
    let apps = tempfile::tempdir().unwrap();
    std::fs::create_dir(apps.path().join("history")).unwrap();
    std::fs::create_dir(apps.path().join("calendar")).unwrap();
    std::fs::write(apps.path().join("README"), "not an app").unwrap();

    assert_eq!(
        apps_in(apps.path()).unwrap(),
        [apps.path().join("calendar"), apps.path().join("history")]
    );
}

#[test]
fn an_apps_directory_that_cannot_be_read_is_an_error() {
    let apps = tempfile::tempdir().unwrap();

    assert!(apps_in(&apps.path().join("gone")).is_err());
}

#[test]
fn chrome_finds_the_settings_host_in_the_profile() {
    // Chrome reads a user's native messaging hosts from
    // `<user-data-dir>/NativeMessagingHosts`.
    assert_eq!(
        settings_host_manifest_path(Path::new("/state/domicile/profile")),
        Path::new("/state/domicile/profile/NativeMessagingHosts/domicile.settings.json")
    );
}

#[test]
fn only_the_settings_app_may_start_the_settings_host() {
    let manifest: serde_json::Value = serde_json::from_str(&settings_host_manifest(Path::new(
        "/nix/store/x-domicile/bin/domicile-settings-host",
    )))
    .expect("the manifest is JSON");

    assert_eq!(
        manifest,
        serde_json::json!({
            "name": "domicile.settings",
            "description": "Reads and writes the desktop's config for the Settings app",
            "path": "/nix/store/x-domicile/bin/domicile-settings-host",
            "type": "stdio",
            "allowed_origins": ["chrome-extension://acpgnhiblklkgbkcjgbabkcmdmchdphk/"],
        })
    );
}

#[test]
fn the_settings_host_is_listed_for_chrome_and_a_stale_one_replaced() {
    // Written on every start: the host's path changes with each install.
    let profile = tempfile::tempdir().unwrap();
    let place = settings_host_manifest_path(profile.path());
    std::fs::create_dir_all(place.parent().unwrap()).unwrap();
    std::fs::write(&place, "stale").unwrap();

    list_the_settings_host(profile.path(), Path::new("/b/domicile-settings-host")).unwrap();

    assert_eq!(
        std::fs::read_to_string(&place).unwrap(),
        settings_host_manifest(Path::new("/b/domicile-settings-host"))
    );
}

#[test]
fn a_new_profile_gets_the_directory_chrome_reads_hosts_from() {
    let profile = tempfile::tempdir().unwrap();

    list_the_settings_host(profile.path(), Path::new("/b/domicile-settings-host")).unwrap();

    assert!(settings_host_manifest_path(profile.path()).exists());
}
