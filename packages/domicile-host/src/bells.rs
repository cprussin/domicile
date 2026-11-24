//! The pages listening for clients ringing `xdg_system_bell_v1`, across every
//! chrome connection. A page listens with `SystemRequest::Bells`; see
//! `docs/WRITING-A-SHELL.md`.

use crate::fanout::Fanout;
use crate::AppId;

/// Every page listening for bells: the window that rang, if any.
pub type Bells = Fanout<Option<AppId>>;
