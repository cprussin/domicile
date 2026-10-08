//! The protocol the supervisor uses to send `load-shell` and `open-url` to the
//! engine.
//!
//! One JSON line each way per connection:
//!
//! ```text
//! {"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
//! {"type":"loaded"}   |   {"type":"refused","why":"…"}
//!
//! {"type":"open_url","version":1,"url":"https://example.com/"}
//! {"type":"opened"}   |   {"type":"refused","why":"…"}
//! ```
//!
//! The engine side is C++ in the fork
//! (`components/domicile/browser/command_protocol.cc`, tested in
//! `command_protocol_unittest.cc`) and is released separately
//! (`packages/domicile-engine/engine-release.nix`). Nothing shares code
//! between the two, so the tests here assert the exact bytes.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// The protocol version the supervisor sends and the engine checks.
///
/// Versioned per [`DATA.md`](/docs/guidelines/DATA.md) because the pinned
/// engine is often older than `domicile`. The engine refuses versions it does
/// not support. Bump this when a request changes in a way an older engine
/// would misread.
const VERSION: u32 = 1;

/// The engine's reply.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Reply {
    /// The engine is serving the shell.
    Loaded,
    /// The engine passed the address to the shell.
    Opened,
    /// The engine refused, with its reason.
    Refused { why: String },
}

/// The request to serve the shell `module` from `root`.
///
/// `root` must be absolute; the engine refuses relative paths. Resolve user
/// input with [`crate::shell_path`] first.
pub fn load_shell_line(root: &Path, module: &Path) -> String {
    let mut line = serde_json::to_string(&Command::LoadShell {
        module,
        root,
        version: VERSION,
    })
    .expect("a command is plain data and always serializes");
    line.push('\n');
    line
}

/// The request to open `url` in the shell. The engine validates `url`.
pub fn open_url_line(url: &str) -> String {
    let mut line = serde_json::to_string(&Command::OpenUrl {
        url,
        version: VERSION,
    })
    .expect("a command is plain data and always serializes");
    line.push('\n');
    line
}

/// Parses one reply line, without its trailing newline.
///
/// An unparseable reply is an error, not a [`Reply::Refused`]: it comes from
/// an incompatible engine, which did not refuse anything.
pub fn reply(line: &str) -> Result<Reply, serde_json::Error> {
    serde_json::from_str(line)
}

/// A request to the engine.
///
/// Field order matches the documented key order, so live lines are easy to
/// compare against the docs.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command<'a> {
    LoadShell {
        version: u32,
        root: &'a Path,
        module: &'a Path,
    },
    OpenUrl {
        version: u32,
        url: &'a str,
    },
}
