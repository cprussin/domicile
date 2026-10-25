//! The ScreenCast portal, from which a cast takes its picture. The shell
//! answers the request: with the TV's virtual monitor to extend the desk, or
//! with the share picker. See docs/architecture/CASTING-TO-TVS.md.

use std::collections::HashMap;
use std::os::fd::OwnedFd;
use std::sync::atomic::{AtomicU32, Ordering};

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const DESTINATION: &str = "org.freedesktop.portal.Desktop";
const PATH: &str = "/org/freedesktop/portal/desktop";
const SCREEN_CAST: &str = "org.freedesktop.portal.ScreenCast";

/// Monitors, windows and regions: whatever the shell offers.
const EVERY_SOURCE: u32 = 1 | 2 | 4;
/// The pointer drawn into the picture, as a TV has no pointer of its own.
const EMBEDDED_CURSOR: u32 = 2;

#[derive(Debug, thiserror::Error)]
pub enum PortalError {
    #[error(transparent)]
    Bus(#[from] zbus::Error),
    #[error("nothing was picked to cast")]
    Canceled,
    #[error("the desktop could not share the screen (portal response {0})")]
    Failed(u32),
    #[error("the desktop shared no picture")]
    NoStream,
}

impl From<zbus::fdo::Error> for PortalError {
    fn from(error: zbus::fdo::Error) -> Self {
        PortalError::Bus(error.into())
    }
}

/// A picture the portal shares, until dropped.
pub struct Shared {
    session: OwnedObjectPath,
    connection: Connection,
    /// The stream's PipeWire node.
    pub node: u32,
    /// The PipeWire remote the node is on.
    pub remote: OwnedFd,
}

impl Drop for Shared {
    fn drop(&mut self) {
        let _ = self.connection.call_method(
            Some(DESTINATION),
            self.session.as_str(),
            Some("org.freedesktop.portal.Session"),
            "Close",
            &(),
        );
    }
}

/// Asks the portal for a picture, as the shell answers.
pub fn share(connection: &Connection) -> Result<Shared, PortalError> {
    let session_token = token();
    let results = request(connection, "CreateSession", |handle| {
        (HashMap::from([
            ("handle_token", Value::from(handle)),
            ("session_handle_token", Value::from(session_token)),
        ]),)
    })?;
    let session = results
        .get("session_handle")
        .and_then(|value| String::try_from(value.clone()).ok())
        .and_then(|path| OwnedObjectPath::try_from(path).ok())
        .ok_or(PortalError::NoStream)?;
    request(connection, "SelectSources", |handle| {
        (
            &session,
            HashMap::from([
                ("handle_token", Value::from(handle)),
                ("types", Value::from(EVERY_SOURCE)),
                ("multiple", Value::from(false)),
                ("cursor_mode", Value::from(EMBEDDED_CURSOR)),
            ]),
        )
    })?;
    let started = request(connection, "Start", |handle| {
        (
            &session,
            "",
            HashMap::from([("handle_token", Value::from(handle))]),
        )
    })?;
    let node = started
        .get("streams")
        .and_then(|streams| {
            <Vec<(u32, HashMap<String, OwnedValue>)>>::try_from(streams.clone()).ok()
        })
        .and_then(|streams| streams.first().map(|(node, _)| *node))
        .ok_or(PortalError::NoStream)?;
    let proxy = Proxy::new(connection, DESTINATION, PATH, SCREEN_CAST)?;
    let options: HashMap<&str, Value> = HashMap::new();
    let remote: zbus::zvariant::OwnedFd = proxy.call("OpenPipeWireRemote", &(&session, options))?;
    Ok(Shared {
        session,
        connection: connection.clone(),
        node,
        remote: remote.into(),
    })
}

/// A unique handle token for this process.
fn token() -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    format!("domicile_miracast_{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

/// Calls `method` with the body `body` makes from a handle token, and waits
/// for its `Response`.
fn request<B>(
    connection: &Connection,
    method: &str,
    body: impl FnOnce(String) -> B,
) -> Result<HashMap<String, OwnedValue>, PortalError>
where
    B: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    let handle = token();
    let sender = connection
        .unique_name()
        .map(|name| name.trim_start_matches(':').replace('.', "_"))
        .unwrap_or_default();
    let path = format!("{PATH}/request/{sender}/{handle}");
    // Subscribed before the call, so a quick response is not missed.
    let request = Proxy::new(
        connection,
        DESTINATION,
        path,
        "org.freedesktop.portal.Request",
    )?;
    let mut responses = request.receive_signal("Response")?;
    let screen_cast = Proxy::new(connection, DESTINATION, PATH, SCREEN_CAST)?;
    let _: OwnedObjectPath = screen_cast.call(method, &body(handle.clone()))?;
    let response = responses.next().ok_or(PortalError::NoStream)?;
    let (code, results): (u32, HashMap<String, OwnedValue>) = response.body().deserialize()?;
    match code {
        0 => Ok(results),
        1 => Err(PortalError::Canceled),
        code => Err(PortalError::Failed(code)),
    }
}
