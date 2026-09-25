//! What a filesystem event does to the index.
//!
//! The reading of `notify`'s event kinds, which is the whole of the
//! subscription's logic — the watcher itself is four lines of OS glue in
//! [`domicile_host::home_watch`]. What makes this worth a module of its own is
//! that most of what a home directory reports is not a change to *what there
//! is to open*: a file written to is a file that was already offered, and a
//! read of one is nothing at all.

use std::path::{Path, PathBuf};

use domicile_host::file_changes::{changes, Change};
use notify::event::{CreateKind, EventKind, ModifyKind, RemoveKind, RenameMode};
use notify::Event;

/// The home every event below is read against.
const HOME: &str = "/home/you";

#[test]
fn a_file_created_is_a_file_to_offer() {
    let event = Event::new(EventKind::Create(CreateKind::File)).add_path(under("Notes/new.org"));

    assert_eq!(
        read(&event),
        vec![Change::Appeared("Notes/new.org".to_string())]
    );
}

#[test]
fn a_file_removed_is_a_file_to_stop_offering() {
    let event = Event::new(EventKind::Remove(RemoveKind::File)).add_path(under("Notes/old.org"));

    assert_eq!(
        read(&event),
        vec![Change::Vanished("Notes/old.org".to_string())]
    );
}

#[test]
fn a_rename_the_kernel_paired_up_is_both_halves_in_order() {
    // The one event that carries two paths, and the order is the contract:
    // `notify` pairs a `MOVED_FROM` with the `MOVED_TO` that shares its
    // cookie, and puts them in that order. Applying them the other way round
    // would remove the file that had just been added when something is renamed
    // over itself.
    let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
        .add_path(under("draft.org"))
        .add_path(under("Notes/plan.org"));

    assert_eq!(
        read(&event),
        vec![
            Change::Vanished("draft.org".to_string()),
            Change::Appeared("Notes/plan.org".to_string()),
        ]
    );
}

#[test]
fn a_rename_out_of_the_watched_tree_is_only_the_half_that_was_seen() {
    // A `mv ~/draft.org /tmp/` is a `MOVED_FROM` with no `MOVED_TO` to pair
    // with, because the other end is not being watched. Half of a rename is
    // still the whole of what the index has to do about it.
    let from = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
        .add_path(under("draft.org"));
    let to = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
        .add_path(under("arrived.org"));

    assert_eq!(read(&from), vec![Change::Vanished("draft.org".to_string())]);
    assert_eq!(read(&to), vec![Change::Appeared("arrived.org".to_string())]);
}

#[test]
fn a_write_into_a_file_that_already_exists_changes_nothing() {
    // MOST OF WHAT A HOME DIRECTORY REPORTS. An editor saving a file is a
    // burst of these, and what a launcher offers is unchanged by every one of
    // them — so this is the arm that keeps the desktop from broadcasting its
    // whole file list at a person who is typing.
    let event = Event::new(EventKind::Modify(ModifyKind::Data(
        notify::event::DataChange::Content,
    )))
    .add_path(under("Notes/today.org"));

    assert_eq!(read(&event), Vec::new());
}

#[test]
fn a_rename_the_kernel_could_not_pair_is_left_alone() {
    // `Any` is `notify` saying a name changed and not which way, which is a
    // thing neither half of this can be worked out from: taking it as an
    // arrival would offer a path that may have just gone, and as a departure
    // would drop one that may have just arrived.
    let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any)))
        .add_path(under("draft.org"));

    assert_eq!(read(&event), Vec::new());
}

#[test]
fn an_omitted_path_is_not_offered_however_deep_under_it() {
    // The same rule the walk keeps, kept at the other end: a `cargo build` is
    // thousands of events under `target/`, and an index that took them would
    // grow what the walk left out the moment somebody worked in it — which
    // the next walk would then throw away, so the launcher's contents would
    // depend on how long ago it started. The watch sees the whole tree where
    // the walk never went, so it asks of every ancestor, not only the path.
    let omitted = |path: &str| path == "src/target";
    let under_it = Event::new(EventKind::Create(CreateKind::File))
        .add_path(under("src/target/debug/build.log"));
    let it = Event::new(EventKind::Create(CreateKind::Folder)).add_path(under("src/target"));
    let beside_it = Event::new(EventKind::Create(CreateKind::File)).add_path(under("src/main.rs"));

    assert_eq!(changes(&under_it, Path::new(HOME), &omitted), Vec::new());
    assert_eq!(changes(&it, Path::new(HOME), &omitted), Vec::new());
    assert_eq!(
        changes(&beside_it, Path::new(HOME), &omitted),
        vec![Change::Appeared("src/main.rs".to_string())]
    );
}

#[test]
fn something_outside_the_home_is_not_this_indexs_business() {
    // Should not arrive — the watch is on the home — but the index is spent as
    // paths under the home, so a path that is not one has no name to be
    // offered under and is dropped where it is read rather than somewhere
    // further in.
    let event =
        Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from("/etc/passwd"));

    assert_eq!(read(&event), Vec::new());
}

#[test]
fn the_home_directory_itself_is_not_a_row() {
    // It is the thing every row is named relative to, so it names itself as
    // the empty string — which is not a path a launcher can draw or open.
    let event = Event::new(EventKind::Create(CreateKind::Folder)).add_path(PathBuf::from(HOME));

    assert_eq!(read(&event), Vec::new());
}

/// What `event` does to an index of `HOME`.
fn read(event: &Event) -> Vec<Change> {
    changes(event, Path::new(HOME), &|_: &str| false)
}

/// A path in the home the tests read against.
fn under(path: &str) -> PathBuf {
    Path::new(HOME).join(path)
}
