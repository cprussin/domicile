//! Pinch ownership and delivery to the native pointer focus.

use domicile_protocol::pinch::Pinch;
use smithay::input::pointer::{
    GesturePinchBeginEvent, GesturePinchEndEvent, GesturePinchUpdateEvent,
};
use smithay::utils::SERIAL_COUNTER;

use crate::DomicileCompositor;

pub struct ActivePinch {
    owner: usize,
    device: u32,
    app_id: String,
}

/// The foreign field keeps Smithay's spelling; the wire uses American English.
fn pinch_end(time: u32, canceled: bool) -> GesturePinchEndEvent {
    GesturePinchEndEvent {
        serial: SERIAL_COUNTER.next_serial(),
        time,
        cancelled: canceled,
    }
}

impl DomicileCompositor {
    pub fn forward_pinch(&mut self, owner: usize, app_id: &str, pinch: Pinch) {
        let pointer = self.seat.get_pointer().unwrap();
        if let Pinch::Begin {
            device,
            time,
            fingers,
        } = pinch
        {
            // A begin for a window the pointer is not on starts nothing, and
            // so must not end the pointer window's pinch either.
            if self.pointer_app.as_deref() != Some(app_id) || self.surface_for(app_id).is_none() {
                return;
            }
            self.cancel_pinch();
            self.pinch = Some(ActivePinch {
                owner,
                device,
                app_id: app_id.to_owned(),
            });
            pointer.gesture_pinch_begin(
                self,
                &GesturePinchBeginEvent {
                    serial: SERIAL_COUNTER.next_serial(),
                    time,
                    fingers: fingers.get(),
                },
            );
            return;
        }
        // An end on focus loss or cancellation retires the sequence. Its
        // remaining updates cannot start another gesture.
        let matching = self.pinch.as_ref().is_some_and(|active| {
            active.owner == owner && active.device == pinch.device() && active.app_id == app_id
        });
        if !matching {
            return;
        }
        match pinch {
            Pinch::Update {
                time,
                dx,
                dy,
                scale,
                rotation,
                ..
            } => {
                if dx.is_finite()
                    && dy.is_finite()
                    && scale.is_finite()
                    && scale > 0.0
                    && rotation.is_finite()
                {
                    pointer.gesture_pinch_update(
                        self,
                        &GesturePinchUpdateEvent {
                            time,
                            delta: (dx, dy).into(),
                            scale,
                            rotation,
                        },
                    );
                } else {
                    tracing::error!("invalid native pinch update; canceling the sequence");
                    self.cancel_pinch();
                }
            }
            Pinch::End { time, canceled, .. } => {
                self.pinch = None;
                pointer.gesture_pinch_end(self, &pinch_end(time, canceled));
            }
            Pinch::Begin { .. } => {
                unreachable!("beginnings are handled before matching a sequence")
            }
        }
    }

    pub fn cancel_pinch(&mut self) {
        if self.pinch.take().is_some() {
            let pointer = self.seat.get_pointer().unwrap();
            let time = self.now_ms();
            pointer.gesture_pinch_end(self, &pinch_end(time, true));
        }
    }

    pub fn pinch_owner_gone(&mut self, owner: usize) {
        if self
            .pinch
            .as_ref()
            .is_some_and(|active| active.owner == owner)
        {
            self.cancel_pinch();
        }
    }

    pub fn pinch_window_gone(&mut self, app_id: &str) {
        if self
            .pinch
            .as_ref()
            .is_some_and(|active| active.app_id == app_id)
        {
            self.cancel_pinch();
        }
    }
}
