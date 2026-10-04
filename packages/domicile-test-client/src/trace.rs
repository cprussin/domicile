//! Protocol event log for checks that assert on Wayland messages.
//!
//! Prints events in libwayland's `WAYLAND_DEBUG` shape, such as
//! `wl_surface@12.enter(wl_output@7)`, which is what the checks grep for. The
//! pure-Rust backend's own debug output uses a different format.
//!
//! Off unless `--trace` is given, since a buffer release arrives every frame.

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether `--trace` was given.
///
/// A global because the `Dispatch` handlers that report events do not see the
/// command line.
static WANTED: AtomicBool = AtomicBool::new(false);

/// Start reporting. Called once, before the connection is made.
pub fn wanted() {
    WANTED.store(true, Ordering::Relaxed);
}

/// Print one line if tracing is on.
pub fn say(line: std::fmt::Arguments<'_>) {
    if WANTED.load(Ordering::Relaxed) {
        eprintln!("{line}");
    }
}

/// Trace one protocol message in libwayland's shape.
///
/// `say!(object, "enter({})", other)` prints
/// `wl_surface@12.enter(wl_output@7)`.
///
/// The argument expressions run even when tracing is off; only formatting and
/// the write are skipped.
#[macro_export]
macro_rules! say {
    ($object:expr, $($argument:tt)*) => {
        $crate::trace::say(format_args!(
            "{}.{}",
            $object,
            format_args!($($argument)*)
        ))
    };
}
