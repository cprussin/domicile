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

use domicile_test_client::{arguments, trace};

mod window;

use std::process::ExitCode;

fn main() -> ExitCode {
    let asked = match arguments::arguments(std::env::args_os().skip(1)) {
        Ok(asked) => asked,
        Err(err) => {
            eprintln!("domicile-test-client: {err}");
            eprintln!("usage: domicile-test-client [--title NAME] [--trace]");
            return ExitCode::from(2);
        }
    };

    if asked.trace {
        trace::wanted();
    }

    // `run` only returns a failure — a window's job here lasts as long as the
    // check that opened it, and every caller ends it with a signal.
    let Err(err) = window::run(&asked.title);
    eprintln!("domicile-test-client: {err}");
    ExitCode::FAILURE
}
