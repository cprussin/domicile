//! Tests for `domicile install-app`, with the network replaced by a table.

use std::fs;
use std::path::PathBuf;

use domicile_launch::install_app::{data_home, install_app, Fetched, InstallAppError};
use domicile_launch::web_address::WebAddressError;

/// Answers each address in `site` with where it landed and its body.
fn serving<'a>(
    site: &'a [(&'a str, &'a str, &'a str)],
) -> impl Fn(&str) -> Result<Fetched, String> + 'a {
    move |asked| {
        site.iter()
            .find(|(address, _, _)| *address == asked)
            .map(|(_, landed, body)| Fetched {
                url: landed.to_string(),
                body: body.as_bytes().to_vec(),
            })
            .ok_or_else(|| "404".to_string())
    }
}

#[test]
fn a_site_is_installed_as_a_desktop_entry_and_its_icon() {
    let home = tempfile::tempdir().unwrap();
    let site = [
        // The page redirects, so its manifest resolves against where it landed.
        (
            "https://music.example",
            "https://music.example/app/",
            r#"<link rel="manifest" href="manifest.json">"#,
        ),
        (
            "https://music.example/app/manifest.json",
            "https://music.example/app/manifest.json",
            r#"{ "name": "Music", "icons": [{ "src": "icon.svg" }] }"#,
        ),
        (
            "https://music.example/app/icon.svg",
            "https://music.example/app/icon.svg",
            "<svg/>",
        ),
    ];

    let entry = install_app("https://music.example", home.path(), &serving(&site)).unwrap();

    let icon = home
        .path()
        .join("domicile/app-icons/domicile-app-music.example-app.svg");
    assert_eq!(
        entry,
        home.path()
            .join("applications/domicile-app-music.example-app.desktop")
    );
    assert_eq!(fs::read_to_string(&icon).unwrap(), "<svg/>");
    assert_eq!(
        fs::read_to_string(&entry).unwrap(),
        format!(
            "[Desktop Entry]\nType=Application\nName=Music\nIcon={}\n\
             Exec=domicile open --app \"https://music.example/app/\"\n\
             X-Domicile-Installed-From=https://music.example\n",
            icon.display()
        )
    );
}

#[test]
fn a_site_without_a_usable_icon_is_installed_without_one() {
    let home = tempfile::tempdir().unwrap();
    let site = [
        (
            "https://music.example/",
            "https://music.example/",
            r#"<link rel="manifest" href="/m.json">"#,
        ),
        (
            "https://music.example/m.json",
            "https://music.example/m.json",
            r#"{ "name": "Music" }"#,
        ),
    ];

    let entry = install_app("https://music.example/", home.path(), &serving(&site)).unwrap();

    assert!(!fs::read_to_string(entry).unwrap().contains("Icon="));
    assert!(!home.path().join("domicile").exists());
}

#[test]
fn a_fetch_that_fails_says_which_address() {
    let home = tempfile::tempdir().unwrap();

    assert_eq!(
        install_app("https://music.example/", home.path(), &serving(&[])),
        Err(InstallAppError::Fetch {
            url: "https://music.example/".to_string(),
            why: "404".to_string(),
        })
    );
}

#[test]
fn an_entry_that_cannot_be_written_says_where() {
    let home = tempfile::tempdir().unwrap();
    // A file where the applications directory goes.
    fs::write(home.path().join("applications"), "").unwrap();
    let site = [
        (
            "https://music.example/",
            "https://music.example/",
            r#"<link rel="manifest" href="/m.json">"#,
        ),
        (
            "https://music.example/m.json",
            "https://music.example/m.json",
            r#"{ "name": "Music" }"#,
        ),
    ];

    assert!(matches!(
        install_app("https://music.example/", home.path(), &serving(&site)),
        Err(InstallAppError::Write { path, .. }) if path == home.path().join("applications")
    ));
}

#[test]
fn apps_install_under_the_data_home() {
    let env = |set: &'static [(&'static str, &'static str)]| {
        move |name: &str| {
            set.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    };
    assert_eq!(
        data_home(&env(&[("XDG_DATA_HOME", "/data"), ("HOME", "/home/me")])),
        Some(PathBuf::from("/data"))
    );
    // A relative XDG_DATA_HOME is ignored, as the XDG spec says.
    assert_eq!(
        data_home(&env(&[("XDG_DATA_HOME", "data"), ("HOME", "/home/me")])),
        Some(PathBuf::from("/home/me/.local/share"))
    );
    assert_eq!(data_home(&env(&[])), None);
}

#[test]
fn only_a_web_address_is_installed() {
    let home = tempfile::tempdir().unwrap();

    assert_eq!(
        install_app("file:///tmp/index.html", home.path(), &serving(&[])),
        Err(InstallAppError::WebApp(
            WebAddressError::NotWeb {
                address: "file:///tmp/index.html".to_string()
            }
            .into()
        ))
    );
}
