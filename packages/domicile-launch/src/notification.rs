//! A notification from the supervisor itself.
//!
//! What goes wrong after a desk is up — a config edit that does not evaluate
//! or build — happens where nobody is reading the terminal, so it is said on
//! the desk too. The compositor is the desk's `org.freedesktop.Notifications`,
//! so this is an ordinary `Notify` on the session bus, toasted like any
//! application's.

use std::collections::HashMap;
use std::time::Duration;

use zbus::zvariant::Value;

/// The name the notification is shown as from.
const APP_NAME: &str = "Domicile";

/// `urgency` 2, critical: stays up until dismissed, because the desk is not
/// what the user's file says it is until they fix it.
const CRITICAL: u8 = 2;

/// How long a `Notify` waits for its answer. A server that never answers
/// would otherwise hold the config watcher's thread, and with it every reload
/// after this one.
pub const ANSWER_WITHIN: Duration = Duration::from_secs(2);

/// The connection `builder` makes, giving up on a call after
/// [`ANSWER_WITHIN`].
pub fn connected(
    builder: zbus::blocking::connection::Builder<'_>,
) -> Result<zbus::blocking::Connection, zbus::Error> {
    builder.method_timeout(ANSWER_WITHIN).build()
}

/// The session bus, as [`connected`] makes it.
pub fn session_bus() -> Result<zbus::blocking::Connection, zbus::Error> {
    connected(zbus::blocking::connection::Builder::session()?)
}

/// Show `summary` and `body` through the notification server on `bus`.
pub fn notify(
    bus: &zbus::blocking::Connection,
    summary: &str,
    body: &str,
) -> Result<(), zbus::Error> {
    let hints = HashMap::from([("urgency", Value::from(CRITICAL))]);
    bus.call_method(
        Some("org.freedesktop.Notifications"),
        "/org/freedesktop/Notifications",
        Some("org.freedesktop.Notifications"),
        "Notify",
        &(
            APP_NAME,
            0_u32,
            "",
            summary,
            body,
            Vec::<&str>::new(),
            hints,
            -1_i32,
        ),
    )
    .map(drop)
}
