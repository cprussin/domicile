//! The pages listening for `domicile send-shell` commands, across every chrome
//! connection. A page listens with `SystemRequest::ShellCommands`; see
//! `docs/architecture/KEYBINDINGS.md`.

use crate::fanout::Fanout;

/// Every page listening for commands, each a command's words.
pub type ShellCommands = Fanout<[String]>;
