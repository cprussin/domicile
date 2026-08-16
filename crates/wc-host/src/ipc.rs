//! The host <-> chrome IPC seam: newline-delimited JSON over a byte stream.
//!
//! In the running compositor the byte stream is whatever channel the engine
//! exposes to the page (a pipe/socket). This module is transport-agnostic: it
//! defines the framing (one JSON message per line) and a [`Session`] that
//! performs the version handshake and forwards chrome messages into the
//! [`Host`] brain. Keeping it stream-agnostic lets it be tested over an
//! in-memory string or a real `UnixStream` alike.

use serde::Serialize;
use wc_protocol::{negotiate, ChromeMessage, HostMessage};

use crate::Host;

/// Encode a message as a single newline-terminated JSON line.
pub fn to_line<T: Serialize>(message: &T) -> String {
    let mut line = serde_json::to_string(message).expect("protocol messages always serialize");
    line.push('\n');
    line
}

/// Parse one chrome message from a JSON line (without the trailing newline).
pub fn parse_chrome(line: &str) -> Result<ChromeMessage, serde_json::Error> {
    serde_json::from_str(line)
}

/// A single chrome connection: owns a [`Host`] and drives the handshake.
///
/// Feed inbound lines to [`ingest`](Session::ingest); it returns any messages
/// to send back to the chrome (currently just the handshake `Welcome`). App
/// lifecycle events originate on the Wayland side via [`Session::host_mut`].
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

    /// Mutable access to the host brain (for Wayland-side events + inspection).
    pub fn host_mut(&mut self) -> &mut Host {
        &mut self.host
    }

    /// Process one inbound line from the chrome. Returns messages to send back.
    ///
    /// Before the handshake, only `Hello` is honoured; everything else is
    /// dropped. Malformed lines and version mismatches are ignored rather than
    /// tearing anything down.
    pub fn ingest(&mut self, line: &str) -> Vec<HostMessage> {
        let message = match parse_chrome(line.trim()) {
            Ok(message) => message,
            Err(_) => return Vec::new(),
        };

        match message {
            ChromeMessage::Hello { protocol_version } => match negotiate(protocol_version) {
                Ok(agreed) => {
                    self.ready = true;
                    vec![HostMessage::Welcome { protocol_version: agreed }]
                }
                Err(_) => Vec::new(),
            },
            other if self.ready => {
                // Placement/focus errors (e.g. an unknown app) are non-fatal:
                // log-and-continue territory, so we swallow them here.
                let _ = self.host.handle_chrome_message(other);
                Vec::new()
            }
            _ => Vec::new(),
        }
    }
}
