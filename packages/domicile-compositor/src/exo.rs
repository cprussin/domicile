//! The protocols Chromium asks for that nothing packages.
//!
//! Chromium will send its layer tree as one `wl_subsurface` per quad — which
//! is the whole of what the chrome being a single flattened raster costs us —
//! but only to a compositor that advertises what it asks for. It says what is
//! missing in its own log and then falls back to the flat path without
//! erroring, so a compositor that does not answer never finds out:
//!
//! ```text
//! Server doesn't support zcr_alpha_compositing_v1.
//! Server doesn't support overlay_prioritizer.
//! ```
//!
//! Both are **hints**. Neither sends a single event back to the client, and a
//! compositor is free to take the hint or leave it — which is why answering
//! them is this small. What they buy is not their own behaviour; it is
//! Chromium agreeing to delegate at all.
//!
//! The bindings are generated from the XML in `protocols/`, vendored because
//! there is nowhere to depend on it from. See that directory's README, and
//! `docs/architecture/WINDOW-COMPOSITING.md` for what this is on the way to.

// The generated code refers to `super::wayland_server`, so it has to be here
// under that name — Smithay's re-export is the one already linked.
pub mod overlay_prioritizer {
    // The generated code reaches for `super::wayland_server`: the scanner
    // emits a module of its own, so this has to be beside it rather than
    // beside this one.
    pub use smithay::reexports::wayland_server;
    // The generated code names `super::wl_surface` for the object it extends.
    pub use smithay::reexports::wayland_server::protocol::wl_surface;

    pub mod __interfaces {
        // Both protocols extend `wl_surface`, so core's interfaces have to be
        // in scope for the generated ones to name it.
        use super::wayland_server::protocol::__interfaces::*;

        wayland_scanner::generate_interfaces!("protocols/overlay-prioritizer.xml");
    }
    use self::__interfaces::*;
    wayland_scanner::generate_server_code!("protocols/overlay-prioritizer.xml");
}

pub mod alpha_compositing {
    pub use smithay::reexports::wayland_server;
    // The generated code names `super::wl_surface` for the object it extends.
    pub use smithay::reexports::wayland_server::protocol::wl_surface;

    pub mod __interfaces {
        use super::wayland_server::protocol::__interfaces::*;

        wayland_scanner::generate_interfaces!("protocols/alpha-compositing-unstable-v1.xml");
    }
    use self::__interfaces::*;
    wayland_scanner::generate_server_code!("protocols/alpha-compositing-unstable-v1.xml");
}

pub mod surface_augmenter {
    pub use smithay::reexports::wayland_server;
    // This one extends `wl_subsurface` as well as `wl_surface`, and names
    // `wl_buffer` for the solid-colour buffers it can make.
    pub use smithay::reexports::wayland_server::protocol::{wl_buffer, wl_subsurface, wl_surface};

    pub mod __interfaces {
        use super::wayland_server::protocol::__interfaces::*;

        wayland_scanner::generate_interfaces!("protocols/surface-augmenter.xml");
    }
    use self::__interfaces::*;
    wayland_scanner::generate_server_code!("protocols/surface-augmenter.xml");
}
