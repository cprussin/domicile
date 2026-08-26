//! What this client saw, in the shape the checks already read.
//!
//! Six end-to-end checks assert on the protocol rather than on the picture:
//! that a surface was told which output it is on, that a buffer came back,
//! that a key arrived. Their only window into that was `WAYLAND_DEBUG`, which
//! is why they needed one of weston's clients — the backend this one speaks
//! prints `wl_surface@12.enter, (Some(wl_output@7))`, with a comma and
//! Rust-formatted arguments, and their greps want libwayland's
//! `wl_surface@12.enter(wl_output@7)`.
//!
//! So the client says it itself. `ObjectId`'s `Display` is already
//! `{interface}@{id}`, so a line built from a proxy's id needs no formatting
//! of its own to match — and it is this client reporting what it was handed,
//! not a rendering of somebody else's log.
//!
//! Off unless `--trace` asks for it: a release arrives every frame, and the
//! checks that only need a window open should not pay a write for each one.

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether `--trace` was given. A global because the `Dispatch` handlers that
/// report events are given the client, not the command line, and threading a
/// flag through every one of them to reach `eprintln!` would say less than
/// this does.
static WANTED: AtomicBool = AtomicBool::new(false);

/// Start reporting. Called once, before the connection is made.
pub fn wanted() {
    WANTED.store(true, Ordering::Relaxed);
}

/// Report one line, if anything asked for them.
///
/// Takes the already-formatted line rather than a format string: every caller
/// is one protocol message, and the argument list is what each of them has to
/// spell out to match the shape a check greps for.
pub fn say(line: std::fmt::Arguments<'_>) {
    if WANTED.load(Ordering::Relaxed) {
        eprintln!("{line}");
    }
}

/// One protocol message, in libwayland's shape.
///
/// `say!(object, "enter({})", other)` gives `wl_surface@12.enter(wl_output@7)`.
///
/// A macro for the call site rather than for laziness: the deferral is
/// `format_args!`'s, and a plain function taking `Arguments` would defer just
/// as much. What this buys is a format string and its arguments at the call
/// site, which a function taking one pre-built `Arguments` cannot offer.
///
/// Note that the argument *expressions* — `output.id()`, `number(state)` —
/// still run on every event whether or not `--trace` was given. They are cheap
/// here; it is the formatting and the write that the flag saves.
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
