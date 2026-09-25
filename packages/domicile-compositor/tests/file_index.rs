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

use domicile_protocol::{ChromeMessage, FilePreview, HostMessage};

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

    settles_on(
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
    // Only what matched crosses into the page: the index is the whole home,
    // and on a real one that is tens of megabytes a page has no use for.
    settles_on(&mut chrome, "plan", &["Notes/2026/april/plan.org"]);
}

#[test]
fn a_preview_reads_what_the_index_holds_and_nothing_else() {
    // The page names the path here, so the index is what decides whether it
    // is read: a dotfile the walk skipped is as unreadable as one that does
    // not exist.
    let home = tempfile::tempdir().expect("a home to lay out");
    fs::create_dir_all(home.path().join("Notes")).expect("the directory");
    fs::write(home.path().join("Notes/today.org"), "* today\n").expect("the file");
    write(home.path(), ".ssh/id_ed25519");

    let compositor = Compositor::started_in_a_home(ONE_DISPLAY, Some(home.path()));
    let mut chrome = compositor.chrome();
    settles_on(&mut chrome, "", &["Notes/", "Notes/today.org"]);

    assert_eq!(
        previewed(&mut chrome, "Notes/today.org"),
        FilePreview::Text {
            text: "* today\n".into()
        }
    );
    assert_eq!(
        previewed(&mut chrome, ".ssh/id_ed25519"),
        FilePreview::Unreadable
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
    settles_on(&mut chrome, "notes", &["Notes/", "Notes/today.org"]);

    settles_on_once_written(
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
    settles_on(&mut chrome, "", &["todo.txt"]);

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
    settles_on(
        &mut chrome,
        "",
        &[".config/", ".config/domicile.toml", "src/", "src/main.rs"],
    );

    compositor.reconfigure(&omitting(r#""**/.*""#));

    settles_on(
        &mut chrome,
        "",
        &["src/", "src/main.rs", "src/target/", "src/target/debug.log"],
    );
}

/// How long a search is asked again before the index is reported wrong.
///
/// Not `running::PATIENCE`, which is how long the *compositor* has to answer
/// one search at all. What is waited on here is a walk of a real disk, a
/// kernel's watch, and the quarter second `file_indexing::SETTLE` gathers a
/// burst of writes for — on a machine that may be running every other check in
/// this repo at the same time. Measured on an idle one, the longest of these
/// waits is answered in about half a second, so this is twenty times what it
/// costs: a compositor that is going to answer has answered, and the deadline
/// firing is a finding rather than a loaded machine.
const SETTLES_WITHIN: Duration = Duration::from_secs(10);

/// How long a turn leaves the compositor alone before asking again.
///
/// **Longer than `file_indexing::SETTLE`, and that is the whole constraint.**
/// The index gathers filesystem events until a quarter of a second passes with
/// none and announces the result once, so a check that wrote every fiftieth of
/// a second handed the burst something new before it could ever settle and the
/// answer a search got never moved — which is a check that hangs for its whole
/// patience over an index that is right. Twice that quarter second, so one
/// write is one burst.
const BETWEEN_ASKS: Duration = Duration::from_millis(500);

/// A search for `query`, asked until the whole of `expected` is its answer.
///
/// **The whole answer rather than one row of it, because every one of these
/// waits is on an index that is still being made.** A search taken during a
/// walk — the one at startup, or the one a reload's new `omit` sets off — is
/// answered from what a disk had got to by then, and one taken between two
/// bursts of filesystem events is answered from the half of a change that had
/// arrived. So a check that waited for the row it named and then compared the
/// rest is comparing against an index a burst behind the one it waited for,
/// which is exactly the failure this was: `Notes/2026/plan.org` had landed and
/// the `Notes/2026/` it is in had not.
///
/// Which makes the assertion the wait: what a settled answer must be is stated
/// once, and being told it in time is not a separate claim.
fn settles_on(chrome: &mut domicile_test_chrome::Chrome, query: &str, expected: &[&str]) {
    asked_until_settled(chrome, query, expected, || {});
}

/// The same, for a `path` this writes into `home` itself.
///
/// **AND IT WRITES IT AGAIN ON EVERY TURN, WHICH IS THE POINT.** A file
/// written after the startup walk is not something waiting longer finds:
/// `file_indexing::keep_the_index` establishes its inotify watch *after* the
/// walk ends, and the search that says the walk is over is answered from the
/// announcement that ends it — so a write that lands between those two is a
/// change the kernel had nobody to report to, and the index goes on without it
/// until something else moves. A write per turn closes that, because whichever
/// one the watch is up for is the one that gets reported.
///
/// Measured rather than reasoned: a 400ms sleep in front of `watch_home` fails
/// this check every run while the write is made once, and passes it every run
/// while it is made per turn.
fn settles_on_once_written(
    chrome: &mut domicile_test_chrome::Chrome,
    home: &Path,
    path: &str,
    query: &str,
    expected: &[&str],
) {
    asked_until_settled(chrome, query, expected, || made_again(home, path));
}

/// Ask `query` until a settled answer is `expected`, arranging `again` first.
///
/// `again` runs before every ask rather than once before the first, which is
/// for a stimulus that can be *lost* rather than merely be late — see
/// [`settles_on_once_written`]. It is nothing at all for a wait on something
/// the compositor is already doing.
fn asked_until_settled(
    chrome: &mut domicile_test_chrome::Chrome,
    query: &str,
    expected: &[&str],
    again: impl Fn(),
) {
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

/// What the compositor says is in `path`.
fn previewed(chrome: &mut domicile_test_chrome::Chrome, path: &str) -> FilePreview {
    chrome
        .say(&ChromeMessage::PreviewFile {
            path: path.to_string(),
        })
        .expect("it asks");
    match chrome
        .wait_for(|message| {
            matches!(message, HostMessage::FilePreview { path: answered, .. } if answered == path)
        })
        .expect("the compositor answers the preview")
    {
        HostMessage::FilePreview { preview, .. } => preview,
        other => panic!("that is not a preview: {other:?}"),
    }
}

/// A file at `path` under `home`, with whatever directories it needs.
fn write(home: &Path, path: &str) {
    let file = home.join(path);
    fs::create_dir_all(file.parent().expect("a file has a parent")).expect("the directories");
    fs::write(&file, "").expect("the file is written");
}

/// The same, from nothing, however much of it is already there.
///
/// Two things make this more than a second [`write`], and both are what the
/// index is told rather than what the disk holds. A write into a path the index
/// already has is not a change `domicile_host::file_changes` reads — only a
/// path arriving or leaving is — so the file has to go before it can arrive
/// again. And the directory holding it is a row of its own that nothing
/// synthesizes from the file's name, so it has to arrive again too.
///
/// **The directory is this check's to lose, then**: whatever else is in it goes
/// with it. Every caller writes into one it introduced itself.
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
