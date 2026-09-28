//! Who draws a window's frame: the shell, whatever the client asks for.
//!
//! A shell draws a title bar over every window, so a client drawing its own —
//! and a shadow around it — draws a second frame inside the first. The two
//! protocols a client asks through are answered "server side" whatever it
//! asked. A client that asks neither, or ignores the answer (GTK4 does), still
//! draws one; `window_geometry.rs` is what keeps that from costing the pointer.
//!
//! The test client asks for client-side decorations on both, which is the
//! request whose answer is in question.

mod running;

use crate::running::Compositor;

/// `zxdg_toplevel_decoration_v1`, which Chromium, Electron and Qt ask through.
#[test]
fn a_window_asking_to_draw_its_own_frame_is_told_the_shell_draws_it() {
    let compositor = Compositor::started_with("");
    let _chrome = compositor.chrome();
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace("configure(ServerSide)", 1),
        "the compositor did not tell the window the shell draws its frame; it \
         traced:\n{}",
        client.trace()
    );
}

/// `org_kde_kwin_server_decoration`, which is what GTK3 asks through.
#[test]
fn a_gtk3_window_asking_to_draw_its_own_frame_is_told_the_shell_draws_it() {
    let compositor = Compositor::started_with("");
    let _chrome = compositor.chrome();
    let mut client = compositor.client("app");

    assert!(
        client.wait_for_trace("mode(Server)", 1),
        "the compositor did not answer the KDE decoration request with server \
         side; it traced:\n{}",
        client.trace()
    );
}
