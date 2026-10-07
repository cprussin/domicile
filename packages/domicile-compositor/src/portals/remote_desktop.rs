//! `org.freedesktop.impl.portal.RemoteDesktop`: an application controls the
//! desk's input, after the user grants it devices.
//!
//! Input arrives over EIS (`ConnectToEIS`) or the legacy `Notify*` methods.
//! Both take [`crate::eis`]'s path, so the lock refuses them. A running
//! session is listed for the shell until it ends; see [`super::queue`].

use std::collections::HashMap;
use std::sync::Mutex;

use domicile_protocol::{CapturingKind, Devices, PortalAnswer, PortalKind, RemoteDesktopDialog};
use zbus::fdo;
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::queue::{ask, Listed};
use super::restore::Grant;
use super::{session, Backends, Told};
use crate::eis::{self, Capabilities, Emulated, Emulator};

/// The `org.freedesktop.impl.portal.RemoteDesktop` version implemented.
const INTERFACE_VERSION: u32 = 2;

/// Device type bits, as the portal numbers them.
const KEYBOARD: u32 = 1;
const POINTER: u32 = 2;
const TOUCHSCREEN: u32 = 4;

/// The vendor in a restore token, so a token from another backend is never
/// read as ours.
const VENDOR: &str = "domicile";
const RESTORE_VERSION: u32 = 1;

/// The `RemoteDesktop` backend object.
pub struct RemoteDesktop {
    pub backends: Backends,
}

/// Every RemoteDesktop session, by handle. Clipboard reads them too.
#[derive(Default)]
pub struct Remotes(Mutex<HashMap<OwnedObjectPath, Remote>>);

/// One session, from `CreateSession` until it closes.
struct Remote {
    asked: Devices,
    clipboard_asked: bool,
    persist_mode: u32,
    /// The token `SelectDevices` offered.
    restore: Option<String>,
    started: Option<Started>,
}

/// A started session: what it may do, and what it holds.
struct Started {
    devices: Devices,
    clipboard: bool,
    emulator: Emulator,
    /// Each `ConnectToEIS` socket, open while the session is.
    contexts: Vec<eis::Session>,
    /// Its entry in the shell's list, taken off when it ends.
    _listed: Listed,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.RemoteDesktop")]
impl RemoteDesktop {
    /// Open a session that asks for every device until `SelectDevices` says
    /// otherwise.
    async fn create_session(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        _handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        self.backends.remotes.0.lock().unwrap().insert(
            session_handle.clone(),
            Remote {
                asked: devices(KEYBOARD | POINTER | TOUCHSCREEN),
                clipboard_asked: false,
                persist_mode: 0,
                restore: None,
                started: None,
            },
        );
        let remotes = std::sync::Arc::clone(&self.backends.remotes);
        let closing = session_handle.clone();
        session::open(server, &session_handle, move || {
            remotes.0.lock().unwrap().remove(&closing);
        })
        .await?;
        Ok((0, HashMap::new()))
    }

    /// Which devices to ask for, and whether and how to keep the grant.
    async fn select_devices(
        &self,
        _handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        _app_id: String,
        options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        self.backends.remotes.with(&session_handle, |remote| {
            if let Some(types) = number(&options, "types") {
                remote.asked = devices(types);
            }
            remote.persist_mode = number(&options, "persist_mode").unwrap_or(0);
            remote.restore = options.get("restore_data").and_then(token);
        })?;
        Ok((0, HashMap::new()))
    }

    /// Ask the user, unless a restore token stands for an earlier answer, and
    /// start the session with what was granted.
    async fn start(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        let (asked, clipboard_asked, persist_mode, restore) =
            self.backends.remotes.with(&session_handle, |remote| {
                (
                    remote.asked,
                    remote.clipboard_asked,
                    remote.persist_mode,
                    remote.restore.take(),
                )
            })?;
        let restored =
            restore.and_then(|token| self.backends.tokens.lock().unwrap().take(&app_id, &token));
        let granted = match restored {
            Some(grant) => Ok(grant),
            None => {
                let kind = PortalKind::RemoteDesktop(RemoteDesktopDialog {
                    devices: asked,
                    clipboard: clipboard_asked,
                });
                match ask(
                    &self.backends.queue,
                    server,
                    handle,
                    app_id.clone(),
                    &parent_window,
                    kind,
                )
                .await
                {
                    PortalAnswer::RemoteDesktop { devices, clipboard } => Ok(Grant {
                        app_id: app_id.clone(),
                        devices: both(asked, devices),
                        clipboard: clipboard_asked && clipboard,
                    }),
                    // The user dismissed it, or no shell could ask.
                    PortalAnswer::Canceled => Err(1),
                    _ => Err(2),
                }
            }
        };
        match granted {
            Ok(grant) => {
                let results = self.begin(&session_handle, grant.clone(), persist_mode)?;
                Ok((0, results))
            }
            Err(response) => Ok((response, HashMap::new())),
        }
    }

