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
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::cli::{monitor_mode, MonitorMode};
use crate::compositor_socket::virtual_monitor;
use crate::control::{to_line, Lent, Request, Response};

/// Holds the monitor `lent` asked for, from the compositor at `chrome`,
/// until either side hangs up. `patience` is how long the compositor may take
/// to add it.
pub fn lend(lent: Lent, chrome: &Path, patience: Duration) {
    let Lent {
        name,
        mode,
        lines,
        mut client,
    } = lent;
    let held = match virtual_monitor(chrome, &name, mode, Some(patience)) {
        Ok(held) => Arc::new(held),
        Err(why) => {
            // The client may be gone already; there is no one else to tell.
            let _ = client.write_all(
                to_line(&Response::Refused {
                    why: why.to_string(),
                })
                .as_bytes(),
            );
            return;
        }
    };
    let answered = client.write_all(
        to_line(&Response::VirtualMonitor {
            output: held.output().to_owned(),
        })
        .as_bytes(),
    );
    // The compositor going hangs up on the client, which ends the loop below.
    let watching = match (answered, client.try_clone()) {
        (Ok(()), Ok(hanging_up)) => {
            let held = Arc::clone(&held);
            Some(std::thread::spawn(move || {
                held.until_it_ends();
                let _ = hanging_up.shutdown(std::net::Shutdown::Both);
            }))
        }
        _ => None,
    };
    if watching.is_some() {
        for line in lines.lines() {
            let Ok(line) = line else { break };
            match serde_json::from_str::<Request>(line.trim()) {
                Ok(Request::ResizeVirtualMonitor {
                    width,
                    height,
                    refresh_mhz,
                    scale,
                }) => {
                    let mode = MonitorMode {
                        size: (width, height),
                        refresh_mhz,
                        scale,
                    };
                    if held.resize(mode).is_err() {
                        break;
                    }
                }
                // Not what a monitor's connection carries; end it rather
                // than guess.
                _ => {
                    eprintln!("domicile: a monitor's client sent '{line}', so it was removed");
                    break;
                }
            }
        }
    }
    held.give_back();
    if let Some(watching) = watching {
        let _ = watching.join();
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
