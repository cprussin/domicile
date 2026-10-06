//! `xdg_foreign` exports: a portal's `parent_window` names the window a client
//! exported.

use domicile_host::xdg_foreign::Exports;
use domicile_host::Host;

fn parent_window(handle: &str) -> String {
    format!("wayland:{handle}")
}

#[test]
fn an_exported_handle_names_its_window() {
    let mut exports = Exports::default();

    let handle = exports.export(Some("app-1".into()));

    assert_eq!(
        exports.parent_window_app(&parent_window(&handle)),
        Some("app-1".into())
    );
}

/// GTK exports a window once per dialog, so each export gets its own handle.
#[test]
fn each_export_gets_its_own_handle() {
    let mut exports = Exports::default();

    let first = exports.export(Some("app-1".into()));
    let second = exports.export(Some("app-1".into()));

    assert_ne!(first, second);
    assert_eq!(
        exports.parent_window_app(&parent_window(&second)),
        Some("app-1".into())
    );
}

/// The chrome's own toplevel is no `<app>`, but a client must still get a
/// handle rather than a protocol error.
#[test]
fn a_surface_that_is_no_window_gets_a_handle_that_names_nothing() {
    let mut exports = Exports::default();

    let handle = exports.export(None);

    assert!(!handle.is_empty());
    assert_eq!(exports.parent_window_app(&parent_window(&handle)), None);
}

#[test]
fn a_parent_window_that_names_no_export_has_no_window() {
    let mut exports = Exports::default();
    let handle = exports.export(Some("app-1".into()));

    for parent_window in [
        String::new(),
        "wayland:".into(),
        "wayland:unknown".into(),
        format!("x11:{handle}"),
        handle,
    ] {
        assert_eq!(
            exports.parent_window_app(&parent_window),
            None,
            "{parent_window:?}"
        );
    }
}

#[test]
fn an_unexported_handle_names_nothing_and_leaves_other_exports() {
    let mut exports = Exports::default();
    let gone = exports.export(Some("app-1".into()));
    let kept = exports.export(Some("app-1".into()));

    exports.unexport(&gone);

    assert_eq!(exports.parent_window_app(&parent_window(&gone)), None);
    assert_eq!(
        exports.parent_window_app(&parent_window(&kept)),
        Some("app-1".into())
    );
}

#[test]
fn a_closed_window_takes_its_exports_with_it() {
    let mut host = Host::new();
    let (closed, _) = host.app_appeared(None, None);
    let (open, _) = host.app_appeared(None, None);
    let first = host.exports_mut().export(Some(closed.clone()));
    let second = host.exports_mut().export(Some(closed.clone()));
    let other = host.exports_mut().export(Some(open.clone()));

    host.app_closed(&closed);

    assert_eq!(
        host.exports().parent_window_app(&parent_window(&first)),
        None
    );
    assert_eq!(
        host.exports().parent_window_app(&parent_window(&second)),
        None
    );
    assert_eq!(
        host.exports().parent_window_app(&parent_window(&other)),
        Some(open)
    );
}
