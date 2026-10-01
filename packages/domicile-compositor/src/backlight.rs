//! Setting the screen's backlight, through logind.
//!
//! `/sys/class/backlight/*/brightness` is root's, and this compositor is not.
//! logind's `Session.SetBrightness` is how a session's owner sets its own
//! backlight without a udev rule or a setuid helper — the same call
//! `brightnessctl` and GNOME make. What the shell sees of it is the uevent the
//! write produces, read back by `domicile_host::backlight`.
//!
//! **On a thread of its own**, like `crate::appearance`: a D-Bus round trip is
//! nothing the Wayland thread should wait on. A slider being dragged asks many
//! times a second, so the thread takes the newest request and drops the ones
//! it overtook — only where the drag ends up matters.
//!
//! **Nothing here can take the desktop down.** No system bus, or no logind
//! session, is a desk whose slider does nothing, and the log says why.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

use tracing::warn;

/// One write: the device under `/sys/class/backlight` and its raw value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub device: String,
    pub raw: u32,
}

/// A handle on the writer. Dropping the last one ends its thread.
#[derive(Clone)]
pub struct Backlight {
    told: Sender<Request>,
}

impl Backlight {
    pub fn set(&self, request: Request) {
        // The thread only goes when this handle does, so a failed send is a
        // writer that already logged why it stopped.
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

/// Connect, then write each newest request. Returns only on failure to reach
/// the bus, or when the compositor has gone.
///
/// A refused write is logged and the thread carries on: a session that was
/// not active a moment ago (a console switch) may be by the next drag.
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

/// The next request, skipping every one a later request has overtaken, or
/// `None` once every sender has gone.
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
