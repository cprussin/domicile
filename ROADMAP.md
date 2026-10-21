# Domicile roadmap

Open work and known gaps. Each item links to the doc with the detail. Remove an
item when it ships.

- No supported end-user release yet.
- Wire protocol: `PROTOCOL_VERSION = 1`.
- Checks that need a physical machine: [HARDWARE-CHECKS.md](docs/HARDWARE-CHECKS.md).

## In this repository

1. **Keystroke-to-pixel latency on a panel** (#206). Run `guard-latency.sh`
   with `PLATFORM=drm` on a machine with a panel
   ([Latency on a panel](docs/HARDWARE-CHECKS.md#latency-on-a-panel)). The
   probe still won't measure presentation.
   [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#keystroke-to-pixel).

2. **Notifications.** [NOTIFICATIONS.md](docs/architecture/NOTIFICATIONS.md).
   - Chrome's notification bridge looks for the server once at startup, so a
     slow bus leaves it showing its own popups.

3. **Revisit the docs for users.** Start with the README.
   - A clearer reading path through the docs.
   - Screenshots and videos of manganese.
   - A short getting started guide: installing and setup.
   - A short tour of the features:
     - Window management.
     - The built-in browser.
     - Chrome extensions.
     - The launcher.
     - Web apps ([WEB-APPS.md](docs/architecture/WEB-APPS.md)).
     - Top bar, system tray, notifications, clipboard history, wallpaper,
       screen lock, several monitors, and the Settings and History apps.
   - A short guide to customizing:
     - Configuring manganese.
     - Composing manganese's packages into a custom desktop.
     - Writing a desktop from scratch
       ([WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md)).

4. **Smithay from a fork.** `Cargo.toml` patches Smithay 0.7.0 with
   Smithay/smithay#2217, which sends keymaps as read-only fds. Drop the patch
   and `flake.nix`'s `outputHashes` once a Smithay release contains it.

## In the engine fork (the agent on `crux`)

1. **Measure presentation.** Nothing reads a lit CRTC, so overlay promotion,
   damage and presentation latency are unmeasured.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).

3. **Overlay promotion under `backdrop-filter`.** Show that viz declines it
   for an `<app>`. Needs a lit CRTC, like item 1.
   [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).

4. **Strip what a desktop never runs.** Tab strip, New Tab page, settings,
   sign-in and sync. Keep PDFium. Measured: 19.6 MB of a 418 MB install,
   5.4 MB of it code
   ([ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#engine-size-by-subsystem)).
   Which to cut is the maintainer's decision.

5. **Shortcuts inhibitor (patch `0038`) beyond sway.**
   [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
   - Untested on other hosts. mutter may show an unseen permission dialog.
   - Untested with a physical keyboard.

6. **Software rendering on DRM.** A CPU output path for GPUs and VMs without
   3D: 2D virtio-gpu, Hyper-V, simpledrm. DRM needs a 3D-capable GPU today
   ([Scanout and render cards can differ](docs/TTY-DEBUGGING.md#scanout-and-render-cards-can-differ),
   [A tty desktop in a virtio-gpu VM](docs/HARDWARE-CHECKS.md#a-tty-desktop-in-a-virtio-gpu-vm)).
   - It would let CI run tty end-to-end tests on vkms.

7. **`<webview>` profiles and navigation.**
   [SHELL-BROWSER-WINDOWS.md](docs/SHELL-BROWSER-WINDOWS.md).
   - Persistent isolated profiles, for example `partition="persist:x"`.
     Guests share the default partition, and patch `0115` relies on that
     ([New windows](docs/architecture/ENGINE-BROWSER-BEHAVIOR.md#new-windows)).
   - A cancelable navigation event, like Electron's `will-navigate`.

## Known gaps

Understood and not scheduled.

### Windows and clients

- **Clients only get 8-bit formats** (`FOURCCS` in `engine.rs`).
- **A chrome repaint damages the whole output.**
- **Windows under a fullscreen window keep drawing,** so manganese can animate
  the fullscreen window back to its box.
- **Browser window context menus have only Chrome's core items.** No spelling
  suggestions, page or extension items.
- **Client-drawn cursor surfaces show a plain arrow.**
- **Unknown: whether viz hit testing must agree with Domicile's.**
  [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#open-questions).

### Displays

- **A monitor profile can require a mode but not set it.** Same for refresh
  rate. [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md).
- **Engine popups are kept inside the desk, not their monitor.** A `<select>`
  near a monitor's edge can open across the seam.
- **Filter quality on lower-density displays is unmeasured.**
- **The desk rasters what no monitor shows.**
  [DISPLAY-TILINGS.md](docs/architecture/DISPLAY-TILINGS.md#cost).
- **No guard runs two CRTCs.**
  [Several monitors](docs/HARDWARE-CHECKS.md#several-monitors).

### Browser windows

- **Some permission requests are refused,** including a tab's capture.
- **A page's screen capture has no audio,** and reports every source as a
  monitor.
- **Some file dialogs are refused:** from the shell's own page, and a
  directory dropped on a page.
- **No `chrome://` pages,** so no Print Preview: printing goes straight to
  the desktop's print dialog.
- **Some extension calls are refused.**
  [EXTENSIONS.md](docs/architecture/EXTENSIONS.md).
- **A browser window attached while hidden is visible for a moment,** so the
  page sees `visibilitychange` twice (`WebViewGuest::AttachWindowTo`).
- **Resize cost is unmeasured.**
  [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#embed-deadlines).

### Clipboard

- **A nested desktop's browser uses the host's clipboard.**

### Session and portals

- **The session portal setup is only checked at evaluation.** Nothing here
  runs a user manager, an unclean exit leaves stale environment variables,
  and a nested desktop doesn't register.
- **Wayland capture is monitors only, into shm, one shot per frame.** No
  toplevel sources, cursor sessions or dmabufs; `wf-recorder` is slow.
  [PORTALS.md](docs/PORTALS.md).

### Shell reload

- **Hot-swapping the shell reloads the page,** so a shell loses state kept in
  its page.

### Engine CI

- **Engine CI is one machine.** `crux` runs one cold build at a time, and a
  build from scratch takes 4h 16m.
  [BUILD-MACHINE.md](packages/domicile-engine/docs/BUILD-MACHINE.md#build-cost).
- **A guard's engine once crashed in fontconfig.** A use-after-free in the
  browser process's font service (`FontDataServiceImpl::MatchFamilyName` →
  `FcConfigSubstituteWithPat` → `FcStrHashIgnoreCase`), seen once in
  `guard-webview-tabs`. Not the shared font cache. Rerun it; an ASan engine
  build would find what freed the string.
