//! What the control socket heard, and what a compositor says when it heard
//! too little.

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
    // Worth telling apart from nothing at all: something dialed the socket, so
    // the engine knows where it is and the shell's document ran far enough to
    // ask for the channel. What did not happen is the `hello`.
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

/// The engine spike's harnesses run a compositor with no shell in front of it:
/// chrome is started on the broker socket and nothing can dial the control
/// one. A sentence about that is not a finding, it is the harness described
/// back to itself — and it was printed on every green run of
/// `guard-client-window.sh`.
#[test]
fn a_socket_no_page_was_ever_going_to_dial_is_not_worth_a_word() {
    assert_eq!(
        silence(Expected::NoPage, Heard::Nothing, socket(), after()),
        None
    );
}

/// And the flag is about what was EXPECTED rather than about what to print:
/// something dialing a socket nobody was meant to dial is still not this
/// compositor's complaint to make, because it has no page to be missing.
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
    // Two chromes is a supported shape, and one of them being a probe that
    // hangs up must not turn a desktop that came up into a complaint.
    let handshake = Handshake::new();
    handshake.connected();
    handshake.connected();
    handshake.agreed();

    assert_eq!(handshake.heard(), Heard::APage);
}
