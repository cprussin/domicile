//! The logic behind the `domicile` binary and the compositor's command line.
//!
//! - `domicile <shell>`: parse the command line ([`cli`]), resolve the shell
//!   ([`shell_path`]), config ([`config_path`]), profile ([`profile_path`],
//!   [`profile_claim`]), platform ([`platform`]) and components
//!   ([`components`]), then start ([`spawn`]), order ([`supervise`]) and
//!   restart ([`restart`]) them. A slow first build of the shell runs behind
//!   the [`splash`]. The engine loads each shell through [`serving`].
//! - `domicile which-shell`: query a running desktop ([`control`],
//!   [`control_socket`]).
//! - `domicile load-shell` and `domicile open-url`: forwarded to the engine
//!   ([`command`], [`command_socket`], [`address`]).
//! - `domicile run-app`: an app module ([`app_entry`]), forwarded to the
//!   engine like `load-shell`.
//! - `domicile screenshot`: forwarded to the compositor
//!   ([`compositor_socket`]).
//! - `domicile power-off`, `domicile reboot` and `domicile log-out`: asked in
//!   the desktop's Access dialog ([`power`]).
//! - `domicile install-app`: reads a site's web app manifest ([`web_app`],
//!   [`web_address`]) and writes a desktop entry ([`desktop_entry`],
//!   [`install_app`]).
//! - `domicile uninstall-app`: removes that entry and its icon
//!   ([`uninstall_app`]).
//! - Failed runs report the compositor's last output ([`heard`]).
//! - The compositor's side: its command line ([`arguments`]), the session
//!   document it publishes ([`session`]), and whether a page connected
//!   ([`handshake`]).
//!
//! This lives in a library so it can be tested without a GPU or a display. See
//! `docs/architecture/THE-DOMICILE-BINARY.md`.

pub mod address;
pub mod app_entry;
pub mod app_host;
pub mod arguments;
pub mod build_progress;
pub mod cli;
pub mod command;
pub mod command_socket;
pub mod components;
pub mod compositor_socket;
pub mod config_check;
pub mod config_path;
pub mod config_watch;
pub mod control;
pub mod control_socket;
pub mod desktop_entry;
pub mod extensions;
pub mod folder_chooser;
pub mod graphical_session;
pub mod handshake;
pub mod heard;
pub mod history;
pub mod install_app;
pub mod media_devices;
pub mod milestones;
pub mod notification;
pub mod platform;
pub mod power;
pub mod profile_claim;
pub mod profile_path;
pub mod restart;
pub mod serving;
pub mod session;
mod shell_options;
pub mod shell_path;
pub mod shell_source;
pub mod site_permissions;
pub mod spawn;
pub mod splash;
pub mod supervise;
pub mod uninstall_app;
pub mod web_address;
pub mod web_app;
pub mod xdg_open;
