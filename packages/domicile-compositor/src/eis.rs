//! The EIS server: emulated input from libei clients.
//!
//! RemoteDesktop's and InputCapture's `ConnectToEIS` hand an app one end of a
//! socket. [`Eis::connect`] makes that socket for the input a session was
//! granted, and dropping the returned [`Session`] revokes it. Design:
//! `docs/architecture/PORTALS.md`.
//!
//! - [`devices`] decides which devices a client gets for its grant.
//! - [`desk`] maps the displays to regions and points to windows.
//! - [`translation`] turns events into the requests the engine's input
//!   becomes, which the lock refuses on a locked desk.
//!
//! The server runs on the Wayland loop, reading each socket only when it is
//! readable, so a client never blocks the loop. [`Eis`] and [`Session`] can be
//! used from any thread, such as the D-Bus one.

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

pub use self::desk::{Desk, Window};
pub use self::devices::Capabilities;
use self::devices::{devices, Kind};
use self::translation::{Emulated, Input};
use crate::ClientRequest;

/// What the server needs from the compositor it runs in.
pub trait Compositor {
    /// The displays and windows now.
    fn desk(&self) -> Desk;

    /// Send a request down the path the engine's input takes.
    fn inject(&mut self, request: ClientRequest);
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

/// What [`Eis`] and [`Session`] ask of the loop.
enum Order {
    Open {
        id: u64,
        socket: UnixStream,
        granted: Capabilities,
    },
    Revoke {
        id: u64,
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
}

/// Serve EIS on `handle`'s loop.
pub fn serve<D: Compositor + 'static>(
    handle: &LoopHandle<'static, D>,
) -> Result<Eis, calloop::Error> {
    let (orders, heard) = channel();
    let served: Rc<RefCell<HashMap<u64, Served>>> = Rc::default();
    let loop_handle = handle.clone();
    handle
        .insert_source(heard, move |event, _, compositor| {
            if let ChannelEvent::Msg(order) = event {
                match order {
                    Order::Open {
                        id,
                        socket,
                        granted,
                    } => open(&loop_handle, &served, id, socket, granted),
                    Order::Revoke { id } => revoke(&loop_handle, &served, id, compositor),
                }
            }
        })
        .map_err(|inserting| inserting.error)?;
    Ok(Eis {
        orders,
        next: Arc::new(AtomicU64::new(0)),
    })
}

impl Eis {
    /// Open a context for `granted` input.
    ///
    /// Returns the client's end of the socket, which `ConnectToEIS` hands out,
    /// and the session that keeps it open.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "called by the RemoteDesktop and InputCapture backends, next in PORTALS.md's phase 3"
        )
    )]
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
mod with_a_client;
