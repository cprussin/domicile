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

2. **A compositor crash loses every window.**
   - The page's control channel only retries at startup (`kReachFor`).
     Reconnecting to a new compositor needs a change in `control_channel.cc`.
     Embeds are ready: each `<app>` embeds again when the old compositor
     disconnects
     ([ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#a-compositor-restart)).
     No guard covers that re-embed.
   - No `disconnected` callback in `domicile_engine.h`. The compositor spots a
     new engine by `SO_PEERCRED` (`which_engine.rs`).

   [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md).

3. **Notifications.** [NOTIFICATIONS.md](docs/architecture/NOTIFICATIONS.md).
   - Chrome's notification bridge looks for the server once at startup, so a
     slow bus leaves it showing its own popups.

4. **Settings app.** [SETTINGS.md](docs/SETTINGS.md).
   - A list of sites with stored data. History clears cookies by time range
     or by site ([HISTORY.md](docs/HISTORY.md)).

5. **Distribution packages.**
   [RUNNING-A-DESKTOP.md](docs/RUNNING-A-DESKTOP.md#other-distributions).
   - Released on GitHub only. APT and RPM repositories, package signing, an
     AUR package and COPR wait until users ask for them; until then upgrades
     are by hand.
   - Checked by installing in containers; no packaged session has run on
     hardware.

6. **Revisit the docs for users.** Start with the README.
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

## In the engine fork (the agent on `crux`)

1. **Measure presentation.** Nothing reads a lit CRTC, so overlay promotion,
   damage and presentation latency are unmeasured.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).

2. **Two tty tasks.** [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md#plan).
   - Take `/dev/dri/card0` from logind (`TakeDevice`, `PauseDevice`,
     `ResumeDevice`) instead of `open()`.
   - Stop the evdev thread blocking during a console switch.

3. **Overlay promotion under `backdrop-filter`.** Show that viz declines it
   for an `<app>`. Needs a lit CRTC, like item 1.
   [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).

4. **Strip what a desktop never runs.** Tab strip, New Tab page, settings,
   sign-in and sync. Keep PDFium. Measured: 19.6 MB of a 737 MB install,
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

8. **Frame-synchronized `<app>` state.** The child allocates the
   `LocalSurfaceId`, so a client's frame and the page's layout change in the
   same frame
   ([What each side knows](docs/architecture/WINDOW-COMPOSITING.md#what-each-side-knows)).
   - Phase 1: Domicile's own subsurfaces and popups, so `wl_subsurface` sync
     holds. Bubbles sync
     ([Synced frames](docs/architecture/WINDOW-COMPOSITING.md#synced-frames));
     xdg popups do not.
   - Phase 2: a protocol for clients to anchor to page layout.

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
- **Engine popups are kept inside their window, not their CRTC.**
- **Filter quality on lower-density displays is unmeasured.**
- **The desk rasters what no monitor shows.**
  [DISPLAY-TILINGS.md](docs/architecture/DISPLAY-TILINGS.md#cost).
- **No guard runs two CRTCs.**
  [Several monitors](docs/HARDWARE-CHECKS.md#several-monitors).

### Browser windows

- **Some permission requests are refused,** including `getDisplayMedia`.
- **Some file dialogs are refused:** from the shell's own page, and a
  directory dropped on a page.
- **No `chrome://` pages,** so no printing.
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
