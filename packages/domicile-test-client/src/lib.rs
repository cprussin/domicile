//! A minimal Wayland client that tests open windows with.
//!
//! It needs no weston, libwayland or GPU, so checks that need a real client
//! run on any machine that builds the workspace.
//!
//! The `domicile-test-client` executable is a `[[bin]]` of
//! `domicile-compositor`. Cargo builds a package's binaries when it builds that
//! package's tests, but cannot depend on another package's binary, so this is
//! how `cargo test -p domicile-compositor` gets the client it spawns.

use std::ffi::OsString;
use std::process::ExitCode;

pub mod arguments;
pub mod trace;
mod window;

pub use window::{POPUP, POPUP_COLOR, TRANSLUCENT_ALPHA, TRANSLUCENT_COLORS};

/// Run the client: open a window on `WAYLAND_DISPLAY` and draw until killed.
///
/// See [`arguments`] for the accepted command line.
pub fn run(command_line: impl IntoIterator<Item = OsString>) -> ExitCode {
    let asked = match arguments::arguments(command_line) {
        Ok(asked) => asked,
        Err(err) => {
            eprintln!("domicile-test-client: {err}");
            eprintln!(
                "usage: domicile-test-client [--title NAME] [--trace] [--translucent] [--follow-configure] [--ask-for-focus] [--hold-the-screens-on] [--hold-the-screens-on-before-it-has-a-window] [--outlive-its-window] [--copy TEXT] [--copy-primary TEXT] [--paste] [--popup] [--popup-grab] [--min-size WxH] [--max-size WxH]"
            );
            return ExitCode::from(2);
        }
    };

    if asked.trace {
        trace::wanted();
    }

    // `window::run` returns only on failure; callers end the client with a
    // signal.
    let Err(err) = window::run(&asked);
    eprintln!("domicile-test-client: {err}");
    ExitCode::FAILURE
}
