//! What the engine can be told about the shell it serves, and what it answers.
//!
//! The engine's socket, not this desktop's: [`crate::control`] is the wire a
//! person's `domicile <command>` arrives on, and this is the one the supervisor
//! turns a `load-shell` into. One JSON object per line each way, and the
//! connection is over.
//!
//! ```text
//! {"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
//! {"type":"loaded"}   |   {"type":"refused","why":"…"}
//! ```
//!
//! THE OTHER END OF THIS IS C++ AND IS PUBLISHED SEPARATELY, which is the whole
//! reason this module is not part of [`crate::control`]:
//! `components/domicile/browser/command_protocol.cc` in the fork holds the
//! engine's half, `command_protocol_unittest.cc` holds its tests, and
//! `packages/domicile-engine/engine-release.nix` pins which build of it a
//! desktop runs. Nothing derives both halves of this agreement, so what is
//! asserted here is the bytes.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// The version of this contract the supervisor writes and the engine checks.
///
/// [`DATA.md`](/docs/guidelines/DATA.md) says to version a contract when
/// producer and consumer can be on different releases at once, and this is the
/// one in this system that can: the engine is pinned by
/// `engine-release.nix` and is routinely built from an older commit than the
/// `domicile` beside it. The refusal is the check — an engine that does not
/// speak the version it was sent says so, by name, on this socket — so there
/// is nothing to do here but say which one this is.
///
/// Bump it when the request's shape changes in a way an older engine would
/// read wrongly; a new engine that must still answer an old supervisor keeps
/// reading the version it shipped with.
const VERSION: u32 = 1;

/// What the engine answered.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Reply {
    /// It is serving that shell now.
    Loaded,
    /// It is not, and this is the engine's own sentence about why.
    Refused { why: String },
}

/// The line that tells an engine to serve the shell `module` out of `root`.
///
/// Absolute `root`, and the engine refuses one that is not: it resolves the
/// path in its own process, whose working directory nobody else knows.
/// Resolving what a person typed is [`crate::shell_path`]'s, and it happens in
/// front of them rather than here.
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

/// Read one reply from a line (without the trailing newline).
///
/// AN UNREADABLE ANSWER IS NOT A REFUSAL. An engine old enough not to have
/// this socket at all, or new enough to answer something this build has no
/// name for, has not refused anything — and telling whoever typed the command
/// that it did would be this program inventing the engine's half of the
/// conversation.
pub fn reply(line: &str) -> Result<Reply, serde_json::Error> {
    serde_json::from_str(line)
}

/// What the supervisor can tell the engine.
///
/// Named fields rather than a `json!` so the line comes out in the order this
/// contract is written down in everywhere else — the fork's own header, this
/// module's, and the two design docs. JSON does not care about the order of an
/// object's keys and a reader comparing a live line against a doc does.
///
/// Not public, and there is no caller that would want it: the one command
/// there is has a function of its own above, which is the whole of what a
/// caller has to know.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command<'a> {
    LoadShell {
        version: u32,
        root: &'a Path,
        module: &'a Path,
    },
}
