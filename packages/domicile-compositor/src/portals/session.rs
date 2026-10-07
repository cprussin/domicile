//! `org.freedesktop.impl.portal.Session`: the frontend's handle on a
//! session that outlives one dialog, such as a screen cast.

use zbus::object_server::{ObjectServer, SignalEmitter};
use zbus::zvariant::OwnedObjectPath;

/// The `org.freedesktop.impl.portal.Session` version implemented.
const INTERFACE_VERSION: u32 = 1;

/// One session's object. `closed` ends what the session started.
pub struct Session {
    closed: Option<Box<dyn FnOnce() + Send + Sync>>,
}

/// Export a session at `handle`. `closed` runs once, when the application
/// closes it.
// The interfaces that open sessions (ScreenCast, RemoteDesktop,
// InputCapture) are later phases of docs/architecture/PORTALS.md.
#[allow(dead_code)]
pub async fn open(
    server: &ObjectServer,
    handle: &OwnedObjectPath,
    closed: impl FnOnce() + Send + Sync + 'static,
) -> zbus::Result<bool> {
    server
        .at(
            handle,
            Session {
                closed: Some(Box::new(closed)),
            },
        )
        .await
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Session")]
impl Session {
    /// The application ended the session. The object goes with it.
    async fn close(
        &mut self,
        #[zbus(object_server)] server: &ObjectServer,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> zbus::fdo::Result<()> {
        if let Some(closed) = self.closed.take() {
            closed();
        }
        server.remove::<Session, _>(emitter.path()).await?;
        Ok(())
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    use domicile_protocol::Theme;

    use crate::portals::settings::Settings;
    use crate::portals::socket_pair::connected;

    const HANDLE: &str = "/org/freedesktop/portal/desktop/session/1_7/s";

    #[test]
    fn closing_a_session_ends_what_it_started_and_takes_it_down() {
        // Any object starts the object server before the connection does.
        let (server, client) = connected(|builder| {
            builder
                .serve_at("/", Settings { theme: Theme::Dark })
                .expect("served")
        });
        let (ended, heard) = channel();
        let handle = OwnedObjectPath::try_from(HANDLE).expect("a path");
        zbus::block_on(open(server.object_server().inner(), &handle, move || {
            ended.send(()).expect("the test listens");
        }))
        .expect("opened");
        let close = || {
            client.call_method(
                None::<&str>,
                HANDLE,
                Some("org.freedesktop.impl.portal.Session"),
                "Close",
                &(),
            )
        };

        close().expect("Close answered");

        assert_eq!(heard.try_recv(), Ok(()));
        assert!(close().is_err(), "the session is gone");
    }
}
