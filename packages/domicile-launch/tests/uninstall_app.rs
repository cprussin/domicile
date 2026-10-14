//! Tests for `domicile uninstall-app`.

use std::fs;
use std::path::{Path, PathBuf};

use domicile_launch::install_app::{install_app, Fetched};
use domicile_launch::uninstall_app::{uninstall_app, UninstallAppError};

/// A site at `https://music.example` that redirects to its app at `/app/`,
/// whose start URL is that.
const SITE: [(&str, &str, &str); 3] = [
    (
        "https://music.example",
        "https://music.example/app/",
        r#"<link rel="manifest" href="m.json">"#,
    ),
    (
        "https://music.example/app/m.json",
        "https://music.example/app/m.json",
        r#"{ "name": "Music", "icons": [{ "src": "icon.svg" }] }"#,
    ),
    (
        "https://music.example/app/icon.svg",
        "https://music.example/app/icon.svg",
        "<svg/>",
    ),
];

/// Answers each address in [`SITE`] with where it landed and its body.
fn fetch(asked: &str) -> Result<Fetched, String> {
    SITE.iter()
        .find(|(address, _, _)| *address == asked)
        .map(|(_, landed, body)| Fetched {
            url: landed.to_string(),
            body: body.as_bytes().to_vec(),
        })
        .ok_or_else(|| "404".to_string())
}

/// The entry and icon installing [`SITE`] writes under `home`.
fn music(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join("applications/domicile-app-music.example-app.desktop"),
        home.join("domicile/app-icons/domicile-app-music.example-app.svg"),
    ]
}

#[test]
fn an_installed_app_loses_its_entry_and_icon_and_nothing_else() {
    let home = tempfile::tempdir().unwrap();
    install_app("https://music.example", home.path(), &fetch).unwrap();
    // Another app whose file names start with this one's.
    let neighbors = [
        "applications/domicile-app-music.example-app-2.desktop",
        "domicile/app-icons/domicile-app-music.example-app-2.svg",
    ];
    for neighbor in neighbors {
        fs::write(home.path().join(neighbor), "").unwrap();
    }

    let removed = uninstall_app("https://music.example/app/", home.path()).unwrap();

    assert_eq!(removed, music(home.path()));
    assert!(removed.iter().all(|path| !path.exists()));
    assert!(neighbors
        .iter()
        .all(|neighbor| home.path().join(neighbor).exists()));
}

#[test]
fn an_app_is_uninstalled_by_the_address_it_was_installed_from() {
    let home = tempfile::tempdir().unwrap();
    install_app("https://music.example", home.path(), &fetch).unwrap();
    // Other entries that name other addresses, or are not domicile's.
    let others = [
        (
            "applications/domicile-app-video.example.desktop",
            "[Desktop Entry]\nX-Domicile-Installed-From=https://video.example\n",
        ),
        (
            "domicile/app-icons/domicile-app-video.example.svg",
            "<svg/>",
        ),
        (
            "applications/music.desktop",
            "[Desktop Entry]\nX-Domicile-Installed-From=https://music.example\n",
        ),
    ];
    for (path, body) in others {
        fs::write(home.path().join(path), body).unwrap();
    }

    let removed = uninstall_app("https://music.example", home.path()).unwrap();

    assert_eq!(removed, music(home.path()));
    assert!(removed.iter().all(|path| !path.exists()));
    assert!(others
        .iter()
        .all(|(path, _)| home.path().join(path).exists()));
}

#[test]
fn an_entry_that_is_not_domiciles_is_never_removed() {
    let home = tempfile::tempdir().unwrap();
    fs::create_dir_all(home.path().join("applications")).unwrap();
    let entry = home.path().join("applications/music.desktop");
    fs::write(
        &entry,
        "[Desktop Entry]\nX-Domicile-Installed-From=https://music.example\n",
    )
    .unwrap();

    assert!(matches!(
        uninstall_app("https://music.example", home.path()),
        Err(UninstallAppError::NotInstalled { .. })
    ));
    assert!(entry.exists());
}

#[test]
fn an_app_that_is_not_installed_is_named() {
    let home = tempfile::tempdir().unwrap();

    assert_eq!(
        uninstall_app("https://music.example/", home.path()),
        Err(UninstallAppError::NotInstalled {
            url: "https://music.example/".to_string()
        })
    );
}

#[test]
fn a_file_that_cannot_be_removed_says_which() {
    let home = tempfile::tempdir().unwrap();
    // A directory where the entry goes.
    let entry = home
        .path()
        .join("applications/domicile-app-music.example.desktop");
    fs::create_dir_all(&entry).unwrap();

    assert!(matches!(
        uninstall_app("https://music.example/", home.path()),
        Err(UninstallAppError::Remove { path, .. }) if path == entry
    ));
}
