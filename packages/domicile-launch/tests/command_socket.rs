//! Tests for sending commands over the engine command socket.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::command::{load_shell_line, open_url_line, screenshot_line};
use domicile_launch::command_socket::{load_shell, open_url, screenshot, CommandError};

/// Reply timeout: long enough for a loaded machine, short enough for a fast
/// suite.
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

    // The bytes on the socket match the line `command.rs` checks.
    assert_eq!(
        heard.join().expect("the engine was listening"),
        load_shell_line(Path::new("/desktops/other"), Path::new("shell.js"))
    );
}

#[test]
fn the_engine_is_sent_the_address_and_says_it_opened_it() {
    let (_scratch, path) = scratch();
    let heard = an_engine(&path, Some("{\"type\":\"opened\"}\n"));

    open_url(&path, "https://example.com/", BRIEFLY).expect("the engine opened it");

    assert_eq!(
        heard.join().expect("the engine was listening"),
        open_url_line("https://example.com/")
    );
}

#[test]
fn the_engine_is_sent_the_path_and_says_it_wrote_the_screenshot() {
    let (_scratch, path) = scratch();
    let heard = an_engine(&path, Some("{\"type\":\"captured\"}\n"));

    screenshot(&path, Path::new("/home/me/shot.png"), BRIEFLY).expect("the engine wrote it");

    assert_eq!(
        heard.join().expect("the engine was listening"),
        screenshot_line(Path::new("/home/me/shot.png"))
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
        CommandError::Refused {
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
    // This happens while the supervisor replaces a dead engine. Fail fast
    // rather than hang the user's terminal.
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
        CommandError::NoEngine {
            path: path.display().to_string()
        }
    );
}

#[test]
fn an_engine_that_takes_the_command_and_says_nothing_is_not_a_shell_that_loaded() {
    // No reply is an error, so the terminal never reports a load that did
    // not happen.
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
        CommandError::NoAnswer {
            path: path.display().to_string()
        }
    );
    heard.join().expect("the engine was listening");
}

/// A fake engine at `path` that reads one line and replies `with`, or hangs up
/// if `with` is `None`.
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

/// A temporary directory and an unused socket path in it.
fn scratch() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("a temp directory");
    let path = directory.path().join("command.sock");
    (directory, path)
}
