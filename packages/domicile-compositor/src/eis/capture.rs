//! InputCapture: the desk's own input, sent to a receiving EIS client once
//! the pointer reaches a barrier.
//!
//! The engine owns the real input devices, so the compositor sees input only
//! as the requests the engine forwards: keys, and pointer events over a
//! window. A capture takes those from the seat while it is active. The pointer
//! reaches a barrier only over a window, and motion is the change between the
//! points the engine reports, which stops at the screen's edge.

use domicile_scene::Point;
use reis::eis;
use reis::request::{Connection, Device};

use super::barriers::Barrier;
use super::desk::Desk;
use super::devices::Kind;
use crate::ClientRequest;

/// What a capture tells its InputCapture session.
#[derive(Debug, Clone, PartialEq)]
pub enum Captured {
    /// The pointer reached `barrier_id` at `cursor`, and input now goes to the
    /// client.
    Activated {
        activation_id: u32,
        cursor: Point,
        barrier_id: u32,
    },
}

/// One capture's state on the loop.
pub struct Capture {
    pub heard: Box<dyn Fn(Captured) + Send>,
    pub barriers: Vec<Barrier>,
    pub enabled: bool,
    /// The pointer's last point while active.
    active: Option<Point>,
    activations: u32,
}

impl Capture {
    pub fn new(heard: Box<dyn Fn(Captured) + Send>) -> Capture {
        Capture {
            heard,
            barriers: Vec::new(),
            enabled: false,
            active: None,
            activations: 0,
        }
    }

    /// Take `request` from the seat if the capture is active, or if it
    /// activates it. Sends it to the client's `devices`.
    pub fn divert(
        &mut self,
        request: &ClientRequest,
        desk: &Desk,
        devices: &[(Kind, Device)],
        connection: &Connection,
    ) -> bool {
        let taken = match (self.enabled, self.active, request) {
            (false, _, _) => false,
            (true, None, ClientRequest::PointerMotion { app_id, x, y }) => {
                let reached = desk.point_in(app_id, *x, *y).and_then(|point| {
                    self.barriers
                        .iter()
                        .find(|barrier| barrier.reached(point))
                        .map(|barrier| (point, barrier.id))
                });
                match reached {
                    Some((point, barrier_id)) => {
                        self.activate(point, barrier_id, devices, connection);
                        true
                    }
                    None => false,
                }
            }
            (true, None, _) => false,
            (true, Some(last), ClientRequest::PointerMotion { app_id, x, y }) => {
                if let Some(point) = desk.point_in(app_id, *x, *y) {
                    self.active = Some(point);
                    send(devices, Kind::Pointer, connection, |device| {
                        if let Some(pointer) = device.interface::<eis::Pointer>() {
                            pointer.motion_relative(
                                (point.x - last.x) as f32,
                                (point.y - last.y) as f32,
                            );
                        }
                    });
                }
                true
            }
            (true, Some(_), ClientRequest::PointerButton { button, pressed }) => {
                send(devices, Kind::Pointer, connection, |device| {
                    if let Some(buttons) = device.interface::<eis::Button>() {
                        buttons.button(*button, button_state(*pressed));
                    }
                });
                true
            }
            (
                true,
                Some(_),
                ClientRequest::PointerAxis {
                    dx,
                    dy,
                    v120_x,
                    v120_y,
                },
            ) => {
                send(devices, Kind::Pointer, connection, |device| {
                    if let Some(scroll) = device.interface::<eis::Scroll>() {
                        if *v120_x != 0 || *v120_y != 0 {
                            scroll.scroll_discrete(*v120_x, *v120_y);
                        } else {
                            scroll.scroll(*dx as f32, *dy as f32);
                        }
                    }
                });
                true
            }
            (true, Some(_), ClientRequest::Key { keycode, pressed }) => {
                send(devices, Kind::Keyboard, connection, |device| {
                    if let Some(keyboard) = device.interface::<eis::Keyboard>() {
                        keyboard.key(*keycode, key_state(*pressed));
                    }
                });
                true
            }
            (true, Some(_), ClientRequest::PointerLeave) => true,
            (true, Some(_), _) => false,
        };
        taken
    }

    /// Give the input back to the seat.
    pub fn deactivate(&mut self, devices: &[(Kind, Device)]) {
        if self.active.take().is_some() {
            for (_, device) in devices {
                device.stop_emulating();
            }
        }
    }

    fn activate(
        &mut self,
        cursor: Point,
        barrier_id: u32,
        devices: &[(Kind, Device)],
        connection: &Connection,
    ) {
        self.activations += 1;
        self.active = Some(cursor);
        for (_, device) in devices {
            device.start_emulating(self.activations);
        }
        // A client that stopped reading is disconnected when its socket
        // closes.
        let _ = connection.flush();
        (self.heard)(Captured::Activated {
            activation_id: self.activations,
            cursor,
            barrier_id,
        });
    }
}

/// Run `event` on the device of `kind`, framed, and flush.
fn send(
    devices: &[(Kind, Device)],
    kind: Kind,
    connection: &Connection,
    event: impl FnOnce(&Device),
) {
    if let Some((_, device)) = devices.iter().find(|(had, _)| *had == kind) {
        event(device);
        device.frame(now_us());
        let _ = connection.flush();
    }
}

fn button_state(pressed: bool) -> eis::button::ButtonState {
    if pressed {
        eis::button::ButtonState::Press
    } else {
        eis::button::ButtonState::Released
    }
}

fn key_state(pressed: bool) -> eis::keyboard::KeyState {
    if pressed {
        eis::keyboard::KeyState::Press
    } else {
        eis::keyboard::KeyState::Released
    }
}

/// The monotonic clock in microseconds, which EIS frames carry.
fn now_us() -> u64 {
    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `now` is a valid `timespec` the call borrows only for its
    // duration.
    let read = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    assert_eq!(read, 0, "the monotonic clock is always readable");
    now.tv_sec as u64 * 1_000_000 + now.tv_nsec as u64 / 1_000
}
