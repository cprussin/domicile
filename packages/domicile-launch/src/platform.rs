//! Which ozone platform the engine takes, and why a machine cannot have one.
//!
//! WHERE IT WAS STARTED DECIDES WHAT IT IS, for the one case that works today.
//! The engine is built with `wayland` and `headless` and nothing else, so a
//! desktop is a window inside an existing Wayland session, and the two other
//! ways to start one are refused rather than attempted.
//!
//! `ozone_platform_drm` is what would make a tty the whole screen, and the
//! reason it is refused has moved. It used to be the pin: `gn gen` would not
//! accept the argument at all, because `ui/ozone/platform/drm/BUILD.gn` opened
//! with `assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")`. Patch
//! `0012` relaxed that assert and `engine-drm-probe.yml` measured the result --
//! the argument configures and `//ui/ozone` compiles and links at this pin.
//!
//! What refuses a tty now is two things further along. The engine that ships
//! does not carry the platform: `scripts/build.sh` and
//! `engine-release-build.sh` both set `ozone_auto_platforms = false` and name
//! only wayland and headless. And behind the platform there is no embedder --
//! `OzonePlatformDrm::CreateScreen` is `NOTREACHED()` and nothing in the tree
//! modesets without `//ui/display/manager`, which is ChromeOS-only.
//!
//! Handing `--ozone-platform=drm` to a binary with no drm platform in it is a
//! black screen and a Chromium fatal, so this says the true thing instead.
//! `docs/architecture/A-DESKTOP-ON-A-TTY.md` is where that work is tracked.

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
         platform, which is not in this engine build — the release names only \
         wayland and headless, and nothing behind the platform drives a screen \
         yet. See docs/architecture/A-DESKTOP-ON-A-TTY.md. Start this from a \
         Wayland session for a window; OZONE=headless runs it with no display."
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
