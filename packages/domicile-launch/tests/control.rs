//! What a running desktop can be asked, and what it answers.

use std::path::{Path, PathBuf};

use domicile_launch::control::{answer, parse_response, Response};

#[test]
fn a_desktop_says_which_shell_it_is_running() {
    // The line spelled out rather than encoded from `Request::WhichShell`,
    // which would be the same `serde` deriving both halves of its own
    // agreement. What a client puts on the wire is a fact about the wire.
    assert_eq!(
        answered(
            "{\"type\":\"which_shell\"}",
            Path::new("/desktops/mine/shell.js")
        ),
        Response::Shell {
            module: PathBuf::from("/desktops/mine/shell.js")
        }
    );
}

#[test]
fn a_line_that_is_not_a_request_is_refused_and_quoted_back() {
    // Whoever is on the other end of this socket said something, and a refusal
    // that does not say what was refused leaves them with a desktop that
    // answered "no" to a question they cannot see.
    let Response::Refused { why } = answered("{\"type\":\"reboot\"}", Path::new("/shell.js"))
    else {
        panic!("a request this desktop has never heard of is not a request");
    };
    assert!(
        why.contains("reboot"),
        "the refusal did not quote the line: {why}"
    );
}

/// One line in, one line out — which is the whole of a connection.
fn answered(line: &str, module: &Path) -> Response {
    parse_response(answer(line, module).trim()).expect("a desktop answers with a response")
}
