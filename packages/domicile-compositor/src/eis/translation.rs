//! Emulated input, turned into the requests the engine's input becomes.
//!
//! The engine forwards a key or a click as a [`ClientRequest`], and the Wayland
//! thread injects it into the seat unless the desk is locked (see
//! [`crate::lock::refused`]). Emulated input becomes the same requests and
//! takes the same path, so the lock refuses it the same way.
//!
//! The engine sends a pointer position relative to the window under it, since
//! the page decides what is under the pointer. An EIS client sends desktop
//! positions, so [`Desk::window_under`] decides here. A point over no window
//! is over the shell, which only the engine can deliver to, so it reaches
//! nothing.
//!
//! The seat has no touchscreen, so a touch is the pointer's left button: one
//! finger at a time, and later fingers are ignored until it lifts.

use std::collections::BTreeSet;

use domicile_scene::Point;
use tracing::warn;

use crate::eis::desk::Desk;
use crate::ClientRequest;

/// The pointer's left button, in evdev codes.
const BTN_LEFT: u32 = 0x110;

/// How far one wheel detent scrolls, in logical units, as libinput reports it.
const DETENT: f64 = 15.0;

/// A wheel detent in `v120` units.
const V120_PER_DETENT: f64 = 120.0;

/// One event from an EIS client, without `reis` around it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Emulated {
    /// Relative motion, in logical units.
    Motion {
        dx: f64,
        dy: f64,
    },
    /// A point in region coordinates (see [`crate::eis::desk`]).
    MotionAbsolute {
        x: f64,
        y: f64,
    },
    Button {
        button: u32,
        pressed: bool,
    },
    /// Smooth scrolling, in logical units.
    Scroll {
        dx: f64,
        dy: f64,
    },
    /// Wheel clicks, in `v120` units.
    ScrollDiscrete {
        v120_x: i32,
        v120_y: i32,
    },
    /// An evdev key code.
    Key {
        keycode: u32,
        pressed: bool,
    },
    TouchDown {
        id: u32,
        x: f64,
        y: f64,
    },
    TouchMotion {
        id: u32,
        x: f64,
        y: f64,
    },
    /// A finger lifted or the touch was canceled.
    TouchUp {
        id: u32,
    },
}

/// One client's input: where its pointer is, and the keys and buttons it holds
/// down.
///
/// Kept so that revoking a session releases everything, and no key stays down
/// in a window after the client is gone.
#[derive(Debug, Default)]
pub struct Input {
    pointer: Option<Point>,
    /// The window the pointer is over, so leaving it is said once.
    over: Option<String>,
    keys: BTreeSet<u32>,
    buttons: BTreeSet<u32>,
    /// The finger that is down, which is the left button.
    finger: Option<u32>,
}

impl Input {
    /// The requests for one event.
    pub fn translate(&mut self, emulated: Emulated, desk: &Desk) -> Vec<ClientRequest> {
        match emulated {
            Emulated::Motion { dx, dy } => {
                let from = self.pointer.unwrap_or_else(|| desk.middle());
                let to = desk.held(from, Point::new(from.x + dx, from.y + dy));
                self.point_at(to, desk)
            }
            Emulated::MotionAbsolute { x, y } => self.jump_to(x, y, desk),
            Emulated::Button { button, pressed } => self.button(button, pressed),
            Emulated::Scroll { dx, dy } => vec![ClientRequest::PointerAxis {
                dx,
                dy,
                v120_x: 0,
                v120_y: 0,
            }],
            Emulated::ScrollDiscrete { v120_x, v120_y } => vec![ClientRequest::PointerAxis {
                dx: f64::from(v120_x) / V120_PER_DETENT * DETENT,
                dy: f64::from(v120_y) / V120_PER_DETENT * DETENT,
                v120_x,
                v120_y,
            }],
            Emulated::Key { keycode, pressed } => {
                if pressed {
                    self.keys.insert(keycode);
                } else {
                    self.keys.remove(&keycode);
                }
                vec![ClientRequest::Key { keycode, pressed }]
            }
            Emulated::TouchDown { id, x, y } => match self.finger {
                Some(_) => Vec::new(),
                None => {
                    self.finger = Some(id);
                    let mut requests = self.jump_to(x, y, desk);
                    requests.extend(self.button(BTN_LEFT, true));
                    requests
                }
            },
            Emulated::TouchMotion { id, x, y } => {
                if self.finger == Some(id) {
                    self.jump_to(x, y, desk)
                } else {
                    Vec::new()
                }
            }
            Emulated::TouchUp { id } => {
                if self.finger == Some(id) {
                    self.finger = None;
                    self.button(BTN_LEFT, false)
                } else {
                    Vec::new()
                }
            }
        }
    }

