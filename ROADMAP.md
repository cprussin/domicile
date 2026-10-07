# Domicile roadmap

Open work and known gaps. Each item links to the design doc with the detail.
For what Domicile is, see [README.md](README.md) and
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Status

- Nothing is released.
- The wire protocol is at `PROTOCOL_VERSION = 1`.
- `packages/domicile-engine/engine-pin.nix` picks the engine users get. See
  [RELEASES.md](packages/domicile-engine/docs/RELEASES.md).

What works:

- A desktop runs on a bare tty or nested in a Wayland session, on the forked
  Chromium the flake pins.
- A client window is an `<app>` element in the shell's page. Seven CSS
  properties render bit-exact against a plain element.
- `<webview>` draws a browser window the engine owns and the shell lays out.
  It reports history and loading to the page.
- Keyboard, trackpad and clicks work on real hardware.
- An idle desktop blanks and locks. The user's password unlocks it through
  PAM.
- A shell is a module named in the config and built by `domicile`. manganese
  is a library, and `@domicile-desktop/*` is on npm.
- Extensions named in the config run. Their actions show in the shell's tray,
  and every `<webview>` is a tab to them.
- Shells reach files, processes and D-Bus. Battery, backlight, audio,
  network, Bluetooth and apps are libraries on them
  ([SHELL-SYSTEM-ACCESS.md](docs/SHELL-SYSTEM-ACCESS.md)).

Evidence is in [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md),
[A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md),
[COMPOSABLE-SHELLS.md](docs/architecture/COMPOSABLE-SHELLS.md),
[EXTENSIONS.md](docs/architecture/EXTENSIONS.md) and the
`packages/domicile-engine/scripts/guard-*.sh` scripts.

## In this repository

