//! Carrying one command to the engine, over the socket it binds.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::command::load_shell_line;
use domicile_launch::command_socket::{load_shell, LoadError};

/// Long enough that a loaded machine does not report an engine that answered
/// as one that did not, short enough that a test waiting it out is not why the
/// suite is slow.
const BRIEFLY: Duration = Duration::from_millis(200);

#[test]
fn the_engine_is_sent_the_shell_and_says_it_is_serving_it() {
    let (_scratch, path) = scratch();
    let heard = an_engine(&path, Some("{\"type\":\"loaded\"}\n"));

    load_shell(
        &path,
        Path::new("/desktops/other"),
        Path::new("shell.js"),
        BRIEFLY,
    )
    .expect("the engine loaded it");

    // The bytes, against the same line `command.rs` says they are: this is the
    // half of that contract that goes on a socket, and a request that never
    // reached the engine intact is one the engine refuses in words nobody here
    // wrote.
    assert_eq!(
        heard.join().expect("the engine was listening"),
        load_shell_line(Path::new("/desktops/other"), Path::new("shell.js"))
    );
}

#[test]
fn an_engine_that_refused_is_carried_back_in_its_own_words() {
    let (_scratch, path) = scratch();
    let heard = an_engine(
        &path,
        Some("{\"type\":\"refused\",\"why\":\"no shell window to load a shell into\"}\n"),
    );

    let why = load_shell(
        &path,
        Path::new("/desktops/other"),
        Path::new("shell.js"),
        BRIEFLY,
    )
    .expect_err("the engine refused it");

    assert_eq!(
        why,
        LoadError::Refused {
            why: "no shell window to load a shell into".to_string()
        }
    );
    assert!(
        why.to_string().contains("no shell window"),
        "the sentence a person reads dropped the engine's own: {why}"
    );
    heard.join().expect("the engine was listening");
}

#[test]
fn an_engine_that_is_not_there_is_said_rather_than_waited_for() {
    // A desktop whose engine has died is a desktop the supervisor is about to
    // replace, and a `load-shell` that arrives in that second has nowhere to
    // go. Named rather than hung on: the person is at a terminal.
    let (_scratch, path) = scratch();

    let why = load_shell(
        &path,
        Path::new("/desktops/other"),
        Path::new("shell.js"),
        BRIEFLY,
    )
    .expect_err("nothing is bound there");

    assert_eq!(
        why,
        LoadError::NoEngine {
            path: path.display().to_string()
        }
    );
}

#[test]
fn an_engine_that_takes_the_command_and_says_nothing_is_not_a_shell_that_loaded() {
    // Silence is the answer that could be read as either, so it is read as
    // neither: a desktop that went on serving the old shell while the terminal
    // said the new one had loaded is the one outcome this command must not
    // have.
    let (_scratch, path) = scratch();
    let heard = an_engine(&path, None);

    let why = load_shell(
        &path,
        Path::new("/desktops/other"),
        Path::new("shell.js"),
        BRIEFLY,
    )
    .expect_err("the engine never answered");

    assert_eq!(
        why,
        LoadError::NoAnswer {
            path: path.display().to_string()
        }
    );
    heard.join().expect("the engine was listening");
}

/// An engine bound at `path` that reads one line and answers `with`, or hangs
/// up without answering where there is nothing to answer with.
///
/// The real one is a Chromium browser process; what it is here is the socket's
/// two ends, which is all this module has any part in.
fn an_engine(path: &Path, with: Option<&'static str>) -> std::thread::JoinHandle<String> {
    let listener = UnixListener::bind(path).expect("the engine binds its command socket");
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
                .expect("the engine answers");
        }
        line
    })
}

/// A directory of this test's own, and a socket path in it that nothing has
/// taken.
fn scratch() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("a temp directory");
    let path = directory.path().join("command.sock");
    (directory, path)
}
