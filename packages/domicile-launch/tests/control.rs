//! Tests for the control socket protocol.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use domicile_launch::control::{answer, parse_response, LoadShell, OpenUrl, Response};

#[test]
fn a_desktop_says_which_shell_it_is_running() {
    // Written out rather than serialized from `Request::WhichShell`, so the
    // test checks the wire format rather than `serde` against itself.
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
    // The supervisor forwards this to the engine. The dial is injected so no
    // engine is needed.
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
    // Replies with the new shell, as `which-shell` would.
    assert_eq!(
        answered,
        Response::Shell {
            module: PathBuf::from("/desktops/other/shell.js")
        }
    );
}

#[test]
fn an_engine_that_refused_the_shell_is_quoted_to_whoever_typed_the_command() {
    // Pass the engine's reason through verbatim; the user cannot see the
    // engine's log.
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
    // The refusal quotes the line so the client sees what was rejected.
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

#[test]
fn a_desktop_told_to_open_an_address_tells_the_engine() {
    // Forwarded to the engine, like `load_shell`.
    let told = Cell::new(None);
    let answered = answered_opening(
        "{\"type\":\"open_url\",\"url\":\"https://example.com/\"}",
        &|url| {
            told.set(Some(url.to_string()));
            Ok(())
        },
    );

    assert_eq!(told.take(), Some("https://example.com/".to_string()));
    assert_eq!(answered, Response::Opened);
}

#[test]
fn an_engine_that_would_not_open_the_address_is_quoted() {
    let Response::Refused { why } = answered_opening(
        "{\"type\":\"open_url\",\"url\":\"https://example.com/\"}",
        &|_| Err("this engine has no shell page to open it in".to_string()),
    ) else {
        panic!("an engine that refused the address is not one that opened it");
    };
    assert!(
        why.contains("no shell page"),
        "the refusal did not carry the engine's own words: {why}"
    );
}

/// Sends one request line and parses the one reply line.
fn answered(line: &str, module: &Path, load: LoadShell) -> Response {
    parse_response(
        answer(line, module, load, &|_| {
            panic!("only open_url opens anything")
        })
        .trim(),
    )
    .expect("a desktop answers with a response")
}

/// [`answered`], for `open_url`.
fn answered_opening(line: &str, open: OpenUrl) -> Response {
    parse_response(
        answer(
            line,
            Path::new("/shell.js"),
            &|_, _| panic!("only load_shell loads anything"),
            open,
        )
        .trim(),
    )
    .expect("a desktop answers with a response")
}
