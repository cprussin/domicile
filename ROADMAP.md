# Domicile roadmap

Open work and known gaps. Each item links to the doc with the detail. Remove an
item when it ships.

- No supported end-user release yet.
- Wire protocol: `PROTOCOL_VERSION = 1`.
- Checks that need a physical machine: [HARDWARE-CHECKS.md](docs/HARDWARE-CHECKS.md).

## In this repository

1. **Revisit the docs for users.** Start with the README.
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

2. **Smithay from a fork.** `Cargo.toml` patches Smithay 0.7.0 with
   Smithay/smithay#2217, which sends keymaps as read-only fds. Drop the patch
   and `flake.nix`'s `outputHashes` once a Smithay release contains it.

3. **Cast to TVs.** Extend the desktop onto, or cast a window, monitor or
   region to, a Google Cast or Miracast receiver, from a `Cast` bar item.
   [CASTING-TO-TVS.md](docs/architecture/CASTING-TO-TVS.md). Moonlight
   (Sunshine or similar) for low-latency play comes after.

4. **Automatic brightness.** Set the backlight from the ambient light sensor,
   learning from manual changes (as wluma does).

5. **Night light.** Warm the colors after sunset. Needs gamma control per
   monitor: a DRM gamma ramp on a tty, `wlr-gamma-control` for clients.

6. **Screen recording.** Record a monitor, a region or a window to a video
   file from the shell, with a way to stop it.

## In the engine fork (the agent on `crux`)

1. **Strip what a desktop never runs.** Tab strip, New Tab page, settings,
   sign-in and sync. Keep PDFium. Measured: 19.6 MB of a 418 MB install,
   5.4 MB of it code
   ([ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#engine-size-by-subsystem)).
   Which to cut is the maintainer's decision.


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

- **Presentation is unmeasured.** Every measurement reads a
  `CopyOutputRequest`; nothing reads a lit CRTC. So overlay promotion
  (including that viz declines it under `backdrop-filter`), damage and
  presentation latency are unmeasured. Revisit if real hardware shows a
  performance problem. [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).
- **A monitor profile can require a mode but not set it.** Same for refresh
  rate. [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md).
- **Filter quality on lower-density displays is unmeasured.**
- **The desk rasters what no monitor shows.**
  [DISPLAY-TILINGS.md](docs/architecture/DISPLAY-TILINGS.md#cost).

### Browser windows

- **The shortcuts inhibitor (patch `0038`) is tested only on sway,** and
  only with a virtual keyboard. mutter may show an unseen permission dialog.
  [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
- **Some permission requests are refused,** such as storage access, an
  extension's `chrome.tabCapture`, and keyboard and pointer lock prompts.
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
- **Wayland capture lists no browser windows.** The toplevel list names
  Wayland windows only. [PORTALS.md](docs/PORTALS.md#wayland-capture).

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
