//! Tests for the file index against a real home directory and chrome socket.
//!
//! `domicile_host::home_walk`, `file_index` and `file_changes` are unit-tested.
//! These check the startup walk, the published answer, the inotify watch and
//! the cache file together.

mod running;

use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// The log line the compositor writes once the index has an answer.
///
/// See [`asked_until_settled`] for why tests wait for it.
const HAS_AN_ANSWER: &str = "the home directory is indexed";

#[test]
fn a_search_finds_what_is_anywhere_in_the_home_and_nothing_else() {
    // The index covers the whole home at any depth. `search_files` carries no
    // path, so the compositor decides what is read.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "todo.txt");
    write(home.path(), "Notes/2026/april/plan.org");
    write(home.path(), "src/domicile/README.md");
    // Dot entries are skipped, along with everything under them.
    write(home.path(), ".config/domicile/domicile.json");
    write(home.path(), "src/.git/HEAD");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();

    settles_on(
        &compositor,
        &mut chrome,
        "",
        &[
            "Notes/",
            "Notes/2026/",
            "Notes/2026/april/",
            "Notes/2026/april/plan.org",
            "src/",
            "src/domicile/",
            "src/domicile/README.md",
            "todo.txt",
        ],
    );
    // Only matches are sent; a real home's index is tens of megabytes.
    settles_on(
        &compositor,
        &mut chrome,
        "plan",
        &["Notes/2026/april/plan.org"],
    );
}

#[test]
fn a_file_written_afterward_is_found_by_the_next_search() {
    // Only a real inotify watch on a real home can show the index follows
    // files created elsewhere.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "Notes/today.org");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();
    settles_on(
        &compositor,
        &mut chrome,
        "notes",
        &["Notes/", "Notes/today.org"],
    );

    settles_on_once_written(
        &compositor,
        &mut chrome,
        home.path(),
        "Notes/2026/plan.org",
        "notes",
        &[
            "Notes/",
            "Notes/2026/",
            "Notes/2026/plan.org",
            "Notes/today.org",
        ],
    );
}

#[test]
fn what_the_walk_found_is_written_down_for_the_next_run() {
    // The next session's first search reads this cache before its walk ends.
    // `domicile_host::index_file` tests the format; this checks the location.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), "todo.txt");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();
    // The cache is written when the walk ends, which a settled answer shows.
    settles_on(&compositor, &mut chrome, "", &["todo.txt"]);

    let written = compositor.await_file(&compositor.cache_home().join("domicile/file-index"));

    assert_eq!(written, "domicile-file-index 1\ntodo.txt\n");
}

#[test]
fn a_reload_that_moves_what_is_omitted_walks_the_home_again_under_it() {
    // A new `omit` both adds unread paths and removes indexed ones. Nothing on
    // disk changed, so the watch sees neither and the reload must rewalk.
    let home = tempfile::tempdir().expect("a home to lay out");
    write(home.path(), ".config/domicile.json");
    write(home.path(), "src/main.rs");
    write(home.path(), "src/target/debug.log");
    let omitting = |omit: &str| {
        format!(
            r#"{{
  "files": {{ "omit": [{omit}] }},
  "output": {{ "displays": [{{ "name": "left", "size": [1920, 1080] }}] }}
}}"#
        )
    };

    let compositor = Compositor::started_in_a_home(&omitting(r#""src/target""#), Some(home.path()));
    let mut chrome = compositor.chrome();
    settles_on(
        &compositor,
        &mut chrome,
        "",
        &[".config/", ".config/domicile.json", "src/", "src/main.rs"],
    );

    compositor.reconfigure(&omitting(r#""**/.*""#));

    settles_on(
        &compositor,
        &mut chrome,
        "",
        &["src/", "src/main.rs", "src/target/", "src/target/debug.log"],
    );
}

/// How long to keep searching before the index is reported wrong.
///
/// Separate from `running::PATIENCE`, which bounds one reply. An idle machine
/// settles in about half a second; this allows twenty times that for a loaded
/// one.
const SETTLES_WITHIN: Duration = Duration::from_secs(10);

/// The pause between searches.
///
/// Must exceed `file_indexing::SETTLE`: the index publishes only after a quiet
/// period, so rewriting faster would keep it from ever settling.
const BETWEEN_ASKS: Duration = Duration::from_millis(500);

/// Searches for `query` until the whole answer equals `expected`.
///
/// Compare the full answer, not one row: a search during a walk or between
/// event bursts sees a partial index.
fn settles_on(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    query: &str,
    expected: &[&str],
) {
    asked_until_settled(compositor, chrome, query, expected, || {});
}

/// Like [`settles_on`], rewriting `path` under `home` before every search.
///
/// The kernel reports a write once, so a write made before the watch exists is
/// lost for good. Rewriting each turn avoids depending on the watch being up.
fn settles_on_once_written(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    home: &Path,
    path: &str,
    query: &str,
    expected: &[&str],
) {
    asked_until_settled(compositor, chrome, query, expected, || {
        made_again(home, path);
    });
}

/// Searches for `query` until the settled answer is `expected`, running
/// `again` before each search.
///
/// Waits for [`HAS_AN_ANSWER`] first. The compositor does not reply to
/// `search_files` before the index has an answer (see the `SearchFiles` arm),
/// so an early search would time out in `Chrome::wait_for`.
fn asked_until_settled(
    compositor: &Compositor,
    chrome: &mut domicile_test_chrome::Chrome,
    query: &str,
    expected: &[&str],
    again: impl Fn(),
) {
    compositor.wait_for_log(HAS_AN_ANSWER);
    let deadline = Instant::now() + SETTLES_WITHIN;
    loop {
        again();
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
            } => {
                let settled = !indexing
                    && files
                        .iter()
                        .map(String::as_str)
                        .eq(expected.iter().copied());
                if settled {
                    return;
                }
                assert!(
                    Instant::now() < deadline,
                    "{query:?} never answered {expected:?} in {SETTLES_WITHIN:?}; \
                     the last answer held {files:?}, and was still indexing: {indexing}"
                );
                std::thread::sleep(BETWEEN_ASKS);
            }
            other => panic!("that is not a search's answer: {other:?}"),
        }
    }
}

/// Creates an empty file at `path` under `home`, with its directories.
fn write(home: &Path, path: &str) {
    let file = home.join(path);
    fs::create_dir_all(file.parent().expect("a file has a parent")).expect("the directories");
    fs::write(&file, "").expect("the file is written");
}

/// Deletes `path`'s parent directory, then calls [`write`].
///
/// `domicile_host::file_changes` sees only paths appearing or disappearing, and
/// the directory is its own index row, so both must be recreated. Everything
/// else in that directory is deleted, so callers use a directory of their own.
fn made_again(home: &Path, path: &str) {
    let directory = home
        .join(path)
        .parent()
        .expect("a file has a parent")
        .to_path_buf();
    if directory.exists() {
        fs::remove_dir_all(&directory).expect("what was written is taken away again");
    }
    write(home, path);
}
