//! `org.freedesktop.impl.portal.InputCapture`: an application takes the
//! desk's input once the pointer reaches a barrier it placed on a screen
//! edge, as a software KVM does.
//!
//! Zones are the displays. Barriers and capture run on the Wayland thread in
//! [`crate::eis`], which sends the input to the application's receiving EIS
//! client. See `docs/PORTALS.md`.

use std::collections::HashMap;
use std::sync::Mutex;

use domicile_protocol::{CapturingKind, Devices, InputCaptureDialog, PortalAnswer, PortalKind};
use zbus::fdo;
use zbus::object_server::ObjectServer;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use super::queue::{ask, Listed};
use super::{session, Backends, Told};
use crate::eis::barriers::{placed, Barrier, Zone};
use crate::eis::{self, Capabilities};

/// The `org.freedesktop.impl.portal.InputCapture` version implemented.
const INTERFACE_VERSION: u32 = 1;

/// Capability bits, as the portal numbers them.
const KEYBOARD: u32 = 1;
const POINTER: u32 = 2;

/// What can be captured. The engine forwards no touch, so no touchscreen.
const SUPPORTED: u32 = KEYBOARD | POINTER;

/// The displays as zones, and the serial of that arrangement.
#[derive(Debug, Default)]
pub struct Zones {
    pub set: u32,
    pub zones: Vec<Zone>,
}

impl Zones {
    /// Take `zones`, and say whether they changed.
    pub fn replace(&mut self, zones: Vec<Zone>) -> bool {
        let changed = zones != self.zones;
        if changed {
            self.set += 1;
            self.zones = zones;
        }
        changed
    }
}

/// Every InputCapture session, by handle.
#[derive(Default)]
pub struct Inputs(Mutex<HashMap<OwnedObjectPath, Input>>);

/// One session, granted at `CreateSession`.
struct Input {
    devices: Devices,
    barriers: Vec<Barrier>,
    enabled: bool,
    /// The receiving EIS context, once `ConnectToEIS` opened it.
    capture: Option<eis::Capture>,
    _listed: Listed,
}

/// The `InputCapture` backend object.
pub struct InputCapture {
    pub backends: Backends,
}

