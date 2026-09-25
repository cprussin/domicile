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
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

#[test]
fn a_search_finds_what_is_anywhere_in_the_home_and_nothing_else() {
    // THE POINT OF THE INDEX, END TO END. `Notes/2026/april/plan.org` is four
    // levels down; the walk this replaced stopped at two and only for two
    // hand-named directories, so a person who typed `plan` was told they had
    // no such file. Nothing here names a directory — what is read is the
    // compositor's decision, and `search_files` carries no path.
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

    assert_eq!(
        found_with(&mut chrome, "", "todo.txt"),
        vec![
            "Notes/".to_string(),
            "Notes/2026/".to_string(),
            "Notes/2026/april/".to_string(),
            "Notes/2026/april/plan.org".to_string(),
            "src/".to_string(),
            "src/domicile/".to_string(),
            "src/domicile/README.md".to_string(),
            "todo.txt".to_string(),
        ]
    );
    // Only what matched crosses into the page: the index is the whole home,
    // and on a real one that is tens of megabytes a page has no use for.
    assert_eq!(
        found_with(&mut chrome, "plan", "Notes/2026/april/plan.org"),
        vec!["Notes/2026/april/plan.org".to_string()]
    );
}

#[test]
fn a_file_written_afterward_is_found_by_the_next_search() {
    // THE SUBSCRIPTION, AND THE ONLY PLACE IT CAN BE SHOWN. A file created in
    // a terminal is not an event any other part of this desktop sees; what
    // makes the index stay true is a real inotify watch on a real home, which
    // is a kernel and two processes rather than anything a unit test holds.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "Notes/today.org");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();
    assert_eq!(
        found_with(&mut chrome, "notes", "Notes/today.org"),
        vec!["Notes/".to_string(), "Notes/today.org".to_string()]
    );

    write(home.path(), "Notes/2026/plan.org");

    assert_eq!(
        found_with(&mut chrome, "notes", "Notes/2026/plan.org"),
        vec![
            "Notes/".to_string(),
            "Notes/2026/".to_string(),
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
    // The file is written when the walk ends, and a settled answer is how a
    // test knows it has.
    found_with(&mut chrome, "", "todo.txt");

    let written = compositor.await_file(&compositor.cache_home().join("domicile/file-index"));

    assert_eq!(written, "domicile-file-index 1\ntodo.txt\n");
}

#[test]
fn a_reload_that_moves_what_is_omitted_walks_the_home_again_under_it() {
    // Both halves of a new rule: what it takes back was never read, and what
    // it now leaves out is already in the index. A watch sees neither, since
    // nothing on the disk moved — so the index thread is told, and walks.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), ".config/domicile.toml");
    write(home.path(), "src/main.rs");
    write(home.path(), "src/target/debug.log");
    let omitting = |omit: &str| format!("[files]\nomit = [{omit}]\n{ONE_DISPLAY}");

    let compositor = Compositor::started_in_a_home(&omitting(r#""src/target""#), Some(home.path()));
    let mut chrome = compositor.chrome();
    assert_eq!(
        found_with(&mut chrome, "", "src/main.rs"),
        vec![
            ".config/".to_string(),
            ".config/domicile.toml".to_string(),
            "src/".to_string(),
            "src/main.rs".to_string(),
        ]
    );

    compositor.reconfigure(&omitting(r#""**/.*""#));

    assert_eq!(
        found_with(&mut chrome, "", "src/target/debug.log"),
        vec![
            "src/".to_string(),
            "src/main.rs".to_string(),
            "src/target/".to_string(),
            "src/target/debug.log".to_string(),
        ]
    );
}

/// What `query` finds once the walk is over and `path` is among it.
///
/// Asked until it is, because both conditions are a race rather than the
/// claim: a search during the startup walk answers from what a disk had got
/// to, and one right after a write answers from before the watch saw it.
fn found_with(chrome: &mut domicile_test_chrome::Chrome, query: &str, path: &str) -> Vec<String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        chrome
            .say(&ChromeMessage::SearchFiles {
                query: query.to_string(),
            })
            .expect("it asks");
        let answer = chrome
            .wait_for(|message| {
                matches!(message, HostMessage::FoundFiles { query: answered, .. } if answered == query)
            })
            .expect("the compositor answers the search");
        match answer {
            HostMessage::FoundFiles {
                files, indexing, ..
            } if !indexing && files.iter().any(|found| found == path) => return files,
            HostMessage::FoundFiles { .. } => {
                assert!(Instant::now() < deadline, "{query:?} never found {path}");
                std::thread::sleep(Duration::from_millis(50));
            }
            other => panic!("that is not a search's answer: {other:?}"),
        }
    }
}

/// A file at `path` under `home`, with whatever directories it needs.
fn write(home: &Path, path: &str) {
    let file = home.join(path);
    fs::create_dir_all(file.parent().expect("a file has a parent")).expect("the directories");
    fs::write(&file, "").expect("the file is written");
}
