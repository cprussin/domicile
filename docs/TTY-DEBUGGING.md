# Debugging a tty desktop

Overview: [A-DESKTOP-ON-A-TTY.md](architecture/A-DESKTOP-ON-A-TTY.md).

## Seeing a modeset

`DRM configuring:` and `Modeset succeeded.` are `VLOG(1)` in
`ui/ozone/platform/drm/gpu/screen_manager.cc`. `--vmodule=drm*=1` does not
match that file. Name it:

    --vmodule=screen_manager=1,drm*=1,gbm*=1,ozone*=1

- Without this flag, missing modeset lines prove nothing.
- `domicile: the displays read the same as last time` appears only after the
  GPU process confirmed a modeset, so it proves one landed.
- `Modeset commit failed after a successful test-modeset.` is misleading: it
  prints on any commit failure, and `DrmModeset` never runs a test-modeset.

## A black screen with a clean log

Usual causes:

- **The window does not match the CRTC exactly.** Page flips are dropped. See
  [The window has to be the size of the CRTC](architecture/A-DESKTOP-ON-A-TTY.md#the-window-has-to-be-the-size-of-the-crtc).
- **No DRM master.** Commits fail with `EACCES`. See
  [TTY-SESSION.md](TTY-SESSION.md#drm-master).
- **A piece ash supplies on ChromeOS is missing.** ozone/drm compiles and runs
  but does nothing. Each of these is a silent no-op without the embedder:
  - a `DisplayConfigurator::TakeControl` call at startup;
  - a `drmSetMaster` on each card;
  - `DrmWindowHost::Close()`, empty upstream;
  - `DrmWindowHost::Activate()`, a `NOTIMPLEMENTED_LOG_ONCE()` upstream;
  - a cursor with a bitmap (`BitmapCursorFactory` gives none);
  - a touchpad branch in `CreateConverter`.

## Scanout and render cards can differ

ozone/drm does not support software compositing. A GPU process that falls back
to software dies with `Software rendering mode is not supported with GBM
platform`, often after restarts on `GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT`.

A common cause is the two card choices landing on different cards:

| Choice | Code | Default |
|---|---|---|
| scanout card | `GetPrimaryDisplayCardPath()` in `drm_display_host_manager.cc` | `cards[0]` |
| render device | `gbm_surface_factory.cc`, via `EGL_PLATFORM_DEVICE_EXT` | `GetPreferredEGLDevice()`'s `devices[0]`, skipping devices with no `EGL_DRM_DEVICE_FILE_EXT` |

On ChromeOS these are always the same card. ozone/drm cannot render on one
card and scan out on another (cross-device PRIME).

Example: `crux`, the build host, has `card0` = vkms (connected, no render
node) and `card1` = an nvidia GPU (no connected outputs, the only render node).
Scanout picks vkms and rendering picks nvidia. On `crux`, the engine starts and
modesets, but the GPU process cannot render to the scanout card. Test a visible
desktop on a single-GPU machine.
