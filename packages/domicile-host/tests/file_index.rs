//! What the launcher is offered, and how it changes under one.
//!
//! The index is read while it is being written — a launcher opened three
//! seconds into a boot draws whatever has been found so far — so every test
//! here is about a half-built or a moved-under index rather than a finished
//! one. A finished index is a sorted list of strings and needs no test.

use domicile_host::file_index::FileIndex;

#[test]
fn a_fresh_index_offers_what_the_last_run_wrote_down_and_says_it_is_building() {
    // THE WHOLE POINT OF KEEPING THE INDEX ON DISK. A walk of a real home
    // takes seconds, and a desktop that opened its launcher onto nothing for
    // the first few of them is a desktop whose launcher is worse than the
    // terminal it replaces. Last boot's answer is wrong in the small ways a
    // week changes a home, and right about everything else.
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
    // Mark and sweep, because the seed is a year-old list of a home that has
    // moved on: a file deleted while the desktop was off is in the index and
    // in no walk, and an index that only ever grew would go on offering it
    // until someone noticed. The walk is the truth as of its run, so what it
    // did not find is what is no longer there.
    let mut index = FileIndex::building(["gone.txt".to_string(), "still-here".to_string()]);

    index.found(["still-here".to_string()]);
    index.built();

    assert_eq!(index.files(), vec!["still-here".to_string()]);
    assert!(!index.indexing());
}

#[test]
fn a_file_that_appeared_during_the_walk_survives_the_walk_ending() {
    // The sweep above is over the *seed* and not over the index, which is the
    // difference between a walk that replaces what it found and one that
    // reconciles it. A file created in a terminal while the boot walk is still
    // running was never in last run's list and may be behind where the walk
    // has reached, so a replace would drop it — and nothing would put it back
    // until the next boot.
    let mut index = FileIndex::building([]);

    index.appeared("just-written.txt".to_string());
    index.built();

    assert_eq!(index.files(), vec!["just-written.txt".to_string()]);
}

#[test]
fn a_directory_that_vanished_takes_everything_under_it() {
    // One event for a `rm -r`, which is all the kernel gives: watching a tree
    // reports the directory going and not each of the thousand paths that went
    // with it. An index that removed only the named path would go on offering
    // every file that used to be in it.
    let mut index = FileIndex::building([
        "Notes".to_string(),
        "Notes/2026".to_string(),
        "Notes/2026/plan.org".to_string(),
        "Notes-elsewhere.txt".to_string(),
    ]);

    index.vanished("Notes");

    // And only what was under it: `Notes-elsewhere.txt` starts with the same
    // letters and is not in that directory, which a prefix match alone would
    // get wrong.
    assert_eq!(index.files(), vec!["Notes-elsewhere.txt".to_string()]);
}

#[test]
fn the_same_path_found_twice_is_offered_once() {
    // A watcher can report a path the walk is about to reach, and a rename
    // into a directory the walk has not visited yet arrives as both. Neither
    // is an error worth reporting — what a launcher wants is a set.
    let mut index = FileIndex::building([]);

    index.found(["src".to_string()]);
    index.appeared("src".to_string());

    assert_eq!(index.files(), vec!["src".to_string()]);
}

#[test]
fn the_index_is_offered_in_byte_order_however_it_was_filled() {
    // Byte order rather than the user's collation: the same home has to
    // produce the same list on every machine, and `LC_COLLATE` is not a thing
    // a desktop should be able to reorder a launcher with. The walk finds
    // shallow paths first, so nothing about the order things arrive in is the
    // order they go on screen.
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
    // What this answers is "is there a broadcast to make": the index is told
    // about every filesystem event under a home, and most of them — a write
    // into a file that already exists, a path that was already known — change
    // nothing a launcher draws. Sending the whole list to every chrome for one
    // of those is a megabyte of JSON saying what the page already had.
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
    // Because `indexing` is part of what the chromes are told, and it is the
    // half that just changed: a launcher showing "still building" over a
    // complete list would go on showing it until somebody saved a file.
    let mut index = FileIndex::building(["src".to_string()]);
    index.found(["src".to_string()]);
    assert!(index.changed());

    index.built();

    assert!(index.changed());
}

#[test]
fn an_index_that_lost_events_can_be_put_back_to_building() {
    // A kernel watch queue can overflow — a `git clone` into a watched home
    // out-runs it — and `notify` says so by flagging a rescan. What was lost
    // is unknowable, so the only honest answer is to walk the home again, and
    // the only honest thing to tell a launcher meanwhile is that the list it
    // has is not complete.
    //
    // Nothing is dropped here: what is in the index is still the best answer
    // there is, and a launcher blanked while a second walk runs would be a
    // desktop that punished the person for a burst of file writes.
    let mut index = FileIndex::building([]);
    index.found(["src".to_string()]);
    index.built();
    index.changed();

    index.rebuilding();

    assert!(index.indexing());
    assert!(index.changed());
    assert_eq!(index.files(), vec!["src".to_string()]);

    // And the second walk sweeps against what is in the index now rather than
    // against the seed the first one started from, so a file that has gone
    // since goes with it.
    index.found(["Notes".to_string()]);
    index.built();
    assert_eq!(index.files(), vec!["Notes".to_string()]);
}
