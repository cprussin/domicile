//! Touchpad swipes and holds the shell left unbound, for the native window
//! under the pointer, with `zwp_pointer_gestures_v1` semantics.
//!
//! The browser recognizes these, not a page, so they name no window: the
//! compositor gives each to whichever native window the pointer is on when it
//! begins, and to nobody if it is on none.

use std::num::NonZeroU32;

use serde::{Deserialize, Serialize};

/// One phase of a swipe. `dx` and `dy` are the fingers' movement since the
/// last update, in the pointer's units.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Swipe {
    Begin { fingers: NonZeroU32 },
    Update { dx: f64, dy: f64 },
    End { canceled: bool },
}

/// One phase of a hold: fingers resting on the touchpad. A hold that ends
/// canceled became something else, such as a swipe or a scroll.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Hold {
    Begin { fingers: NonZeroU32 },
    End { canceled: bool },
}
