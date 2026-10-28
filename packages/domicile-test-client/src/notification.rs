//! `--notify`: a notification sent over the session bus, as a chat app sends
//! one.

use std::collections::HashMap;

use zbus::blocking::Connection;
use zbus::zvariant::Value;

/// Send a notification summarized `summary`, with a press as its only action.
///
/// Returns the connection, which must outlive the notification: the server
/// asks the bus which process sent it.
pub fn notify(summary: &str) -> zbus::Result<Connection> {
    let bus = Connection::session()?;
    let id: u32 = bus
        .call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "Notify",
            &(
                "domicile-test-client",
                0u32,
                "",
                summary,
                "",
                vec!["default", ""],
                HashMap::<&str, Value<'_>>::new(),
                -1i32,
            ),
        )?
        .body()
        .deserialize()?;
    crate::say!("notifications", "notified({id})");
    Ok(bus)
}
