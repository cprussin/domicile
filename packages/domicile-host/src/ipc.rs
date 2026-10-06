//! Host-chrome IPC: newline-delimited JSON, one message per line.
//!
//! Transport-agnostic, so tests can use in-memory strings. [`Session`] runs
//! the version handshake and forwards chrome messages to [`Host`].

use domicile_protocol::{negotiate, ChromeMessage, HostMessage, PROTOCOL_VERSION};
use serde::Serialize;

use crate::Host;

/// Encodes a message as one newline-terminated JSON line.
pub fn to_line<T: Serialize>(message: &T) -> String {
    let mut line = serde_json::to_string(message).expect("protocol messages always serialize");
    line.push('\n');
    line
}

/// Parses one chrome message from a JSON line without its newline.
pub fn parse_chrome(line: &str) -> Result<ChromeMessage, serde_json::Error> {
    serde_json::from_str(line)
}

/// One chrome connection that owns a [`Host`] and runs the handshake.
///
/// [`ingest`](Session::ingest) takes inbound lines and returns replies.
/// Wayland-side events go through [`Session::host_mut`].
#[derive(Debug, Default)]
pub struct Session {
    host: Host,
    ready: bool,
}

impl Session {
    pub fn new() -> Self {
        Session::default()
    }

    /// Whether the version handshake has completed.
    pub fn is_ready(&self) -> bool {
        self.ready
    }

    /// The host, for Wayland-side events and inspection.
    pub fn host_mut(&mut self) -> &mut Host {
        &mut self.host
    }

    /// Handles one inbound line and returns the replies.
    pub fn ingest(&mut self, line: &str) -> Vec<HostMessage> {
        handle_chrome_line(&mut self.host, &mut self.ready, line)
    }
}

/// Applies one inbound line to a possibly shared [`Host`] and returns the
/// replies. The caller owns the handshake's `ready` flag.
///
/// The compositor calls this directly so one `Host` serves many chromes.
/// Malformed lines are ignored. See [`apply_chrome_message`] for the
/// handshake.
pub fn handle_chrome_line(host: &mut Host, ready: &mut bool, line: &str) -> Vec<HostMessage> {
    match parse_chrome(line.trim()) {
        Ok(message) => apply_chrome_message(host, ready, message),
        // A chrome on another version must not take the host down. This crate
        // has no logger; the compositor logs the same case.
        Err(_) => Vec::new(),
    }
}

/// Applies a parsed chrome message and returns the replies.
///
/// Before the handshake, only `Hello` is handled. Separate from
/// [`handle_chrome_line`] so the compositor can intercept messages such as
/// `Spawn` first.
pub fn apply_chrome_message(
    host: &mut Host,
    ready: &mut bool,
    message: ChromeMessage,
) -> Vec<HostMessage> {
    match message {
        ChromeMessage::Hello { protocol_version } => match negotiate(protocol_version) {
            Ok(agreed) => {
                *ready = true;
                // Send the current state after `Welcome`. State messages are
                // only sent on change, so a reloaded chrome has nothing until
                // it gets these. The keymap is the browser's only source of a
                // layout off ChromeOS; it is absent when none was set.
                [
                    HostMessage::Welcome {
                        protocol_version: agreed,
                    },
                    host.describe_desktop(),
                    // Needed before first paint, or the shell flashes the
                    // wrong theme.
                    host.describe_theme(),
                    // The theme the browser draws its own pages in.
                    host.describe_windows_theme(),
                ]
                .into_iter()
                .chain(host.describe_keymap())
                .chain(host.describe_shell_config())
                .chain(host.describe_extensions())
                .chain(host.describe_tray())
                .chain(host.describe_notifications())
                .chain(host.describe_portal_requests())
                .collect()
            }
            // Reply with this build's version so the chrome can report the
            // mismatch instead of waiting forever. `Welcome` is readable at
            // any version.
            //
            // Clear `ready` even if an earlier `Hello` succeeded: the
            // compositor broadcasts only to ready connections.
            Err(_) => {
                *ready = false;
                vec![HostMessage::Welcome {
                    protocol_version: PROTOCOL_VERSION,
                }]
            }
        },
        other if *ready => {
            // Placement/focus errors (e.g. an unknown app) are non-fatal.
            let _ = host.handle_chrome_message(other);
            // Focus changes are not returned: replies go only to this
            // chrome, but every chrome needs them. The compositor broadcasts
            // `Host::focus_change` instead.
            Vec::new()
        }
        _ => Vec::new(),
    }
}
