//! The EIS server: emulated input from libei clients.
//!
//! RemoteDesktop's and InputCapture's `ConnectToEIS` hand an app one end of a
//! socket. [`Eis::connect`] makes that socket for the input a session was
//! granted, and dropping the returned [`Session`] revokes it. RemoteDesktop's
//! legacy `Notify*` methods send through an [`Emulator`] instead, which takes
//! the same path. Design: `docs/PORTALS.md`.
//!
//! - [`devices`] decides which devices a client gets for its grant.
//! - [`desk`] maps the displays to regions and points to windows.
//! - [`translation`] turns events into the requests the engine's input
//!   becomes, which the lock refuses on a locked desk.
//!
//! The server runs on the Wayland loop, reading each socket only when it is
//! readable, so a client never blocks the loop. [`Eis`] and [`Session`] can be
//! used from any thread, such as the D-Bus one.

pub mod barriers;
mod capture;
mod desk;
mod devices;
mod translation;

use std::cell::RefCell;
use std::collections::HashMap;
use std::io;
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use reis::calloop::{EisRequestSource, EisRequestSourceEvent};
use reis::eis;
use reis::eis::connection::DisconnectReason;
use reis::eis::device::DeviceType;
use reis::request::{Bind, Connection, Device, EisRequest};
use smithay::reexports::calloop::{
    self,
    channel::{channel, Event as ChannelEvent, Sender},
    LoopHandle, PostAction, RegistrationToken,
};
use tracing::{debug, error, warn};

use self::barriers::Barrier;
use self::capture::Capture as Capturing;
pub use self::capture::Captured;
pub use self::desk::{Desk, Window};
pub use self::devices::Capabilities;
use self::devices::{devices, Kind};
pub use self::translation::Emulated;
use self::translation::Input;
use crate::ClientRequest;

/// What the server needs from the compositor it runs in.
pub trait Compositor {
    /// The displays and windows now.
    fn desk(&self) -> Desk;

    /// Send a request down the path the engine's input takes.
    fn inject(&mut self, request: ClientRequest);

    /// The evdev key that types `keysym` on the desk's keyboard, if any.
    fn keycode(&self, keysym: u32) -> Option<u32>;
}

/// Opens EIS contexts. Cheap to clone; usable from any thread.
#[derive(Clone)]
pub struct Eis {
    orders: Sender<Order>,
    next: Arc<AtomicU64>,
}

/// One open EIS context. Dropping it revokes the context: the client is
/// disconnected and everything it held is released.
pub struct Session {
    id: u64,
    orders: Sender<Order>,
}

/// One InputCapture context. Dropping it revokes it, as for [`Session`].
pub struct Capture {
    id: u64,
    orders: Sender<Order>,
}

/// The captures, for the Wayland thread to divert input to. See
/// [`Captures::divert`].
pub struct Captures(Rc<RefCell<HashMap<u64, Served>>>);

/// Input sent without a socket. Dropping it lets go of every key and button
/// it holds.
pub struct Emulator {
    id: u64,
    orders: Sender<Order>,
}

/// What [`Eis`], [`Session`] and [`Emulator`] ask of the loop.
enum Order {
    Open {
        id: u64,
        socket: UnixStream,
        granted: Capabilities,
        /// Set for an InputCapture receiver.
        capture: Option<Box<dyn Fn(Captured) + Send>>,
    },
    Barriers {
        id: u64,
        barriers: Vec<Barrier>,
    },
    Enable {
        id: u64,
        enabled: bool,
    },
    Release {
        id: u64,
    },
    Revoke {
        id: u64,
    },
    Emulate {
        id: u64,
        emulated: Emulated,
    },
    Keysym {
        id: u64,
        keysym: u32,
        pressed: bool,
    },
}

/// One client the server is serving.
struct Served {
    token: RegistrationToken,
    granted: Capabilities,
    /// Set once the handshake is done.
    connection: Option<Connection>,
    devices: Vec<(Kind, Device)>,
    input: Input,
    /// Set for an InputCapture receiver, which sends no input.
    capture: Option<Capturing>,
}

