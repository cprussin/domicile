//! `org.freedesktop.impl.portal.Clipboard`: the seat's clipboard, shared with
//! a RemoteDesktop session the user granted it to.
//!
//! The Wayland thread owns the selection. It hears a [`Selection`] from here,
//! and tells the portal thread when the selection changes and when a client
//! pastes the session's offer (see [`super::Told`]). A paste hands the
//! application the pasting client's pipe, so the data never passes through
//! the compositor.

use std::collections::HashMap;
use std::os::fd::OwnedFd;

use zbus::fdo;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::Backends;

/// The `org.freedesktop.impl.portal.Clipboard` version implemented.
const INTERFACE_VERSION: u32 = 1;

/// What the backend asks of the Wayland thread.
#[derive(Debug)]
pub enum Selection {
    /// Make `session`'s offer of `mime_types` the seat's clipboard.
    Offer {
        session: OwnedObjectPath,
        mime_types: Vec<String>,
    },
    /// Write the clipboard, as `mime_type`, into `into`.
    Read { mime_type: String, into: OwnedFd },
}

/// Pastes of a session's offer, waiting for the application to write them.
#[derive(Default)]
pub struct Transfers {
    next_serial: u32,
    pending: HashMap<u32, (OwnedObjectPath, OwnedFd)>,
}

impl Transfers {
    /// Hold `fd` for `session` and return the serial its signal carries.
    pub fn hold(&mut self, session: OwnedObjectPath, fd: OwnedFd) -> u32 {
        self.next_serial += 1;
        self.pending.insert(self.next_serial, (session, fd));
        self.next_serial
    }
}

