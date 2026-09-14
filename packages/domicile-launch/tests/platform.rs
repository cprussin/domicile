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
fn a_machine_with_no_session_is_refused_rather_than_given_an_unproven_tty() {
    // Deliberate, not pending. The drm platform is in this binary now, so
    // returning "drm" here would compile and run -- and would trade a clear
    // refusal for whatever the GPU process does on a path no screen has ever
    // lit. That is the trade this module exists to avoid. It becomes the right
    // default the day a screen lights.
    assert_eq!(
        platform(None, None, None),
        Err(PlatformError::NoDisplayServer)
    );
}

#[test]
fn the_tty_refusal_names_the_blocker_that_is_actually_left() {
    // The reason a tty is refused has moved twice, and an error that names a
    // blocker somebody already removed sends its reader to argue with a
    // settled question. It was the pin, until patch 0012. Then it was the
    // build and the missing embedder, until 0013/0015/0016 and
    // `ozone_platform_drm = true` in both gn gen blocks. What is left is that
    // no screen has been lit, which is a GPU-device question -- so the message
    // has to stop blaming the build and start pointing at the way to try.
    let said = PlatformError::NoDisplayServer.to_string();
    assert!(
        !said.contains("cannot be built at this Chromium pin"),
        "the refusal still blames the pin: {said}"
    );
    assert!(
        !said.contains("is not in this engine build"),
        "the refusal still blames the build, which now carries the platform: {said}"
    );
    assert!(
        said.contains("OZONE=drm"),
        "the refusal does not say how to try a tty: {said}"
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
