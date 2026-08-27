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
//! # Frames
//!
//! `app_frame` is a header line followed by that many bytes of pixels on the
//! same socket. [`hear`] reads the header and then consumes the payload, so a
//! reader resumes at the next message rather than at whatever byte of RGBA
//! happened to be a newline — which is what a test that starts a real client
//! hits immediately, and did.
//!
//! The pixels are dropped. Every question asked so far is about which app drew,
//! at what size and how often, and all of those are in the header; a test that
//! needs the image itself should have it handed back rather than read the
//! socket on its own.

mod connected;
mod conversation;

pub use connected::Chrome;
pub use conversation::{greet, hear, say, ChromeError, Greeting};
