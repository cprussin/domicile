//! Tests for the on-disk file index cache.
//!
//! Most tests cover a bad file. The cache lives in a user-writable directory,
//! a killed process can leave it half written, and the compositor reads it at
//! startup, so a bad file must cause a rebuild, not a failed start.

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
    // On first boot the cache directory does not exist, and nothing else
    // creates it.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("never").join("existed").join("file-index");

    write(&path, &[]).expect("it writes");

    assert!(path.exists());
}

#[test]
fn no_file_at_all_says_so_rather_than_saying_the_home_is_empty() {
    // Happens on first boot or after the cache is cleared. The compositor
    // logs this differently from an empty index, so the two must differ.
    let kept = tempfile::tempdir().expect("a directory to write in");

    let refused = read(&kept.path().join("file-index"));

    assert_eq!(refused, Err(IndexFileError::Missing));
}

#[test]
fn a_file_that_is_not_ours_is_refused_rather_than_read_as_paths() {
    // Without the header check, any text file would parse as an index and
    // the launcher would offer its lines.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(&path, "Notes/today.org\nsrc\n").expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn a_file_written_by_a_later_domicile_is_refused_rather_than_guessed_at() {
    // An unknown format version is refused. The cost is a rebuild of the
    // index at boot.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(&path, "domicile-file-index 2\nNotes/today.org\n").expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn a_path_that_is_not_under_home_takes_the_whole_file_down() {
    // The compositor opens paths from the index relative to the home
    // directory. A path outside home means Domicile did not write this file,
    // so the whole file is refused and the home is walked again.
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
    // Non-UTF-8 bytes come from a corrupt file or a non-UTF-8 filename.
    // The launcher cannot show either, and the compositor must not panic.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");
    fs::write(&path, [b'd', b'o', b'm', 0xff, 0xfe]).expect("it writes");

    let refused = read(&path);

    assert_eq!(refused, Err(IndexFileError::Unrecognized));
}

#[test]
fn an_index_of_nothing_round_trips_as_an_index_of_nothing() {
    // Reading an empty index as `Missing` would cause a rebuild and a log
    // line on every boot.
    let kept = tempfile::tempdir().expect("a directory to write in");
    let path = kept.path().join("file-index");

    write(&path, &[]).expect("it writes");

    assert_eq!(read(&path), Ok(Vec::new()));
}

#[test]
fn a_write_over_an_index_that_is_being_read_leaves_one_or_the_other() {
    // `write` writes a temporary file and renames it over the index, so a
    // reader never sees a partial file. No temporary file left behind shows
    // the rename happened.
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
