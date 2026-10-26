# Domicile roadmap

Open work and known gaps. Each item links to the doc with the detail. Remove an
item when it ships.

- No supported end-user release yet.
- Wire protocol: `PROTOCOL_VERSION = 1`.
- Checks that need a physical machine: [HARDWARE-CHECKS.md](docs/HARDWARE-CHECKS.md).

## In this repository

1. **Revisit the docs for users.** The site's docs pages
   (`packages/site/src/docs/`) render today's markdown with a sidebar, and the
   landing pages carry captures (`docs/media/`). Left:
   - Rewrite the pages for users. Most still mix in how it works inside.
   - A short getting started guide: installing and setup.
   - Captures for the rest of the tour: web apps, extensions, the bar,
     notifications, several monitors, Settings, and configuring.
   - A short guide to customizing:
     - Composing manganese's packages into a custom desktop.
     - Writing a desktop from scratch
       ([WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md)).
     - Writing an app. The Domicile page links the example and
       [APP-MODULES.md](docs/architecture/APP-MODULES.md), which is the design.

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