    async fn notify_pointer_motion(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        dx: f64,
        dy: f64,
    ) -> fdo::Result<()> {
        self.emulate(&session_handle, POINTER, Emulated::Motion { dx, dy })
    }

    /// Refused: a stream is a screen this session shares, and it shares none.
    async fn notify_pointer_motion_absolute(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        stream: u32,
        _x: f64,
        _y: f64,
    ) -> fdo::Result<()> {
        self.on_a_stream(&session_handle, POINTER, stream)
    }

    async fn notify_pointer_button(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        button: i32,
        state: u32,
    ) -> fdo::Result<()> {
        let button = u32::try_from(button)
            .map_err(|_| fdo::Error::InvalidArgs(format!("no button {button}")))?;
        self.emulate(
            &session_handle,
            POINTER,
            Emulated::Button {
                button,
                pressed: state == 1,
            },
        )
    }

    async fn notify_pointer_axis(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        dx: f64,
        dy: f64,
    ) -> fdo::Result<()> {
        self.emulate(&session_handle, POINTER, Emulated::Scroll { dx, dy })
    }

    /// `axis` 0 is vertical and 1 horizontal; each step is one wheel click.
    async fn notify_pointer_axis_discrete(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        axis: u32,
        steps: i32,
    ) -> fdo::Result<()> {
        let clicks = steps.saturating_mul(120);
        let emulated = match axis {
            0 => Emulated::ScrollDiscrete {
                v120_x: 0,
                v120_y: clicks,
            },
            1 => Emulated::ScrollDiscrete {
                v120_x: clicks,
                v120_y: 0,
            },
            _ => return Err(fdo::Error::InvalidArgs(format!("no axis {axis}"))),
        };
        self.emulate(&session_handle, POINTER, emulated)
    }

    async fn notify_keyboard_keycode(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        keycode: i32,
        state: u32,
    ) -> fdo::Result<()> {
        let keycode = u32::try_from(keycode)
            .map_err(|_| fdo::Error::InvalidArgs(format!("no key {keycode}")))?;
        self.emulate(
            &session_handle,
            KEYBOARD,
            Emulated::Key {
                keycode,
                pressed: state == 1,
            },
        )
    }

    async fn notify_keyboard_keysym(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        keysym: i32,
        state: u32,
    ) -> fdo::Result<()> {
        let keysym = u32::try_from(keysym)
            .map_err(|_| fdo::Error::InvalidArgs(format!("no keysym {keysym}")))?;
        self.granted(&session_handle, KEYBOARD, |started| {
            started.emulator.keysym(keysym, state == 1)
        })
    }

    /// Refused like [`Self::notify_pointer_motion_absolute`].
    async fn notify_touch_down(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        stream: u32,
        _slot: u32,
        _x: f64,
        _y: f64,
    ) -> fdo::Result<()> {
        self.on_a_stream(&session_handle, TOUCHSCREEN, stream)
    }

    /// Refused like [`Self::notify_pointer_motion_absolute`].
    async fn notify_touch_motion(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        stream: u32,
        _slot: u32,
        _x: f64,
        _y: f64,
    ) -> fdo::Result<()> {
        self.on_a_stream(&session_handle, TOUCHSCREEN, stream)
    }

    async fn notify_touch_up(
        &self,
        session_handle: OwnedObjectPath,
        _options: HashMap<String, OwnedValue>,
        slot: u32,
    ) -> fdo::Result<()> {
        self.emulate(&session_handle, TOUCHSCREEN, Emulated::TouchUp { id: slot })
    }

