//! Takes the desk's well-known names on the session bus.
//!
//! Several desks can share one session bus: a desk in another desk's window,
//! or a second login session on another tty. A login session takes each name
//! from the desk holding it, and a desk in a window queues behind it. Every
//! desk stays in the queue, so when the holder exits the bus gives the name to
//! the next desk.

use std::ffi::OsStr;

use zbus::fdo::RequestNameFlags;

/// Whether this desk is in another session's window, from its own
/// `WAYLAND_DISPLAY`, `host`.
///
/// An empty value counts as unset, as in `domicile_launch::platform`: the desk
/// is on a tty.
pub fn in_a_window(host: Option<&OsStr>) -> bool {
    host.is_some_and(|display| !display.is_empty())
}

/// Takes `name` or queues for it. See the module docs.
pub fn take(
    connection: &zbus::blocking::Connection,
    name: &str,
    in_a_window: bool,
) -> zbus::Result<()> {
    let flags = if in_a_window {
        RequestNameFlags::AllowReplacement.into()
    } else {
        RequestNameFlags::AllowReplacement | RequestNameFlags::ReplaceExisting
    };
    connection.request_name_with_flags(name, flags).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_desk_with_a_host_display_is_in_a_window() {
        assert!(in_a_window(Some(OsStr::new("wayland-0"))));
    }

    #[test]
    fn a_desk_with_no_host_display_is_on_a_tty() {
        assert!(!in_a_window(None));
        assert!(!in_a_window(Some(OsStr::new(""))));
    }
}
