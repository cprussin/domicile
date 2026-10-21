//! `domicile_anchor_v1`, generated from the compositor's
//! `protocols/domicile-anchor-v1.xml`.

#![allow(missing_docs, clippy::all)]

use wayland_client;
use wayland_protocols::xdg::shell::client::*;

pub mod __interfaces {
    use wayland_client::backend as wayland_backend;
    use wayland_protocols::xdg::shell::client::__interfaces::*;
    wayland_scanner::generate_interfaces!(
        "../domicile-compositor/protocols/domicile-anchor-v1.xml"
    );
}
use self::__interfaces::*;

wayland_scanner::generate_client_code!("../domicile-compositor/protocols/domicile-anchor-v1.xml");