#[zbus::interface(name = "org.freedesktop.impl.portal.InputCapture")]
impl InputCapture {
    /// Ask the user, and open the session with what can be captured of what
    /// it asked for.
    async fn create_session(
        &self,
        #[zbus(object_server)] server: &ObjectServer,
        handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        app_id: String,
        parent_window: String,
        options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        let asked = options
            .get("capabilities")
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(SUPPORTED)
            & SUPPORTED;
        let devices = devices(asked);
        let kind = PortalKind::InputCapture(InputCaptureDialog { devices });
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
            PortalAnswer::InputCapture => {
                self.open(server, session_handle, app_id, devices).await?;
                Ok((
                    0,
                    HashMap::from([("capabilities".to_string(), OwnedValue::from(asked))]),
                ))
            }
            PortalAnswer::Canceled => Ok((1, HashMap::new())),
            _ => Ok((2, HashMap::new())),
        }
    }

    /// The displays, as `(width, height, x, y)`.
    async fn get_zones(
        &self,
        _handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        self.backends.inputs.with(&session_handle, |_| ())?;
        let zones = self.backends.zones.lock().unwrap();
        let listed: Vec<(u32, u32, i32, i32)> = zones
            .zones
            .iter()
            .map(|zone| (zone.width, zone.height, zone.x, zone.y))
            .collect();
        Ok((
            0,
            HashMap::from([
                ("zones".to_string(), owned(Value::from(listed))),
                ("zone_set".to_string(), OwnedValue::from(zones.set)),
            ]),
        ))
    }

    /// Place barriers on the outer edges of `zone_set`. Those that are not
    /// on one, or all of them for a stale `zone_set`, fail.
    #[allow(clippy::too_many_arguments)] // The spec's own signature.
    async fn set_pointer_barriers(
        &self,
        _handle: OwnedObjectPath,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
        barriers: Vec<HashMap<String, OwnedValue>>,
        zone_set: u32,
    ) -> fdo::Result<(u32, HashMap<String, OwnedValue>)> {
        let asked: Vec<(u32, [i32; 4])> = barriers.iter().filter_map(barrier).collect();
        let (accepted, failed) = {
            let zones = self.backends.zones.lock().unwrap();
            if zones.set == zone_set {
                placed(&zones.zones, &asked)
            } else {
                (Vec::new(), asked.iter().map(|(id, _)| *id).collect())
            }
        };
        self.backends.inputs.with(&session_handle, |input| {
            if let Some(capture) = &input.capture {
                capture.barriers(accepted.clone());
            }
            input.barriers = accepted;
        })?;
        Ok((
            0,
            HashMap::from([("failed_barriers".to_string(), owned(Value::from(failed)))]),
        ))
    }

    async fn enable(
        &self,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<()> {
        self.backends.inputs.enable(&session_handle, true)
    }

    async fn disable(
        &self,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<()> {
        self.backends.inputs.enable(&session_handle, false)
    }

    /// Give the input back. The pointer stays where it is: the compositor
    /// cannot move the engine's cursor.
    async fn release(
        &self,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<()> {
        self.backends.inputs.with(&session_handle, |input| {
            if let Some(capture) = &input.capture {
                capture.release();
            }
        })
    }

    /// A receiving libei socket for the captured input.
    #[zbus(name = "ConnectToEIS")]
    async fn connect_to_eis(
        &self,
        session_handle: OwnedObjectPath,
        _app_id: String,
        _options: HashMap<String, OwnedValue>,
    ) -> fdo::Result<zbus::zvariant::OwnedFd> {
        let eis = self.backends.eis()?;
        let told = self.backends.told.clone();
        let session = session_handle.clone();
        self.backends.inputs.with(&session_handle, |input| {
            let granted = Capabilities {
                pointer: input.devices.pointer,
                keyboard: input.devices.keyboard,
                ..Capabilities::default()
            };
            let (socket, capture) = eis
                .capture(granted, move |captured| {
                    // A closed channel means the service stopped.
                    let _ = told.send(Told::Captured {
                        session: session.clone(),
                        captured,
                    });
                })
                .map_err(|why| fdo::Error::Failed(format!("no EIS socket: {why}")))?;
            capture.barriers(input.barriers.clone());
            capture.enable(input.enabled);
            input.capture = Some(capture);
            Ok(socket.into())
        })?
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn supported_capabilities(&self) -> u32 {
        SUPPORTED
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn version(&self) -> u32 {
        INTERFACE_VERSION
    }
}

impl InputCapture {
    /// Open a granted session: list it for the shell and export its object.
    async fn open(
        &self,
        server: &ObjectServer,
        session_handle: OwnedObjectPath,
        app_id: String,
        devices: Devices,
    ) -> fdo::Result<()> {
        let told = self.backends.told.clone();
        let stopping = session_handle.clone();
        let id =
            self.backends
                .queue
                .begin(app_id, CapturingKind::InputCapture { devices }, move || {
                    // A closed channel means the service stopped.
                    let _ = told.send(Told::End(stopping));
                });
        self.backends.inputs.0.lock().unwrap().insert(
            session_handle.clone(),
            Input {
                devices,
                barriers: Vec::new(),
                enabled: false,
                capture: None,
                _listed: Listed::new(id, &self.backends.queue),
            },
        );
        let inputs = std::sync::Arc::clone(&self.backends.inputs);
        let closing = session_handle.clone();
        session::open(server, &session_handle, move || {
            inputs.0.lock().unwrap().remove(&closing);
        })
        .await?;
        Ok(())
    }
}

impl Inputs {
    fn with<T>(
        &self,
        handle: &OwnedObjectPath,
        act: impl FnOnce(&mut Input) -> T,
    ) -> fdo::Result<T> {
        self.0
            .lock()
            .unwrap()
            .get_mut(handle)
            .map(act)
            .ok_or_else(|| fdo::Error::InvalidArgs(format!("no session {handle}")))
    }

    fn enable(&self, handle: &OwnedObjectPath, enabled: bool) -> fdo::Result<()> {
        self.with(handle, |input| {
            input.enabled = enabled;
            if let Some(capture) = &input.capture {
                capture.enable(enabled);
            }
        })
    }

    /// The zones changed: every session's barriers are gone. Returns the
    /// sessions, to tell.
    pub fn rezoned(&self) -> Vec<OwnedObjectPath> {
        self.0
            .lock()
            .unwrap()
            .iter_mut()
            .map(|(handle, input)| {
                input.barriers.clear();
                if let Some(capture) = &input.capture {
                    capture.barriers(Vec::new());
                }
                handle.clone()
            })
            .collect()
    }
}

/// The `Activated` options for a capture.
pub fn activated(
    activation_id: u32,
    cursor: (f64, f64),
    barrier_id: u32,
) -> HashMap<String, OwnedValue> {
    HashMap::from([
        ("activation_id".to_string(), OwnedValue::from(activation_id)),
        ("cursor_position".to_string(), owned(Value::from(cursor))),
        ("barrier_id".to_string(), OwnedValue::from(barrier_id)),
    ])
}

/// A barrier's id and position. One missing either is skipped: it has no id
/// to fail under.
fn barrier(barrier: &HashMap<String, OwnedValue>) -> Option<(u32, [i32; 4])> {
    let id = u32::try_from(barrier.get("barrier_id")?).ok()?;
    let (x1, y1, x2, y2) =
        <(i32, i32, i32, i32)>::try_from(barrier.get("position")?.try_clone().ok()?).ok()?;
    Some((id, [x1, y1, x2, y2]))
}

fn devices(capabilities: u32) -> Devices {
    Devices {
        keyboard: capabilities & KEYBOARD != 0,
        pointer: capabilities & POINTER != 0,
        touchscreen: false,
    }
}

fn owned(value: Value<'_>) -> OwnedValue {
    OwnedValue::try_from(value).expect("a value with no file descriptor is ownable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    use zbus::blocking::MessageIterator;
    use zbus::MatchRule;

    use crate::eis::recorded::{a_receiver, Got};
    use crate::portals::fixture::{
        call, next, options, path, reply, served, Results, Served, APP, SESSION,
    };
    use crate::portals::restore::Tokens;
    use crate::ClientRequest;

    const INPUT_CAPTURE: &str = "org.freedesktop.impl.portal.InputCapture";

    /// One 1280x800 display.
    const DISPLAY: Zone = Zone {
        x: 0,
        y: 0,
        width: 1280,
        height: 800,
    };

    /// A session that asked for everything, granted.
    fn granted(served: &Served) -> Results {
        served.backends.displays(vec![DISPLAY]);
        let client = served.client.clone();
        let creating = thread::spawn(move || {
            let created = client
                .call_method(
                    None::<&str>,
                    crate::portals::OBJECT_PATH,
                    Some(INPUT_CAPTURE),
                    "CreateSession",
                    &(
                        path("/r/1"),
                        path(SESSION),
                        APP,
                        "",
                        options(vec![("capabilities", Value::from(7u32))]),
                    ),
                )
                .expect("CreateSession answered");
            reply(created)
        });
        let (items, _) = next(served);
        assert_eq!(
            items[0].kind,
            PortalKind::InputCapture(InputCaptureDialog {
                devices: Devices {
                    keyboard: true,
                    pointer: true,
                    touchscreen: false,
                },
            })
        );
        served
            .backends
            .queue
            .answer(items[0].id, PortalAnswer::InputCapture);
        let (response, results) = creating.join().expect("CreateSession returned");
        assert_eq!(response, 0);
        results
    }

    fn barriers(served: &Served, zone_set: u32) -> Vec<u32> {
        let barrier = |id: u32, position: (i32, i32, i32, i32)| {
            HashMap::from([
                ("barrier_id".to_string(), OwnedValue::from(id)),
                ("position".to_string(), owned(Value::from(position))),
            ])
        };
        let set = call(
            served,
            INPUT_CAPTURE,
            "SetPointerBarriers",
            &(
                path("/r/2"),
                path(SESSION),
                APP,
                Results::new(),
                vec![barrier(7, (1279, 0, 1279, 799)), barrier(8, (5, 5, 5, 9))],
                zone_set,
            ),
        )
        .expect("SetPointerBarriers answered");
        let (_, results) = reply(set);
        Vec::<u32>::try_from(results["failed_barriers"].try_clone().expect("no fds")).expect("ids")
    }

    #[test]
    fn a_granted_session_captures_what_the_seat_can_give_and_is_listed() {
        let served = served(Tokens::load(None));

        let results = granted(&served);

        assert_eq!(results.get("capabilities"), Some(&OwnedValue::from(3u32)));
        let capturing = loop {
            let (_, capturing) = next(&served);
            if !capturing.is_empty() {
                break capturing;
            }
        };
        assert_eq!(
            capturing[0].kind,
            CapturingKind::InputCapture {
                devices: devices(3)
            }
        );
    }

    #[test]
    fn barriers_go_on_the_outer_edges_of_the_current_zones() {
        let served = served(Tokens::load(None));
        granted(&served);

        let zones = call(
            &served,
            INPUT_CAPTURE,
            "GetZones",
            &(path("/r/3"), path(SESSION), APP, Results::new()),
        )
        .expect("GetZones answered");
        let (_, zones) = reply(zones);
        assert_eq!(
            Vec::<(u32, u32, i32, i32)>::try_from(zones["zones"].try_clone().expect("no fds")),
            Ok(vec![(1280, 800, 0, 0)])
        );
        let zone_set = u32::try_from(&zones["zone_set"]).expect("a serial");

        assert_eq!(barriers(&served, zone_set), [8]);
        assert_eq!(barriers(&served, zone_set + 1), [7, 8], "a stale set fails");
    }

    #[test]
    fn reaching_a_barrier_activates_the_capture() {
        let served = served(Tokens::load(None));
        granted(&served);
        let activations = MessageIterator::for_match_rule(
            MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .interface(INPUT_CAPTURE)
                .expect("a name")
                .member("Activated")
                .expect("a name")
                .build(),
            &served.client,
            None,
        )
        .expect("listening");
        let socket = call(
            &served,
            INPUT_CAPTURE,
            "ConnectToEIS",
            &(path(SESSION), APP, Results::new()),
        )
        .expect("ConnectToEIS answered");
        let socket: zbus::zvariant::OwnedFd = socket.body().deserialize().expect("a socket");
        let got = a_receiver(socket.into());
        assert_eq!(
            got.recv_timeout(Duration::from_secs(10)),
            Ok(Got::Devices(2))
        );
        assert_eq!(barriers(&served, 1), [8]);
        call(
            &served,
            INPUT_CAPTURE,
            "Enable",
            &(path(SESSION), APP, Results::new()),
        )
        .expect("Enable answered");

        // Window 2 of the fixture reaches the right edge.
        served
            .input
            .send(ClientRequest::PointerMotion {
                app_id: "2".into(),
                x: 279.5,
                y: 100.0,
            })
            .expect("the loop listens");

        let signal = activations
            .into_iter()
            .next()
            .expect("a signal")
            .expect("read");
        let (session, options): (OwnedObjectPath, Results) =
            signal.body().deserialize().expect("its arguments");
        assert_eq!(session.as_str(), SESSION);
        assert_eq!(options, activated(1, (1279.5, 100.0), 7));
        assert_eq!(
            got.recv_timeout(Duration::from_secs(10)),
            Ok(Got::Emulating(1))
        );
    }
}
