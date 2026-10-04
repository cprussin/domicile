//! Sets the screen backlight through logind.
//!
//! `/sys/class/backlight/*/brightness` is writable only by root. logind's
//! `Session.SetBrightness` lets the session owner set it without a udev rule
//! or setuid helper. The shell reads the new level back from the uevent, in
//! `domicile_host::backlight`.
//!
//! Runs on its own thread so D-Bus calls never block the Wayland thread. A
//! dragged slider sends many requests, so only the newest is written. Failures
//! are logged and never stop the compositor.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

use tracing::warn;

/// A device under `/sys/class/backlight` and the raw value to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub device: String,
    pub raw: u32,
}

/// Handle to the writer thread. Dropping the last one ends the thread.
#[derive(Clone)]
pub struct Backlight {
    told: Sender<Request>,
}

impl Backlight {
    pub fn set(&self, request: Request) {
        // A failed send means the writer stopped and already logged why.
        let _ = self.told.send(request);
    }
}

/// Start the writer.
pub fn serve() -> Backlight {
    let (told, requests) = channel();
    thread::spawn(move || {
        if let Err(why) = write(&requests) {
            warn!(%why, "the backlight cannot be set; the brightness slider will do nothing");
        }
    });
    Backlight { told }
}

/// Connects to the system bus and writes the newest request each time.
/// Returns on a bus connection failure or when every handle is dropped.
///
/// A refused write is logged and skipped: an inactive session (after a console
/// switch) may be active again by the next request.
fn write(requests: &Receiver<Request>) -> Result<(), zbus::Error> {
    let connection = zbus::blocking::Connection::system()?;
    while let Some(request) = newest(requests) {
        if let Err(why) = connection.call_method(
            Some("org.freedesktop.login1"),
            "/org/freedesktop/login1/session/auto",
            Some("org.freedesktop.login1.Session"),
            "SetBrightness",
            &("backlight", request.device.as_str(), request.raw),
        ) {
            warn!(%why, device = %request.device, "logind refused to set the backlight");
        }
    }
    Ok(())
}

/// Blocks for the next request and returns the newest one queued, or `None`
/// once every sender is gone.
fn newest(requests: &Receiver<Request>) -> Option<Request> {
    let first = requests.recv().ok()?;
    Some(requests.try_iter().last().unwrap_or(first))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(raw: u32) -> Request {
        Request {
            device: "intel_backlight".into(),
            raw,
        }
    }

    #[test]
    fn a_drag_is_written_where_it_ends_up() {
        let (told, requests) = channel();
        told.send(at(1)).unwrap();
        told.send(at(2)).unwrap();
        told.send(at(3)).unwrap();

        assert_eq!(newest(&requests), Some(at(3)));
    }

    #[test]
    fn a_lone_request_is_written() {
        let (told, requests) = channel();
        told.send(at(7)).unwrap();

        assert_eq!(newest(&requests), Some(at(7)));
    }

    #[test]
    fn the_writer_stops_when_the_compositor_goes() {
        let (told, requests) = channel::<Request>();
        drop(told);

        assert_eq!(newest(&requests), None);
    }
}
