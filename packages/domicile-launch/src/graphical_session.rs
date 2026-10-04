//! Registers a desktop as the graphical session with the systemd user manager.
//!
//! Services such as the portal require `graphical-session.target`, which
//! only a session can start. [`begin`] exports the desktop's environment and
//! then starts [`TARGET`], so services started by it inherit that environment.
//! [`end`] stops the session and unsets the environment, so later services do
//! not find a dead socket or display.
//!
//! Only a desktop running as the login session does this. A nested desktop
//! leaves the session to its host.

use std::path::Path;

use crate::control_socket::VARIABLE;

/// The unit started while the desktop is the session. It has
/// `BindsTo=graphical-session.target`.
pub const TARGET: &str = "domicile-session.target";

/// The unit that ends the session.
///
/// Stopping [`TARGET`] is not enough: a running portal's `Requisite=` keeps
/// `graphical-session.target` up. This unit `Conflicts=` the graphical session,
/// like niri's `niri-shutdown.target`.
pub const SHUTDOWN: &str = "domicile-session-shutdown.target";

/// `XDG_CURRENT_DESKTOP` for a desktop. Matches the names of
/// `domicile-mimeapps.list` and `domicile-portals.conf`.
const CURRENT_DESKTOP: &str = "domicile";

/// Variables [`begin`] sets and [`end`] unsets.
const VARIABLES: [&str; 4] = [
    "XDG_CURRENT_DESKTOP",
    "WAYLAND_DISPLAY",
    VARIABLE,
    "XDG_SESSION_TYPE",
];

/// Exports the desktop's environment to `manager`, then starts [`TARGET`].
pub fn begin(
    manager: &zbus::blocking::Connection,
    wayland_display: &str,
    control: &Path,
) -> Result<(), zbus::Error> {
    let values = [
        CURRENT_DESKTOP.to_string(),
        wayland_display.to_string(),
        control.display().to_string(),
        "wayland".to_string(),
    ];
    let assignments: Vec<String> = VARIABLES
        .iter()
        .zip(values)
        .map(|(name, value)| format!("{name}={value}"))
        .collect();
    call(manager, "SetEnvironment", &(assignments,))?;
    call(manager, "StartUnit", &(TARGET, "replace"))
}

/// Starts [`SHUTDOWN`], then unsets the environment from [`begin`].
///
/// Uses `replace-irreversibly`, as niri does, so no later job can cancel the
/// shutdown.
pub fn end(manager: &zbus::blocking::Connection) -> Result<(), zbus::Error> {
    call(manager, "StartUnit", &(SHUTDOWN, "replace-irreversibly"))?;
    call(manager, "UnsetEnvironment", &(VARIABLES.to_vec(),))
}

fn call<B>(manager: &zbus::blocking::Connection, method: &str, body: &B) -> Result<(), zbus::Error>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
{
    manager
        .call_method(
            Some("org.freedesktop.systemd1"),
            "/org/freedesktop/systemd1",
            Some("org.freedesktop.systemd1.Manager"),
            method,
            body,
        )
        .map(drop)
}
