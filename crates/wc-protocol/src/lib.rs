//! The wire contract between the Loom host and the in-page bridge client.
//!
//! The chrome runs a small JS bridge that mirrors these types. Messages are
//! exchanged as JSON. Keep this crate dependency-light (serde only) so it stays
//! a clean, portable description of the protocol; the host maps these onto its
//! internal scene model, and the JS side mirrors them by hand.

use serde::{Deserialize, Serialize};

/// The protocol version this build speaks.
pub const PROTOCOL_VERSION: u32 = 1;

/// Messages sent from the chrome (in-page bridge) to the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChromeMessage {
    /// First message after connecting; declares the version the chrome speaks.
    Hello { protocol_version: u32 },

    /// Report the on-screen placement of an `<app>` element. Sent whenever the
    /// element's geometry, stacking, or visibility changes. `transform` is a
    /// CSS `matrix(a,b,c,d,e,f)` mapping app-local pixels to screen space.
    PlacePortal {
        app_id: String,
        transform: [f64; 6],
        size: [f64; 2],
        z_index: i32,
        visible: bool,
    },

    /// An `<app>` element was unmounted; the host should stop compositing it.
    RemovePortal { app_id: String },

    /// Request keyboard focus for an app.
    FocusApp { app_id: String },

    /// Return keyboard focus to the chrome.
    FocusChrome,

    /// Ask the compositor to spawn a client process (argv). The child inherits
    /// the compositor's environment, so it connects to Loom's Wayland display.
    /// Used by chrome keybindings/launchers.
    Spawn { command: Vec<String> },
}

/// Messages sent from the host to the chrome (in-page bridge).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostMessage {
    /// Response to `Hello`; declares the version the host agreed to speak.
    Welcome { protocol_version: u32 },

    /// A new Wayland client wants a portal. The chrome decides where to mount
    /// its `<app id="…">` element.
    AppAppeared { app_id: String, title: Option<String>, size: [f64; 2] },

    /// A client's content size changed.
    AppResized { app_id: String, size: [f64; 2] },

    /// A new pixel frame for an app surface, to draw into its `<app>` element.
    /// `data` is base64-encoded, row-major RGBA (`width * height * 4` bytes).
    /// This is the copy-based stopgap until the zero-copy dmabuf/CEF bridge lands.
    AppFrame { app_id: String, width: u32, height: u32, format: String, data: String },

    /// A client went away; the chrome should unmount its `<app>` element.
    AppClosed { app_id: String },
}

/// Version negotiation failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("incompatible protocol version: host speaks {host}, chrome speaks {chrome}")]
pub struct VersionMismatch {
    pub host: u32,
    pub chrome: u32,
}

/// Negotiate a protocol version against a chrome that speaks `chrome_version`.
///
/// v1 requires an exact match; this is where looser compatibility rules would
/// live as the protocol evolves.
pub fn negotiate(chrome_version: u32) -> Result<u32, VersionMismatch> {
    if chrome_version == PROTOCOL_VERSION {
        Ok(PROTOCOL_VERSION)
    } else {
        Err(VersionMismatch { host: PROTOCOL_VERSION, chrome: chrome_version })
    }
}