/// Serve EIS on `handle`'s loop.
pub fn serve<D: Compositor + 'static>(
    handle: &LoopHandle<'static, D>,
) -> Result<(Eis, Captures), calloop::Error> {
    let (orders, heard) = channel();
    let served: Rc<RefCell<HashMap<u64, Served>>> = Rc::default();
    let captures = Captures(Rc::clone(&served));
    // Each emulator's input, created by its first event.
    let mut emulated: HashMap<u64, Input> = HashMap::new();
    let loop_handle = handle.clone();
    handle
        .insert_source(heard, move |event, _, compositor| {
            if let ChannelEvent::Msg(order) = event {
                match order {
                    Order::Open {
                        id,
                        socket,
                        granted,
                        capture,
                    } => open(&loop_handle, &served, id, socket, granted, capture),
                    Order::Barriers { id, barriers } => {
                        capturing(&served, id, |capture, _| capture.barriers = barriers);
                    }
                    Order::Enable { id, enabled } => capturing(&served, id, |capture, devices| {
                        capture.enabled = enabled;
                        if !enabled {
                            capture.deactivate(devices);
                        }
                    }),
                    Order::Release { id } => {
                        capturing(&served, id, |capture, devices| capture.deactivate(devices));
                    }
                    Order::Revoke { id } => {
                        if let Some(mut input) = emulated.remove(&id) {
                            for request in input.let_go() {
                                compositor.inject(request);
                            }
                        }
                        revoke(&loop_handle, &served, id, compositor);
                    }
                    Order::Emulate {
                        id,
                        emulated: event,
                    } => {
                        let desk = compositor.desk();
                        for request in emulated.entry(id).or_default().translate(event, &desk) {
                            compositor.inject(request);
                        }
                    }
                    Order::Keysym {
                        id,
                        keysym,
                        pressed,
                    } => match compositor.keycode(keysym) {
                        Some(keycode) => {
                            let desk = compositor.desk();
                            let key = Emulated::Key { keycode, pressed };
                            for request in emulated.entry(id).or_default().translate(key, &desk) {
                                compositor.inject(request);
                            }
                        }
                        None => debug!(keysym, "no key on this keyboard types an emulated keysym"),
                    },
                }
            }
        })
        .map_err(|inserting| inserting.error)?;
    Ok((
        Eis {
            orders,
            next: Arc::new(AtomicU64::new(0)),
        },
        captures,
    ))
}

/// Run `change` on capture `id`'s state, if it is still open.
fn capturing(
    served: &Rc<RefCell<HashMap<u64, Served>>>,
    id: u64,
    change: impl FnOnce(&mut Capturing, &[(Kind, Device)]),
) {
    if let Some(this) = served.borrow_mut().get_mut(&id) {
        if let Some(capture) = &mut this.capture {
            change(capture, &this.devices);
            if let Some(connection) = &this.connection {
                let _ = connection.flush();
            }
        }
    }
}

impl Captures {
    /// Whether an InputCapture session takes `request` from the seat, and
    /// sends it to its client instead. Called on the Wayland thread for
    /// input the lock let through.
    pub fn divert(&self, request: &ClientRequest, desk: &Desk) -> bool {
        // Borrowed already while an EIS client's input is being injected.
        // Emulated input is never captured.
        match self.0.try_borrow_mut() {
            Ok(mut served) => {
                served
                    .values_mut()
                    .any(|this| match (&mut this.capture, &this.connection) {
                        (Some(capture), Some(connection)) => {
                            capture.divert(request, desk, &this.devices, connection)
                        }
                        _ => false,
                    })
            }
            Err(_) => false,
        }
    }
}

impl Eis {
    /// Open a context for `granted` input.
    ///
    /// Returns the client's end of the socket, which `ConnectToEIS` hands out,
    /// and the session that keeps it open.
    pub fn connect(&self, granted: Capabilities) -> io::Result<(OwnedFd, Session)> {
        let (ours, theirs) = UnixStream::pair()?;
        // Here rather than on the loop, so a failure reaches the caller.
        ours.set_nonblocking(true)?;
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.orders
            .send(Order::Open {
                id,
                socket: ours,
                granted,
                capture: None,
            })
            .map_err(|_| io::Error::other("the compositor's loop has stopped"))?;
        Ok((
            theirs.into(),
            Session {
                id,
                orders: self.orders.clone(),
            },
        ))
    }

    /// Open a receiving context that gets the desk's `granted` input once a
    /// barrier is reached. `heard` hears each activation.
    pub fn capture(
        &self,
        granted: Capabilities,
        heard: impl Fn(Captured) + Send + 'static,
    ) -> io::Result<(OwnedFd, Capture)> {
        let (ours, theirs) = UnixStream::pair()?;
        ours.set_nonblocking(true)?;
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.orders
            .send(Order::Open {
                id,
                socket: ours,
                granted,
                capture: Some(Box::new(heard)),
            })
            .map_err(|_| io::Error::other("the compositor's loop has stopped"))?;
        Ok((
            theirs.into(),
            Capture {
                id,
                orders: self.orders.clone(),
            },
        ))
    }
}

