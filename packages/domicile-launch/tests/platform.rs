//! Where a desktop was started decides what the engine is.

use domicile_launch::platform::{platform, PlatformError};

#[test]
fn a_wayland_session_is_a_window_inside_it() {
    assert_eq!(platform(None, Some("wayland-1"), None).unwrap(), "wayland");
}

#[test]
fn ozone_overrides_everything() {
    // A machine with no display and no environment variable that says so is a
    // real answer, and somebody trying the tty once drm is patched in should
    // not have to edit the program to do it.
    assert_eq!(
        platform(Some("headless"), Some("wayland-1"), Some(":0")).unwrap(),
        "headless"
    );
    assert_eq!(platform(Some("drm"), None, None).unwrap(), "drm");
}

#[test]
fn an_x11_session_is_refused_as_itself() {
    // Rather than as "no display server": the difference is what the person
    // does next, and an X11 user has a Wayland session to start from.
    assert_eq!(
        platform(None, None, Some(":0")),
        Err(PlatformError::X11Session)
    );
}

#[test]
fn a_tty_is_refused_because_drm_cannot_be_built_yet() {
    assert_eq!(
        platform(None, None, None),
        Err(PlatformError::NoDisplayServer)
    );
}

#[test]
fn an_empty_variable_is_not_a_display() {
    // `WAYLAND_DISPLAY=` is what a shell leaves behind when something unset it
    // badly, and taking it for a session starts an engine that cannot connect.
    assert_eq!(
        platform(None, Some(""), None),
        Err(PlatformError::NoDisplayServer)
    );
    assert_eq!(
        platform(Some(""), Some("wayland-1"), None).unwrap(),
        "wayland"
    );
}
