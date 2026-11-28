//! What every interface of the desktop's `xdg-desktop-portal` backend shares.
//!
//! Each interface is a crate of its own, `domicile-portal-<name>`, that
//! registers on [`OBJECT_PATH`]. One that needs the user calls
//! [`queue::ask`], which lists the dialog for the shell and waits for its
//! answer. `domicile-compositor`'s `portals` serves them all on one bus name.
//! See `docs/PORTALS.md`.

pub mod queue;
pub mod reply;
pub mod request;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

/// The object path the frontend calls backends at.
pub const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";
