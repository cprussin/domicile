//! Choosing the engine's Ozone platform from where the desktop was started.

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
    // `OZONE` lets a person force a platform without editing the program, such
    // as `headless` with no display, or `drm`.
    assert_eq!(
        platform(Some("headless"), Some("wayland-1"), Some(":0"), None).unwrap(),
        "headless"
    );
    assert_eq!(platform(Some("drm"), None, None, None).unwrap(), "drm");
}

#[test]
fn an_x11_session_is_refused_as_itself() {
    // Distinct from "no display server" because an X11 user's next step
    // differs: start a Wayland session.
    assert_eq!(
        platform(None, None, Some(":0"), None),
        Err(PlatformError::X11Session)
    );
}

#[test]
fn the_tty_refusal_names_the_blocker_that_is_actually_left() {
    // The refusal covers only a machine with no VT. These assertions keep it
    // from citing blockers that no longer apply: the pin, the build, an unlit
    // screen.
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
    // A badly unset `WAYLAND_DISPLAY=` is empty. Treating it as a session would
    // start an engine that cannot connect.
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
    // `DrmMaster::Add` takes master on each card as it arrives, so a tty with a
    // VT can be drawn on without setting `OZONE`.
    //
    // `XDG_VTNR` decides because pam_systemd sets it for a session that owns a
    // VT, and the engine asks that same logind session for `TakeControl` and
    // `TakeDevice`. Without `XDG_VTNR` those calls would fail.
    assert_eq!(platform(None, None, None, Some("2")).unwrap(), "drm");
}

#[test]
fn a_session_on_a_vt_is_still_that_session() {
    // Wayland and X11 sessions also set `XDG_VTNR`. Checking the VT first would
    // take the console from the session the desktop should run inside.
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
    // ssh, a container, a cron job: no display and no VT. A drm run would fail
    // later with a worse message.
    assert_eq!(
        platform(None, None, None, None),
        Err(PlatformError::NoDisplayServer)
    );
    assert_eq!(
        platform(None, None, None, Some("")),
        Err(PlatformError::NoDisplayServer)
    );
}
