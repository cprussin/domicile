//! The home directory watch, tested on a real directory with inotify.
//!
//! Directories are watched as the walk reads them, so paths in `files.omit`
//! are never watched. This keeps busy directories like `~/.cache` from
//! overflowing the kernel's event queue.

use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use domicile_host::home_walk::walk;
use domicile_host::home_watch::HomeWatcher;

/// How long to wait for an expected event.
const HEARD_WITHIN: Duration = Duration::from_secs(10);

#[test]
fn what_is_omitted_is_not_watched() {
    // Events arrive in queue order, so any `.cache` event would come before
    // `Notes/today.org`.
    let home = tempfile::tempdir().expect("a home to lay out");
    fs::create_dir(home.path().join(".cache")).expect("the directory");
    fs::create_dir(home.path().join("Notes")).expect("the directory");
    let (watcher, heard) = watching();

    walked(home.path(), &watcher, &|path: &str| path.starts_with('.'));
    fs::write(home.path().join(".cache/thumbnail.png"), "").expect("the file");
    fs::write(home.path().join("Notes/today.org"), "").expect("the file");

    let before = heard_until(&heard, &home.path().join("Notes/today.org"));
    assert!(
        !before
            .iter()
            .any(|path| path.starts_with(home.path().join(".cache"))),
        "an omitted directory was watched: {before:?}"
    );
}

#[test]
fn a_link_to_a_directory_is_offered_but_not_walked() {
    // `d_type` does not follow links, so the walk offers the link and does
    // not enter it.
    let home = tempfile::tempdir().expect("a home to lay out");
    let elsewhere = tempfile::tempdir().expect("a directory outside the home");
    fs::write(elsewhere.path().join("inside.txt"), "").expect("the file");
    symlink(elsewhere.path(), home.path().join("result")).expect("the link");
    let (watcher, _heard) = watching();

    let found = walked(home.path(), &watcher, &|_: &str| false);

    assert_eq!(found, ["result"]);
}

/// A watcher with no watches yet, and the receiver for its events.
fn watching() -> (HomeWatcher, Receiver<std::path::PathBuf>) {
    let (heard, hearing) = channel();
    let watcher = HomeWatcher::new(move |event: notify::Result<notify::Event>| {
        // Sending fails only after the test drops the receiver.
        for path in event.expect("an event").paths {
            let _ = heard.send(path);
        }
    })
    .expect("a watcher");
    (watcher, hearing)
}

/// Every path the walk of `home` through `watcher` finds.
fn walked(home: &Path, watcher: &HomeWatcher, omitted: &impl Fn(&str) -> bool) -> Vec<String> {
    walk(home, watcher, omitted).expect("home reads").collect()
}

/// Every path heard before `path`.
fn heard_until(heard: &Receiver<std::path::PathBuf>, path: &Path) -> Vec<std::path::PathBuf> {
    let mut before = Vec::new();
    loop {
        let next = heard
            .recv_timeout(HEARD_WITHIN)
            .unwrap_or_else(|_| panic!("{} was not heard within {HEARD_WITHIN:?}", path.display()));
        if next == path {
            return before;
        }
        before.push(next);
    }
}
