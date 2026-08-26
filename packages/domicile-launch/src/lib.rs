//! The boundary between a shell and the compositor it runs.
//!
//! A Domicile desktop is started by its *shell*: the shell owns the
//! configuration, starts `domicile-compositor` as a child, and connects to it
//! as the chrome. Two things cross that boundary, and this crate is both of
//! them — the command line the compositor is started with
//! ([`arguments`](crate::arguments)) and the session document it publishes once
//! it is up ([`session`](crate::session)).
//!
//! Both are here rather than in the compositor because the compositor is the
//! Smithay binary: it needs a GPU-capable toolchain to build and a display to
//! do anything, and neither is a place to keep logic that can be tested with a
//! string and a temp directory.

pub mod arguments;
pub mod session;