/// The `Clipboard` backend object.
pub struct Clipboard {
    pub backends: Backends,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.Clipboard")]
impl Clipboard {
    /// Ask for the clipboard in the session's grant. Called before `Start`.
    async fn request_clipboard(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<()> {
        self.backends.remotes.ask_for_the_clipboard(&session_handle)
    }

    /// Offer the application's data as the clipboard.
    async fn set_selection(
        &self,
        session_handle: OwnedObjectPath,
        options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<()> {
        self.backends.remotes.sharing(&session_handle)?;
        let mime_types = options
            .get("mime_types")
            .and_then(|value| Vec::<String>::try_from(value.try_clone().ok()?).ok())
            .ok_or_else(|| fdo::Error::InvalidArgs("no mime_types".into()))?;
        self.backends.select(Selection::Offer {
            session: session_handle,
            mime_types,
        })
    }

    /// The pipe to write the paste `serial` asked for.
    async fn selection_write(
        &self,
        session_handle: OwnedObjectPath,
        serial: u32,
    ) -> fdo::Result<zbus::zvariant::OwnedFd> {
        let mut transfers = self.backends.transfers.lock().unwrap();
        match transfers.pending.remove(&serial) {
            Some((session, fd)) if session == session_handle => Ok(fd.into()),
            Some(other) => {
                transfers.pending.insert(serial, other);
                Err(fdo::Error::AccessDenied(format!(
                    "paste {serial} is another session's"
                )))
            }
            None => Err(fdo::Error::InvalidArgs(format!("no paste {serial}"))),
        }
    }

    /// The application is done with paste `serial`. One it never took is
    /// dropped, so the pasting client reads nothing.
    async fn selection_write_done(
        &self,
        session_handle: OwnedObjectPath,
        serial: u32,
        _success: bool,
    ) -> fdo::Result<()> {
        let mut transfers = self.backends.transfers.lock().unwrap();
        if transfers
            .pending
            .get(&serial)
            .is_some_and(|(session, _)| *session == session_handle)
        {
            transfers.pending.remove(&serial);
        }
        Ok(())
    }

    /// A pipe the clipboard, as `mime_type`, is written into.
    async fn selection_read(
        &self,
        session_handle: OwnedObjectPath,
        mime_type: String,
    ) -> fdo::Result<zbus::zvariant::OwnedFd> {
        self.backends.remotes.sharing(&session_handle)?;
        let (read, write) = crate::clipboard::pipe()
            .map_err(|why| fdo::Error::Failed(format!("no pipe: {why}")))?;
        self.backends.select(Selection::Read {
            mime_type,
            into: write,
        })?;
        Ok(read.into())
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

/// The `SelectionOwnerChanged` options for one session.
pub fn owner_changed(mime_types: &[String], is_owner: bool) -> HashMap<String, OwnedValue> {
    HashMap::from([
        (
            "mime_types".to_string(),
            OwnedValue::try_from(Value::from(mime_types.to_vec())).expect("strings are ownable"),
        ),
        ("session_is_owner".to_string(), OwnedValue::from(is_owner)),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::time::Duration;

    use domicile_protocol::{Devices, PortalAnswer, PortalKind, RemoteDesktopDialog};
    use zbus::blocking::MessageIterator;
    use zbus::MatchRule;

    use crate::portals::fixture::{
        call, next, options, path, served, starting, Results, Served, SESSION,
    };
    use crate::portals::restore::Tokens;

    const CLIPBOARD: &str = "org.freedesktop.impl.portal.Clipboard";
    const TEXT: &str = "text/plain;charset=utf-8";

    /// A session that asked for the keyboard and the clipboard, granted
    /// `clipboard`.
    fn sharing(served: &Served, clipboard: bool) -> Results {
        let started = starting(served, options(vec![("types", Value::from(1u32))]), true);
        let (items, _) = next(served);
        assert_eq!(
            items[0].kind,
            PortalKind::RemoteDesktop(RemoteDesktopDialog {
                devices: Devices {
                    keyboard: true,
                    ..Devices::default()
                },
                clipboard: true,
            })
        );
        served.backends.queue.answer(
            items[0].id,
            PortalAnswer::RemoteDesktop {
                devices: Devices {
                    keyboard: true,
                    ..Devices::default()
                },
                clipboard,
            },
        );
        started.join().expect("Start returned").1
    }

    fn signals(served: &Served, member: &'static str) -> MessageIterator {
        MessageIterator::for_match_rule(
            MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface(CLIPBOARD)
                .expect("a name")
                .member(member)
                .expect("a name")
                .build(),
            &served.client,
            None,
        )
        .expect("listening")
    }

    fn read_all(fd: OwnedFd) -> String {
        let mut read = String::new();
        std::fs::File::from(fd)
            .read_to_string(&mut read)
            .expect("it reads");
        read
    }

    #[track_caller]
    fn selected(served: &Served) -> Selection {
        served
            .selections
            .recv_timeout(Duration::from_secs(10))
            .expect("the backend asked the clipboard")
    }

    #[test]
    fn a_session_shares_the_clipboard_when_the_user_lets_it() {
        let served = served(Tokens::load(None));
        let results = sharing(&served, true);

        assert_eq!(
            results.get("clipboard_enabled"),
            Some(&OwnedValue::from(true))
        );
    }

    #[test]
    fn a_session_the_user_kept_off_the_clipboard_cannot_set_it() {
        let served = served(Tokens::load(None));
        sharing(&served, false);

        let refused = call(
            &served,
            CLIPBOARD,
            "SetSelection",
            &(
                path(SESSION),
                options(vec![("mime_types", Value::from(vec![TEXT]))]),
            ),
        );

        assert!(refused.is_err());
    }

    #[test]
    fn a_client_pasting_the_sessions_offer_is_written_by_the_application() {
        let served = served(Tokens::load(None));
        sharing(&served, true);
        let transfers = signals(&served, "SelectionTransfer");
        call(
            &served,
            CLIPBOARD,
            "SetSelection",
            &(
                path(SESSION),
                options(vec![("mime_types", Value::from(vec![TEXT]))]),
            ),
        )
        .expect("SetSelection answered");
        let Selection::Offer {
            session,
            mime_types,
        } = selected(&served)
        else {
            panic!("an offer")
        };
        assert_eq!(
            (session.as_str(), mime_types),
            (SESSION, vec![TEXT.to_string()])
        );

        // A client pastes: the Wayland thread hands over its pipe.
        let (pasted, paste) = crate::clipboard::pipe().expect("a pipe");
        served.backends.transfer(session, TEXT.into(), paste);
        let signal = transfers
            .into_iter()
            .next()
            .expect("a signal")
            .expect("read");
        let (_, mime_type, serial): (OwnedObjectPath, String, u32) =
            signal.body().deserialize().expect("its arguments");
        assert_eq!(mime_type, TEXT);
        let write = call(
            &served,
            CLIPBOARD,
            "SelectionWrite",
            &(path(SESSION), serial),
        )
        .expect("SelectionWrite answered");
        let write: zbus::zvariant::OwnedFd = write.body().deserialize().expect("a pipe");
        std::fs::File::from(OwnedFd::from(write))
            .write_all(b"from afar")
            .expect("it writes");
        call(
            &served,
            CLIPBOARD,
            "SelectionWriteDone",
            &(path(SESSION), serial, true),
        )
        .expect("SelectionWriteDone answered");

        // Not to the end: the test's own connection keeps a copy of every fd
        // it was sent, so the pipe never closes.
        let mut arrived = [0u8; 9];
        std::fs::File::from(pasted)
            .read_exact(&mut arrived)
            .expect("it reads");
        assert_eq!(&arrived, b"from afar");
    }

    #[test]
    fn the_application_reads_the_clipboard_and_hears_it_change() {
        let served = served(Tokens::load(None));
        sharing(&served, true);
        let changes = signals(&served, "SelectionOwnerChanged");

        served.backends.selection_changed(vec![TEXT.into()], None);
        let signal = changes.into_iter().next().expect("a signal").expect("read");
        let (session, changed): (OwnedObjectPath, Results) =
            signal.body().deserialize().expect("its arguments");
        assert_eq!(session.as_str(), SESSION);
        assert_eq!(changed, owner_changed(&[TEXT.into()], false));

        let read = call(&served, CLIPBOARD, "SelectionRead", &(path(SESSION), TEXT))
            .expect("SelectionRead answered");
        let read: zbus::zvariant::OwnedFd = read.body().deserialize().expect("a pipe");
        let Selection::Read { mime_type, into } = selected(&served) else {
            panic!("a read")
        };
        assert_eq!(mime_type, TEXT);
        std::fs::File::from(into)
            .write_all(b"copied here")
            .expect("it writes");

        assert_eq!(read_all(read.into()), "copied here");
    }
}