    /// Release every key and button held down, and leave the window under the
    /// pointer.
    pub fn let_go(&mut self) -> Vec<ClientRequest> {
        self.finger = None;
        let keys = std::mem::take(&mut self.keys)
            .into_iter()
            .map(|keycode| ClientRequest::Key {
                keycode,
                pressed: false,
            });
        let buttons = std::mem::take(&mut self.buttons).into_iter().map(|button| {
            ClientRequest::PointerButton {
                button,
                pressed: false,
            }
        });
        let leave = self.over.take().map(|_| ClientRequest::PointerLeave);
        keys.chain(buttons).chain(leave).collect()
    }

    fn jump_to(&mut self, x: f64, y: f64, desk: &Desk) -> Vec<ClientRequest> {
        match desk.at(x, y) {
            Some(point) => self.point_at(point, desk),
            // The protocol forbids it, so the client has a bug. Nothing is
            // under a point that is not on the desk.
            None => {
                warn!(x, y, "an EIS client pointed off every display");
                Vec::new()
            }
        }
    }

    fn point_at(&mut self, point: Point, desk: &Desk) -> Vec<ClientRequest> {
        self.pointer = Some(point);
        match desk.window_under(point) {
            Some((app_id, local)) => {
                self.over = Some(app_id.clone());
                vec![ClientRequest::PointerMotion {
                    app_id,
                    x: local.x,
                    y: local.y,
                }]
            }
            None => match self.over.take() {
                Some(_) => vec![ClientRequest::PointerLeave],
                None => Vec::new(),
            },
        }
    }

    fn button(&mut self, button: u32, pressed: bool) -> Vec<ClientRequest> {
        if pressed {
            self.buttons.insert(button);
        } else {
            self.buttons.remove(&button);
        }
        vec![ClientRequest::PointerButton { button, pressed }]
    }
}

#[cfg(test)]
mod tests {
    use domicile_config::Transform;
    use domicile_scene::{Bounds, Point};

    use super::{Emulated, Input, BTN_LEFT};
    use crate::eis::desk::{Desk, Window};
    use crate::screens::Advertised;
    use crate::ClientRequest;

    /// One 1280x800 display with a window at 100,100, 400x300.
    fn desk() -> Desk {
        Desk::new(
            vec![Advertised {
                name: "one".into(),
                position: (0, 0),
                logical: (1280, 800),
                mode: (1280, 800),
                scale: 1.0,
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
                focused: false,
            }],
        )
    }

    fn motion_in_the_window(x: f64, y: f64) -> ClientRequest {
        ClientRequest::PointerMotion {
            app_id: "1".into(),
            x,
            y,
        }
    }

    #[test]
    fn an_absolute_pointer_moves_over_the_window_under_it() {
        let mut input = Input::default();
        assert_eq!(
            input.translate(Emulated::MotionAbsolute { x: 110.0, y: 120.0 }, &desk()),
            [motion_in_the_window(10.0, 20.0)]
        );
    }

    #[test]
    fn a_pointer_leaving_a_window_for_the_shell_says_so_once() {
        let mut input = Input::default();
        input.translate(Emulated::MotionAbsolute { x: 110.0, y: 120.0 }, &desk());
        assert_eq!(
            input.translate(Emulated::MotionAbsolute { x: 900.0, y: 120.0 }, &desk()),
            [ClientRequest::PointerLeave]
        );
        assert_eq!(
            input.translate(Emulated::MotionAbsolute { x: 901.0, y: 120.0 }, &desk()),
            [],
            "and the shell is reached by nothing"
        );
    }

    #[test]
    fn a_point_off_the_desk_reaches_nothing() {
        let mut input = Input::default();
        assert_eq!(
            input.translate(
                Emulated::MotionAbsolute {
                    x: 5000.0,
                    y: 120.0
                },
                &desk()
            ),
            []
        );
    }

    #[test]
    fn a_relative_pointer_starts_in_the_middle_and_moves_from_there() {
        let mut input = Input::default();
        // The middle, 640,400, is just off the window's far corner.
        assert_eq!(
            input.translate(
                Emulated::Motion {
                    dx: -150.0,
                    dy: -100.0
                },
                &desk()
            ),
            [motion_in_the_window(390.0, 200.0)]
        );
        assert_eq!(
            input.translate(Emulated::Motion { dx: 5.0, dy: 5.0 }, &desk()),
            [motion_in_the_window(395.0, 205.0)]
        );
    }

