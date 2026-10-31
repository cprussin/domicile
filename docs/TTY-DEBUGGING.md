# GPU and display issues

What to do when the desktop doesn't start, stays black or draws wrong.

## Get your old desktop back

- **In a window on another desktop:** close the window, or press Ctrl+C in
  the terminal that started it.
- **At login:** log out, or switch to a console (Ctrl+Alt+F2) and log in. At
  the login screen, pick the session you used before.
- **If the login screen keeps coming back:** switch to a console, log in and
  set `"shell"` in `~/.config/domicile/domicile.json` to
  `@domicile-desktop/manganese`, to rule out your own shell.

## Find where it fails

1. **Run it in a window** on the desktop you already use:
   `domicile @domicile-desktop/manganese`. If that fails too, the cause is the
   config or the engine, not your monitors. It prints which config it used and
   why it stops. Then try your own shell the same way.
2. **Check the config:**
   `domicile check-config ~/.config/domicile/domicile.json`.
3. **Run it from a console** (Ctrl+Alt+F2): `domicile`. This is how the login
   session runs it, with the shell your config names, and it prints its errors
   to that console.

## Report it

[Open an issue](https://github.com/cprussin/domicile/issues) with:

- What you did and what you saw, and whether it was in a window or at login.
- Your distribution (`cat /etc/os-release`), kernel (`uname -r`) and
  Domicile's package version (`dpkg -s domicile`, `rpm -q domicile` or
  `pacman -Q domicile`).
- Your graphics card and driver: `lspci -k | grep -A3 -E 'VGA|3D'`.
- The output of `domicile` from step 3 above.

## Workarounds

- **Ubuntu 24.04+:** the engine needs the package's AppArmor profile.
  Reinstall the package if it's missing.
- **GPU flags** can turn GPU features on for your driver. None is safe on
  every driver, so each is opt-in: see
  [GPU flags](RUNNING-A-DESKTOP.md#gpu-flags) for each one's tradeoff.

## For developers

The rest of this page is for debugging the engine on a tty. Overview:
[A-DESKTOP-ON-A-TTY.md](architecture/A-DESKTOP-ON-A-TTY.md).

### Seeing a modeset

`DRM configuring:` and `Modeset succeeded.` are `VLOG(1)` in
`ui/ozone/platform/drm/gpu/screen_manager.cc`. `--vmodule=drm*=1` does not
match that file. Name it:

    --vmodule=screen_manager=1,drm*=1,gbm*=1,ozone*=1

- Without this flag, missing modeset lines prove nothing.
- `domicile: the displays read the same as last time` appears only after the
  GPU process confirmed a modeset, so it proves one landed.
- `Modeset commit failed after a successful test-modeset.` is misleading: it
  prints on any commit failure, and `DrmModeset` never runs a test-modeset.

### A black screen with a clean log

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

### A primary plane display cannot read

    Not scanning out a <format> buffer (<size>, modifier <n>) allocated or imported without GBM_BO_USE_SCANOUT

- The buffer has no framebuffer, so patch `0112` queues no plane for it. For
  the primary plane, the screen keeps its last frame. A warning, logged once
  per process for each format, size and modifier.
- The usual cause: the scanout allocation for the window's buffers failed, and
  `OzoneImageBackingFactory` retried it, without a log, as a buffer for
  sampling only.
- Find out why the scanout allocation failed with
  `--vmodule=gbm_wrapper=1,drm_framebuffer=4`. `drm_framebuffer` logs a failed
  `AddFramebuffer2` only at level 4.
- On virtio-gpu, the kernel takes only XR24 and AR24 framebuffers.
  `drm_screen.cc` draws in BGRA_8888 when no plane takes XB24, so a
  `DRM_FORMAT_ABGR8888` buffer here means that check did not apply
  ([A tty desktop in a virtio-gpu VM](HARDWARE-CHECKS.md#a-tty-desktop-in-a-virtio-gpu-vm)).

### Scanout and render cards can differ

A GPU process that falls back to software on its own, often after restarts on
`GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT`, draws a desktop whose windows are
blank: the compositor still sends dmabufs. `DOMICILE_SOFTWARE_COMPOSITING=yes`
composites on the CPU from the start
([Software output](architecture/A-DESKTOP-ON-A-TTY.md#software-output)).

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
modesets, but the GPU process cannot render to the scanout card.
`DOMICILE_SOFTWARE_COMPOSITING=yes` draws on vkms on the CPU instead.
