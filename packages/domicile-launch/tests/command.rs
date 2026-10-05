//! Tests for the engine command socket protocol.

use std::path::Path;

use domicile_launch::command::{load_shell_line, open_url_line, reply, screenshot_line, Reply};

#[test]
fn a_load_shell_names_the_version_it_is_written_in() {
    // Each request carries the version, since there is no handshake. The
    // expected line is written out because the engine's `command_protocol.cc`
    // does not share this crate's serializer.
    assert_eq!(
        load_shell_line(Path::new("/x/dist"), Path::new("shell.js")),
        "{\"type\":\"load_shell\",\"version\":1,\"root\":\"/x/dist\",\"module\":\"shell.js\"}\n"
    );
}

#[test]
fn an_open_url_names_the_version_it_is_written_in() {
    assert_eq!(
        open_url_line("https://example.com/?q=\"x\""),
        "{\"type\":\"open_url\",\"version\":1,\"url\":\"https://example.com/?q=\\\"x\\\"\"}\n"
    );
}

#[test]
fn a_screenshot_names_the_version_it_is_written_in() {
    assert_eq!(
        screenshot_line(Path::new("/home/me/shot.png")),
        "{\"type\":\"screenshot\",\"version\":1,\"file\":\"/home/me/shot.png\"}\n"
    );
}

#[test]
fn an_engine_that_wrote_the_screenshot_says_so() {
    assert_eq!(reply("{\"type\":\"captured\"}").unwrap(), Reply::Captured);
}

#[test]
fn an_engine_that_opened_the_address_says_so() {
    assert_eq!(reply("{\"type\":\"opened\"}").unwrap(), Reply::Opened);
}

#[test]
fn an_engine_that_served_the_shell_says_so() {
    assert_eq!(reply("{\"type\":\"loaded\"}").unwrap(), Reply::Loaded);
}

#[test]
fn an_engine_that_refused_says_why() {
    // Keep the engine's reason verbatim; each cause needs a different fix.
    assert_eq!(
        reply("{\"type\":\"refused\",\"why\":\"this engine speaks version 1\"}").unwrap(),
        Reply::Refused {
            why: "this engine speaks version 1".to_string()
        }
    );
}

#[test]
fn an_answer_that_is_not_one_is_not_read_as_a_refusal() {
    // An unknown reply, such as from an older engine, is an error, not a
    // refusal.
    assert!(reply("{\"type\":\"loading\"}").is_err());
}
