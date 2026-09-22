//! What the engine is told about the shell it serves, and what it answers.

use std::path::Path;

use domicile_launch::command::{load_shell_line, reply, Reply};

#[test]
fn a_load_shell_names_the_version_it_is_written_in() {
    // THE VERSION IS THE HALF OF THIS CONTRACT THE OTHER TWO DO NOT HAVE, and
    // it is in the request because there is nowhere else to put it: the
    // supervisor names this socket and the engine binds it, so there is no
    // path to version, and one connection is one request, so there is no
    // handshake to negotiate in. The line is spelled out rather than built
    // from the same `serde` the engine's `command_protocol.cc` does not
    // share — what goes on this wire is a fact about the wire.
    assert_eq!(
        load_shell_line(Path::new("/x/dist"), Path::new("shell.js")),
        "{\"type\":\"load_shell\",\"version\":1,\"root\":\"/x/dist\",\"module\":\"shell.js\"}\n"
    );
}

#[test]
fn an_engine_that_served_the_shell_says_so() {
    assert_eq!(reply("{\"type\":\"loaded\"}").unwrap(), Reply::Loaded);
}

#[test]
fn an_engine_that_refused_says_why() {
    // The sentence is the engine's whole account of itself here: a version it
    // does not speak, a root that is not absolute, no window to load a shell
    // into. Kept rather than summarized, because every one of those is a
    // different thing to go and do.
    assert_eq!(
        reply("{\"type\":\"refused\",\"why\":\"this engine speaks version 1\"}").unwrap(),
        Reply::Refused {
            why: "this engine speaks version 1".to_string()
        }
    );
}

#[test]
fn an_answer_that_is_not_one_is_not_read_as_a_refusal() {
    // An engine from a release that predates this protocol answers nothing a
    // parser here recognizes, and reading that as a refusal would put words in
    // its mouth: the two are different things to say to whoever typed the
    // command.
    assert!(reply("{\"type\":\"loading\"}").is_err());
}
