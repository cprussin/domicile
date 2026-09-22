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
    /// Serve this shell from now on.
    ///
    /// The two halves the engine is told a shell in — see
    /// [`crate::shell_path::Shell`] — and resolved before they get here: the
    /// person typed a path in a terminal of their own, and neither this
    /// desktop nor the engine it talks to shares that working directory.
    LoadShell { root: PathBuf, module: PathBuf },
}

/// What it answered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    /// The module the running desktop is serving, absolute — the desktop's
    /// working directory is not the asker's, and a relative answer would name
    /// a different file depending on where it was read.
    ///
    /// The answer to both commands there are: `which-shell` asks what it is,
    /// and a `load-shell` the engine carried out says what it became. One
    /// answer rather than a `Loaded` of its own, because a second variant
    /// saying the same thing is a second thing for a client to get right.
    Shell { module: PathBuf },

    /// The request was not one this desktop knows, or was one it could not
    /// carry out.
    ///
    /// The first covers a `domicile` from another build as much as a
    /// hand-written line: the desktop and the client that talks to it are the
    /// same program installed twice, and the one on `PATH` can be newer than
    /// the one that is running. There is no version number to catch that
    /// with — the refusal is the version check, and it names the request
    /// nobody understood.
    ///
    /// The second is a `load-shell` the engine would not or could not take,
    /// and `why` is then the engine's own sentence carried out to the terminal
    /// the command was typed in. That engine has a log, and the person who
    /// typed the command is not reading it.
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

/// Telling the engine to serve a shell, or saying why it is not serving it.
///
/// [`crate::command_socket::load_shell`] in a desktop and a closure in a test.
/// The supervisor does not serve the page and cannot carry this out itself —
/// see [`answer`], which is where the one command that routes meets the one
/// that does not.
pub type LoadShell<'a> = &'a dyn Fn(&Path, &Path) -> Result<(), String>;

/// Answer one line from the socket, given the shell this desktop is running
/// and what it takes to make it serve another.
///
/// The whole of a connection. NOT PURE ANY MORE, and it says so here because
/// it used to say the opposite: `which-shell` is answered out of what the
/// supervisor already holds, and `load-shell` is carried out by the engine
/// that serves the page, which means a socket. What is kept is the
/// testability that claim was really about — the dial is injected, so every
/// line of this function is still a string in and a string out. Getting bytes
/// onto the engine's socket is [`crate::command_socket`]'s, the way getting
/// them off this one is [`crate::control_socket`]'s.
pub fn answer(line: &str, module: &Path, load: LoadShell) -> String {
    match parse_request(line.trim()) {
        Ok(Request::WhichShell) => to_line(&Response::Shell {
            module: module.to_path_buf(),
        }),
        // The shell it is serving now rather than an acknowledgment, because
        // the root and the module the engine was given are worth reading back:
        // a `load-shell` typed against the wrong build answers with the file
        // it resolved to, in the terminal it was typed in.
        Ok(Request::LoadShell { root, module }) => to_line(&match load(&root, &module) {
            Ok(()) => Response::Shell {
                module: root.join(module),
            },
            Err(why) => Response::Refused { why },
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
