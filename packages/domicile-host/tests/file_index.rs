//! The launcher's file index and how it changes.
//!
//! The launcher reads the index while the walk is still writing it, so these
//! tests cover partial and changing indexes.

use domicile_host::file_index::FileIndex;

#[test]
fn a_fresh_index_offers_what_the_last_run_wrote_down_and_says_it_is_building() {
    // The index is saved to disk because a full walk takes seconds. Last
    // boot's list lets the launcher show results right away.
    let index = FileIndex::building(["Notes/today.org".to_string(), "src".to_string()]);

    assert_eq!(
        index.files(),
        vec!["Notes/today.org".to_string(), "src".to_string()]
    );
    assert!(index.indexing());
}

#[test]
fn what_the_walk_finds_is_offered_before_the_walk_is_over() {
    let mut index = FileIndex::building([]);

    index.found(["src".to_string()]);

    assert_eq!(index.files(), vec!["src".to_string()]);
    assert!(index.indexing());
}

#[test]
fn the_walk_ending_drops_what_it_did_not_find_and_stops_saying_it_is_building() {
    // Mark and sweep: a seeded path the walk does not find was deleted while
    // the desktop was off, so it is removed.
    let mut index = FileIndex::building(["gone.txt".to_string(), "still-here".to_string()]);

    index.found(["still-here".to_string()]);
    index.built();

    assert_eq!(index.files(), vec!["still-here".to_string()]);
    assert!(!index.indexing());
}

#[test]
fn a_file_that_appeared_during_the_walk_survives_the_walk_ending() {
    // The sweep covers only the seed, not the whole index. A file created
    // during the boot walk, behind where the walk has reached, must survive.
    let mut index = FileIndex::building([]);

    index.appeared("just-written.txt".to_string());
    index.built();

    assert_eq!(index.files(), vec!["just-written.txt".to_string()]);
}

#[test]
fn a_directory_that_vanished_takes_everything_under_it() {
    // Deleting a tree reports only its root, so everything under it must go
    // too.
    let mut index = FileIndex::building([
        "Notes".to_string(),
        "Notes/2026".to_string(),
        "Notes/2026/plan.org".to_string(),
        "Notes-elsewhere.txt".to_string(),
    ]);

    index.vanished("Notes");

    // Only paths under it: `Notes-elsewhere.txt` shares the prefix but is not
    // inside.
    assert_eq!(index.files(), vec!["Notes-elsewhere.txt".to_string()]);
}

#[test]
fn the_same_path_found_twice_is_offered_once() {
    // The watcher and the walk can both report a path. The index is a set, so
    // a duplicate is not an error.
    let mut index = FileIndex::building([]);

    index.found(["src".to_string()]);
    index.appeared("src".to_string());

    assert_eq!(index.files(), vec!["src".to_string()]);
}

#[test]
fn the_index_is_offered_in_byte_order_however_it_was_filled() {
    // Byte order, not locale collation, so the list is the same on every
    // machine. The walk finds shallow paths first, so arrival order is not
    // display order.
    let mut index = FileIndex::building([]);

    index.found(["src".to_string(), "Notes".to_string()]);
    index.appeared("Archive".to_string());

    assert_eq!(
        index.files(),
        vec![
            "Archive".to_string(),
            "Notes".to_string(),
            "src".to_string()
        ]
    );
}

#[test]
fn nothing_is_worth_saying_until_something_has_changed() {
    // Returns whether to broadcast. Most events change nothing the launcher
    // shows, and each broadcast sends the whole list to every chrome.
    let mut index = FileIndex::building(["src".to_string()]);
    assert!(index.changed(), "a fresh index has its whole list to say");

    assert!(!index.changed());

    index.appeared("src".to_string());
    assert!(!index.changed(), "a path already in the index is not news");

    index.vanished("nothing-by-that-name");
    assert!(!index.changed(), "removing what was not there is not news");

    index.appeared("todo.txt".to_string());
    assert!(index.changed());
}

#[test]
fn the_walk_ending_is_news_even_when_it_found_nothing_new() {
    // `indexing` is sent to the chromes, so finishing the walk is a change.
    // Otherwise the launcher would keep showing "still building".
    let mut index = FileIndex::building(["src".to_string()]);
    index.found(["src".to_string()]);
    assert!(index.changed());

    index.built();

    assert!(index.changed());
}

#[test]
fn an_index_that_lost_events_can_be_put_back_to_building() {
    // When the kernel's watch queue overflows (for example during a
    // `git clone`), `notify` flags a rescan. The lost events are unknown, so
    // the home is walked again and the list is marked incomplete.
    //
    // Nothing is dropped meanwhile: the current index is still the best
    // answer.
    let mut index = FileIndex::building([]);
    index.found(["src".to_string()]);
    index.built();
    index.changed();

    index.rebuilding();

    assert!(index.indexing());
    assert!(index.changed());
    assert_eq!(index.files(), vec!["src".to_string()]);

    // The second walk sweeps against the current index, not the original
    // seed, so files deleted since are removed.
    index.found(["Notes".to_string()]);
    index.built();
    assert_eq!(index.files(), vec!["Notes".to_string()]);
}
