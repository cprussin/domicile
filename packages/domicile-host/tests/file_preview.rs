//! What a launcher is shown of the row it has reached.

use std::fs;

use domicile_host::file_preview::preview;
use domicile_host::file_search::FileSearch;
use domicile_protocol::FilePreview;

/// How much of a file a preview is sent, as `file_preview` says.
const PREVIEW_BYTES: usize = 8 * 1024;

/// How many of a directory's entries a preview is sent.
const PREVIEW_ENTRIES: usize = 200;

/// A home holding `paths`, written to disk, and the index a walk would make of
/// it.
fn home(paths: &[&str]) -> (tempfile::TempDir, FileSearch) {
    let home = tempfile::tempdir().expect("a directory to write in");
    for path in paths {
        let at = home.path().join(path);
        fs::create_dir_all(at.parent().expect("a parent")).unwrap();
        fs::write(&at, format!("in {path}\n")).unwrap();
    }
    let mut indexed: Vec<String> = paths.iter().map(|path| path.to_string()).collect();
    indexed.extend(
        paths
            .iter()
            .filter_map(|path| path.rsplit_once('/').map(|(dir, _)| dir.to_string())),
    );
    indexed.sort();
    indexed.dedup();
    (home, FileSearch::new(indexed))
}

#[test]
fn a_text_file_is_shown_as_its_text() {
    let (dir, search) = home(&["Notes/today.org"]);

    assert_eq!(
        preview(dir.path(), "Notes/today.org", &search),
        FilePreview::Text {
            text: "in Notes/today.org\n".into()
        }
    );
}

#[test]
fn only_the_front_of_a_long_file_is_read() {
    // A preview is a pane, and a log of a gigabyte is not a thing to send it.
    let (dir, search) = home(&["long.txt"]);
    fs::write(dir.path().join("long.txt"), "a".repeat(PREVIEW_BYTES * 2)).unwrap();

    assert_eq!(
        preview(dir.path(), "long.txt", &search),
        FilePreview::Text {
            text: "a".repeat(PREVIEW_BYTES)
        }
    );
}

#[test]
fn a_character_cut_by_the_limit_is_left_out_rather_than_mangled() {
    let (dir, search) = home(&["long.txt"]);
    let text = format!("{}é", "a".repeat(PREVIEW_BYTES - 1));
    fs::write(dir.path().join("long.txt"), text).unwrap();

    assert_eq!(
        preview(dir.path(), "long.txt", &search),
        FilePreview::Text {
            text: "a".repeat(PREVIEW_BYTES - 1)
        }
    );
}

#[test]
fn a_file_that_is_not_text_says_so() {
    let (dir, search) = home(&["photo.jpg"]);
    fs::write(dir.path().join("photo.jpg"), [0xff, 0xd8, 0xff, 0x00, 0x10]).unwrap();

    assert_eq!(
        preview(dir.path(), "photo.jpg", &search),
        FilePreview::Binary
    );
}

#[test]
fn a_directory_is_shown_as_what_it_holds() {
    let (dir, search) = home(&["Notes/today.org", "Notes/2026/plan.org"]);

    assert_eq!(
        preview(dir.path(), "Notes", &search),
        FilePreview::Directory {
            entries: vec!["2026/".into(), "today.org".into()]
        }
    );
}

#[test]
fn only_the_front_of_a_big_directory_is_listed() {
    let names: Vec<String> = (0..PREVIEW_ENTRIES + 5)
        .map(|at| format!("big/{at:04}"))
        .collect();
    let (dir, search) = home(&names.iter().map(String::as_str).collect::<Vec<_>>());

    let FilePreview::Directory { entries } = preview(dir.path(), "big", &search) else {
        panic!("a directory");
    };
    assert_eq!(entries.len(), PREVIEW_ENTRIES);
    assert_eq!(entries[0], "0000");
}

#[test]
fn a_path_the_index_does_not_hold_is_not_read() {
    // THE SECURITY PROPERTY. A page names the path, so what keeps this from
    // being a `readdir` on the page is that the compositor answers only for a
    // path a search could already have named.
    let (dir, search) = home(&["Notes/today.org"]);
    fs::write(dir.path().join("secret"), "hidden").unwrap();

    assert_eq!(
        preview(dir.path(), "secret", &search),
        FilePreview::Unreadable
    );
    assert_eq!(
        preview(dir.path(), "../etc/passwd", &search),
        FilePreview::Unreadable
    );
}

#[test]
fn a_file_gone_since_the_walk_is_unreadable() {
    let (dir, search) = home(&["gone.txt"]);
    fs::remove_file(dir.path().join("gone.txt")).unwrap();

    assert_eq!(
        preview(dir.path(), "gone.txt", &search),
        FilePreview::Unreadable
    );
}
