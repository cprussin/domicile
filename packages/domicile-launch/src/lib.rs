//! `domicile`: everything it decides, and the boundary it decides it across.
//!
//! `domicile ./my-desktop/dist/shell.js` starts an engine and a compositor.
//! What that takes is a handful of decisions, and each is a module here with
//! tests of its own — which command line was given ([`cli`]), which module to
//! load ([`shell_path`]), which config file the compositor reads
//! ([`config_path`]), which ozone platform ([`platform`]), where the two
//! components are ([`components`]), what each is started with ([`spawn`]),
//! and the order they go up in ([`supervise`]) — and, when one of them stops
//! being a component, whether there is another desktop in it ([`restart`]).
//!
//! `domicile which-shell` puts a command to a desktop that is already
//! running. That is the same binary read the other way, and two more modules:
//! what a desktop can be asked and what it answers ([`control`]), and where it
//! answers ([`control_socket`]).
//!
//! `domicile load-shell <path>` is the command a desktop does not answer on
//! its own account: the page belongs to the engine, so the supervisor routes
//! it on. What that says is [`command`] — the one contract here with a version
//! in it, because the engine is published separately from this — and where it
//! says it is [`command_socket`].
//!
//! What a run that gave up says at the end is [`heard`]: the compositor's own
//! words, kept as they go past so that the last line of a failed run is the
//! reason rather than a pointer to it.
//!
//! The other boundary is the compositor's own: the command line it is started
//! with ([`arguments`]), the session document it
//! publishes once it is up ([`session`]), and whether a page ever reached it
//! at all ([`handshake`]).
//!
//! All of it is here rather than in the compositor or in
//! the `domicile` binary because both of those need
//! something this does not: the compositor a GPU-capable toolchain to build
//! and a display to do anything, the binary a machine with a screen. Neither
//! is a place to keep logic that can be tested with a string and a temp
//! directory.

pub mod arguments;
pub mod cli;
pub mod command;
pub mod command_socket;
pub mod components;
pub mod config_path;
pub mod control;
pub mod control_socket;
pub mod handshake;
pub mod heard;
pub mod milestones;
pub mod platform;
pub mod restart;
pub mod session;
pub mod shell_path;
pub mod spawn;
pub mod supervise;
