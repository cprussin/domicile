//! Which ozone platform the engine takes, and why a machine cannot have one.
//!
//! WHERE IT WAS STARTED DECIDES WHAT IT IS, for the one case that is proven
//! today: a desktop is a window inside an existing Wayland session.
//!
//! THE REASON A TTY IS REFUSED HAS MOVED TWICE, and what it is now is worth
//! stating precisely, because an error that names a blocker somebody already
//! removed sends its reader to argue with a settled question.
//!
//! It used to be the pin: `gn gen` would not accept `ozone_platform_drm` at
//! all, because `ui/ozone/platform/drm/BUILD.gn` opened with
//! `assert(is_chromeos)`. Patch `0012` relaxed that and the drm probe measured
//! it. Then it was the build and the missing embedder: the shipped engine
//! named only wayland and headless, `OzonePlatformDrm::CreateScreen` was
//! `NOTREACHED()`, and nothing modeset. Patches `0013`, `0015` and `0016`
//! answered the embedder, and the argument is in both `gn gen` blocks now.
//!
//! So the platform IS in this binary, and `OZONE=drm` hands it
//! `--ozone-platform=drm` outright. What has not happened is a lit screen:
//! past the embedder the GPU process has its own question, which is a device
//! one rather than a porting one -- scanout and rendering on separate cards,
//! with one function choosing both. `docs/architecture/A-DESKTOP-ON-A-TTY.md`
//! carries it.
//!
//! WHICH IS WHY A MACHINE WITH NO SESSION STILL GETS A REFUSAL RATHER THAN A
//! TTY. Auto-selecting `drm` here would turn a clear refusal into whatever the
//! GPU process does on an unproven path, and that trade -- a message for a
//! black screen -- is the one this file exists to avoid. It becomes the right
//! default the day a screen lights, and not before.

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
        "there is no display server here. This engine does carry the drm ozone \
         platform now, so a tty is something it can be told to try — \
         OZONE=drm — but nothing has yet got a lit screen out of it, so it is \
         not what a machine with no session gets by default. See \
         docs/architecture/A-DESKTOP-ON-A-TTY.md. Start this from a Wayland \
         session for a window; OZONE=headless runs it with no display."
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
