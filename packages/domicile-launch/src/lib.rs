//! `domicile`: everything it decides, and the boundary it decides it across.
//!
//! `domicile ./my-desktop/dist/shell.js` starts an engine and a compositor.
//! What that takes is a handful of decisions, and each is a module here with
//! tests of its own — which command line was given ([`cli`]), which module to
//! load ([`shell_path`]), which ozone platform ([`platform`]), where the two
//! components are ([`components`]), what each is started with ([`spawn`]),
//! and the order they go up in ([`supervise`]).
//!
//! The other boundary is the compositor's own: the command line it is started
//! with ([`arguments`]) and the session document it
//! publishes once it is up ([`session`]).
//!
//! All of it is here rather than in the compositor or in
//! the `domicile` binary because both of those need
//! something this does not: the compositor a GPU-capable toolchain to build
//! and a display to do anything, the binary a machine with a screen. Neither
//! is a place to keep logic that can be tested with a string and a temp
//! directory.

pub mod arguments;
pub mod cli;
pub mod components;
pub mod platform;
pub mod session;
pub mod shell_path;
pub mod spawn;
pub mod supervise;
