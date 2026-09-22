//! What a running desktop can be asked, and what it answers.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use domicile_launch::control::{answer, parse_response, LoadShell, Response};

#[test]
fn a_desktop_says_which_shell_it_is_running() {
    // The line spelled out rather than encoded from `Request::WhichShell`,
    // which would be the same `serde` deriving both halves of its own
    // agreement. What a client puts on the wire is a fact about the wire.
    assert_eq!(
        answered(
            "{\"type\":\"which_shell\"}",
            Path::new("/desktops/mine/shell.js"),
            &|_, _| panic!("a question is answered where it lands, not dialed on"),
        ),
        Response::Shell {
            module: PathBuf::from("/desktops/mine/shell.js")
        }
    );
}

#[test]
fn a_desktop_told_to_load_a_shell_tells_the_engine_and_says_what_it_serves() {
    // THE SUPERVISOR ROUTES THIS ONE RATHER THAN ANSWERING IT. Which shell is
    // served is the engine's, so the dial is what carries the command out —
    // injected here, because a test that had to start an engine would not be
    // a test of this line.
    let told = Cell::new(None);
    let answered = answered(
        "{\"type\":\"load_shell\",\"root\":\"/desktops/other\",\"module\":\"shell.js\"}",
        Path::new("/desktops/mine/shell.js"),
        &|root, module| {
            told.set(Some((root.to_path_buf(), module.to_path_buf())));
            Ok(())
        },
    );

    assert_eq!(
        told.take(),
        Some((PathBuf::from("/desktops/other"), PathBuf::from("shell.js")))
    );
    // The shell it is serving now, which is what `which-shell` answers with:
    // one question, one answer, whether it was asked or brought about.
    assert_eq!(
        answered,
        Response::Shell {
            module: PathBuf::from("/desktops/other/shell.js")
        }
    );
}

#[test]
fn an_engine_that_refused_the_shell_is_quoted_to_whoever_typed_the_command() {
    // The engine's own sentence, unedited. It is the half that knows why —
    // a version it does not speak, no window to load a shell into — and the
    // person who typed the command is in another terminal entirely, where the
    // engine's log is not.
    let Response::Refused { why } = answered(
        "{\"type\":\"load_shell\",\"root\":\"/desktops/other\",\"module\":\"shell.js\"}",
        Path::new("/desktops/mine/shell.js"),
        &|_, _| Err("this engine has no shell window to load a shell into".to_string()),
    ) else {
        panic!("an engine that refused the shell is not a desktop that loaded it");
    };
    assert!(
        why.contains("no shell window"),
        "the refusal did not carry the engine's own words: {why}"
    );
}

#[test]
fn a_line_that_is_not_a_request_is_refused_and_quoted_back() {
    // Whoever is on the other end of this socket said something, and a refusal
    // that does not say what was refused leaves them with a desktop that
    // answered "no" to a question they cannot see.
    let Response::Refused { why } =
        answered("{\"type\":\"reboot\"}", Path::new("/shell.js"), &|_, _| {
            panic!("a line that is not a request reaches no engine")
        })
    else {
        panic!("a request this desktop has never heard of is not a request");
    };
    assert!(
        why.contains("reboot"),
        "the refusal did not quote the line: {why}"
    );
}

/// One line in, one line out — which is the whole of a connection.
fn answered(line: &str, module: &Path, load: LoadShell) -> Response {
    parse_response(answer(line, module, load).trim()).expect("a desktop answers with a response")
}
