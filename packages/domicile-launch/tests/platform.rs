//! Where a desktop was started decides what the engine is.

use domicile_launch::platform::{platform, PlatformError};

#[test]
fn a_wayland_session_is_a_window_inside_it() {
    assert_eq!(
        platform(None, Some("wayland-1"), None, None).unwrap(),
        "wayland"
    );
}

#[test]
fn ozone_overrides_everything() {
    // A machine with no display and no environment variable that says so is a
    // real answer, and somebody trying the tty once drm is patched in should
    // not have to edit the program to do it.
    assert_eq!(
        platform(Some("headless"), Some("wayland-1"), Some(":0"), None).unwrap(),
        "headless"
    );
    assert_eq!(platform(Some("drm"), None, None, None).unwrap(), "drm");
}

#[test]
fn an_x11_session_is_refused_as_itself() {
    // Rather than as "no display server": the difference is what the person
    // does next, and an X11 user has a Wayland session to start from.
    assert_eq!(
        platform(None, None, Some(":0"), None),
        Err(PlatformError::X11Session)
    );
}

#[test]
fn the_tty_refusal_names_the_blocker_that_is_actually_left() {
    // The reason a tty is refused has moved twice, and an error that names a
    // blocker somebody already removed sends its reader to argue with a
    // settled question. It was the pin, until patch 0012. Then it was the
    // build and the missing embedder, until 0013/0015/0016 and
    // `ozone_platform_drm = true` in both gn gen blocks. Then it was that no
    // screen had been lit, until `DrmMaster::Add` took master as a card
    // arrives. What is left is the case this error is now FOR: a machine with
    // no VT at all, where there is nothing to light.
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
        !said.contains("nothing has yet got a lit screen"),
        "the refusal still says no screen has lit, which stopped being true: {said}"
    );
    assert!(
        said.contains("XDG_VTNR"),
        "the refusal does not name the variable whose absence it is about: {said}"
    );
    assert!(
        said.contains("OZONE=drm"),
        "the refusal does not say how to force it anyway: {said}"
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
        platform(None, Some(""), None, None),
        Err(PlatformError::NoDisplayServer)
    );
    assert_eq!(
        platform(Some(""), Some("wayland-1"), None, None).unwrap(),
        "wayland"
    );
}

#[test]
fn a_tty_with_a_vt_is_a_desktop_on_that_vt() {
    // The refusal below used to cover this case too, and the reason it gave --
    // that no screen had ever been lit on drm -- stopped being true. What
    // lights it is `DrmMaster::Add` taking master on a card as it arrives; the
    // four fixes behind that are `engine-9dd6e30`. So a tty is now a machine
    // this can draw on, and a person on one should not have to know an
    // environment variable to find that out.
    //
    // `XDG_VTNR` is the question because logind is the thing that answers it:
    // pam_systemd sets it for a session that owns a VT, and that is the same
    // logind the engine then asks for `TakeControl` and `TakeDevice`. A
    // session with no `XDG_VTNR` is one those calls would fail on anyway.
    assert_eq!(platform(None, None, None, Some("2")).unwrap(), "drm");
}

#[test]
fn a_session_on_a_vt_is_still_that_session() {
    // A Wayland or X11 session HAS a VT -- `XDG_VTNR` is set for it too -- so
    // reading the VT first would take the console out from under the very
    // session the desktop was supposed to be a window inside of.
    assert_eq!(
        platform(None, Some("wayland-1"), None, Some("2")).unwrap(),
        "wayland"
    );
    assert_eq!(
        platform(None, None, Some(":0"), Some("2")),
        Err(PlatformError::X11Session)
    );
}

#[test]
fn nothing_anywhere_is_still_a_refusal() {
    // ssh, a container, a cron job: no display and no VT either. There is
    // nothing to light, and a drm run there would fail further in with a worse
    // message than this one.
    assert_eq!(
        platform(None, None, None, None),
        Err(PlatformError::NoDisplayServer)
    );
    assert_eq!(
        platform(None, None, None, Some("")),
        Err(PlatformError::NoDisplayServer)
    );
}
