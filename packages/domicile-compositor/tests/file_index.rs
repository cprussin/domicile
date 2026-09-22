//! The file index, from a real home directory to a real chrome socket.
//!
//! What the pieces do on their own is covered where they live —
//! `domicile_host::home_walk` walks a table, `domicile_host::file_index` holds
//! a set, `domicile_host::file_changes` reads an event. None of that can show
//! the thing this change is: a walk that runs on a thread at startup, an
//! answer published where a chrome connection can read it without waiting for
//! a disk, a watch on a real kernel, and a cache file the next run starts
//! from. Those are four processes' worth of arrangement and one compositor.

mod running;

use std::fs;
use std::path::Path;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

#[test]
fn a_launcher_is_offered_the_whole_home_at_every_depth() {
    // THE POINT OF THE INDEX, END TO END. `Notes/2026/april/plan.org` is four
    // levels down; the walk this replaced stopped at two and only for two
    // hand-named directories, so a person who typed `plan` was told they had
    // no such file. Nothing here names a directory — what is read is the
    // compositor's decision, and `list_files` carries no path.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "todo.txt");
    write(home.path(), "Notes/2026/april/plan.org");
    write(home.path(), "src/domicile/README.md");
    // And the rule that survived from the old walk: a dot is not offered, and
    // nothing under it is walked.
    write(home.path(), ".config/domicile/domicile.toml");
    write(home.path(), "src/.git/HEAD");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();
    chrome.say(&ChromeMessage::ListFiles).expect("it asks");

    assert_eq!(
        offered_with(&mut chrome, "todo.txt"),
        vec![
            "Notes".to_string(),
            "Notes/2026".to_string(),
            "Notes/2026/april".to_string(),
            "Notes/2026/april/plan.org".to_string(),
            "src".to_string(),
            "src/domicile".to_string(),
            "src/domicile/README.md".to_string(),
            "todo.txt".to_string(),
        ]
    );
}

#[test]
fn a_file_written_afterward_is_offered_without_anybody_asking() {
    // THE SUBSCRIPTION, AND THE ONLY PLACE IT CAN BE SHOWN. A file created in
    // a terminal is not an event any other part of this desktop sees; what
    // makes the index stay true is a real inotify watch on a real home, which
    // is a kernel and two processes rather than anything a unit test holds.
    //
    // Nothing is asked for here after the first answer. The panel a person has
    // open is the one this is for: they are typing at a list, and the file
    // they just saved in another window appears in it.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "Notes/today.org");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    // Connected before the file is written, because a broadcast reaches the
    // chromes that are connected for it and no others.
    let mut chrome = compositor.chrome();
    chrome.say(&ChromeMessage::ListFiles).expect("it asks");
    assert_eq!(
        offered_with(&mut chrome, "Notes/today.org"),
        vec!["Notes".to_string(), "Notes/today.org".to_string()]
    );

    write(home.path(), "Notes/2026/plan.org");

    assert_eq!(
        offered_with(&mut chrome, "Notes/2026/plan.org"),
        vec![
            "Notes".to_string(),
            "Notes/2026".to_string(),
            "Notes/2026/plan.org".to_string(),
            "Notes/today.org".to_string(),
        ]
    );
}

#[test]
fn what_the_walk_found_is_written_down_for_the_next_run() {
    // So the first launcher of the next session has a list before its walk has
    // found anything. The file's own format and every way it can be wrong are
    // `domicile_host::index_file`'s; what is asserted here is that a running
    // compositor puts one where the next one will look for it.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "todo.txt");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();
    chrome.say(&ChromeMessage::ListFiles).expect("it asks");
    // The file is written when the walk ends, and a settled answer is how a
    // test knows it has.
    offered_with(&mut chrome, "todo.txt");

    let written = compositor.await_file(&compositor.cache_home().join("domicile/file-index"));

    assert_eq!(written, "domicile-file-index 1\ntodo.txt\n");
}

/// The next settled answer that has `path` in it, as its sorted list.
///
/// Two conditions, and both are about a race rather than about the claim.
/// `indexing` false waits for the walk to be over: a startup walk publishes
/// what it has found so far, so the first `files` message is whatever a disk
/// had got to. And `path` waits for *which* settled answer — the boot
/// broadcast and the reply to `list_files` are two messages saying the same
/// thing, so a test that took the next one after writing a file could be
/// handed one of those instead and would be asserting against the home as it
/// was a moment ago.
fn offered_with(chrome: &mut domicile_test_chrome::Chrome, path: &str) -> Vec<String> {
    let answer = chrome
        .wait_for(|message| match message {
            HostMessage::Files { files, indexing } => {
                !indexing && files.iter().any(|offered| offered == path)
            }
            _ => false,
        })
        .expect("the compositor says what there is to open");
    match answer {
        HostMessage::Files { files, .. } => files,
        other => panic!("that is not a file list: {other:?}"),
    }
}

/// A file at `path` under `home`, with whatever directories it needs.
fn write(home: &Path, path: &str) {
    let file = home.join(path);
    fs::create_dir_all(file.parent().expect("a file has a parent")).expect("the directories");
    fs::write(&file, "").expect("the file is written");
}
