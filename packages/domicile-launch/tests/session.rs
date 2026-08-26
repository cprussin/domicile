//! What the compositor publishes once it is up, and the shell that started it
//! reads back.

use std::collections::BTreeSet;
use std::path::Path;

use domicile_launch::session::{publish, PublishError, Session};

fn a_session() -> Session {
    Session {
        protocol: 17,
        chrome_socket: "/run/user/1000/domicile/chrome.sock".into(),
        wayland_display: "wayland-3".into(),
        chrome_wayland_display: "wayland-3-chrome".into(),
        composited: true,
    }
}

fn names_in(directory: &Path) -> BTreeSet<String> {
    std::fs::read_dir(directory)
        .expect("the directory is there")
        .map(|entry| {
            entry
                .expect("the entry is readable")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[test]
fn a_published_session_reads_back_as_it_was_written() {
    let directory = tempfile::tempdir().expect("a temp dir");
    let path = directory.path().join("session.json");

    publish(&a_session(), &path).expect("publishing works");

    let text = std::fs::read_to_string(&path).expect("the file is there");
    let read: Session = serde_json::from_str(&text).expect("it parses");
    assert_eq!(read, a_session());
}

/// The reader is a TypeScript program, so the *spelling* of every key is the
/// contract rather than an implementation detail of the Rust struct.
#[test]
fn the_keys_are_the_ones_the_shell_reads() {
    let directory = tempfile::tempdir().expect("a temp dir");
    let path = directory.path().join("session.json");

    publish(&a_session(), &path).expect("publishing works");

    let text = std::fs::read_to_string(&path).expect("the file is there");
    let document: serde_json::Value = serde_json::from_str(&text).expect("it parses");
    let keys: BTreeSet<&str> = document
        .as_object()
        .expect("the document is an object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        BTreeSet::from([
            "chrome_socket",
            "chrome_wayland_display",
            "composited",
            "protocol",
            "wayland_display",
        ])
    );
}

/// Published by rename, so a shell polling for the file never opens a half
/// written one — and the temp it was renamed from does not outlive the call.
#[test]
fn publishing_leaves_nothing_beside_the_session() {
    let directory = tempfile::tempdir().expect("a temp dir");
    let path = directory.path().join("session.json");

    publish(&a_session(), &path).expect("publishing works");

    assert_eq!(
        names_in(directory.path()),
        BTreeSet::from(["session.json".to_string()])
    );
}

/// A compositor restarted into the same session path replaces the document
/// rather than failing on a file its predecessor left behind.
#[test]
fn publishing_over_an_earlier_session_replaces_it() {
    let directory = tempfile::tempdir().expect("a temp dir");
    let path = directory.path().join("session.json");
    publish(&a_session(), &path).expect("the first publish works");

    let second = Session {
        wayland_display: "wayland-9".into(),
        ..a_session()
    };
    publish(&second, &path).expect("the second publish works");

    let text = std::fs::read_to_string(&path).expect("the file is there");
    let read: Session = serde_json::from_str(&text).expect("it parses");
    assert_eq!(read, second);
}

#[test]
fn publishing_somewhere_unwritable_says_where() {
    let directory = tempfile::tempdir().expect("a temp dir");
    let path = directory
        .path()
        .join("no-such-directory")
        .join("session.json");

    let err = publish(&a_session(), &path).expect_err("there is no such directory");

    assert_eq!(
        err,
        PublishError {
            path: path.display().to_string(),
            kind: std::io::ErrorKind::NotFound,
        }
    );
}

/// A path with no file name is not a place a document can be written, and the
/// crate that refuses an empty flag value must not answer this one for itself.
#[test]
fn publishing_to_a_path_that_names_no_file_is_refused() {
    let err = publish(&a_session(), Path::new("/")).expect_err("that is a directory");

    assert_eq!(
        err,
        PublishError {
            path: "/".to_string(),
            kind: std::io::ErrorKind::InvalidInput,
        }
    );
}

/// A failed rename must not leave the half-written document beside the place
/// it was going: a shell polling the directory would find a file named almost
/// right, and the next run would inherit it.
#[test]
fn a_publish_that_could_not_finish_leaves_nothing_behind() {
    let directory = tempfile::tempdir().expect("a temp dir");
    // A destination that cannot be renamed onto: a non-empty directory.
    let path = directory.path().join("occupied");
    std::fs::create_dir(&path).expect("the directory is made");
    std::fs::write(path.join("tenant"), "x").expect("something is in it");

    publish(&a_session(), &path).expect_err("a directory is in the way");

    assert_eq!(
        names_in(directory.path()),
        BTreeSet::from(["occupied".to_string()])
    );
}
