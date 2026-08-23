//! The host <-> chrome IPC seam: newline-delimited JSON over a byte stream.
//!
//! In the running compositor the byte stream is whatever channel the engine
//! exposes to the page (a pipe/socket). This module is transport-agnostic: it
//! defines the framing (one JSON message per line) and a [`Session`] that
//! performs the version handshake and forwards chrome messages into the
//! [`Host`] brain. Keeping it stream-agnostic lets it be tested over an
//! in-memory string or a real `UnixStream` alike.

use domicile_protocol::{negotiate, ChromeMessage, HostMessage};
use serde::Serialize;

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
/// to send back to the chrome — the handshake `Welcome`, and the `Displays`
/// describing the desktop that follows it. App lifecycle events originate on
/// the Wayland side via [`Session::host_mut`].
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
    pub fn ingest(&mut self, line: &str) -> Vec<HostMessage> {
        handle_chrome_line(&mut self.host, &mut self.ready, line)
    }
}

/// Apply one inbound chrome line to a (possibly shared) [`Host`], driving the
/// handshake via the caller-owned `ready` flag. Returns messages to send back.
///
/// This is the reusable core behind [`Session::ingest`]. The compositor uses it
/// directly so a single shared `Host` can be driven by both the Wayland side
/// and any number of chrome connections. Before the handshake only `Hello` is
/// honoured; malformed lines and version mismatches are ignored rather than
/// tearing anything down.
pub fn handle_chrome_line(host: &mut Host, ready: &mut bool, line: &str) -> Vec<HostMessage> {
    match parse_chrome(line.trim()) {
        Ok(message) => apply_chrome_message(host, ready, message),
        // Dropped, because a chrome one version out of step must not take the
        // host down. The compositor says so out loud where it does the same
        // thing; this crate has no logging dependency at all, and adding one
        // is its own change rather than a rider on the one that noticed.
        Err(_) => Vec::new(),
    }
}

/// Apply an already-parsed chrome message to the host, driving the handshake.
///
/// Split out so callers that must peek at the message first (e.g. the compositor
/// intercepting `Spawn`) can parse once and dispatch the rest here.
pub fn apply_chrome_message(
    host: &mut Host,
    ready: &mut bool,
    message: ChromeMessage,
) -> Vec<HostMessage> {
    match message {
        ChromeMessage::Hello { protocol_version } => match negotiate(protocol_version) {
            Ok(agreed) => {
                *ready = true;
                // The desktop rides with the handshake, after the `Welcome`
                // that agreed the version it is written in. A chrome has no
                // other way to learn what it is laying out against, and one
                // that reloads has to be told again — so it cannot be a change
                // the chrome might have missed.
                vec![
                    HostMessage::Welcome {
                        protocol_version: agreed,
                    },
                    host.describe_desktop(),
                ]
            }
            Err(_) => Vec::new(),
        },
        other if *ready => {
            // Placement/focus errors (e.g. an unknown app) are non-fatal.
            let _ = host.handle_chrome_message(other);
            // Who holds the keyboard is *not* returned here. What this
            // function returns is written back to the one connection that
            // asked, and focus is the whole desktop's business: a second
            // chrome told nothing would believe the wrong window was active
            // for as long as it stayed connected, because the change is a
            // delta and a delta is only reported once. The compositor asks
            // `Host::focus_change` and broadcasts it instead.
            Vec::new()
        }
        _ => Vec::new(),
    }
}
