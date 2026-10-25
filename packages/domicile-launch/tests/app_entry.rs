//! Tests for resolving the module `domicile open --app` is given.

use std::path::{Path, PathBuf};

use domicile_launch::app_entry::{app_entry, AppEntry};

#[test]
fn an_entry_is_served_from_its_own_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes/notes.js"), "").unwrap();

    let entry = app_entry(Path::new("notes/notes.js"), dir.path()).unwrap();

    assert_eq!(
        entry,
        AppEntry {
            root: dir.path().canonicalize().unwrap().join("notes"),
            module: PathBuf::from("notes.js"),
        }
    );
}

/// One directory is one app, and so one origin, however it is spelled.
#[test]
fn a_link_is_followed_to_the_directory_it_names() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes/notes.js"), "").unwrap();
    std::os::unix::fs::symlink(dir.path().join("notes"), dir.path().join("linked")).unwrap();

    let entry = app_entry(Path::new("linked/./notes.js"), dir.path()).unwrap();

    assert_eq!(entry.root, dir.path().canonicalize().unwrap().join("notes"));
}

#[test]
fn an_entry_that_is_not_a_file_is_refused() {
    let dir = tempfile::tempdir().unwrap();

    let missing = app_entry(Path::new("nowhere.js"), dir.path()).unwrap_err();
    assert!(missing.contains("nowhere.js"), "{missing}");
    let directory = app_entry(Path::new("."), dir.path()).unwrap_err();
    assert!(directory.contains("not a file"), "{directory}");
}
