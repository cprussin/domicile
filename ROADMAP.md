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
   - Engine-restart recovery is untested against a real engine and GPU
     ([Dead engine with windows open](docs/HARDWARE-CHECKS.md#dead-engine-with-windows-open)).

   [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md).

3. **Notifications.** [NOTIFICATIONS.md](docs/architecture/NOTIFICATIONS.md).
   - Chrome's notification bridge looks for the server once at startup, so a
     slow bus leaves it showing its own popups.

4. **Native density on every monitor: test on hardware.**
   [ONE-PAGE-FOR-THE-DESK.md](docs/architecture/ONE-PAGE-FOR-THE-DESK.md).

5. **Split manganese into small packages.** Clock, tray, mixer and window
   management as their own packages; manganese composes them. No design doc.

6. **Settings app.** [SETTINGS.md](docs/SETTINGS.md).
   - Shell options ([SHELL-OPTIONS.md](docs/architecture/SHELL-OPTIONS.md)).
   - A persistent theme choice, which needs a store for desktop state.
   - A list of sites with stored data. History clears cookies by time range
     or by site ([HISTORY.md](docs/HISTORY.md)).

7. **Web apps.** [WEB-APPS.md](docs/architecture/WEB-APPS.md).
   - A guard that the engine lists an app window with `isApp` and records no
     visits for it.

8. **Distribution packages.**
   [RUNNING-A-DESKTOP.md](docs/RUNNING-A-DESKTOP.md#other-distributions).
   - No APT or RPM repository, AUR package or COPR, so upgrades are by hand.
   - The shell builder ships the whole workspace's `node_modules`, about
     600 MB with the dev tools.
   - Checked by installing in containers; no packaged session has run on
     hardware.

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
   sign-in and sync. Measure each subsystem's size first. Keep PDFium.

5. **Shortcuts inhibitor (patch `0038`) beyond sway.**
   [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
   - Untested on other hosts. mutter may show an unseen permission dialog.
   - Untested with a physical keyboard.

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
- **A monitor with no make, model or serial is named `drm-<id>`.**
- **Engine popups are kept inside their window, not their CRTC.**
- **Filter quality on lower-density displays is unmeasured.**
- **The desk rasters what no monitor shows.**
  [DISPLAY-TILINGS.md](docs/architecture/DISPLAY-TILINGS.md#cost).
- **No guard runs two CRTCs.**
  [Several monitors](docs/HARDWARE-CHECKS.md#several-monitors).

### Browser windows

- **`beforeunload` asks nothing.** The page leaves.
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
- **The padlock's `dangerous` state is untested against the engine.** Needs
  an https fixture with an untrusted cert.

### Clipboard

- **A nested desktop's browser uses the host's clipboard.**
- **Clipboard history skips the primary selection.**

### Theme

- **A theme picked from the toggle lasts only until restart.** Needs the
  desktop-state store (the Settings app item).

### Session and portals

- **The session portal setup is only checked at evaluation.** Nothing here
  runs a user manager, an unclean exit leaves stale environment variables,
  and a nested desktop doesn't register.
- **The settings portal has no cursor or font keys** in
  `org.gnome.desktop.interface` (`cursor-theme`, `cursor-size`, `font-name`,
  `monospace-font-name`). The config has nothing to serve them from.
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
