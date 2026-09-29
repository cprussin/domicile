//! The picture a launcher draws beside an application.

use std::fs;
use std::path::{Path, PathBuf};

use domicile_host::app_icons::AppIcons;

/// A data directory holding `files`, each a relative path and its bytes.
fn data_dir(files: &[(&str, &[u8])]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a directory to write in");
    for (path, bytes) in files {
        let at = dir.path().join(path);
        fs::create_dir_all(at.parent().expect("a parent")).unwrap();
        fs::write(at, bytes).unwrap();
    }
    dir
}

fn icons_in(dirs: &[&Path]) -> AppIcons {
    AppIcons::new(
        dirs.iter()
            .map(|dir| dir.to_path_buf())
            .collect::<Vec<PathBuf>>(),
    )
}

#[test]
fn a_themed_icon_is_found_in_hicolor_at_the_size_a_row_wants() {
    let data = data_dir(&[
        ("icons/hicolor/256x256/apps/firefox.png", b"big"),
        ("icons/hicolor/48x48/apps/firefox.png", b"row"),
    ]);

    assert_eq!(
        icons_in(&[data.path()]).icon("firefox"),
        Some("data:image/png;base64,cm93".into())
    );
}

#[test]
fn a_scalable_icon_is_an_svg() {
    let data = data_dir(&[("icons/hicolor/scalable/apps/editor.svg", b"<svg/>")]);

    assert_eq!(
        icons_in(&[data.path()]).icon("editor"),
        Some("data:image/svg+xml;base64,PHN2Zy8+".into())
    );
}

#[test]
fn an_earlier_data_directory_wins_and_pixmaps_are_the_last_resort() {
    let user = data_dir(&[("pixmaps/term.png", b"pix")]);
    let system = data_dir(&[("icons/hicolor/32x32/apps/term.png", b"thm")]);

    // The theme is looked through in every directory before any pixmaps: a
    // pixmap is the old place an icon went, not a preferred one.
    assert_eq!(
        icons_in(&[user.path(), system.path()]).icon("term"),
        Some("data:image/png;base64,dGht".into())
    );
    assert_eq!(
        icons_in(&[user.path()]).icon("term"),
        Some("data:image/png;base64,cGl4".into())
    );
}

#[test]
fn an_absolute_icon_is_that_file() {
    let data = data_dir(&[("somewhere/app.png", b"abs")]);
    let path = data.path().join("somewhere/app.png");

    assert_eq!(
        icons_in(&[]).icon(path.to_str().expect("a UTF-8 path")),
        Some("data:image/png;base64,YWJz".into())
    );
}

#[test]
fn an_icon_nothing_can_draw_or_nothing_has_is_none() {
    let data = data_dir(&[
        ("icons/hicolor/48x48/apps/old.xpm", b"xpm"),
        ("icons/hicolor/48x48/apps/huge.png", &[0; 256 * 1024]),
    ]);
    let mut icons = icons_in(&[data.path()]);

    assert_eq!(icons.icon("old"), None, "a browser does not draw an XPM");
    assert_eq!(
        icons.icon("huge"),
        None,
        "too big to send on every keystroke"
    );
    assert_eq!(icons.icon("missing"), None);
}
