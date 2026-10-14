//! Tests for the desktop entry `domicile install-app` writes.

use std::path::Path;

use domicile_launch::desktop_entry::{desktop_entry, file_stem, installed_from};

#[test]
fn an_entry_opens_its_start_url_as_an_app() {
    assert_eq!(
        desktop_entry(
            "Music",
            "https://music.example/?source=app",
            Some(Path::new(
                "/home/me/.local/share/domicile/app-icons/music.svg"
            )),
            "https://music.example"
        ),
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Music\n\
         Icon=/home/me/.local/share/domicile/app-icons/music.svg\n\
         Exec=domicile open-app \"https://music.example/?source=app\"\n\
         X-Domicile-Installed-From=https://music.example\n"
    );
}

#[test]
fn an_entry_without_an_icon_names_none() {
    assert!(!desktop_entry(
        "Music",
        "https://music.example/",
        None,
        "https://music.example/"
    )
    .contains("Icon="));
}

#[test]
fn a_value_is_escaped_so_the_entry_reads_back_as_given() {
    // A name cannot end the line, and `%` is a field code in `Exec`.
    let entry = desktop_entry(
        "Music\n[Desktop Entry]\\",
        "https://m.example/?a=%20&b=\"$`\\",
        None,
        "https://m.example/\n[Desktop Entry]",
    );
    assert!(
        entry.contains("Name=Music\\n[Desktop Entry]\\\\\n"),
        "{entry}"
    );
    assert!(
        entry.contains(
            "Exec=domicile open-app \"https://m.example/?a=%%20&b=\\\\\"\\\\$\\\\`\\\\\\\\\"\n"
        ),
        "{entry}"
    );
}

#[test]
fn an_entry_is_named_after_where_the_app_starts() {
    assert_eq!(
        file_stem("https://Music.example:8443/app/play?source=app#top"),
        "domicile-app-music.example-8443-app-play"
    );
    assert_eq!(
        file_stem("https://music.example/"),
        "domicile-app-music.example"
    );
}

#[test]
fn an_entry_reads_back_the_address_it_was_installed_from() {
    let from = "https://m.example/?a=%20\\b\nExec=evil";
    let entry = desktop_entry("Music", "https://m.example/app/", None, from);

    assert_eq!(installed_from(&entry).as_deref(), Some(from));
    assert_eq!(installed_from("[Desktop Entry]\nName=Music\n"), None);
}
