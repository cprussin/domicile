//! `domicile_anchor_manager_v1`: a client asks for its window to be laid out
//! at a named anchor in the page. See
//! `docs/architecture/WINDOW-COMPOSITING.md#anchored-windows`.

use std::sync::atomic::{AtomicBool, Ordering};

use smithay::reexports::wayland_server::{
    backend::ClientId, protocol::wl_surface::WlSurface, Client, DataInit, Dispatch, DisplayHandle,
    GlobalDispatch, New, Resource,
};
use smithay::wayland::compositor::{with_states, Cacheable};

use crate::DomicileCompositor;

/// The generated protocol, from `protocols/domicile-anchor-v1.xml`.
#[allow(missing_docs, clippy::all)]
pub mod protocol {
    use smithay::reexports::wayland_protocols::xdg::shell::server::*;
    use smithay::reexports::wayland_server;

    pub mod __interfaces {
        use smithay::reexports::wayland_protocols::xdg::shell::server::__interfaces::*;
        use smithay::reexports::wayland_server::backend as wayland_backend;
        wayland_scanner::generate_interfaces!("protocols/domicile-anchor-v1.xml");
    }
    use self::__interfaces::*;

    wayland_scanner::generate_server_code!("protocols/domicile-anchor-v1.xml");
}

use protocol::{domicile_anchor_manager_v1 as manager, domicile_toplevel_anchor_v1 as anchor};

/// Advertises the manager.
pub fn advertise(display: &DisplayHandle) {
    display.create_global::<DomicileCompositor, manager::DomicileAnchorManagerV1, _>(1, ());
}

/// A window's anchor, double-buffered with `wl_surface.commit`.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct AnchorCachedState {
    pub anchor: Option<String>,
}

impl Cacheable for AnchorCachedState {
    fn commit(&mut self, _: &DisplayHandle) -> Self {
        self.clone()
    }

    fn merge_into(self, into: &mut Self, _: &DisplayHandle) {
        *into = self;
    }
}

/// Marks a surface whose toplevel has a live anchor object.
#[derive(Default)]
struct Anchored(AtomicBool);

/// The anchor `surface` last committed.
pub fn committed_anchor(surface: &WlSurface) -> Option<String> {
    with_states(surface, |states| {
        states
            .cached_state
            .get::<AnchorCachedState>()
            .current()
            .anchor
            .clone()
    })
}

/// Set the anchor `surface` commits next.
fn set_pending(surface: &WlSurface, anchor: Option<String>) {
    with_states(surface, |states| {
        states
            .cached_state
            .get::<AnchorCachedState>()
            .pending()
            .anchor = anchor;
    });
}

impl GlobalDispatch<manager::DomicileAnchorManagerV1, ()> for DomicileCompositor {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<manager::DomicileAnchorManagerV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<manager::DomicileAnchorManagerV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        resource: &manager::DomicileAnchorManagerV1,
        request: manager::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            manager::Request::GetToplevelAnchor { id, toplevel } => {
                let surface = state
                    .xdg_shell_state
                    .get_toplevel(&toplevel)
                    .expect("a live xdg_toplevel is a toplevel the shell knows")
                    .wl_surface()
                    .clone();
                let taken = with_states(&surface, |states| {
                    states
                        .data_map
                        .insert_if_missing_threadsafe(Anchored::default);
                    states
                        .data_map
                        .get::<Anchored>()
                        .expect("inserted above")
                        .0
                        .swap(true, Ordering::Relaxed)
                });
                if taken {
                    resource.post_error(
                        manager::Error::AlreadyAnchored,
                        "the toplevel already has an anchor object",
                    );
                    return;
                }
                data_init.init(id, surface);
            }
            manager::Request::Destroy => {}
        }
    }
}

impl Dispatch<anchor::DomicileToplevelAnchorV1, WlSurface> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &anchor::DomicileToplevelAnchorV1,
        request: anchor::Request,
        surface: &WlSurface,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
        match request {
            anchor::Request::SetAnchor { name } => set_pending(surface, name),
            anchor::Request::Destroy => {}
        }
    }

    /// The window has no anchor from its next commit, and may take a new
    /// anchor object.
    fn destroyed(
        _: &mut Self,
        _: ClientId,
        _: &anchor::DomicileToplevelAnchorV1,
        surface: &WlSurface,
    ) {
        if !surface.is_alive() {
            return;
        }
        set_pending(surface, None);
        with_states(surface, |states| {
            states
                .data_map
                .get::<Anchored>()
                .expect("an anchor object marked its surface")
                .0
                .store(false, Ordering::Relaxed);
        });
    }
}

impl DomicileCompositor {
    /// Tell the chromes the anchor a window's commit set, if it changed.
    pub fn tell_the_anchor(&mut self, app_id: &str, surface: &WlSurface) {
        let anchored = self
            .hub
            .host
            .lock()
            .unwrap()
            .app_anchored(app_id, committed_anchor(surface));
        if let Some(message) = anchored {
            self.hub.broadcast(message);
        }
    }
}
