//! The pages listening for clients' maximize and fullscreen requests, across
//! every chrome connection. A page listens with
//! `SystemRequest::WindowRequests`; see `docs/WRITING-A-SHELL.md`.

use domicile_protocol::WindowRequest;

use crate::fanout::Fanout;
use crate::AppId;

/// Every page listening for window requests: the window and what its client
/// asked for.
pub type WindowRequests = Fanout<(AppId, WindowRequest)>;
