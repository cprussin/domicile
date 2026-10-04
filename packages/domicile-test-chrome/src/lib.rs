//! A stand-in chrome for compositor end-to-end tests.
//!
//! It speaks the chrome protocol and records what the host says, so tests can
//! check the compositor without a web engine. Reading and writing work on any
//! buffer pair; only [`Chrome`] needs a real socket.

mod connected;
mod conversation;

pub use connected::Chrome;
pub use conversation::{greet, hear, say, ChromeError, Greeting};