impl Capture {
    /// Where the pointer starts a capture. Replaces any earlier barriers.
    pub fn barriers(&self, barriers: Vec<Barrier>) {
        self.order(Order::Barriers {
            id: self.id,
            barriers,
        });
    }

    /// Whether reaching a barrier starts a capture. Disabling ends one.
    pub fn enable(&self, enabled: bool) {
        self.order(Order::Enable {
            id: self.id,
            enabled,
        });
    }

    /// End the active capture: input goes back to the seat.
    pub fn release(&self) {
        self.order(Order::Release { id: self.id });
    }

    fn order(&self, order: Order) {
        // Fails only once the loop has stopped, and the capture with it.
        let _ = self.orders.send(order);
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.order(Order::Revoke { id: self.id });
    }
}

impl Eis {
    /// Open an emulator, for input that arrives without a socket.
    pub fn emulate(&self) -> Emulator {
        Emulator {
            id: self.next.fetch_add(1, Ordering::Relaxed),
            orders: self.orders.clone(),
        }
    }
}

impl Emulator {
    /// Send one event. The caller checks it against the grant.
    pub fn send(&self, emulated: Emulated) {
        self.order(Order::Emulate {
            id: self.id,
            emulated,
        });
    }

    /// Press or release the key that types `keysym`. Dropped if no key does.
    pub fn keysym(&self, keysym: u32, pressed: bool) {
        self.order(Order::Keysym {
            id: self.id,
            keysym,
            pressed,
        });
    }

    fn order(&self, order: Order) {
        // Fails only once the loop has stopped, and the input with it.
        let _ = self.orders.send(order);
    }
}

impl Drop for Emulator {
    fn drop(&mut self) {
        self.order(Order::Revoke { id: self.id });
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // Fails only once the loop has stopped, which took every client with
        // it, so there is nothing left to revoke.
        let _ = self.orders.send(Order::Revoke { id: self.id });
    }
}

fn open<D: Compositor + 'static>(
    handle: &LoopHandle<'static, D>,
    served: &Rc<RefCell<HashMap<u64, Served>>>,
    id: u64,
    socket: UnixStream,
    granted: Capabilities,
    capture: Option<Box<dyn Fn(Captured) + Send>>,
) {
    let context = eis::Context::new(socket)
        .expect("a socket already made non-blocking can be made non-blocking again");
    let serving = served.clone();
    let inserted = handle.insert_source(
        EisRequestSource::new(context, 1),
        move |event, connection, compositor| {
            let mut served = serving.borrow_mut();
            let this = served
                .get_mut(&id)
                .expect("a revoked client's source is removed with it");
            let action = match event {
                Ok(EisRequestSourceEvent::Connected) => {
                    // The connection keeps the seat, and `Bind` hands it back.
                    let _seat = connection.add_seat(Some("domicile"), this.granted.offered());
                    this.connection = Some(connection.clone());
                    PostAction::Continue
                }
                Ok(EisRequestSourceEvent::Request(request)) => this.heard(request, compositor),
                Err(err) => {
                    warn!(%err, "an EIS client broke the protocol, so it was disconnected");
                    PostAction::Remove
                }
            };
            if action == PostAction::Remove {
                for request in this.input.let_go() {
                    compositor.inject(request);
                }
                served.remove(&id);
            }
            if let Err(err) = connection.flush() {
                // A client that stopped reading is disconnected when its
                // socket closes.
                debug!(%err, "could not write to an EIS client");
            }
            Ok(action)
        },
    );
    match inserted {
        Ok(token) => {
            served.borrow_mut().insert(
                id,
                Served {
                    token,
                    granted,
                    connection: None,
                    devices: Vec::new(),
                    input: Input::default(),
                    capture: capture.map(Capturing::new),
                },
            );
        }
        // The socket is dropped with the error, so the client sees it close.
        Err(inserting) => error!(err = %inserting.error, "could not serve an EIS client"),
    }
}

fn revoke<D: Compositor>(
    handle: &LoopHandle<'static, D>,
    served: &Rc<RefCell<HashMap<u64, Served>>>,
    id: u64,
    compositor: &mut D,
) {
    // Absent when the client disconnected first.
    let removed = served.borrow_mut().remove(&id);
    if let Some(mut this) = removed {
        if let Some(connection) = &this.connection {
            connection.disconnected(DisconnectReason::Disconnected, Some("the session closed"));
            if let Err(err) = connection.flush() {
                debug!(%err, "could not tell an EIS client its session closed");
            }
        }
        for request in this.input.let_go() {
            compositor.inject(request);
        }
        handle.remove(this.token);
    }
}

