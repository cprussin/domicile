//! A config module and the files beside it, watched: one call per burst of
//! edits, none for what a build writes.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use domicile_launch::config_watch::{matters, watch};

/// Long enough for an editor's save, short enough that a test is quick.
const QUIET: Duration = Duration::from_millis(150);

/// How long a change gets to be heard before the test calls it unheard.
const PATIENCE: Duration = Duration::from_secs(5);

#[test]
fn an_edit_is_one_call_however_many_writes_it_takes() {
    let directory = tempfile::tempdir().expect("a directory");
    let (told, heard) = mpsc::channel();
    let _watching = watch(directory.path(), QUIET, move || {
        told.send(()).expect("the test is listening");
    })
    .expect("the directory can be watched");

    // An editor's save: a write, a rename over, a touch.
    std::fs::write(directory.path().join("domicile.tsx.tmp"), "a").unwrap();
    std::fs::rename(
        directory.path().join("domicile.tsx.tmp"),
        directory.path().join("domicile.tsx"),
    )
    .unwrap();
    std::fs::write(directory.path().join("mail.tsx"), "b").unwrap();

    heard.recv_timeout(PATIENCE).expect("the edit was heard");
    assert!(
        heard.recv_timeout(QUIET * 4).is_err(),
        "one burst is one call"
    );
}

#[test]
fn what_an_install_writes_is_not_an_edit() {
    let desk = Path::new("/home/me/.config/domicile");
    assert!(matters(desk, &desk.join("domicile.tsx")));
    assert!(matters(desk, &desk.join("bar/mail.tsx")));
    assert!(!matters(desk, &desk.join("node_modules/zod/index.js")));
    assert!(!matters(desk, &desk.join(".git/index")));
}

#[test]
fn an_install_is_not_heard() {
    let directory = tempfile::tempdir().expect("a directory");
    std::fs::create_dir(directory.path().join("node_modules")).unwrap();
    let (told, heard) = mpsc::channel();
    let _watching = watch(directory.path(), QUIET, move || {
        told.send(()).expect("the test is listening");
    })
    .expect("the directory can be watched");

    std::fs::write(directory.path().join("node_modules/zod.js"), "a").unwrap();

    assert!(heard.recv_timeout(QUIET * 4).is_err());
}
