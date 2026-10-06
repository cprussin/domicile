//! Tests that both `xdg_foreign` exporters hand a window a handle.
//!
//! A client passes the handle to a portal as `parent_window`. GTK3 exports
//! through v1; GTK4, Chromium and Electron through v2. Resolving a handle is
//! tested in `domicile-host`'s `tests/xdg_foreign.rs`.

mod running;

use crate::running::Compositor;

#[test]
fn a_window_exported_through_v2_gets_a_handle() {
    let compositor = Compositor::started_with("{}");
    let _chrome = compositor.chrome();
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace("zxdg_exported_v2", 1),
        "the compositor sent no zxdg_exported_v2 handle; the client traced:\n{}",
        client.trace()
    );
}

#[test]
fn a_window_exported_through_v1_gets_a_handle() {
    let compositor = Compositor::started_with("{}");
    let _chrome = compositor.chrome();
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace("zxdg_exported_v1", 1),
        "the compositor sent no zxdg_exported_v1 handle; the client traced:\n{}",
        client.trace()
    );
}
