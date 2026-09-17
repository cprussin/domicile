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
//! AND THEN A SCREEN LIT, SO A TTY IS NO LONGER REFUSED. This file used to say
//! `drm` became the right default the day that happened and not before; that
//! day is `engine-9dd6e30`. What had been missing was DRM master: nothing in
//! the fork ever asked the kernel for it, so the first modeset got `EACCES`
//! and the first `drmSetMaster` a desktop ever ran was the one a console
//! switch asked for. `DrmMaster::Add` takes it as a card arrives now.
//!
//! WHAT IS ASKED IS `XDG_VTNR`, BECAUSE LOGIND IS WHAT ANSWERS IT. pam_systemd
//! sets it for a session that owns a VT, and that is the same logind the
//! engine then asks for `TakeControl` and `TakeDevice`. A session without one
//! is a session those calls would fail on, so the variable that says "there is
//! a VT here" is also the variable that says "the calls that need one will
//! work" -- which is why this is not `isatty` on a descriptor somebody may
//! have redirected.
//!
//! IT IS READ LAST OF THE THREE, and that ordering is the whole of the care
//! here: a Wayland session has a VT too, and an X11 one does. Reading the VT
//! first would take the console out from under the very session the desktop
//! was supposed to be a window inside of.

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

/// What the engine's `--ozone-platform` should be.
///
/// `OZONE` wins outright, because `headless` is a real answer on a machine
/// with no display and no environment variable says so.
///
/// `WAYLAND_DISPLAY` is the question for a window: it is what a Wayland client
/// uses to find its compositor, so unset means there is nothing to be a window
/// inside of. `XDG_VTNR` is the question for a console, and it is asked last,
/// because a session has a VT as well as a display and the session is what the
/// person is looking at.
///
/// Empty is unset throughout — `WAYLAND_DISPLAY=` is what a shell leaves
/// behind when something cleared it badly, and taking it for a session starts
/// an engine that cannot connect to anything.
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

/// A variable somebody actually set. Empty is not a value here, for the same
/// reason `[ -n "$VAR" ]` is what the shell asked.
fn set(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}
