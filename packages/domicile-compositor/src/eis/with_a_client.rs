//! The server driven by a real `reis` client over a socket.
//!
//! The server runs on a calloop loop, as on the Wayland thread. The compositor
//! it serves records what it was asked to inject, since `inject` is
//! `handle_client_request` in the real one.

use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use domicile_scene::Point;
use reis::ei;
use reis::event::{Connection, Device};
use smithay::reexports::calloop::EventLoop;

use super::barriers::{placed, Zone};
use super::recorded::{a_client, a_receiver, Got, Recorded, Saw, KEYSYM_A};
use super::Compositor;
use super::{serve, Capabilities, Captured, Captures, Eis, Emulated};
use crate::client_requests::ClientRequest;
use crate::lock::{refused, Asked, Refusal};

/// How long a test waits for the client or the server.
const PATIENCE: Duration = Duration::from_secs(10);

const EVERYTHING: Capabilities = Capabilities {
    pointer: true,
    pointer_absolute: true,
    keyboard: true,
    touch: true,
};

/// A served loop and the compositor it serves.
struct Served {
    event_loop: EventLoop<'static, Recorded>,
    compositor: Recorded,
    eis: Eis,
    captures: Captures,
}

impl Served {
    fn new() -> Served {
        let event_loop = EventLoop::try_new().unwrap();
        let (eis, captures) = serve(&event_loop.handle()).unwrap();
        Served {
            event_loop,
            compositor: Recorded::default(),
            eis,
            captures,
        }
    }

    /// Whether a capture took `request` from the seat.
    fn diverted(&mut self, request: ClientRequest) -> bool {
        // Orders from the capture's handle first.
        self.event_loop
            .dispatch(Duration::ZERO, &mut self.compositor)
            .unwrap();
        self.captures.divert(&request, &self.compositor.desk())
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

#[test]
fn input_sent_without_a_socket_takes_the_same_path_and_is_let_go_of() {
    // RemoteDesktop's `NotifyKeyboardKeysym` and the other legacy methods.
    let mut served = Served::new();
    let emulator = served.eis.emulate();

    emulator.keysym(KEYSYM_A, true);
    emulator.send(Emulated::Motion {
        dx: -240.0,
        dy: -100.0,
    });
    served.until(|injected| injected.len() >= 2);
    drop(emulator);
    served.until(|injected| injected.len() >= 4);

    assert_eq!(
        served.compositor.injected,
        [
            ClientRequest::Key {
                keycode: 30,
                pressed: true,
            },
            // From the middle of the display, inside the window.
            ClientRequest::PointerMotion {
                app_id: "1".into(),
                x: 300.0,
                y: 200.0,
            },
            ClientRequest::Key {
                keycode: 30,
                pressed: false,
            },
            ClientRequest::PointerLeave,
        ]
    );
}

#[test]
fn a_capture_takes_the_input_that_crosses_a_barrier_until_released() {
    let mut served = Served::new();
    let (tell, told) = std::sync::mpsc::channel();
    let (socket, capture) = served
        .eis
        .capture(
            Capabilities {
                pointer: true,
                keyboard: true,
                ..Capabilities::default()
            },
            move |captured| {
                let _ = tell.send(captured);
            },
        )
        .unwrap();
    let got = a_receiver(socket);
    assert_eq!(served.heard(&got), Got::Devices(2));
    let (barriers, _) = placed(
        &[Zone {
            x: 0,
            y: 0,
            width: 1280,
            height: 800,
        }],
        &[(7, [1279, 0, 1279, 799])],
    );
    capture.barriers(barriers);
    capture.enable(true);

    // Window 2 reaches the right edge.
    let pointing = |x, y| ClientRequest::PointerMotion {
        app_id: "2".into(),
        x,
        y,
    };
    assert!(
        !served.diverted(pointing(100.0, 100.0)),
        "short of the barrier"
    );
    assert!(served.diverted(pointing(279.5, 100.0)));
    assert_eq!(
        told.try_recv(),
        Ok(Captured::Activated {
            activation_id: 1,
            cursor: Point::new(1279.5, 100.0),
            barrier_id: 7,
        })
    );
    assert!(served.diverted(pointing(270.5, 90.0)));
    assert!(served.diverted(ClientRequest::Key {
        keycode: 30,
        pressed: true
    }));
    assert_eq!(served.heard(&got), Got::Emulating(1));
    assert_eq!(served.heard(&got), Got::Motion(-9.0, -10.0));
    assert_eq!(served.heard(&got), Got::Key(30, true));

    capture.release();
    assert!(!served.diverted(ClientRequest::Key {
        keycode: 30,
        pressed: false
    }));
    assert!(
        served.compositor.injected.is_empty(),
        "the seat got nothing"
    );
}