    /// A libei socket for the granted devices, open while the session is.
    #[zbus(name = "ConnectToEIS")]
    async fn connect_to_eis(
        &self,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<zbus::zvariant::OwnedFd> {
        let eis = self.backends.eis()?;
        self.backends.remotes.started(&session_handle, |started| {
            let (socket, context) = eis
                .connect(capabilities(started.devices))
                .map_err(|why| fdo::Error::Failed(format!("no EIS socket: {why}")))?;
            started.contexts.push(context);
            Ok(socket.into())
        })?
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn available_device_types(&self) -> u32 {
        KEYBOARD | POINTER | TOUCHSCREEN
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

impl RemoteDesktop {
    /// Start `session_handle` with `grant`: list it for the shell and keep the
    /// grant for `persist_mode`. The `Start` results.
    fn begin(
        &self,
        session_handle: &OwnedObjectPath,
        grant: Grant,
        persist_mode: u32,
    ) -> fdo::Result<HashMap<String, OwnedValue>> {
        let emulator = self.backends.eis()?.emulate();
        let told = self.backends.told.clone();
        let stopping = session_handle.clone();
        let id = self.backends.queue.begin(
            grant.app_id.clone(),
            CapturingKind::RemoteDesktop {
                devices: grant.devices,
                clipboard: grant.clipboard,
            },
            move || {
                // A closed channel means the service stopped.
                let _ = told.send(Told::End(stopping));
            },
        );
        let listed = Listed::new(id, &self.backends.queue);
        self.backends.remotes.with(session_handle, |remote| {
            remote.started = Some(Started {
                devices: grant.devices,
                clipboard: grant.clipboard,
                emulator,
                contexts: Vec::new(),
                _listed: listed,
            });
        })?;
        let mut results = HashMap::from([
            ("devices".to_string(), OwnedValue::from(bits(grant.devices))),
            (
                "clipboard_enabled".to_string(),
                OwnedValue::from(grant.clipboard),
            ),
        ]);
        if let Some(token) = self
            .backends
            .tokens
            .lock()
            .unwrap()
            .keep(grant, persist_mode)
        {
            results.insert(
                "restore_data".to_string(),
                owned(Value::from((VENDOR, RESTORE_VERSION, Value::from(token)))),
            );
            results.insert("persist_mode".to_string(), OwnedValue::from(persist_mode));
        }
        Ok(results)
    }

    /// Send `emulated` if the session was granted `device`.
    fn emulate(
        &self,
        session_handle: &OwnedObjectPath,
        device: u32,
        emulated: Emulated,
    ) -> fdo::Result<()> {
        self.granted(session_handle, device, |started| {
            started.emulator.send(emulated)
        })
    }

    fn on_a_stream(
        &self,
        session_handle: &OwnedObjectPath,
        device: u32,
        stream: u32,
    ) -> fdo::Result<()> {
        self.granted(session_handle, device, |_| ())?;
        Err(fdo::Error::InvalidArgs(format!(
            "no stream {stream}: this session shares no screen"
        )))
    }

    /// Run `act` on a started session granted `device`.
    fn granted<T>(
        &self,
        session_handle: &OwnedObjectPath,
        device: u32,
        act: impl FnOnce(&mut Started) -> T,
    ) -> fdo::Result<T> {
        self.backends.remotes.started(session_handle, |started| {
            if bits(started.devices) & device == device {
                Ok(act(started))
            } else {
                Err(fdo::Error::AccessDenied(
                    "the session was not granted this device".into(),
                ))
            }
        })?
    }
}

impl Remotes {
    /// Ask for the clipboard in `handle`'s grant.
    pub fn ask_for_the_clipboard(&self, handle: &OwnedObjectPath) -> fdo::Result<()> {
        self.with(handle, |remote| remote.clipboard_asked = true)
    }

    /// Whether `handle` started with the clipboard: an error if not.
    pub fn sharing(&self, handle: &OwnedObjectPath) -> fdo::Result<()> {
        if self.started(handle, |started| started.clipboard)? {
            Ok(())
        } else {
            Err(fdo::Error::AccessDenied(
                "the session was not granted the clipboard".into(),
            ))
        }
    }

    /// Every started session sharing the clipboard.
    pub fn sharing_sessions(&self) -> Vec<OwnedObjectPath> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, remote)| {
                remote
                    .started
                    .as_ref()
                    .is_some_and(|started| started.clipboard)
            })
            .map(|(handle, _)| handle.clone())
            .collect()
    }

    /// Run `act` on the session at `handle`.
    fn with<T>(
        &self,
        handle: &OwnedObjectPath,
        act: impl FnOnce(&mut Remote) -> T,
    ) -> fdo::Result<T> {
        self.0
            .lock()
            .unwrap()
            .get_mut(handle)
            .map(act)
            .ok_or_else(|| fdo::Error::InvalidArgs(format!("no session {handle}")))
    }

    /// Run `act` on the started session at `handle`.
    fn started<T>(
        &self,
        handle: &OwnedObjectPath,
        act: impl FnOnce(&mut Started) -> T,
    ) -> fdo::Result<T> {
        self.with(handle, |remote| remote.started.as_mut().map(act))?
            .ok_or_else(|| fdo::Error::Failed(format!("session {handle} has not started")))
    }
}

/// Devices from the portal's bits.
fn devices(types: u32) -> Devices {
    Devices {
        keyboard: types & KEYBOARD != 0,
        pointer: types & POINTER != 0,
        touchscreen: types & TOUCHSCREEN != 0,
    }
}

/// The portal's bits for `devices`.
fn bits(devices: Devices) -> u32 {
    [
        (devices.keyboard, KEYBOARD),
        (devices.pointer, POINTER),
        (devices.touchscreen, TOUCHSCREEN),
    ]
    .into_iter()
    .filter(|(has, _)| *has)
    .fold(0, |all, (_, bit)| all | bit)
}

/// The devices both grant.
fn both(asked: Devices, granted: Devices) -> Devices {
    devices(bits(asked) & bits(granted))
}

/// What EIS serves for `devices`: a pointer moves both ways.
fn capabilities(devices: Devices) -> Capabilities {
    Capabilities {
        pointer: devices.pointer,
        pointer_absolute: devices.pointer,
        keyboard: devices.keyboard,
        touch: devices.touchscreen,
    }
}

/// A `u` option. One of another type reads as absent.
fn number(options: &HashMap<String, OwnedValue>, name: &str) -> Option<u32> {
    options
        .get(name)
        .and_then(|value| u32::try_from(value).ok())
}

/// The token in a `restore_data` of ours. Another vendor's reads as none.
fn token(restore: &OwnedValue) -> Option<String> {
    match &**restore {
        Value::Structure(fields) => match fields.fields() {
            [Value::Str(vendor), Value::U32(version), Value::Value(token)]
                if vendor.as_str() == VENDOR && *version == RESTORE_VERSION =>
            {
                match &**token {
                    Value::Str(token) => Some(token.to_string()),
                    _ => None,
                }
            }
            _ => None,
        },
        _ => None,
    }
}

fn owned(value: Value<'_>) -> OwnedValue {
    OwnedValue::try_from(value).expect("a value with no file descriptor is ownable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use zbus::zvariant::Value;

    use crate::eis::recorded::{a_client, Saw};
    use crate::portals::fixture::{
        call, next, options, path, served, starting, Results, Served, APP, SESSION,
    };
    use crate::portals::restore::Tokens;
    use crate::ClientRequest;

    const REMOTE_DESKTOP: &str = "org.freedesktop.impl.portal.RemoteDesktop";

    const KEYBOARD: u32 = 1;
    const POINTER: u32 = 2;

    /// A session that asked for the keyboard, granted everything.
    fn a_keyboard_session(served: &Served) -> Results {
        a_session(served, KEYBOARD)
    }

    /// A session that asked for `types`, granted everything.
    fn a_session(served: &Served, types: u32) -> Results {
        let started = starting(served, options(vec![("types", Value::from(types))]), false);
        let (items, _) = next(served);
        assert_eq!(
            items[0].kind,
            PortalKind::RemoteDesktop(RemoteDesktopDialog {
                devices: devices(types),
                clipboard: false,
            })
        );
        served.backends.queue.answer(
            items[0].id,
            PortalAnswer::RemoteDesktop {
                devices: Devices {
                    keyboard: true,
                    pointer: true,
                    touchscreen: true,
                },
                clipboard: true,
            },
        );
        let (response, results) = started.join().expect("Start returned");
        assert_eq!(response, 0);
        results
    }

    fn keycode(served: &Served, pressed: u32) -> zbus::Result<zbus::message::Message> {
        call(
            served,
            REMOTE_DESKTOP,
            "NotifyKeyboardKeycode",
            &(path(SESSION), Results::new(), 30i32, pressed),
        )
    }

    #[test]
    fn a_session_gets_no_more_than_it_asked_for() {
        let served = served(Tokens::load(None));
        let results = a_keyboard_session(&served);

        assert_eq!(results.get("devices"), Some(&OwnedValue::from(KEYBOARD)));
        assert_eq!(
            results.get("clipboard_enabled"),
            Some(&OwnedValue::from(false))
        );
        keycode(&served, 1).expect("a granted key");
        assert_eq!(
            served.injected.recv_timeout(Duration::from_secs(10)),
            Ok(ClientRequest::Key {
                keycode: 30,
                pressed: true
            })
        );
        assert!(
            call(
                &served,
                REMOTE_DESKTOP,
                "NotifyPointerMotion",
                &(path(SESSION), Results::new(), 1.0, 1.0)
            )
            .is_err(),
            "the pointer was not asked for"
        );
    }

    #[test]
    fn an_eis_client_gets_the_granted_devices() {
        let served = served(Tokens::load(None));
        a_keyboard_session(&served);

        let socket = call(
            &served,
            REMOTE_DESKTOP,
            "ConnectToEIS",
            &(path(SESSION), APP, Results::new()),
        )
        .expect("ConnectToEIS answered");
        let socket: zbus::zvariant::OwnedFd = socket.body().deserialize().expect("a socket");
        let seen = a_client(socket.into(), 1, |_, _| {});

        assert_eq!(
            seen.recv_timeout(Duration::from_secs(10)),
            Ok(Saw::Devices(vec![("keyboard".into(), vec![])]))
        );
    }

    #[test]
    fn the_shell_lists_a_running_session_and_can_stop_it() {
        let served = served(Tokens::load(None));
        a_session(&served, KEYBOARD);
        let capturing = loop {
            let (_, capturing) = next(&served);
            if !capturing.is_empty() {
                break capturing;
            }
        };
        assert_eq!(
            capturing
                .iter()
                .map(|session| &session.kind)
                .collect::<Vec<_>>(),
            [&CapturingKind::RemoteDesktop {
                devices: Devices {
                    keyboard: true,
                    ..Devices::default()
                },
                clipboard: false,
            }]
        );
        keycode(&served, 1).expect("a granted key");

        served
            .backends
            .queue
            .answer(capturing[0].id, PortalAnswer::Stop);

        assert_eq!(next(&served).1, []);
        let released = served
            .injected
            .iter()
            .find(|request| matches!(request, ClientRequest::Key { pressed: false, .. }));
        assert!(released.is_some(), "the held key is let go");
        assert!(keycode(&served, 0).is_err(), "the session is gone");
    }

    #[test]
    fn a_restore_token_starts_the_session_again_without_asking() {
        let served = served(Tokens::load(None));
        let results = {
            let started = starting(
                &served,
                options(vec![
                    ("types", Value::from(KEYBOARD)),
                    ("persist_mode", Value::from(1u32)),
                ]),
                false,
            );
            let (items, _) = next(&served);
            served.backends.queue.answer(
                items[0].id,
                PortalAnswer::RemoteDesktop {
                    devices: Devices {
                        keyboard: true,
                        ..Devices::default()
                    },
                    clipboard: false,
                },
            );
            started.join().expect("Start returned").1
        };
        let restore = results.get("restore_data").expect("a token").clone();
        served
            .client
            .call_method(
                None::<&str>,
                SESSION,
                Some("org.freedesktop.impl.portal.Session"),
                "Close",
                &(),
            )
            .expect("closed");

        let (response, again) = starting(
            &served,
            options(vec![("restore_data", Value::from(restore))]),
            false,
        )
        .join()
        .expect("Start returned");

        assert_eq!(response, 0);
        assert_eq!(again.get("devices"), Some(&OwnedValue::from(KEYBOARD)));
        assert!(
            served
                .published
                .try_iter()
                .all(|(items, _)| items.is_empty()),
            "no dialog"
        );
    }

    #[test]
    fn a_point_needs_a_shared_screen_to_land_on() {
        let served = served(Tokens::load(None));
        a_session(&served, POINTER);

        let refused = call(
            &served,
            REMOTE_DESKTOP,
            "NotifyPointerMotionAbsolute",
            &(path(SESSION), Results::new(), 0u32, 1.0, 1.0),
        );

        assert!(refused.is_err());
    }
}
