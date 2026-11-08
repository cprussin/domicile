//! Touchpad pinch phases with native Wayland gesture semantics.

use std::num::NonZeroU32;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Pinch {
    Begin {
        device: u32,
        time: u32,
        fingers: NonZeroU32,
    },
    Update {
        device: u32,
        time: u32,
        dx: f64,
        dy: f64,
        scale: f64,
        rotation: f64,
    },
    End {
        device: u32,
        time: u32,
        canceled: bool,
    },
}

impl Pinch {
    /// The platform device that owns this sequence.
    pub fn device(&self) -> u32 {
        match self {
            Self::Begin { device, .. } | Self::Update { device, .. } | Self::End { device, .. } => {
                *device
            }
        }
    }
}
