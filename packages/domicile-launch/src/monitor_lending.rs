//! `domicile monitor`: a virtual monitor the compositor keeps while the
//! command runs, for a desktop whose monitors follow the panes of something
//! else, like a terminal. See `docs/architecture/A-HEADLESS-DESKTOP.md`.
//!
//! The command sends [`Request::VirtualMonitor`] to the control socket, which
//! lends the connection to [`lend`]. That asks the compositor for the monitor
//! and forwards each [`Request::ResizeVirtualMonitor`] the command sends
//! ([`forward_sizes`]). Either side hanging up ends it: the command's removes
//! the monitor, the compositor's hangs up on the command.

use std::io::{BufRead, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::cli::{monitor_mode, MonitorMode};
use crate::compositor_socket::{virtual_monitor, HeldMonitor};
use crate::control::{to_line, Lent, Request, Response};
use crate::lending::{self, Lending};

/// Holds the monitor `lent` asked for, from the compositor at `chrome`,
/// until either side hangs up. `patience` is how long the compositor may take
/// to add it.
pub fn lend(lent: Lent, chrome: &Path, patience: Duration) {
    let Lent {
        name,
        mode,
        lines,
        client,
    } = lent;
    lending::serve(
        virtual_monitor(chrome, &name, mode, Some(patience)),
        client,
        lines,
        |line| format!("a monitor's client sent '{line}', so it was removed"),
    );
}

// The compositor removing the monitor hangs up on the client.
impl Lending for HeldMonitor {
    fn answer(&self) -> Response {
        Response::VirtualMonitor {
            output: self.output().to_owned(),
        }
    }

    fn watch(&self, _client: &mut UnixStream) {
        self.until_it_ends();
    }

    fn heard(&self, request: Request) -> Option<bool> {
        match request {
            Request::ResizeVirtualMonitor {
                width,
                height,
                refresh_mhz,
                scale,
            } => Some(
                self.resize(MonitorMode {
                    size: (width, height),
                    refresh_mhz,
                    scale,
                })
                .is_ok(),
            ),
            _ => None,
        }
    }

    fn give_back(&self) {
        HeldMonitor::give_back(self);
    }
}

/// Sends a [`Request::ResizeVirtualMonitor`] to `to` for each size in
/// `typed`, one per line as [`monitor_mode`] reads it. A line that is not a
/// size is reported on `said` and skipped; a blank one is skipped.
pub fn forward_sizes(
    typed: impl BufRead,
    mut to: impl Write,
    mut said: impl Write,
) -> std::io::Result<()> {
    for line in typed.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match monitor_mode(line) {
            Some(mode) => to.write_all(
                to_line(&Request::ResizeVirtualMonitor {
                    width: mode.size.0,
                    height: mode.size.1,
                    refresh_mhz: mode.refresh_mhz,
                    scale: mode.scale,
                })
                .as_bytes(),
            )?,
            None => writeln!(
                said,
                "domicile: '{line}' is not a size like 1280x720, 1280x720@30 or \
                 3840x2160 2, so it was skipped"
            )?,
        }
    }
    Ok(())
}
