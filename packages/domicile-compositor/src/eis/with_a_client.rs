//! The server driven by a real `reis` client over a socket.
//!
//! The server runs on a calloop loop, as on the Wayland thread. The compositor
//! it serves records what it was asked to inject, since `inject` is
//! `handle_client_request` in the real one.

use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use domicile_config::Transform;
use domicile_scene::{Bounds, Point};
use reis::ei;
use reis::enumflags2::BitFlags;
use reis::event::{Connection, Device, EiEvent};
use smithay::reexports::calloop::EventLoop;

use super::{serve, Capabilities, Compositor, Desk, Eis, Window};
use crate::lock::{refused, Asked, Refusal};
use crate::screens::Advertised;
use crate::ClientRequest;

/// How long a test waits for the client or the server.
const PATIENCE: Duration = Duration::from_secs(10);

const EVERYTHING: Capabilities = Capabilities {
    pointer: true,
    pointer_absolute: true,
    keyboard: true,
    touch: true,
};

/// A compositor with one 1280x800 display at 2x and one window at 100,100,
/// which records what it is asked to inject.
#[derive(Default)]
struct Recorded {
    injected: Vec<ClientRequest>,
}

impl Compositor for Recorded {
    fn desk(&self) -> Desk {
        Desk::new(
            vec![Advertised {
                name: "one".into(),
                position: (0, 0),
                logical: (1280, 800),
                mode: (2560, 1600),
                scale: 2.0,
                transform: Transform::Normal,
                description: String::new(),
                physical_mm: (0, 0),
                refresh_mhz: 0,
            }],
            vec![Window {
                app_id: "1".into(),
                bounds: Bounds {
                    min: Point::new(100.0, 100.0),
                    max: Point::new(500.0, 400.0),
                },
                focused: true,
            }],
        )
    }

    fn inject(&mut self, request: ClientRequest) {
        self.injected.push(request);
    }
}

/// A served loop and the compositor it serves.
struct Served {
    event_loop: EventLoop<'static, Recorded>,
    compositor: Recorded,
    eis: Eis,
}

impl Served {
    fn new() -> Served {
        let event_loop = EventLoop::try_new().unwrap();
        let eis = serve(&event_loop.handle()).unwrap();
        Served {
            event_loop,
            compositor: Recorded::default(),
            eis,
        }
    }

    /// Run the loop until `done` holds of what was injected.
    fn until(&mut self, done: impl Fn(&[ClientRequest]) -> bool) {
        let started = Instant::now();
        while !done(&self.compositor.injected) {
            assert!(
                started.elapsed() < PATIENCE,
                "gave up waiting; injected so far: {:?}",
                self.compositor.injected
            );
            self.event_loop
                .dispatch(Duration::from_millis(10), &mut self.compositor)
                .unwrap();
        }
    }

    /// Run the loop until the client says something.
    fn heard<T>(&mut self, from: &Receiver<T>) -> T {
        let started = Instant::now();
        loop {
            if let Ok(said) = from.try_recv() {
                return said;
            }
            assert!(started.elapsed() < PATIENCE, "the client said nothing");
            self.event_loop
                .dispatch(Duration::from_millis(10), &mut self.compositor)
                .unwrap();
        }
    }
}

/// A region as a client sees it: offset, size and scale.
type Region = (u32, u32, u32, u32, f32);

/// What a client thread reports.
#[derive(Debug, PartialEq)]
enum Saw {
    /// Its devices, by name, with each one's regions.
    Devices(Vec<(String, Vec<Region>)>),
    Disconnected,
}

/// A client on `socket` that binds everything, waits for `devices` devices,
/// reports them, then runs `act` with them.
fn a_client(
    socket: OwnedFd,
    devices: usize,
    act: impl FnOnce(&Connection, &[Device]) + Send + 'static,
) -> Receiver<Saw> {
    let (saw, seen) = mpsc::channel();
    thread::spawn(move || {
        let context = ei::Context::new(UnixStream::from(socket)).unwrap();
        let (connection, events) = context
            .handshake_blocking("domicile test", ei::handshake::ContextType::Sender)
            .unwrap();
        let mut resumed = Vec::new();
        let mut act = Some(act);
        for event in events {
            match event {
                Ok(EiEvent::SeatAdded(added)) => {
                    added.seat.bind_capabilities(BitFlags::all());
                    connection.flush().unwrap();
                }
                Ok(EiEvent::DeviceResumed(device)) => {
                    resumed.push(device.device);
                    if resumed.len() == devices {
                        saw.send(Saw::Devices(described(&resumed))).unwrap();
                        act.take().unwrap()(&connection, &resumed);
                        connection.flush().unwrap();
                    }
                }
                Ok(EiEvent::Disconnected(_)) => {
                    saw.send(Saw::Disconnected).unwrap();
                    return;
                }
                Ok(_) => {}
                Err(err) => panic!("the client heard {err}"),
            }
        }
    });
    seen
}

