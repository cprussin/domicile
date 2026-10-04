//! A desk that is the login session, said to the systemd user manager.
//!
//! The portal's unit has `Requisite=graphical-session.target`, as does any
//! service a home binds to a graphical session, and nothing starts that target
//! but a session saying it is one. [`TARGET`] binds it, so starting it is the
//! desk saying so; starting [`SHUTDOWN`] is the desk saying it has gone.
//!
//! Every such service takes the user manager's environment as it starts, so
//! [`begin`] says the desk before it starts anything: which desktop this is,
//! the display its apps open on, and the control socket the `domicile-open-url`
//! a portal starts finds this desk by. [`end`] takes all of that back, so a
//! service started after the desk has gone finds neither a dead socket nor a
//! display nobody is serving.
//!
//! ONLY A DESK THAT IS THE SESSION. One in a window inside another session
//! says nothing here: the session it is inside owns the user manager's
//! graphical session, and its links and its portal.

use std::path::Path;

use crate::control_socket::VARIABLE;

/// The unit a desk starts while it is the session. Shipped with Domicile:
/// `BindsTo=graphical-session.target`.
pub const TARGET: &str = "domicile-session.target";

/// The unit that ends it. Stopping [`TARGET`] is not enough: a running
/// portal's `Requisite=` pins `graphical-session.target` up, and the portal
/// with it. This one `Conflicts=` the graphical session, so starting it takes
/// both down whatever holds them -- niri's `niri-shutdown.target`, for the same
/// reason.
pub const SHUTDOWN: &str = "domicile-session-shutdown.target";

/// What `XDG_CURRENT_DESKTOP` is in a desk -- the compositor's own
/// `CURRENT_DESKTOP`, which is what `domicile-mimeapps.list` and
/// `domicile-portals.conf` are named for.
const CURRENT_DESKTOP: &str = "domicile";

/// What [`begin`] says and [`end`] takes back, in that order.
const VARIABLES: [&str; 4] = [
    "XDG_CURRENT_DESKTOP",
    "WAYLAND_DISPLAY",
    VARIABLE,
    "XDG_SESSION_TYPE",
];

/// Say this desk to the user manager on `manager`, then start [`TARGET`].
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

/// Start [`SHUTDOWN`], then take back what [`begin`] said.
///
/// `replace-irreversibly`, as niri does: nothing queued after it can cancel
/// the graphical session going down.
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
