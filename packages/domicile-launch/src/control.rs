//! What a running desktop can be asked, and what it answers.
//!
//! `domicile <shell>` runs a desktop; `domicile <command>` sends one a
//! command. This is the wire between those two readings of the same binary:
//! one JSON object per line, a request in and a response out, and the
//! connection is over.
//!
//! Newline-delimited JSON because that is already the framing in this system
//! — the compositor serves the host protocol in it and the engine speaks it
//! back — and a second framing would be a second thing to get right for no
//! gain. It is a different *contract* from that one all the same: this socket
//! carries what a desktop is, and that one carries what is happening on it.
//!
//! THE LINE COMES OFF A SOCKET, so nothing here trusts it. A request is
//! parsed, and anything that is not one is refused out loud rather than
//! guessed at — see [`answer`], which is the whole of what a connection does.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Something a running desktop can be asked.
///
/// A closed set, and the CLI's verbs are its other spelling: adding one here
/// is adding one there, in the same change, because a verb nothing answers is
/// a refusal with extra steps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    /// Which shell is this desktop running?
    WhichShell,
}

/// What it answered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    /// The module the running desktop was started on, absolute — the desktop's
    /// working directory is not the asker's, and a relative answer would name
    /// a different file depending on where it was read.
    Shell { module: PathBuf },

    /// The request was not one this desktop knows.
    ///
    /// Which covers a `domicile` from another build as much as a hand-written
    /// line: the desktop and the client that talks to it are the same program
    /// installed twice, and the one on `PATH` can be newer than the one that
    /// is running. There is no version number to catch that with — the refusal
    /// is the version check, and it names the request nobody understood.
    Refused { why: String },
}

/// Encode a message as a single newline-terminated JSON line.
pub fn to_line<T: Serialize>(message: &T) -> String {
    let mut line = serde_json::to_string(message).expect("control messages always serialize");
    line.push('\n');
    line
}

/// Parse one response from a line (without the trailing newline).
pub fn parse_response(line: &str) -> Result<Response, serde_json::Error> {
    serde_json::from_str(line)
}

/// Answer one line from the socket, given the shell this desktop is running.
///
/// The whole of a connection, and pure: a line of somebody else's bytes in, a
/// line of ours out. What it takes to get those bytes on and off a socket is
/// [`crate::control_socket`]'s, and is the part that cannot be tested with a
/// string.
pub fn answer(line: &str, module: &Path) -> String {
    match parse_request(line.trim()) {
        Ok(Request::WhichShell) => to_line(&Response::Shell {
            module: module.to_path_buf(),
        }),
        Err(why) => to_line(&Response::Refused {
            why: format!(
                "'{}' is not a request this desktop knows: {why}",
                line.trim()
            ),
        }),
    }
}

/// Parse one request from a line (without the trailing newline).
///
/// Not public, and there is no caller that would want it: a request is parsed
/// exactly once, by the desktop, in [`answer`] — which is also where the
/// refusal for one that is not a request is written.
fn parse_request(line: &str) -> Result<Request, serde_json::Error> {
    serde_json::from_str(line)
}
