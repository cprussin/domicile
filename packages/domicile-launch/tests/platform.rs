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
fn a_tty_is_refused_by_the_build_and_not_by_the_pin() {
    assert_eq!(
        platform(None, None, None),
        Err(PlatformError::NoDisplayServer)
    );
}

#[test]
fn the_tty_refusal_blames_the_engine_build_rather_than_the_pin() {
    // The reason a tty is refused moved, and an error that names a blocker
    // which has been removed sends the reader to argue with a settled
    // question. `ozone_platform_drm = true` configures and links at this pin
    // -- patch 0012 and the drm probe job establish that. What is missing is
    // that the release build names only wayland and headless, and that there
    // is no embedder behind the platform even when it is built.
    let said = PlatformError::NoDisplayServer.to_string();
    assert!(
        !said.contains("cannot be built at this Chromium pin"),
        "the refusal still blames the pin: {said}"
    );
    assert!(
        said.contains("is not in this engine build"),
        "the refusal does not name the build as the blocker: {said}"
    );
    assert!(
        said.contains("A-DESKTOP-ON-A-TTY.md"),
        "the refusal does not point at the doc that tracks the work: {said}"
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
