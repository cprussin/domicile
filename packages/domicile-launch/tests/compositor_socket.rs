//! Tests for asking the compositor for a screenshot over its chrome socket.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::compositor_socket::{screenshot, ScreenshotError};

/// Reply timeout: long enough for a loaded machine, short enough for a fast
/// suite.
const BRIEFLY: Duration = Duration::from_millis(200);

#[test]
fn the_compositor_is_asked_for_the_whole_desk_in_the_file_and_says_it_saved_it() {
    let (_scratch, path) = scratch();
    let heard = a_compositor(
        &path,
        Some(
            "{\"type\":\"system_reply\",\"id\":1,\"reply\":{\"kind\":\"saved\",\
             \"path\":\"/home/me/shot.png\"}}\n",
        ),
    );

    screenshot(&path, Path::new("/home/me/shot.png"), BRIEFLY).expect("the compositor saved it");

    assert_eq!(
        heard.join().expect("the compositor was listening"),
        "{\"type\":\"system_request\",\"id\":1,\"request\":{\"call\":\"screenshot\",\
         \"file\":\"/home/me/shot.png\"}}\n"
    );
}

#[test]
fn a_compositor_that_could_not_save_it_is_carried_back_in_its_own_words() {
    let (_scratch, path) = scratch();
    let heard = a_compositor(
        &path,
        Some(
            "{\"type\":\"system_reply\",\"id\":1,\"reply\":{\"kind\":\"failed\",\
             \"error\":{\"kind\":\"locked\",\"message\":\"the desktop is locked\"}}}\n",
        ),
    );

    let why = screenshot(&path, Path::new("/home/me/shot.png"), BRIEFLY)
        .expect_err("the compositor refused");

    assert_eq!(
        why,
        ScreenshotError::Refused {
            why: "the desktop is locked".to_string()
        }
    );
    heard.join().expect("the compositor was listening");
}

#[test]
fn a_compositor_that_is_not_there_is_said_rather_than_waited_for() {
    let (_scratch, path) = scratch();

    let why = screenshot(&path, Path::new("/home/me/shot.png"), BRIEFLY)
        .expect_err("nothing is bound there");

    assert_eq!(
        why,
        ScreenshotError::NoCompositor {
            path: path.display().to_string()
        }
    );
}

#[test]
fn a_compositor_that_says_nothing_did_not_save_it() {
    let (_scratch, path) = scratch();
    let heard = a_compositor(&path, None);

    let why = screenshot(&path, Path::new("/home/me/shot.png"), BRIEFLY)
        .expect_err("the compositor never answered");

    assert_eq!(
        why,
        ScreenshotError::NoAnswer {
            path: path.display().to_string()
        }
    );
    heard.join().expect("the compositor was listening");
}

#[test]
fn an_answer_that_is_not_a_reply_is_unreadable() {
    let (_scratch, path) = scratch();
    let heard = a_compositor(&path, Some("{\"type\":\"welcome\"}\n"));

    let why = screenshot(&path, Path::new("/home/me/shot.png"), BRIEFLY).expect_err("not a reply");

    assert_eq!(
        why,
        ScreenshotError::Unreadable {
            path: path.display().to_string(),
            said: "{\"type\":\"welcome\"}".to_string(),
        }
    );
    heard.join().expect("the compositor was listening");
}

/// A fake compositor at `path` that reads one line and replies `with`, or
/// hangs up if `with` is `None`.
fn a_compositor(path: &Path, with: Option<&'static str>) -> std::thread::JoinHandle<String> {
    let listener = UnixListener::bind(path).expect("the compositor binds its chrome socket");
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("a supervisor dialed");
        let mut line = String::new();
        BufReader::new(stream.try_clone().expect("the connection is readable"))
            .read_line(&mut line)
            .expect("the supervisor wrote a line");
        if let Some(answer) = with {
            let mut answering = stream;
            answering
                .write_all(answer.as_bytes())
                .expect("the compositor answers");
        }
        line
    })
}

/// A temporary directory and an unused socket path in it.
fn scratch() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("a temp directory");
    let path = directory.path().join("chrome.sock");
    (directory, path)
}
