//! `domicile power-off` and `domicile reboot`: the launcher's Shutdown and
//! Reboot. Each asks in the desktop's Access dialog, which the shell draws
//! (`docs/PORTALS.md`), then runs `systemctl`.

use std::collections::HashMap;

use domicile_protocol::SHELL_APP_ID;
use zbus::zvariant::{ObjectPath, OwnedValue, Value};

/// The desktop's own portal backend, which the compositor serves.
const BACKEND: &str = "org.freedesktop.impl.portal.desktop.domicile";
const BACKEND_PATH: &str = "/org/freedesktop/portal/desktop";
const ACCESS: &str = "org.freedesktop.impl.portal.Access";

/// What to do to the computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Power {
    Off,
    Reboot,
}

impl Power {
    /// The `systemctl` arguments that do it. `-i` because the user just said
    /// yes, so an inhibitor should not refuse it.
    pub fn systemctl(self) -> [&'static str; 2] {
        match self {
            Power::Off => ["poweroff", "-i"],
            Power::Reboot => ["reboot", "-i"],
        }
    }

    /// The launcher entry's id, which names the request.
    fn id(self) -> &'static str {
        match self {
            Power::Off => "shutdown",
            Power::Reboot => "reboot",
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
