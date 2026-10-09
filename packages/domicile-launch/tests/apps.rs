//! Tests for listing Domicile's own apps.

use domicile_launch::apps::apps_in;

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
