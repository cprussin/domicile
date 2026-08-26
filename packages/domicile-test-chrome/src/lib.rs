//! A stand-in chrome: what a test connects to a compositor in place of a web
//! engine.
//!
//! Domicile's own end-to-end checks are about the compositor, not about any
//! shell — so what they need on the other end of the chrome socket is
//! something that speaks the protocol and remembers what it heard, which is
//! all this is. A real shell is a web engine, an Electron and a page; none of
//! that is under test when the question is "does a compositor started on a
//! two-display config describe two displays".
//!
//! The reading and writing are separate from the socket on purpose: every rule
//! about what a chrome may say and when is checkable against a pair of
//! buffers, and only the process arrangement needs a compositor.
//!
//! # What it does not speak
//!
//! The frame transport. `app_frame` is a header line followed by the pixels
//! themselves on the same socket, and this reads newline-delimited JSON with
//! no notion of that — so a frame arrives as [`ChromeError::Unreadable`] on a
//! line of RGBA, or worse, desynchronises the reader at whatever byte happened
//! to be a newline and produces a `NeverCame` about the message *after* it.
//!
//! Nothing sends one today: a compositor only broadcasts frames for clients,
//! and no test here starts one. The first that does needs this implemented
//! rather than worked around.

mod connected;
mod conversation;

pub use connected::Chrome;
pub use conversation::{greet, hear, say, ChromeError, Greeting};
