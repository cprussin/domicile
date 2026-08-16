//! Shared logic for the Domicile host daemon.
//!
//! The daemon's job today is the compositor's *control plane*: boot from
//! config, resolve the active chrome package, and serve the chrome protocol
//! over a socket to a connected shell. The Wayland server and the web-engine
//! bridge attach to this same host brain later; keeping the connection loop
//! here (rather than in `main`) makes it unit-testable.

use std::io::{BufRead, Write};

use domicile_host::ipc::{to_line, Session};

pub mod config_reload;

/// Drive one chrome connection to completion.
///
/// Reads newline-delimited chrome messages from `reader`, feeds each into the
/// `session`, and writes any responses to `writer`. Returns when the peer
/// closes the connection (EOF).
pub fn run_connection<R: BufRead, W: Write>(
    mut reader: R,
    mut writer: W,
    session: &mut Session,
) -> std::io::Result<()> {
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(()); // EOF: peer disconnected
        }
        for message in session.ingest(&line) {
            writer.write_all(to_line(&message).as_bytes())?;
        }
        writer.flush()?;
    }
}
