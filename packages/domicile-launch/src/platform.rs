//! Picks the engine's ozone platform from the environment.
//!
//! - `OZONE` overrides everything.
//! - `WAYLAND_DISPLAY` means a window inside a Wayland session.
//! - `XDG_VTNR` means a console session and the drm platform. It is set by
//!   pam_systemd for a session that owns a VT, which is the same session
//!   logind's `TakeControl` and `TakeDevice` need. `isatty` would be fooled by
//!   a redirected descriptor.
//!
//! The VT is checked last because Wayland and X11 sessions have one too.
//! Checking it first would take the console from the running session. See
//! `docs/architecture/A-DESKTOP-ON-A-TTY.md` for the TTY design.

/// A machine this engine cannot draw on, and what the person does about it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlatformError {
    #[error(
        "this is an X11 session, and this engine has no x11 platform — it is \
         built for wayland and headless. Start it from a Wayland session for a \
         window; OZONE=headless runs it with no display at all."
    )]
    X11Session,
    #[error(
        "there is no display server here and no VT either — no WAYLAND_DISPLAY, \
         no DISPLAY, no XDG_VTNR. A console login has XDG_VTNR and gets the drm \
         platform on its own; this looks like ssh, a container or a job with no \
         seat, and drm there fails further in with a worse message than this \
         one. OZONE=drm forces it anyway and \
         docs/architecture/A-DESKTOP-ON-A-TTY.md says what it needs; \
         OZONE=headless runs with no display at all."
    )]
    NoDisplayServer,
}

/// Returns the engine's `--ozone-platform` value.
///
/// An empty variable counts as unset. A stray `WAYLAND_DISPLAY=` would
/// otherwise start an engine with no compositor to connect to.
pub fn platform(
    ozone: Option<&str>,
    wayland_display: Option<&str>,
    x11_display: Option<&str>,
    vt: Option<&str>,
) -> Result<String, PlatformError> {
    match (set(ozone), set(wayland_display), set(x11_display), set(vt)) {
        (Some(named), _, _, _) => Ok(named.to_string()),
        (None, Some(_), _, _) => Ok("wayland".to_string()),
        (None, None, Some(_), _) => Err(PlatformError::X11Session),
        (None, None, None, Some(_)) => Ok("drm".to_string()),
        (None, None, None, None) => Err(PlatformError::NoDisplayServer),
    }
}

/// Returns the value only if it is non-empty.
fn set(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}
