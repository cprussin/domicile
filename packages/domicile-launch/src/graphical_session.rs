//! Registers a desktop as the graphical session with the systemd user manager.
//!
//! Services such as the portal require `graphical-session.target`, which
//! only a session can start. [`name`] exports the desktop's name before any
//! component starts, since the engine can D-Bus activate the portal frontend
//! before the compositor is up. [`begin`] exports the rest of the desktop's
//! environment and then starts [`TARGET`], so services started by it inherit
//! that environment.
//! [`end`] stops the session and unsets the environment, so later services do
//! not find a dead socket or display.
//!
//! A second login session, on another tty, takes over the user manager's
//! session from the first. [`begin`] returns the first's variables, and
//! [`end`] gives them back while the first still runs instead of stopping the
//! session under it.
//!
//! Only a desktop running as the login session does this. A nested desktop
//! leaves the session to its host.

use std::os::unix::net::UnixStream;
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

/// Exports `XDG_CURRENT_DESKTOP` and `XDG_SESSION_TYPE` to `manager`.
///
/// The portal frontend reads `XDG_CURRENT_DESKTOP` once, when it starts, and
/// routes every interface by it. Neither value waits on the compositor.
pub fn name(manager: &zbus::blocking::Connection) -> Result<(), zbus::Error> {
    call(
        manager,
        "SetEnvironment",
        &(vec![
            format!("XDG_CURRENT_DESKTOP={CURRENT_DESKTOP}"),
            "XDG_SESSION_TYPE=wayland".to_string(),
        ],),
    )
}

/// Exports the desktop's environment to `manager`, then starts [`TARGET`].
///
/// Returns the [`VARIABLES`] `manager` held when they named another desktop's
/// control socket, for [`end`]. Empty when they named none or this desktop's.
pub fn begin(
    manager: &zbus::blocking::Connection,
    wayland_display: &str,
    control: &Path,
) -> Result<Vec<String>, zbus::Error> {
    let held = held(manager)?;
    let earlier = match socket(&held) {
        Some(socket) if Path::new(socket) != control => held,
        _ => Vec::new(),
    };
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
    call(manager, "StartUnit", &(TARGET, "replace"))?;
    Ok(earlier)
}

/// Ends the session of the desktop at `control`, which took it over from
/// `earlier` (from [`begin`]).
///
/// - Another desktop's control socket in `manager`: that desktop took the
///   session over later, so it is left alone.
/// - `earlier`'s desktop still answers: its variables are set again.
/// - Otherwise starts [`SHUTDOWN`], then unsets the environment from
///   [`begin`]. Uses `replace-irreversibly`, as niri does, so no later job can
///   cancel the shutdown.
pub fn end(
    manager: &zbus::blocking::Connection,
    control: &Path,
    earlier: &[String],
) -> Result<(), zbus::Error> {
    let held = held(manager)?;
    if socket(&held).is_some_and(|socket| Path::new(socket) != control) {
        return Ok(());
    }
    if socket(earlier).is_some_and(|socket| UnixStream::connect(socket).is_ok()) {
        return call(manager, "SetEnvironment", &(earlier,));
    }
    call(manager, "StartUnit", &(SHUTDOWN, "replace-irreversibly"))?;
    call(manager, "UnsetEnvironment", &(VARIABLES.to_vec(),))
}

/// The assignments of [`VARIABLES`] in `manager`'s environment.
fn held(manager: &zbus::blocking::Connection) -> Result<Vec<String>, zbus::Error> {
    let environment: Vec<String> = zbus::blocking::Proxy::new(
        manager,
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
    )?
    .get_property("Environment")?;
    Ok(environment
        .into_iter()
        .filter(|assignment| {
            VARIABLES
                .iter()
                .any(|name| assignment.split_once('=').map(|(key, _)| key) == Some(*name))
        })
        .collect())
}

/// The control socket among `assignments`.
fn socket(assignments: &[String]) -> Option<&str> {
    assignments.iter().find_map(|assignment| {
        assignment
            .strip_prefix(VARIABLE)
            .and_then(|rest| rest.strip_prefix('='))
    })
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
