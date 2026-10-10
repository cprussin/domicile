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
   - No `disconnected` callback in `domicile_engine.h`. The compositor spots a
     new engine by `SO_PEERCRED` (`which_engine.rs`).
   - Engine-restart recovery is untested against a real engine and GPU
     ([Dead engine with windows open](docs/HARDWARE-CHECKS.md#dead-engine-with-windows-open)).

   [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md).

3. **Lock.** [LOCK.md](docs/LOCK.md),
   [SHELL-IDLE-AND-LOCK.md](docs/SHELL-IDLE-AND-LOCK.md#locking).
   - A wrong passphrase only re-sends `locked: true`. A shell can't tell it
     from a verifier error, or count or rate-limit attempts.
   - A config reload doesn't change `lock`. It applies on the next run.
   - No warning before blanking. `HostMessage::Idle` arrives when the screens
     go dark.
   - `lock.passphrase` is world-readable and not compared in constant time.

4. **Notifications.** [NOTIFICATIONS.md](docs/architecture/NOTIFICATIONS.md).
   - Inline reply.
   - Chrome's notification bridge looks for the server once at startup, so a
     slow bus leaves it showing its own popups.

5. **Native density on every monitor: test on hardware.**
   [ONE-PAGE-FOR-THE-DESK.md](docs/architecture/ONE-PAGE-FOR-THE-DESK.md).

6. **home-manager builds a TS config.** `nix/home-manager.nix` should build a
   TS config directory with `bun2nix`; it writes `domicile.json`.
   [COMPOSABLE-SHELLS.md](docs/architecture/COMPOSABLE-SHELLS.md).

7. **Split manganese into small packages.** Clock, tray, mixer and window
   management as their own packages; manganese composes them. No design doc.

8. **Settings app.** [SETTINGS.md](docs/SETTINGS.md).
   - Shell options ([SHELL-OPTIONS.md](docs/architecture/SHELL-OPTIONS.md)).
   - A persistent theme choice, which needs a store for desktop state.
   - Cookies and site data.
   - A guard that runs the app's native messaging host in the engine.

9. **Split up the compositor's `main.rs`.** Left in it: event-loop state,
   startup (`run`), the surface commit path, casting, the engine pump and the
   Wayland protocol handlers.

10. **Web apps.** [WEB-APPS.md](docs/architecture/WEB-APPS.md).
    - Show the address when an app leaves its origin.
    - `domicile install-app` from a web app manifest.
    - A home-manager option for desktop entries.
    - A guard that the engine lists an app window with `isApp` and records no
      visits for it.

## In the engine fork (the agent on `crux`)

1. **shm upload on a GPU.** The GBM allocation and the browser's import
   (`uploads.rs`) have never run on a render node.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).

2. **Measure presentation.** Nothing reads a lit CRTC, so overlay promotion,
   damage and presentation latency are unmeasured.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).

3. **Two tty tasks.** [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md#plan).
   - Take `/dev/dri/card0` from logind (`TakeDevice`, `PauseDevice`,
     `ResumeDevice`) instead of `open()`.
   - Stop the evdev thread blocking during a console switch.

4. **Overlay promotion under `backdrop-filter`.** Show that viz declines it
   for an `<app>`. Needs a lit CRTC, like item 2.
   [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).

5. **Strip what a desktop never runs.** Tab strip, New Tab page, settings,
   sign-in and sync. Measure each subsystem's size first. Keep PDFium.

6. **Shortcuts inhibitor (patch `0038`) beyond sway.**
   [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
   - Untested on other hosts. mutter may show an unseen permission dialog.
   - Untested with a physical keyboard.
   - A host that sends no keymap crashes the browser on its first modifiers
     event (`WaylandKeyboard::OnModifiers`).

7. **`guard-shell.sh` launches through `domicile`.** Do this last.
   [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md).

8. **A compositor restart breaks every embed.** App ids restart, so the page's
   tokens point at dead `FrameSinkId`s. Invalidate the renderer's tokens on
   disconnect. Needed before item 2 of the repository list.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#open-questions).

9. **Keep the fork current.** A Chromium security fix ships only in a new
   engine release: move `CHROMIUM_PIN` or carry the fix as a patch.
   [BUILDING-CHROMIUM.md](packages/domicile-engine/docs/BUILDING-CHROMIUM.md#rolling-the-pin),
   [RELEASES.md](packages/domicile-engine/docs/RELEASES.md).

## Known gaps

Understood and not scheduled.

### Windows and clients

- **Popups near a screen edge aren't moved back on screen.**
  `constraint_adjustment` is never applied (`popup_placed` in
  `domicile-host`).
- **Clients only get 8-bit formats** (`FOURCCS` in `engine.rs`).
- **A chrome repaint damages the whole output.**
- **A window cast shows a pre-rotated buffer unturned.**
  [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md#pre-rotated-buffers).
- **A cast of a hidden window drops to a frame a second.**
  [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md#hidden-windows).
- **Windows under a fullscreen window keep drawing,** so manganese can animate
  the fullscreen window back to its box.
- **Browser window context menus have only Chrome's core items.** No spelling
  suggestions, page or extension items.
- **Client-drawn cursor surfaces show a plain arrow.**
- **The engine's `frame` callback is never called.** Removing it moves the
  callbacks after it, so `domicile_engine.h` and `engine.rs` change together.
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

- **No dialogs.** `alert`, `confirm` and `prompt` show nothing.
  `window.open` returns `null` and drops the opener and target name; a form
  POST to a new target arrives as a GET.
- **Some permission requests are refused,** including `getDisplayMedia`.
- **Some file dialogs are refused:** from the shell's own page, and a
  directory dropped on a page. Download progress isn't reported.
- **No `chrome://` pages,** so no cookie clearing and no printing.
- **Some extension calls are refused.**
  [EXTENSIONS.md](docs/architecture/EXTENSIONS.md).
- **Private data lasts until the engine exits.**
  [SHELL-BROWSER-WINDOWS.md](docs/SHELL-BROWSER-WINDOWS.md#private-browsing).
- **A browser window attached while hidden is visible for a moment,** so the
  page sees `visibilitychange` twice (`WebViewGuest::AttachWindowTo`).
- **Resize cost is unmeasured.**
  [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#embed-deadlines).
- **The padlock's `dangerous` state is untested.** Needs an https fixture with
  an untrusted cert.

### Clipboard

- **A nested desktop's browser uses the host's clipboard.**
- **Only text crosses to the browser.**
- **Clipboard history stores text only,** and not the primary selection.

### Theme

- **A theme picked from the toggle lasts only until restart.** Needs the
  desktop-state store (repository item 8).

### Session and portals

- **The session portal setup is only checked at evaluation.** Nothing here
  runs a user manager, an unclean exit leaves stale environment variables,
  and a nested desktop doesn't register.
- **The settings portal answers only `icon-theme`** of
  `org.gnome.desktop.interface`.
- **Wayland capture is monitors only, into shm, one shot per frame.** No
  toplevel sources, cursor sessions or dmabufs; `wf-recorder` is slow.
  [PORTALS.md](docs/PORTALS.md).

### System tray

- **Left click never opens a dbusmenu,** for items that set `ItemIsMenu`.

### Shell reload

- **Hot-swapping the shell reloads the page,** so a shell loses state kept in
  its page.

### Engine CI

- **Engine CI is one machine.** `crux` has one compile slot; a cold release
  build takes ~4h30m (#604).
  [BUILD-MACHINE.md](packages/domicile-engine/docs/BUILD-MACHINE.md).
