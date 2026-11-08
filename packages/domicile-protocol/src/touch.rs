//! Touch points on a native window, with `wl_touch` semantics.

use serde::{Deserialize, Serialize};

/// One step of one finger. `id` names a point from its down to its up; a
/// cancel ends every point down on the window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Touch {
    /// A finger at `x`, `y` in what the client drew, as pointer motion is.
    Down {
        id: i32,
        time: u32,
        x: f64,
        y: f64,
    },
    Motion {
        id: i32,
        time: u32,
        x: f64,
        y: f64,
    },
    Up {
        id: i32,
        time: u32,
    },
    Cancel {
        time: u32,
    },
}
