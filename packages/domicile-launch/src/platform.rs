//! Which ozone platform the engine takes, and why a machine cannot have one.
//!
//! WHERE IT WAS STARTED DECIDES WHAT IT IS, for the one case that works today.
//! The engine is built with `wayland` and `headless` and nothing else, so a
//! desktop is a window inside an existing Wayland session, and the two other
//! ways to start one are refused rather than attempted.
//!
//! `ozone_platform_drm` is what would make a tty the whole screen, and it
//! cannot be set at this Chromium pin: `ui/ozone/platform/drm/BUILD.gn` opens
//! with `assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")`, and
//! `//ui/ozone` depends on it the moment the argument is true, so `gn gen`
//! refuses before anything compiles. Handing `--ozone-platform=drm` to a
//! binary with no drm platform in it is a black screen and a Chromium fatal,
//! so this says the true thing instead.

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
        "there is no display server here, and a tty needs the drm ozone \
         platform, which cannot be built at this Chromium pin — see \
         docs/architecture/ENGINE-FORK.md. Start this from a Wayland session \
         for a window; OZONE=headless runs it with no display."
    )]
    NoDisplayServer,
}

/// What the engine's `--ozone-platform` should be.
///
/// `OZONE` wins outright, because `headless` is a real answer on a machine
/// with no display and no environment variable says so.
///
/// `WAYLAND_DISPLAY` is the question for the case that does work: it is what a
/// Wayland client uses to find its compositor, so unset means there is nothing
/// to be a window inside of. Empty is unset — `WAYLAND_DISPLAY=` is what a
/// shell leaves behind when something cleared it badly, and taking it for a
/// session starts an engine that cannot connect to anything.
pub fn platform(
    ozone: Option<&str>,
    wayland_display: Option<&str>,
    x11_display: Option<&str>,
) -> Result<String, PlatformError> {
    match (set(ozone), set(wayland_display), set(x11_display)) {
        (Some(named), _, _) => Ok(named.to_string()),
        (None, Some(_), _) => Ok("wayland".to_string()),
        (None, None, Some(_)) => Err(PlatformError::X11Session),
        (None, None, None) => Err(PlatformError::NoDisplayServer),
    }
}

/// A variable somebody actually set. Empty is not a value here, for the same
/// reason `[ -n "$VAR" ]` is what the shell asked.
fn set(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}
