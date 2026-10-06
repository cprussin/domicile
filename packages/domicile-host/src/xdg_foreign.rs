//! Window handles from `xdg_foreign` (`zxdg_exporter_v1`/`v2`).
//!
//! A client exports its window and passes the handle to another process. A
//! portal request carries it as `parent_window` (`wayland:<handle>`), and the
//! portals backend resolves it to the `<app>` to draw the dialog over. See
//! `docs/architecture/PORTALS.md`.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use crate::AppId;

/// The `parent_window` prefix for a Wayland handle, per the portal spec.
const WAYLAND_PREFIX: &str = "wayland:";

/// Random bytes in a handle. Unguessable, so a client cannot name another
/// client's window to a portal.
const HANDLE_BYTES: usize = 16;

/// The live exports, by handle.
#[derive(Debug, Default)]
pub struct Exports {
    apps: HashMap<String, AppId>,
}

impl Exports {
    /// Records an export of `app_id`'s window and returns its new handle.
    ///
    /// `None` is a surface with no `<app>`, such as the chrome's own toplevel.
    /// Its handle names nothing.
    pub fn export(&mut self, app_id: Option<AppId>) -> String {
        let handle = new_handle();
        if let Some(app_id) = app_id {
            self.apps.insert(handle.clone(), app_id);
        }
        handle
    }

    /// Forgets a handle whose `zxdg_exported` object was destroyed.
    pub fn unexport(&mut self, handle: &str) {
        self.apps.remove(handle);
    }

    /// Forgets every handle for a closed window.
    pub fn app_closed(&mut self, app_id: &str) {
        self.apps.retain(|_, exported| exported != app_id);
    }

    /// The app id of the window a portal's `parent_window` names.
    ///
    /// `None` for an empty or unknown handle or a non-Wayland one (`x11:…`);
    /// the dialog then goes over the focused screen.
    pub fn parent_window_app(&self, parent_window: &str) -> Option<AppId> {
        parent_window
            .strip_prefix(WAYLAND_PREFIX)
            .and_then(|handle| self.apps.get(handle))
            .cloned()
    }
}

/// A fresh handle: random bytes as hex.
fn new_handle() -> String {
    let mut bytes = [0u8; HANDLE_BYTES];
    File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut bytes))
        .expect("read /dev/urandom for an xdg_foreign handle");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