impl Served {
    fn heard(&mut self, request: EisRequest, compositor: &mut impl Compositor) -> PostAction {
        match request {
            EisRequest::Disconnect => PostAction::Remove,
            EisRequest::Bind(bind) => {
                self.bind(bind, &compositor.desk());
                PostAction::Continue
            }
            // A receiver sends no input.
            _ if self.capture.is_some() => PostAction::Continue,
            other => {
                if let Some(emulated) = emulated(&other) {
                    let desk = compositor.desk();
                    for request in self.input.translate(emulated, &desk) {
                        compositor.inject(request);
                    }
                }
                PostAction::Continue
            }
        }
    }

    /// Give the client a device for each granted kind it bound, and take back
    /// the ones it no longer binds.
    fn bind(&mut self, bind: Bind, desk: &Desk) {
        let wanted = devices(self.granted, bind.capabilities);
        self.devices.retain(|(kind, device)| {
            let keep = wanted.contains(kind);
            if !keep {
                device.remove();
            }
            keep
        });
        for kind in wanted {
            if !self.devices.iter().any(|(had, _)| *had == kind) {
                let regions = if kind.has_regions() {
                    desk.regions()
                } else {
                    Vec::new()
                };
                let device = bind.seat.add_device(
                    Some(kind.name()),
                    DeviceType::Virtual,
                    kind.capabilities(),
                    |device| {
                        for region in &regions {
                            device.device().region(
                                region.offset.0,
                                region.offset.1,
                                region.size.0,
                                region.size.1,
                                region.scale,
                            );
                        }
                    },
                );
                device.resumed();
                self.devices.push((kind, device));
            }
        }
    }
}

/// The input in a request, if it is input.
fn emulated(request: &EisRequest) -> Option<Emulated> {
    match request {
        EisRequest::PointerMotion(motion) => Some(Emulated::Motion {
            dx: f64::from(motion.dx),
            dy: f64::from(motion.dy),
        }),
        EisRequest::PointerMotionAbsolute(motion) => Some(Emulated::MotionAbsolute {
            x: f64::from(motion.dx_absolute),
            y: f64::from(motion.dy_absolute),
        }),
        EisRequest::Button(button) => Some(Emulated::Button {
            button: button.button,
            pressed: button.state == eis::button::ButtonState::Press,
        }),
        EisRequest::ScrollDelta(scroll) => Some(Emulated::Scroll {
            dx: f64::from(scroll.dx),
            dy: f64::from(scroll.dy),
        }),
        EisRequest::ScrollDiscrete(scroll) => Some(Emulated::ScrollDiscrete {
            v120_x: scroll.discrete_dx,
            v120_y: scroll.discrete_dy,
        }),
        EisRequest::KeyboardKey(key) => Some(Emulated::Key {
            keycode: key.key,
            pressed: key.state == eis::keyboard::KeyState::Press,
        }),
        EisRequest::TouchDown(touch) => Some(Emulated::TouchDown {
            id: touch.touch_id,
            x: f64::from(touch.x),
            y: f64::from(touch.y),
        }),
        EisRequest::TouchMotion(touch) => Some(Emulated::TouchMotion {
            id: touch.touch_id,
            x: f64::from(touch.x),
            y: f64::from(touch.y),
        }),
        EisRequest::TouchUp(touch) => Some(Emulated::TouchUp { id: touch.touch_id }),
        EisRequest::TouchCancel(touch) => Some(Emulated::TouchUp { id: touch.touch_id }),
        // Framing and emulation bounds carry no input. The seat has no scroll
        // stop, and no text device is offered.
        EisRequest::Disconnect
        | EisRequest::Bind(_)
        | EisRequest::DeviceClosed(_)
        | EisRequest::RequestDevice(_)
        | EisRequest::Frame(_)
        | EisRequest::Ready(_)
        | EisRequest::DeviceStartEmulating(_)
        | EisRequest::DeviceStopEmulating(_)
        | EisRequest::ScrollStop(_)
        | EisRequest::ScrollCancel(_)
        | EisRequest::TextKeysym(_)
        | EisRequest::TextUtf8(_) => None,
    }
}

#[cfg(test)]
pub mod recorded;
#[cfg(test)]
mod with_a_client;