    #[test]
    fn a_relative_pointer_stops_at_the_edge_of_the_desk() {
        let mut input = Input::default();
        input.translate(
            Emulated::Motion {
                dx: -10_000.0,
                dy: -10_000.0,
            },
            &desk(),
        );
        assert_eq!(
            input.translate(
                Emulated::Motion {
                    dx: 110.0,
                    dy: 110.0
                },
                &desk()
            ),
            [motion_in_the_window(10.0, 10.0)]
        );
    }

    #[test]
    fn keys_buttons_and_the_wheel_go_as_the_engine_sends_them() {
        let mut input = Input::default();
        assert_eq!(
            input.translate(
                Emulated::Key {
                    keycode: 30,
                    pressed: true
                },
                &desk()
            ),
            [ClientRequest::Key {
                keycode: 30,
                pressed: true
            }]
        );
        assert_eq!(
            input.translate(
                Emulated::Button {
                    button: 0x111,
                    pressed: true
                },
                &desk()
            ),
            [ClientRequest::PointerButton {
                button: 0x111,
                pressed: true
            }]
        );
        assert_eq!(
            input.translate(Emulated::Scroll { dx: 0.0, dy: 7.5 }, &desk()),
            [ClientRequest::PointerAxis {
                dx: 0.0,
                dy: 7.5,
                v120_x: 0,
                v120_y: 0
            }]
        );
    }

    #[test]
    fn a_wheel_click_scrolls_as_far_as_a_mouse_wheel_does() {
        let mut input = Input::default();
        assert_eq!(
            input.translate(
                Emulated::ScrollDiscrete {
                    v120_x: 0,
                    v120_y: -240
                },
                &desk()
            ),
            [ClientRequest::PointerAxis {
                dx: 0.0,
                dy: -30.0,
                v120_x: 0,
                v120_y: -240
            }]
        );
    }

    #[test]
    fn a_finger_is_the_left_button_where_it_touches() {
        let mut input = Input::default();
        assert_eq!(
            input.translate(
                Emulated::TouchDown {
                    id: 7,
                    x: 110.0,
                    y: 120.0
                },
                &desk()
            ),
            [
                motion_in_the_window(10.0, 20.0),
                ClientRequest::PointerButton {
                    button: BTN_LEFT,
                    pressed: true
                }
            ]
        );
        assert_eq!(
            input.translate(
                Emulated::TouchMotion {
                    id: 7,
                    x: 130.0,
                    y: 120.0
                },
                &desk()
            ),
            [motion_in_the_window(30.0, 20.0)]
        );
        assert_eq!(
            input.translate(Emulated::TouchUp { id: 7 }, &desk()),
            [ClientRequest::PointerButton {
                button: BTN_LEFT,
                pressed: false
            }]
        );
    }

    #[test]
    fn a_second_finger_is_ignored_until_the_first_lifts() {
        let mut input = Input::default();
        input.translate(
            Emulated::TouchDown {
                id: 7,
                x: 110.0,
                y: 120.0,
            },
            &desk(),
        );
        for second in [
            Emulated::TouchDown {
                id: 8,
                x: 200.0,
                y: 200.0,
            },
            Emulated::TouchMotion {
                id: 8,
                x: 210.0,
                y: 200.0,
            },
            Emulated::TouchUp { id: 8 },
        ] {
            assert_eq!(input.translate(second, &desk()), [], "{second:?}");
        }
    }

    #[test]
    fn letting_go_releases_everything_held_and_leaves_the_window() {
        let mut input = Input::default();
        for held in [
            Emulated::MotionAbsolute { x: 110.0, y: 120.0 },
            Emulated::Key {
                keycode: 30,
                pressed: true,
            },
            Emulated::Key {
                keycode: 42,
                pressed: true,
            },
            Emulated::Key {
                keycode: 42,
                pressed: false,
            },
            Emulated::Button {
                button: 0x111,
                pressed: true,
            },
        ] {
            input.translate(held, &desk());
        }
        assert_eq!(
            input.let_go(),
            [
                ClientRequest::Key {
                    keycode: 30,
                    pressed: false
                },
                ClientRequest::PointerButton {
                    button: 0x111,
                    pressed: false
                },
                ClientRequest::PointerLeave,
            ]
        );
        assert_eq!(input.let_go(), [], "and lets go once");
    }
}
