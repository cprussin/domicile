//! How a filesystem event changes the file index.
//!
//! Most events in a home directory, such as writes and reads, do not change
//! which files exist, so they produce no change. The watcher itself is in
//! [`domicile_host::home_watch`].

use std::path::{Path, PathBuf};

use domicile_host::file_changes::{changes, Change};
use notify::event::{CreateKind, EventKind, ModifyKind, RemoveKind, RenameMode};
use notify::Event;

/// The home directory every event below is read against.
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
    // `notify` orders a rename's paths `MOVED_FROM` then `MOVED_TO`. The
    // reverse order would drop a file renamed over itself.
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
    // A move out of the home has no `MOVED_TO`, but the removal is all the
    // index needs.
    let from = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
        .add_path(under("draft.org"));
    let to = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
        .add_path(under("arrived.org"));

    assert_eq!(read(&from), vec![Change::Vanished("draft.org".to_string())]);
    assert_eq!(read(&to), vec![Change::Appeared("arrived.org".to_string())]);
}

#[test]
fn a_write_into_a_file_that_already_exists_changes_nothing() {
    // Most events are modifications. An editor's save is a burst of them, and
    // none changes the file list, so none triggers a broadcast.
    let event = Event::new(EventKind::Modify(ModifyKind::Data(
        notify::event::DataChange::Content,
    )))
    .add_path(under("Notes/today.org"));

    assert_eq!(read(&event), Vec::new());
}

#[test]
fn a_rename_the_kernel_could_not_pair_is_left_alone() {
    // `Any` does not say whether the name arrived or left, so neither change
    // is safe.
    let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Any)))
        .add_path(under("draft.org"));

    assert_eq!(read(&event), Vec::new());
}

#[test]
fn an_omitted_path_is_not_offered_however_deep_under_it() {
    // The walk's omit rule also applies to events, or a `cargo build` would
    // add thousands of `target/` paths the next walk drops. Every ancestor is
    // checked, because the watch sees paths under omitted directories.
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
    // The watch is on the home, so this should not arrive. Index paths are
    // relative to the home, so an outside path is dropped here.
    let event =
        Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from("/etc/passwd"));

    assert_eq!(read(&event), Vec::new());
}

#[test]
fn the_home_directory_itself_is_not_a_row() {
    // It would be the empty relative path, which a launcher cannot draw or
    // open.
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
