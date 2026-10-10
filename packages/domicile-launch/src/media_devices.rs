//! The cameras and microphones the engine sees, and which one a site gets when
//! it does not ask for a particular one.
//!
//! The same shape crosses three hops, as [`crate::site_permissions`] does: the
//! engine's command socket, the control socket and the Settings app's native
//! messaging host.

use serde::{Deserialize, Serialize};

/// Each kind's devices, most preferred first. A site that names no device gets
/// the first.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaDevices {
    pub cameras: Vec<MediaDevice>,
    pub microphones: Vec<MediaDevice>,
}

/// One camera or microphone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaDevice {
    /// The engine's id for the device, such as `/dev/video2`.
    pub id: String,
    /// The name the system gives it.
    pub name: String,
}

/// Which list a device is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Camera,
    Microphone,
}
