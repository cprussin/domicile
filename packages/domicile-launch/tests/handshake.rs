//! Messages the compositor logs when no page completes the control socket
//! handshake.

use std::path::Path;
use std::time::Duration;

use domicile_launch::handshake::{silence, Expected, Handshake, Heard};

fn after() -> Duration {
    Duration::from_secs(30)
}

fn socket() -> &'static Path {
    Path::new("/run/user/1000/domicile-7/chrome.sock")
}

#[test]
fn a_page_that_agreed_the_protocol_is_not_worth_a_word() {
    assert_eq!(
        silence(Expected::APage, Heard::APage, socket(), after()),
        None
    );
}

#[test]
fn a_socket_nothing_ever_dialed_says_so_and_names_itself() {
    let said = silence(Expected::APage, Heard::Nothing, socket(), after())
        .expect("there is nothing to draw with");

    assert_eq!(
        said,
        "nothing has connected to the control socket at \
         /run/user/1000/domicile-7/chrome.sock after 30s. The desktop is drawn \
         by a page in the engine, and no page has reached this compositor: \
         either the engine never loaded the shell, or it was not told where \
         this socket is. The engine's own output says which; check that it was \
         started with --domicile-control-socket=/run/user/1000/domicile-7/chrome.sock."
    );
}

#[test]
fn a_connection_that_never_spoke_is_a_different_sentence() {
    // Something connected, so the engine found the socket and the shell
    // started. Only the `hello` is missing.
    let said = silence(Expected::APage, Heard::AConnection, socket(), after())
        .expect("no page agreed anything");

    assert_eq!(
        said,
        "something connected to the control socket at \
         /run/user/1000/domicile-7/chrome.sock but no page has agreed the \
         protocol after 30s. A page says `hello` naming a protocol version as \
         soon as it starts; a version this compositor refuses is logged above."
    );
}

/// Engine spike harnesses run a compositor with no shell, so nothing dials the
/// control socket. A message there would be noise.
#[test]
fn a_socket_no_page_was_ever_going_to_dial_is_not_worth_a_word() {
    assert_eq!(
        silence(Expected::NoPage, Heard::Nothing, socket(), after()),
        None
    );
}

/// With no page expected, a connection is not worth reporting either.
#[test]
fn a_connection_on_a_socket_no_page_was_due_on_is_not_either() {
    assert_eq!(
        silence(Expected::NoPage, Heard::AConnection, socket(), after()),
        None
    );
}

#[test]
fn a_socket_nobody_has_dialed_has_heard_nothing() {
    assert_eq!(Handshake::new().heard(), Heard::Nothing);
}

#[test]
fn a_dial_on_its_own_is_a_connection() {
    let handshake = Handshake::new();
    handshake.connected();

    assert_eq!(handshake.heard(), Heard::AConnection);
}

#[test]
fn a_page_that_agreed_outranks_the_connections_that_did_not() {
    // Two chrome processes are supported. One that connects and hangs up must
    // not cause a warning when the other agreed.
    let handshake = Handshake::new();
    handshake.connected();
    handshake.connected();
    handshake.agreed();

    assert_eq!(handshake.heard(), Heard::APage);
}
