//! The index on disk: what a desktop knows about a home before it has looked.
//!
//! **Every test here is about the file being wrong**, which is the whole
//! reason this module is not two calls to `fs`. It is a cache in a directory
//! anybody can write to, left behind by a process that can be killed halfway
//! through writing it, and read by the desktop before there is a desktop to
//! report anything to. A desktop that would not start because of it would be a
//! desktop a stray file could stop.

use std::fs;

use domicile_host::index_file::{read, write, IndexFileError};

#[test]
fn what_was_written_is_what_is_read_back() {
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("state").join("file-index");

    write(&path, &["Notes/today.org".to_string(), "src".to_string()]).expect("it writes");

    assert_eq!(
        read(&path).expect("it reads"),
        vec!["Notes/today.org".to_string(), "src".to_string()]
    );
}

#[test]
fn a_directory_nobody_has_made_yet_is_made_rather_than_a_failure() {
    // The first boot on a new machine, which is the ordinary case: the cache
    // directory is ours and nothing else puts it there. Asserted through
    // `write` succeeding above and named here so that the requirement is
    // written down rather than implied by a path with a `state/` in it.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("never").join("existed").join("file-index");

    write(&path, &[]).expect("it writes");

    assert!(path.exists());
}

#[test]
fn no_file_at_all_says_so_rather_than_saying_the_home_is_empty() {
    // The first boot, and the boot after somebody cleared their cache. It has
    // to be told apart from an index of nothing, because the compositor says a
    // different thing about each: one is "there was nothing written down", and
    // the other would be a desktop reporting a missing file as an error every
    // time a person has an empty home.
    let kept = tempfile::tempdir().expect("a directory to write in");

    let refused = read(&kept.path().join("file-index"));

    assert_eq!(refused, Err(IndexFileError::Missing));
}

#[test]
fn a_file_that_is_not_ours_is_refused_rather_than_read_as_paths() {
    // The header is what makes this answerable at all. Without it every file
    // in the world is a valid index — a log, half a JSON document, somebody
    // else's cache under a name we picked — and what the launcher would offer
    // is its lines.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(&path, "Notes/today.org\nsrc\n").expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn a_file_written_by_a_later_domicile_is_refused_rather_than_guessed_at() {
    // The version in the header, doing the one job a version does: a format
    // this build does not know is one it must not read as the format it does
    // know. The answer is a rebuild, which costs a boot walk and nothing else.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(&path, "domicile-file-index 2\nNotes/today.org\n").expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn a_path_that_is_not_under_home_takes_the_whole_file_down() {
    // Every path in here is spent as a path relative to the home directory —
    // the launcher hands the one a person picked back to the compositor to
    // open — so `/etc/shadow` and `../../etc/shadow` are not rows to drop
    // quietly. They are evidence that this file is not one we wrote, and the
    // answer to that is the same as for a file with no header: forget it and
    // walk the home.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(
        &path,
        "domicile-file-index 1\nNotes/today.org\n../../etc/shadow\n",
    )
    .expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn a_file_of_bytes_that_are_not_text_is_refused_rather_than_ending_the_boot() {
    // A half-written file from a desktop that was killed mid-write, or a
    // filename the kernel stored as bytes that somehow reached here. Neither
    // is a path a launcher can draw and neither is worth a panic in a process
    // that has the screen.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(&path, [b'd', b'o', b'm', 0xff, 0xfe]).expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn an_index_of_nothing_round_trips_as_an_index_of_nothing() {
    // A home with nothing in it is an answer, and it has to survive the disk:
    // an empty file read back as `Missing` would have the compositor rebuild
    // on every boot and log that it had never written one.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");

    write(&path, &[]).expect("it writes");

    assert_eq!(read(&path), Ok(Vec::new()));
}

#[test]
fn a_write_over_an_index_that_is_being_read_leaves_one_or_the_other() {
    // Written beside and renamed over, because a desktop can be killed in the
    // middle of this — and a rename is the one write a reader cannot catch
    // half of. What this asserts is the leftover: the temporary file is not
    // still sitting in the cache directory afterward, which is how you find
    // out the rename happened rather than a truncate-and-write.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");

    write(&path, &["src".to_string()]).expect("it writes once");
    write(&path, &["Notes".to_string()]).expect("it writes again");

    let left: Vec<String> = fs::read_dir(kept.path())
        .expect("the directory reads")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into()
        })
        .collect();
    assert_eq!(left, vec!["file-index".to_string()]);
    assert_eq!(read(&path), Ok(vec!["Notes".to_string()]));
}
