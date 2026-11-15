//! What `domicile open --electron` finds of an installed Electron app.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt as _};
use std::path::{Path, PathBuf};

use domicile_launch::electron_app::{electron_app, ElectronApp, ElectronError};

/// Writes `text` at `path` under `root`, making its directories.
fn write(root: &Path, path: &str, text: &str) -> PathBuf {
    let at = root.join(path);
    fs::create_dir_all(at.parent().expect("a parent")).unwrap();
    fs::write(&at, text).unwrap();
    at
}

/// Writes an executable script.
fn script(root: &Path, path: &str, text: &str) -> PathBuf {
    let at = write(root, path, text);
    fs::set_permissions(&at, fs::Permissions::from_mode(0o755)).unwrap();
    at
}

fn entry(exec: &str) -> String {
    format!("[Desktop Entry]\nType=Application\nName=App\nExec={exec}\n")
}

/// An install as a bundled Electron app ships: its binary beside
/// `resources/app.asar`.
fn bundled(root: &Path) -> PathBuf {
    write(root, "opt/Slack/resources/app.asar", "asar");
    script(root, "opt/Slack/slack", "\x7fELF")
}

fn canonical(path: PathBuf) -> PathBuf {
    fs::canonicalize(path).unwrap()
}

#[test]
fn an_entry_leads_through_its_program_to_resources() {
    let root = tempfile::tempdir().unwrap();
    let slack = bundled(root.path());
    let apps = root.path().join("applications");
    write(
        &apps,
        "slack.desktop",
        &entry(&format!("{} -s %U", slack.display())),
    );

    assert_eq!(
        electron_app("slack.desktop", &[], root.path(), &[apps], None),
        Ok(ElectronApp {
            resources: canonical(root.path().join("opt/Slack/resources")),
            args: vec!["-s".into()],
            fallback: Some(vec![slack.display().to_string(), "-s".into()]),
        })
    );
}

#[test]
fn an_entry_id_may_leave_out_desktop() {
    let root = tempfile::tempdir().unwrap();
    let slack = bundled(root.path());
    let apps = root.path().join("applications");
    write(&apps, "slack.desktop", &entry(&slack.display().to_string()));

    let found = electron_app("slack", &[], root.path(), &[apps], None).unwrap();

    assert_eq!(
        found.resources,
        canonical(root.path().join("opt/Slack/resources"))
    );
}

#[test]
fn a_bare_program_is_found_on_path() {
    let root = tempfile::tempdir().unwrap();
    bundled(root.path());
    let apps = root.path().join("applications");
    write(&apps, "slack.desktop", &entry("slack %U"));
    let path = root.path().join("opt/Slack");

    let found = electron_app(
        "slack.desktop",
        &[],
        root.path(),
        &[apps],
        Some(path.as_os_str()),
    )
    .unwrap();

    assert_eq!(
        found.resources,
        canonical(root.path().join("opt/Slack/resources"))
    );
    assert_eq!(found.fallback, Some(vec!["slack".to_string()]));
}

#[test]
fn wrapper_scripts_are_followed_to_the_app_they_run() {
    // As nixpkgs wraps Element: Electron, given the app's asar.
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "element/share/element/app.asar", "asar");
    script(root.path(), "electron/bin/electron", "\x7fELF");
    let unwrapped = script(
        root.path(),
        "element/bin/.element-desktop-wrapped",
        &format!(
            "#! /bin/bash -e\nexport LD_PRELOAD='/nowhere/libsqlcipher.so'\n\
             exec -a \"$0\" \"{}\" {} \"$@\"\n",
            root.path().join("electron/bin/electron").display(),
            root.path().join("element/share/element/app.asar").display(),
        ),
    );
    let wrapper = script(
        root.path(),
        "element-with-flags/bin/element-desktop",
        &format!(
            "#! /bin/bash -e\nexec \"{}\" --ozone-platform-hint=auto \"$@\"\n",
            unwrapped.display()
        ),
    );
    let apps = root.path().join("applications");
    write(
        &apps,
        "element-desktop.desktop",
        &entry(&format!("{} %u", wrapper.display())),
    );

    let found = electron_app("element-desktop", &[], root.path(), &[apps], None).unwrap();

    assert_eq!(
        found.resources,
        canonical(root.path().join("element/share/element"))
    );
}

#[test]
fn a_symlinked_program_is_followed_to_its_install() {
    let root = tempfile::tempdir().unwrap();
    let slack = bundled(root.path());
    fs::create_dir_all(root.path().join("bin")).unwrap();
    symlink(&slack, root.path().join("bin/slack")).unwrap();

    let found = electron_app("./bin/slack", &[], root.path(), &[], None).unwrap();

    assert_eq!(
        found.resources,
        canonical(root.path().join("opt/Slack/resources"))
    );
    assert_eq!(found.fallback, None);
}

#[test]
fn an_install_directory_or_its_unpacked_app_is_found() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "VSCodium/resources/app/package.json", "{}");

    let found = electron_app("./VSCodium", &[], root.path(), &[], None).unwrap();

    assert_eq!(
        found.resources,
        canonical(root.path().join("VSCodium/resources"))
    );
}

#[test]
fn a_given_command_is_the_fallback_and_its_arguments_the_apps() {
    let root = tempfile::tempdir().unwrap();
    let slack = bundled(root.path());
    let apps = root.path().join("applications");
    write(&apps, "slack.desktop", &entry("slack %U"));
    let command = vec![
        slack.display().to_string(),
        "-u".to_string(),
        "slack://open".to_string(),
    ];

    let found = electron_app("slack.desktop", &command, root.path(), &[apps], None).unwrap();

    assert_eq!(
        found.args,
        vec!["-u".to_string(), "slack://open".to_string()]
    );
    assert_eq!(found.fallback, Some(command));
}

#[test]
fn a_missing_entry_says_so() {
    let root = tempfile::tempdir().unwrap();

    assert_eq!(
        electron_app(
            "slack",
            &[],
            root.path(),
            &[root.path().to_path_buf()],
            None
        ),
        Err(ElectronError::NoEntry {
            id: "slack.desktop".into()
        })
    );
}

#[test]
fn a_program_that_is_no_electron_app_says_so() {
    let root = tempfile::tempdir().unwrap();
    let vim = script(root.path(), "bin/vim", "\x7fELF");
    let apps = root.path().join("applications");
    write(&apps, "vim.desktop", &entry(&vim.display().to_string()));

    assert!(matches!(
        electron_app("vim", &[], root.path(), &[apps], None),
        Err(ElectronError::NotElectron { .. })
    ));
}

#[test]
fn a_script_naming_itself_ends() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("bin/loop");
    script(
        root.path(),
        "bin/loop",
        &format!("#!/bin/sh\nexec {} \"$@\"\n", path.display()),
    );

    assert!(matches!(
        electron_app("./bin/loop", &[], root.path(), &[], None),
        Err(ElectronError::NotElectron { .. })
    ));
}