fn described(devices: &[Device]) -> Vec<(String, Vec<Region>)> {
    devices
        .iter()
        .map(|device| {
            (
                device.name().unwrap().to_owned(),
                device
                    .regions()
                    .iter()
                    .map(|region| {
                        (
                            region.x,
                            region.y,
                            region.width,
                            region.height,
                            region.scale,
                        )
                    })
                    .collect(),
            )
        })
        .collect()
}

/// The device named `name`, emulating, with `send` run on it and then framed.
fn emulate(connection: &Connection, devices: &[Device], name: &str, send: impl FnOnce(&Device)) {
    let device = devices
        .iter()
        .find(|device| device.name() == Some(name))
        .unwrap();
    device.device().start_emulating(connection.serial(), 1);
    send(device);
    device.device().frame(connection.serial(), 1);
}

#[test]
fn a_client_gets_a_device_for_each_granted_kind_and_absolute_ones_reach_the_displays() {
    let mut served = Served::new();
    let (socket, _session) = served
        .eis
        .connect(Capabilities {
            keyboard: true,
            pointer_absolute: true,
            ..Capabilities::default()
        })
        .unwrap();
    let seen = a_client(socket, 2, |_, _| {});
    assert_eq!(
        served.heard(&seen),
        Saw::Devices(vec![
            ("keyboard".into(), vec![]),
            ("absolute pointer".into(), vec![(0, 0, 1280, 800, 2.0)]),
        ])
    );
}

#[test]
fn emulated_input_becomes_what_the_lock_refuses() {
    let mut served = Served::new();
    let (socket, _session) = served.eis.connect(EVERYTHING).unwrap();
    let _seen = a_client(socket, 4, |connection, devices| {
        emulate(connection, devices, "keyboard", |keyboard| {
            keyboard
                .interface::<ei::Keyboard>()
                .unwrap()
                .key(30, ei::keyboard::KeyState::Press);
        });
        emulate(connection, devices, "absolute pointer", |pointer| {
            pointer
                .interface::<ei::PointerAbsolute>()
                .unwrap()
                .motion_absolute(110.0, 120.0);
        });
        emulate(connection, devices, "pointer", |pointer| {
            pointer
                .interface::<ei::Button>()
                .unwrap()
                .button(0x111, ei::button::ButtonState::Press);
            pointer
                .interface::<ei::Scroll>()
                .unwrap()
                .scroll_discrete(0, 120);
        });
        emulate(connection, devices, "touchscreen", |touch| {
            touch
                .interface::<ei::Touchscreen>()
                .unwrap()
                .down(1, 130.0, 120.0);
        });
    });
    let expected = [
        ClientRequest::Key {
            keycode: 30,
            pressed: true,
        },
        ClientRequest::PointerMotion {
            app_id: "1".into(),
            x: 10.0,
            y: 20.0,
        },
        ClientRequest::PointerButton {
            button: 0x111,
            pressed: true,
        },
        ClientRequest::PointerAxis {
            dx: 0.0,
            dy: 15.0,
            v120_x: 0,
            v120_y: 120,
        },
        ClientRequest::PointerMotion {
            app_id: "1".into(),
            x: 30.0,
            y: 20.0,
        },
        ClientRequest::PointerButton {
            button: 0x110,
            pressed: true,
        },
    ];
    served.until(|injected| injected.len() >= expected.len());
    assert_eq!(served.compositor.injected, expected);
    for request in &served.compositor.injected {
        assert_eq!(
            refused(Asked::OnTheWaylandThread(request)),
            Some(Refusal::Hand),
            "a locked desk refuses {request:?} as it refuses the engine's"
        );
    }
}

#[test]
fn closing_the_session_disconnects_the_client_and_lets_go_of_its_keys() {
    let mut served = Served::new();
    let (socket, session) = served.eis.connect(EVERYTHING).unwrap();
    let seen = a_client(socket, 4, |connection, devices| {
        emulate(connection, devices, "keyboard", |keyboard| {
            keyboard
                .interface::<ei::Keyboard>()
                .unwrap()
                .key(30, ei::keyboard::KeyState::Press);
        });
    });
    served.until(|injected| !injected.is_empty());
    assert!(matches!(served.heard(&seen), Saw::Devices(_)));

    drop(session);
    assert_eq!(served.heard(&seen), Saw::Disconnected);
    assert_eq!(
        served.compositor.injected.last(),
        Some(&ClientRequest::Key {
            keycode: 30,
            pressed: false
        })
    );
}
