//! The watch on a home, taken over a real directory and a real inotify.
//!
//! What it is watched through is the walk: a directory is watched as it is
//! read, so what the desk's `files.omit` leaves out is never watched at all.
//! It used to be one recursive watch over the whole home, which set up a watch
//! on every directory under it — a `~/.cache` a browser writes into all day
//! included — and whose events, all of them thrown away, were what overflowed
//! the kernel's queue and walked the home again.

use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use domicile_host::home_walk::walk;
use domicile_host::home_watch::HomeWatcher;

/// How long an event the test is waiting for may take to arrive.
const HEARD_WITHIN: Duration = Duration::from_secs(10);

#[test]
fn what_is_omitted_is_not_watched() {
    // The events are read in the order the kernel queued them, so by the time
    // `Notes/today.org` is heard, anything `.cache` said has been heard too.
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
    // `d_type` says what the entry is, without following it: a link reads as
    // a link, so the walk offers it and goes no further.
    let home = tempfile::tempdir().expect("a home to lay out");
    let elsewhere = tempfile::tempdir().expect("a directory outside the home");
    fs::write(elsewhere.path().join("inside.txt"), "").expect("the file");
    symlink(elsewhere.path(), home.path().join("result")).expect("the link");
    let (watcher, _heard) = watching();

    let found = walked(home.path(), &watcher, &|_: &str| false);

    assert_eq!(found, ["result"]);
}

/// A watcher that has watched nothing yet, and what it hears.
fn watching() -> (HomeWatcher, Receiver<std::path::PathBuf>) {
    let (heard, hearing) = channel();
    let watcher = HomeWatcher::new(move |event: notify::Result<notify::Event>| {
        // Refused only once the test has ended.
        for path in event.expect("an event").paths {
            let _ = heard.send(path);
        }
    })
    .expect("a watcher");
    (watcher, hearing)
}

/// Everything the walk of `home` through `watcher` finds.
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
