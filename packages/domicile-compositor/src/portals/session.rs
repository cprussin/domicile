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

/// End the session at `handle` from the desktop's side, as when the user
/// stops it: what it started ends, the application hears `Closed`, and the
/// object goes. Nothing happens if the application closed it first.
pub async fn end(server: &ObjectServer, handle: &OwnedObjectPath) -> zbus::Result<()> {
    match server.interface::<_, Session>(handle).await {
        Ok(session) => {
            if let Some(closed) = session.get_mut().await.closed.take() {
                closed();
            }
            Session::closed_signal(session.signal_emitter()).await?;
            server.remove::<Session, _>(handle).await?;
            Ok(())
        }
        Err(zbus::Error::InterfaceNotFound) => Ok(()),
        Err(other) => Err(other),
    }
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

    /// The desktop ended the session. See [`end`].
    #[zbus(signal, name = "Closed")]
    async fn closed_signal(emitter: &SignalEmitter<'_>) -> zbus::Result<()>;

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

    use crate::portals::settings::{Appearance, Settings};
    use crate::portals::socket_pair::connected;

    const HANDLE: &str = "/org/freedesktop/portal/desktop/session/1_7/s";

    #[test]
    fn closing_a_session_ends_what_it_started_and_takes_it_down() {
        // Any object starts the object server before the connection does.
        let (server, client) = connected(|builder| {
            builder
                .serve_at(
                    "/",
                    Settings {
                        theme: Theme::Dark,
                        appearance: Appearance::default(),
                    },
                )
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

    #[test]
    fn a_session_the_desktop_ends_tells_the_application() {
        let (server, client) = connected(|builder| {
            builder
                .serve_at(
                    "/",
                    Settings {
                        theme: Theme::Dark,
                        appearance: Appearance::default(),
                    },
                )
                .expect("served")
        });
        let (ended, heard) = channel();
        let handle = OwnedObjectPath::try_from(HANDLE).expect("a path");
        zbus::block_on(open(server.object_server().inner(), &handle, move || {
            ended.send(()).expect("the test listens");
        }))
        .expect("opened");
        let closed = zbus::blocking::MessageIterator::for_match_rule(
            zbus::MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface("org.freedesktop.impl.portal.Session")
                .expect("a name")
                .member("Closed")
                .expect("a name")
                .build(),
            &client,
            None,
        )
        .expect("listening");

        zbus::block_on(end(server.object_server().inner(), &handle)).expect("ended");

        assert_eq!(heard.try_recv(), Ok(()));
        let signal = closed.into_iter().next().expect("a signal").expect("read");
        assert_eq!(
            signal.header().path().map(|path| path.as_str()),
            Some(HANDLE)
        );
    }
}