1. **Keystroke to pixel, on a screen** (#206). `guard-latency.sh` reads 19–29
   ms commit to pixel against a 16.67 ms frame on `crux`. That run is nested,
   with nothing presenting, and every figure includes the probe's own round
   trip. The guard waits until nothing else on `crux` is compiling or running
   guards, because load inflates the result (#601).
   - `PLATFORM=drm` runs the same probe on the scanout platform, sized to the
     CRTC. The guard refuses to run a platform in the wrong environment.
   - Left: run it on a machine with a panel. See
     [Latency on a panel](docs/HARDWARE-CHECKS.md#latency-on-a-panel).
   - The probe is a `CopyOutputRequest` that forces the draw it reads, so it
     does not measure presentation, even on a panel.
   - [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#keystroke-to-pixel).

2. **A compositor crash still loses every window.** An engine crash is
   recovered: the compositor reconnects to the new engine, re-imports every
   client buffer and restores each window's last frame. Clients keep their
   `wl_display` connection. On a tty the screens go dark for a second or two
   during an engine restart, because the engine holds DRM master. See
   [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md).

   Left:

   - **Compositor restart.** A compositor crash starts a new desktop and the
     apps exit. The page's control channel to the compositor closes when
     either end exits, and the page only retries at startup (`kReachFor`).
     Reconnecting the page to a new compositor needs a C++ change in
     `control_channel.cc` in the fork.
   - **No disconnect callback.** `domicile_engine.h` has six callbacks and none
     reports a disconnect. The compositor detects a new engine by the
     `SO_PEERCRED` of the process that says hello
     (`packages/domicile-compositor/src/which_engine.rs`). A `disconnected`
     callback would be more direct, and would also cover an engine that dies
     with no replacement.
   - **Untested against a real engine.** Unit tests cover every decision in
     the rejoin. The `dlopen`, the second `domicile_engine_connect` and the
     re-import need a built `libdomicile_engine.so` and a GPU. See
     [Dead engine with windows open](docs/HARDWARE-CHECKS.md#dead-engine-with-windows-open).

3. **Lock follow-ups.** Idle blanking, the lock and a
   PAM verifier all work. See [IDLE.md](docs/IDLE.md), [LOCK.md](docs/LOCK.md), and
   [SHELL-IDLE-AND-LOCK.md](docs/SHELL-IDLE-AND-LOCK.md#locking) for the shell
   side. A shell can lock on demand with `ChromeMessage::Lock`; manganese binds
   it to Meta+Shift+Return. `lock.passphrase` remains for machines with no PAM
   service; it is world-readable and not compared in constant time. Left:
   - **A wrong passphrase only re-sends `locked: true`.** A shell can show
     "wrong password" from that. It cannot tell a wrong password from a
     verifier error, or count or rate-limit attempts. That needs its own event
     in the engine.
   - **A config reload does not change the lock.** `lock` is read only at
     startup. Rebuilding the verifier while locked would either unlock by file
     edit or leave no way to unlock. A changed verifier applies on the next
     run.
   - **No warning before blanking.** `HostMessage::Idle` is sent when the
     screens go dark, so a shell cannot dim, count down or warn first. Two
     options, neither written: a second timer in `crate::idle` with a config
     field for the lead time, or sending the timeout to the shell so it can
     count. The lock makes this more pressing: a user about to touch the
     keyboard gets a lock screen with no warning.

4. **System tray menus.** Icons, titles and clicks work, and each item names
   its bus and menu path. Left: a library that draws `com.canonical.dbusmenu`
   over `dbusCall`. Without it, most libappindicator items do nothing on a
   secondary click. [SYSTEM-TRAY.md](docs/architecture/SYSTEM-TRAY.md).

5. **Which monitor shows a notification.** The compositor serves
   `org.freedesktop.Notifications`, including web notifications, and manganese
   shows toasts and a drawer. Left:
   - Toasts go to the top right of the whole desktop, not the focused monitor.
   - Inline reply.
   - Chrome's notification bridge looks for the server once at startup. A slow
     bus can leave it showing its own popups.

   [NOTIFICATIONS.md](docs/architecture/NOTIFICATIONS.md).

6. **Native density on every monitor.** On a tty the shell is one page over
   all monitors. It is hosted on the fastest monitor, rastered at the largest
   scale, and each lower-density monitor's region is also rastered at its own
   scale. Left: test on hardware.
   [ONE-PAGE-FOR-THE-DESK.md](docs/architecture/ONE-PAGE-FOR-THE-DESK.md).

7. **`domicile send-shell` from a terminal.** Keybindings are shell props and
   their commands reach the shell. The same command typed as
   `domicile send-shell focus right` has no route yet (supervisor → compositor
   → every page). [KEYBINDINGS.md](docs/architecture/KEYBINDINGS.md).

8. **Composable shells, phase 3.** Phases 1, 2 and 4 are done. Left:
   - A `schemars` schema with generated `@domicile-desktop/sdk/config` types.
   - `nix/home-manager.nix` building a TS config directory with `bun2nix`. It
     writes `domicile.json` today.

   [COMPOSABLE-SHELLS.md](docs/architecture/COMPOSABLE-SHELLS.md).

9. **Domicile answers every portal.** The compositor answers `Settings`,
    `Access`, `AppChooser`, `FileChooser`, `Notification`, `Inhibit`,
    `RemoteDesktop`, `Clipboard`, `InputCapture`, `Account`, `Email`,
    `Lockdown`, `GlobalShortcuts`, `Background`, `Wallpaper`,
    `DynamicLauncher`, `Usb`, `Print`, `ScreenCast` and `Screenshot`, over
    the request channel to the shell; `Secret` goes to the keyring, and no
    other backend is routed.
    [PORTALS.md](docs/PORTALS.md).

10. **Split manganese into small packages.** `@domicile-desktop/manganese` is
    one package with the layout, the bar and every bar item. Split the clock,
    tray, mixer and window management into their own packages, with manganese
    the shell that composes them. No design doc yet.

11. **A History app.** Browser windows have back, forward and address
    suggestions, but nothing browses, searches or clears history.
    `chrome://history` is blocked like every `chrome://` page (patch 0083). No
    design doc yet.

12. **A Settings app.** Extensions and config values can only be set by editing
    the config. A Settings app would manage both. It would also hold the
    *Known gaps* that need a place to store state: a persistent theme choice,
    and the cookies, site data and permissions that `chrome://settings`
    manages in Chrome. No design doc yet.

## In the engine fork (the agent on `crux`)

1. **shm upload on a GPU.** An shm client's frame is copied into a compositor
   GBM buffer (`uploads.rs`) and submitted like a dmabuf. The copy is tested on
   llvmpipe. The allocation and the browser's import have never run, because no
   guard drives an shm client on `crux`'s render node.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).

2. **Measure presentation.** Every number in the fork's docs comes from a
   `CopyOutputRequest`. Nothing reads a lit CRTC, so overlay promotion, damage
   and the presentation part of latency are unmeasured.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#plan).

3. **Two tty tasks.**
   - Take `/dev/dri/card0` from logind (`TakeDevice` plus
     `PauseDevice`/`ResumeDevice`) instead of the browser's own `open()`. This
     closes the gap where a console switch beats the master drop by a D-Bus
     round trip.
   - Stop the evdev thread blocking for the length of a console switch.

   [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md#plan).

4. **`backdrop-filter` over an `<app>`: overlay promotion.**
   `guard-css-and-resize.sh` checks every CSS property again under a
   `backdrop-filter`, and the `<app>` renders correctly. Left: show that viz
   declines overlay promotion under a filter. The guard is headless and
   software-composited, so it never uses hardware planes. This needs a lit
   CRTC, like item 2. [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).

5. **Strip what a desktop never runs.** The tab strip, New Tab page, settings,
   sign-in and sync are built and shipped, and add attack surface, but nothing
   on a desktop can reach them.
   - Measure each subsystem's size before patching. The saving could be 5% or
     40%.
   - Keep PDFium so PDFs render in a window. The viewer UI is a separate
     question.
   - Already disabled (#608), but still built: Chrome's accelerators, context
     menu, zoom, overscroll navigation, password manager, autofill, translate
     and WebAuthn UI.

6. **Shortcuts inhibitor tested only on sway with a virtual keyboard.** Patch
   `0038` asks the host compositor to stop handling its own bindings while the
   desktop window has focus, so the shell gets Meta chords when nested. Two
   guards cover it; see
   [ENGINE-FORK-MEASUREMENTS.md](docs/architecture/ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
   Untested:
   - Hosts other than sway. mutter asks the user before granting an
     inhibitor, so a nested desktop on GNOME may show an unseen dialog.
   - A physical keyboard, which reaches sway through a different device than
     `wtype`.
   - Chromium bug: a host that sends no keymap crashes the browser on its
     first modifiers event (`xkb_state_update_mask` under
     `WaylandKeyboard::OnModifiers`). The guard avoids it by holding the seat
     before the engine starts.

7. **`guard-shell.sh` should launch through `domicile`** instead of repeating
   the launch steps. Do this last, so a mistake there cannot block what
   ordinary CI covers. [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md).

8. **A compositor restart breaks every embed.** App ids restart with the
   compositor, so `app-1` gets a new `FrameSinkId` while the page holds the
   old token, and every embed of it is refused.
   `FrameSinkBroker::OnProducerDisconnected` drops the sinks but does not tell
   the renderer. Plan: invalidate the renderer's tokens on disconnect. Needed
   before item 2's compositor restart can work.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#open-questions).

9. **The renderer's parent frame sink is not checked.**
   `ExternalSurfaceProvider` is bound as a free function, so the browser does
   not verify that the renderer owns the parent frame sink it names
   (`EmbeddedFrameSinkProviderImpl` does). Plan: bind through
   `RenderProcessHostImpl` to get the renderer's child process id.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#open-questions).

## Needs a machine with a screen

No agent or CI runner here has a lit panel.
[HARDWARE-CHECKS.md](docs/HARDWARE-CHECKS.md) lists the checks a person with a
laptop must run.

## Known gaps

Understood and not scheduled.

### Windows and clients

- **Popups near a screen edge are not moved back on screen.** The compositor
  places a menu where its positioner asks, relative to its window, because it
  does not know where the page put the window. `constraint_adjustment` (flip,
  slide, resize) is never applied. A fix needs the page to report each window's
  screen box, or the shell to solve the positioner. See `popup_placed` in
  `domicile-host`.
- **Clients only get 8-bit formats.** The engine imports four fourccs
  (`FOURCCS` in `engine.rs`). Adding 10-bit needs a `FormatFromFourcc` case in
  the fork and an entry in `FOURCCS`.
  `scripts/test-the-engines-fourccs-agree.sh` keeps them in sync.
- **A chrome repaint marks the whole output damaged.** The chrome is one layer
  over the desktop, and it repaints for a clock, a caret or a hover.
- **Clients that pre-rotate their buffer render wrong.** Clients may
  pre-rotate their buffer to match `wl_output.transform`, but nothing reads
  `wl_surface.set_buffer_transform`. The fix is in the dmabuf submit path.
- **Browser window context menus have Chrome's core items only.** No
  spelling suggestions and no items a page or extension adds. DevTools' own
  menus get the page menu. Each needs a field on `WebViewContextMenu` in
  `web_view_guest.mojom`.
- **Client-drawn cursor surfaces show a plain arrow.**
- **Unknown: whether viz hit testing must agree with Domicile's.** Domicile
  routes input itself from the box the page reports. If viz's hit-test data
  disagrees, the engine may swallow events.
  [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md#open-questions).

### Displays

- **A client without `wp_fractional_scale_v1` draws at `wl_output.scale`,
  rounded up.** Intended: a client rendered at 2× and downscaled is sharper
  than one at 1× and stretched. Clients with it get the exact scale.
- **A monitor profile can require a mode but not set it.** `mode = [3840,
  2160]` on a placement names the mode the positions assume. A monitor that
  comes up in another mode leaves the desktop unchanged and logs both modes.
  Without `mode`, the monitor's native mode is used. Setting a mode needs a
  field on `DomicileDisplayLayout` and a mode lookup in
  `ModesetParamsFromSnapshots`, which uses `native_mode()` today. That is fork
  work. Refresh rate is the same item.
  [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md).
- **A monitor with no make, model or serial is named `drm-<id>`.** Other
  monitors get names like `Dell Inc. DELL U3219Q 2ZLS413` from hwdata's
  `pnp.ids`, and a profile can match that or the EDID's `DEL …`.
- **A non-panel `wl_output` reports zero physical size and refresh.** That is
  what `wl_output` specifies for unknown values. On a tty they come from the
  panel's `DisplaySnapshot`.
- **Engine popups are kept inside their window, not their CRTC.** A
  `<select>`, context menu or extension popup is its own widget (patch 0051).
  Plan: open it on the display under the anchor, kept inside that CRTC.
- **Filter quality on lower-density displays is unmeasured.** The desk draws
  once for all displays. If a blurred bar or shadow looks soft on the
  lower-density one, the fix is a render pass per display.
- **The desk rasters what no monitor shows.** The high-res tiling covers the
  gaps between monitors, and a display tiling the bounds of its monitors.
  [DISPLAY-TILINGS.md](docs/architecture/DISPLAY-TILINGS.md#cost).
- **No guard runs two CRTCs.** Headless has one screen. gtests cover the
  logic, and [Several monitors](docs/HARDWARE-CHECKS.md#several-monitors) the
  rest. [ONE-PAGE-FOR-THE-DESK.md](docs/architecture/ONE-PAGE-FOR-THE-DESK.md#open-questions).

### Browser windows

- **Browser windows deny permission requests and dialogs.** A `<webview>`
  guest's `WebContentsDelegate` gives the default answer: camera, microphone,
  location and the like are denied, and `alert`, `confirm` and `prompt` show
  nothing and return at once. `window.open` is the
  exception: the engine opens a browser window at the address. But
  `window.open` returns `null`, the opener and target name are dropped, and a
  form POST to a new target arrives as a GET.
- **Some file dialogs are refused.** Every file dialog goes to the shell
  (`domicile-file-chooser`): file inputs, downloads, File System Access pickers
  and the PDF viewer's save (patch 0086). Not covered:
  - Dialogs from the shell's own page (not in a `<webview>`) are refused.
  - A directory dropped on a page (`EnumerateDirectory`) is refused.
  - Download progress is not reported.
- **No settings page.** Browser windows block every `chrome://` page (patch
  0083), so nothing can clear cookies and site data or change site
  permissions. The Settings app (item 12) will cover this. Printing is also
  blocked: `window.print()` opens `chrome://print`.
- **Some extension calls are refused.** `tabs.move`, `group`, `ungroup`,
  `discard`, `duplicate` and splits; `tabs.update`'s `pinned`, `openerTabId`
  and `autoDiscardable`; `windows.update` bounds and state; and any
  `windows.create` but a one-`url` popup fail with `not supported on a
  Domicile desk`. [EXTENSIONS.md](docs/architecture/EXTENSIONS.md).
- **Resize cost is unmeasured.** Patch 0054 stops the shell's frame waiting
  for a `<webview>` to draw at each new size, matching `<app>`. No guard times
  a resize of either.
- **The padlock state is not fully tested.** `PageChanged` carries the address
  and `security_state::GetSecurityLevel` for the visible entry, the same source
  as Chrome's omnibox. The fixture serves plain http from localhost, so the
  guard only checks that a level arrives. Testing expired certificates,
  name mismatches and mixed content needs an https fixture with an untrusted
  cert. Until then, `dangerous` is untested.

### Clipboard

- **A nested desktop's browser uses the host's clipboard.** On a tty, the
  browser's drm platform (`ui/ozone/platform/drm/domicile/`) uses the
  compositor's clipboard. Nested, the browser uses Wayland ozone, which uses
  the host session's clipboard, so a copy in a terminal does not reach a tab.
  Fix: implement the same clipboard `OzonePlatform` entry points on the
  Wayland platform.
- **Only text crosses to the browser.** The engine ABI carries a string. An
  image copied in a page gives other windows no text to paste, and an image
  copied in a terminal does not reach a tab. Supporting it needs bytes and a
  mime type in the ABI.
- **Clipboard history stores text only.** Selections that offer only an image
  or a file list are not recorded. The primary (middle-click) selection is not
  in the history, because it changes on every drag-select. It still works
  between clients: `zwp_primary_selection_device_manager_v1` is advertised,
  and `packages/domicile-compositor/tests/selection.rs` tests it.

### Theme

- **A theme picked from the toggle lasts only until restart.** `theme.mode` is
  the startup value. The config file is generated (by a shell, or by
  home-manager on NixOS), so the desktop does not write to it. Persisting the
  choice needs a separate store for desktop state; the Settings app (item 12)
  needs the same.
- **Unmeasured: whether Wayland windows are in the theme transition's old
  frame.** Windows change theme inside the shell's view transition, after it
  captures the old frame (`domicile_host::theme_turnover`). A `<webview>` was
  verified against the published engine. An `<app>` is embedded the same way,
  but no pixel guard has tested one. If it is not captured, the window changes
  theme before the wipe instead of behind it.

### Session and portals

- **The session portal setup is only checked at evaluation.** A desktop that
  is the session tells the user manager and starts `domicile-session.target`
  (`domicile_launch::graphical_session`), which binds
  `graphical-session.target` so the portal can start. Links from sandboxed
  (Flatpak) apps reach the desktop through `domicile-mimeapps.list` and
  `DOMICILE_SOCK`. Not covered:
  - Nothing here runs a user manager.
  - A desktop that exits uncleanly leaves its environment variables until the
    next one replaces them.
  - A nested desktop does not register, so the host session keeps its portal.
- **The settings portal answers one namespace.** Desktop backends often also
  serve `org.gnome.desktop.interface` (font, cursor theme). Domicile has no
  values for those. An unanswered namespace falls
  through to the next backend, which is correct, so `nix/domicile.portal`
  lists only what Domicile implements.

- **Screenshots are a Domicile command, not a protocol.** `domicile
  screenshot <file>` asks the engine for a PNG of the shell page. It is a
  stopgap:
  - No region or window picker, and no screen recording.
  - Tools such as `grim` and `wf-recorder` cannot capture the desk. Portal
    clients can, through the Screenshot portal
    ([PORTALS.md](docs/PORTALS.md)).

  Replace it with `ext-image-copy-capture-v1` (and `wlr-screencopy` for older
  tools), on the display captures the portal uses. Then remove the command.

### Shell reload

- **Hot-swapping the shell reloads the page.** `domicile load-shell` triggers
  it, and `announce_open_apps` re-sends the desktop state to the new page. A
  shell loses any state kept in its page. App windows survive because the
  compositor is not involved. Browser windows survive because the engine owns
  their pages.

### Engine CI

- **Engine CI is one machine.** `crux` has one compile slot. Engine pull
  requests queue for it. A cold release build takes ~4h30m (#604). The latency
  guard can wait up to 10h for a quiet machine. See
  [BUILD-MACHINE.md](packages/domicile-engine/docs/BUILD-MACHINE.md) and
  [RELEASES.md](packages/domicile-engine/docs/RELEASES.md).

---

Working in this repository: [AGENTS.md](AGENTS.md) has the rules, and
[docs/DEVELOPING.md](docs/DEVELOPING.md) covers running, testing and
debugging.
