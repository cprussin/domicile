//! A stand-in Wayland client: what a test opens a window with.
//!
//! Fourteen of this repo's end-to-end checks needed a real client to point at
//! the compositor, and reached for weston's demo programs to get one —
//! `weston-flower`, `weston-terminal`, `weston-simple-shm`. Those are not on
//! most machines, so what those checks did on most machines was `exit 77`:
//! they stopped running, which is the worst outcome a check can have and the
//! one nobody notices.
//!
//! This is that client, built from the workspace. It needs no weston, no
//! libwayland and no GPU — the Wayland crates it speaks are already in
//! `Cargo.lock`, because Smithay pulls them for the compositor's own server
//! side.
//!
//! All of it is the library, and none of it is a binary of this crate: the
//! `domicile-test-client` executable is a `[[bin]]` of `domicile-compositor`,
//! whose integration tests spawn it. Cargo builds a package's binaries
//! whenever it builds that package's tests and has no stable way to depend on
//! *another* package's binary, so owning the target there is what makes
//! `cargo test -p domicile-compositor` produce the client it starts. The code
//! stays here, where the crate that describes it is.

use std::ffi::OsString;
use std::process::ExitCode;

pub mod arguments;
pub mod trace;
mod window;

pub use window::{TRANSLUCENT_ALPHA, TRANSLUCENT_COLOURS};

/// Be the client: open a window on the compositor `WAYLAND_DISPLAY` names and
/// keep drawing until something kills it.
///
/// Takes the command line rather than reading it, so the caller is a `main`
/// with nothing in it but this — see `arguments` for what it accepts.
pub fn run(command_line: impl IntoIterator<Item = OsString>) -> ExitCode {
    let asked = match arguments::arguments(command_line) {
        Ok(asked) => asked,
        Err(err) => {
            eprintln!("domicile-test-client: {err}");
            eprintln!("usage: domicile-test-client [--title NAME] [--trace] [--translucent]");
            return ExitCode::from(2);
        }
    };

    if asked.trace {
        trace::wanted();
    }

    // `window::run` only returns a failure — a window's job here lasts as long
    // as the check that opened it, and every caller ends it with a signal.
    let Err(err) = window::run(&asked.title, asked.translucent);
    eprintln!("domicile-test-client: {err}");
    ExitCode::FAILURE
}
