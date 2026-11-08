//! Touchpad swipes and holds the shell left unbound, for the native window
//! under the pointer.
//!
//! Unlike a pinch, which the `<app>` under the pointer sends, these come from
//! the browser itself and name no window. The pointer's window when one
//! begins gets every phase of it: a gesture does not follow the pointer to
//! another window, and ends canceled when the pointer leaves, as a pinch does.

use domicile_protocol::swipe::{Hold, Swipe};
use smithay::input::pointer::{
    GestureHoldBeginEvent, GestureHoldEndEvent, GestureSwipeBeginEvent, GestureSwipeEndEvent,
    GestureSwipeUpdateEvent,
};
use smithay::utils::SERIAL_COUNTER;

use crate::DomicileCompositor;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Swipe,
    Hold,
}

pub struct ActiveSwipe {
    owner: usize,
    kind: Kind,
    app_id: String,
}

impl DomicileCompositor {
    pub fn forward_swipe(&mut self, owner: usize, swipe: Swipe) {
        let pointer = self.seat.get_pointer().unwrap();
        let time = self.now_ms();
        match swipe {
            Swipe::Begin { fingers } => {
                if self.begin_swipe(owner, Kind::Swipe) {
                    pointer.gesture_swipe_begin(
                        self,
                        &GestureSwipeBeginEvent {
                            serial: SERIAL_COUNTER.next_serial(),
                            time,
                            fingers: fingers.get(),
                        },
                    );
                }
            }
            Swipe::Update { dx, dy } => {
                if !self.swiping(owner, Kind::Swipe) {
                    return;
                }
                if dx.is_finite() && dy.is_finite() {
                    pointer.gesture_swipe_update(
                        self,
                        &GestureSwipeUpdateEvent {
                            time,
                            delta: (dx, dy).into(),
                        },
                    );
                } else {
                    tracing::error!("invalid swipe update; canceling the swipe");
                    self.cancel_swipe();
                }
            }
            Swipe::End { canceled } => {
                if self.swiping(owner, Kind::Swipe) {
                    self.swipe = None;
                    pointer.gesture_swipe_end(self, &swipe_end(time, canceled));
                }
            }
        }
    }

    pub fn forward_hold(&mut self, owner: usize, hold: Hold) {
        let pointer = self.seat.get_pointer().unwrap();
        let time = self.now_ms();
        match hold {
            Hold::Begin { fingers } => {
                if self.begin_swipe(owner, Kind::Hold) {
                    pointer.gesture_hold_begin(
                        self,
                        &GestureHoldBeginEvent {
                            serial: SERIAL_COUNTER.next_serial(),
                            time,
                            fingers: fingers.get(),
                        },
                    );
                }
            }
            Hold::End { canceled } => {
                if self.swiping(owner, Kind::Hold) {
                    self.swipe = None;
                    pointer.gesture_hold_end(self, &hold_end(time, canceled));
                }
            }
        }
    }

    /// Starts a gesture for the pointer's window, if it is on one, ending any
    /// gesture still going: the touchpad does one at a time.
    fn begin_swipe(&mut self, owner: usize, kind: Kind) -> bool {
        self.cancel_swipe();
        let Some(app_id) = self.pointer_app.clone() else {
            return false;
        };
        if self.surface_for(&app_id).is_none() {
            return false;
        }
        self.swipe = Some(ActiveSwipe {
            owner,
            kind,
            app_id,
        });
        true
    }

    fn swiping(&self, owner: usize, kind: Kind) -> bool {
        self.swipe
            .as_ref()
            .is_some_and(|active| active.owner == owner && active.kind == kind)
    }

    /// Ends the gesture in progress, if any, canceled.
    pub fn cancel_swipe(&mut self) {
        if let Some(active) = self.swipe.take() {
            let pointer = self.seat.get_pointer().unwrap();
            let time = self.now_ms();
            match active.kind {
                Kind::Swipe => pointer.gesture_swipe_end(self, &swipe_end(time, true)),
                Kind::Hold => pointer.gesture_hold_end(self, &hold_end(time, true)),
            }
        }
    }

    pub fn swipe_owner_gone(&mut self, owner: usize) {
        if self
            .swipe
            .as_ref()
            .is_some_and(|active| active.owner == owner)
        {
            self.cancel_swipe();
        }
    }

    pub fn swipe_window_gone(&mut self, app_id: &str) {
        if self
            .swipe
            .as_ref()
            .is_some_and(|active| active.app_id == app_id)
        {
            self.cancel_swipe();
        }
    }
}

/// The foreign field keeps Smithay's spelling; the wire uses American English.
fn swipe_end(time: u32, canceled: bool) -> GestureSwipeEndEvent {
    GestureSwipeEndEvent {
        serial: SERIAL_COUNTER.next_serial(),
        time,
        cancelled: canceled,
    }
}

fn hold_end(time: u32, canceled: bool) -> GestureHoldEndEvent {
    GestureHoldEndEvent {
        serial: SERIAL_COUNTER.next_serial(),
        time,
        cancelled: canceled,
    }
}
