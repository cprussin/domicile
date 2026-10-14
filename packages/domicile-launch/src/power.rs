//! `domicile power-off`, `domicile reboot` and `domicile log-out`: the
//! launcher's Shutdown, Reboot and Logout. Each asks in the desktop's Access
//! dialog, which the shell draws (`docs/PORTALS.md`), then runs `systemctl` or
//! `loginctl`.

use std::collections::HashMap;

use domicile_protocol::SHELL_APP_ID;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};

/// The desktop's own portal backend, which the compositor serves.
const BACKEND: &str = "org.freedesktop.impl.portal.desktop.domicile";
const BACKEND_PATH: &str = "/org/freedesktop/portal/desktop";
const ACCESS: &str = "org.freedesktop.impl.portal.Access";

/// What to do to the computer or the login session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Power {
    Off,
    Reboot,
    LogOut,
}

impl Power {
    /// The program and arguments that do it.
    ///
    /// - Power off and reboot pass `-i` to `systemctl`: the user just said
    ///   yes, so an inhibitor should not refuse it.
    /// - Log out terminates `session` (`XDG_SESSION_ID`), which returns to the
    ///   login manager. It is an error outside a login session.
    pub fn command(self, session: Option<&str>) -> Result<(&'static str, Vec<String>), String> {
        let args = |args: &[&str]| args.iter().map(|arg| arg.to_string()).collect();
        match self {
            Power::Off => Ok(("systemctl", args(&["poweroff", "-i"]))),
            Power::Reboot => Ok(("systemctl", args(&["reboot", "-i"]))),
            Power::LogOut => match session {
                Some(session) => Ok(("loginctl", args(&["terminate-session", session]))),
                None => Err("XDG_SESSION_ID is not set: no login session to log out of".into()),
            },
        }
    }

    /// The launcher entry's id, which names the request.
    fn id(self) -> &'static str {
        match self {
            Power::Off => "shutdown",
            Power::Reboot => "reboot",
            Power::LogOut => "logout",
        }
    }

    /// The dialog's title, what happens, and its yes.
    fn question(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Power::Off => (
                "Shut down?",
                "Are you sure you want to shut down? Unsaved work is lost.",
                "Shut down",
            ),
            Power::Reboot => (
                "Reboot?",
                "Are you sure you want to reboot? Unsaved work is lost.",
                "Reboot",
            ),
            Power::LogOut => (
                "Log out?",
                "Are you sure you want to log out? Unsaved work is lost.",
                "Log out",
            ),
        }
    }
}

/// Asks the user on `bus`. Returns whether they said yes.
///
/// A canceled dialog, or one with no shell to show it, is a no.
pub fn confirmed(bus: &zbus::blocking::Connection, power: Power) -> Result<bool, String> {
    let (title, subtitle, grant) = power.question();
    let handle = format!(
        "{BACKEND_PATH}/request/launcher/{}_{}",
        power.id(),
        std::process::id()
    );
    let handle = ObjectPath::try_from(handle.as_str()).map_err(|why| why.to_string())?;
    let options = HashMap::from([
        ("grant_label", Value::from(grant)),
        ("deny_label", Value::from("Cancel")),
        ("destructive", Value::from(true)),
    ]);
    let (response, _): (u32, HashMap<String, OwnedValue>) = bus
        .call_method(
            Some(BACKEND),
            BACKEND_PATH,
            Some(ACCESS),
            "AccessDialog",
            &(handle, SHELL_APP_ID, "", title, subtitle, "", options),
        )
        .and_then(|reply| reply.body().deserialize())
        .map_err(|why| format!("the desktop's Access dialog did not answer: {why}"))?;
    match response {
        0 => Ok(true),
        1 | 2 => Ok(false),
        other => Err(format!("the Access dialog answered {other}")),
    }
}
