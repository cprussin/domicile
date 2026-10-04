//! The logic behind the `domicile` binary and the compositor's command line.
//!
//! - `domicile <shell>`: parse the command line ([`cli`]), resolve the shell
//!   ([`shell_path`]), config ([`config_path`]), profile ([`profile_path`],
//!   [`profile_claim`]), platform ([`platform`]) and components
//!   ([`components`]), then start ([`spawn`]), order ([`supervise`]) and
//!   restart ([`restart`]) them.
//! - `domicile which-shell`: query a running desktop ([`control`],
//!   [`control_socket`]).
//! - `domicile load-shell` and `domicile open-url`: forwarded to the engine
//!   ([`command`], [`command_socket`], [`address`]).
//! - Failed runs report the compositor's last output ([`heard`]).
//! - The compositor's side: its command line ([`arguments`]), the session
//!   document it publishes ([`session`]), and whether a page connected
//!   ([`handshake`]).
//!
//! This lives in a library so it can be tested without a GPU or a display. See
//! `docs/architecture/THE-DOMICILE-BINARY.md`.

pub mod address;
pub mod arguments;
pub mod build_progress;
pub mod cli;
pub mod command;
pub mod command_socket;
pub mod components;
pub mod config_path;
pub mod config_watch;
pub mod control;
pub mod control_socket;
pub mod graphical_session;
pub mod handshake;
pub mod heard;
pub mod milestones;
pub mod notification;
pub mod platform;
pub mod profile_claim;
pub mod profile_path;
pub mod restart;
pub mod session;
pub mod shell_path;
pub mod shell_source;
pub mod spawn;
pub mod supervise;
pub mod xdg_open;
