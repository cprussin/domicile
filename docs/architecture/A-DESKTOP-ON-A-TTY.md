# A desktop on a tty

On a tty, `domicile` runs the engine with `--ozone-platform=drm`. The engine:

- takes each card from logind, which sets DRM master on it;
- modesets each panel at its native mode;
- opens a fullscreen window that covers each CRTC;
- takes every keyboard and pointer from logind too;
- asks logind for a console switch on `Ctrl+Alt+F<n>`.

`domicile-launch` picks this platform when `XDG_VTNR` is set and neither
`WAYLAND_DISPLAY` nor `DISPLAY` is.

The work has two parts:

- **A build patch** (`0012`, `0014`) lets `gn gen` accept
  `ozone_platform_drm = true` off ChromeOS.
- **An embedder** in `ui/ozone/platform/drm/domicile/` does what ash does on
  ChromeOS: a `PlatformScreen`, a modeset driver, DRM master handling, input
  from logind and console switching.

Details live in separate docs:

- [TTY-SESSION.md](../TTY-SESSION.md): DRM master, console switching and input
  from logind.
- [DISPLAYS.md](../DISPLAYS.md): profiles, which connectors light, pointer
  crossing, rotation and monitor names.
- [IDLE.md](../IDLE.md): blanking and idle inhibitors.
- [LOCK.md](../LOCK.md): the screen lock.
- [TTY-DEBUGGING.md](../TTY-DEBUGGING.md): reading a modeset from the logs, and
  hosts whose scanout and render cards differ.

## Status

| What | Evidence |
|---|---|
| `gn gen` accepts the argument and `//ui/ozone` builds | CI: `.github/workflows/engine-drm-probe.yml` |
| A panel modesets at its native mode, lit at startup | Hardware (2880x1920@120) |
| The window fills the CRTC and stays fullscreen | Hardware. Patches `0018`, `0023` |
| Keys reach the shell in the configured layout | Hardware. Patches `0024`, `0025` |
| A force-paused input device comes back | Hardware |
| An arrow cursor is drawn | Hardware. Patch `0026` |
| The trackpad moves it; a click reaches the page | Hardware. Patch `0027`, `use_libinput = true` |
| The screens relight after a console round trip | Hardware |
| Input works after a console round trip | Unverified. The `released_` fix in `DrmTakenDevices` has not run on hardware |
| The card comes from logind, and a console switch does not crash the GPU process | Unverified. `HardwareDisplayControllerTest.AFlipAfterLogindTookMasterIsSkipped` |
| Input keeps reading while logind answers | Unverified. Patch `0132` |
| `Ctrl+Alt+F<n>` reaches `Seat.SwitchTo` | Not run on hardware |
| Display drop and retake on a console switch | Reasoned from source. `DrmVtSwitcherTest` |
| The screens relight after suspend | Reasoned from source. `DrmSleepTest`, `DrmModesetTest` |
| A light cursor on a dark theme | Unit tests (`CursorColorSchemeTest`). Patch `0061` |
| Fast scrolls go further than slow ones | Unit tests (`ScrollAcceleratorTest`). Patch `0049` |
| Mouse acceleration and wheel | Unit tests (`WheelTicksTest`). Patch `0059` |
| An absolute mouse hovers, clicks with every button and scrolls | Unit tests (`AbsoluteMouseConverterTest`). Patch `0123` |
| A stop during startup stops | Unit tests (`domicile-launch` milestones) |
| A card with no 3D draws the desktop on the CPU | Unit tests (`DrmCanvasTest`, `software_compositing`). See [Software output](#software-output) |

## Building ozone/drm off ChromeOS

- Patch `0012` relaxes the `BUILD.gn` assert to `is_linux || is_chromeos` and
  gates the ChromeOS-only deps.
- Patch `0014` fixes a static initializer.
- Both build scripts set `ozone_platform_drm = true`;
  `packages/domicile-engine/tests/test-the-builds-agree-on-ozone.sh` checks they agree.
- Some gaps show up only at link time. `host/drm_cursor.cc` includes
  `cursor_controller.h`, which ships everywhere, but `cursor_controller.cc`
  compiles only on ChromeOS. CI builds a drm probe
  (`.github/workflows/engine-drm-probe.yml`) to catch these.

## The embedder

ozone/drm has two gaps that ash fills on ChromeOS:

- `OzonePlatformDrm::CreateScreen()` is `NOTREACHED()`. A views browser on
  Linux calls it through `aura::ScreenOzone`.
- Nothing modesets. The only caller of `NativeDisplayDelegate::Configure` is
  `display::DisplayConfigurator` in `ui/display/manager`, which asserts
  `is_chromeos`.

### `DrmScreen`

- A `PlatformScreen` over the snapshots `DrmDisplayHostManager` holds. Patch
  `0013`, modeled on `HeadlessScreen`.
- Most methods delegate to `display::DisplayList` and
  `display::FindDisplay*`. `DisplayList` notifies observers, so hotplug needs
  no code of its own.
- Widget lookups use `DrmWindowHostManager`'s window map.
  `GetAcceleratedWidgetAtScreenPoint` receives DIPs and converts to pixels.
- `DrmWindowHostManager::HasWindow` is added because `GetWindow` is
  `NOTREACHED()` on an unknown widget.

### The modeset driver

`DrmModeset` gets a delegate from `OzonePlatform::CreateNativeDisplayDelegate()`
and runs `GetDisplays` → `ModesetParamsFromSnapshots` → `Configure`. Each
connector gets its `native_mode()` unless a layout says otherwise
([DISPLAYS.md](../DISPLAYS.md#which-connectors-light)).

Two guards:

- **No repeat modesets.** Each `Configure` makes the kernel emit a udev CHANGE,
  which triggers another read and another modeset. `ModesetWouldChangeAnything`
  skips the modeset when the hardware reports what it last confirmed. A real
  hotplug changes the report.
- **Ignore answers from inside the browser.** `DrmModeset::Start()` runs before
  the GPU process exists, so `DrmDisplayHostManager` answers from its dummy
  snapshots, synchronously. An answer that arrives before `Configure` returns
  comes from this process (`inside_configure_`). It is logged and not recorded.
  Otherwise a machine whose dummy reading matched its real one would never
  modeset.

`DrmModeset::Relight` forces a modeset past the first guard. A console switch
back and a wake from suspend use it.

## The session, the console and DRM master

Details: [TTY-SESSION.md](../TTY-SESSION.md).

## Exiting during startup

- An engine that outlives its launcher keeps session control, input, the cards
  and a `K_OFF` console until its bus name drops. Only the power button
  recovers.
- So `domicile-launch` stops the engine at once on `SIGINT` or `SIGTERM` during
  startup.
- Chromium's `SIGTERM` handler calls `_exit`, so no destructor runs.

## Input

- The browser takes evdev devices from logind with `Session.TakeDevice`
  (`DrmLogindInput`, `DrmTakenDevices`, patch `0020`). It plugs in as the
  `InputDeviceOpener` that `InputDeviceFactoryEvdev` already accepts, and
  answers when logind does (patch `0132`).
- logind's ACLs cover the card but not keyboards or mice, so a plain `open()`
  of `/dev/input/event*` fails.
- It uses Chromium's `dbus::Bus`, already in the engine. No libseat.
- Touchpad and mouse go through libinput (patches `0027`, `0059`).
- The chrome forwards `ClientRequest::Key` (an evdev code); the compositor
  injects it with `inject_key`.
- The compositor sends its compiled keymap with the handshake (`keymap`), and
  the browser's `XkbKeyboardLayoutEngine` loads it (patch `0024`,
  `components/domicile/browser/keyboard_layout.h`). The layout is read from the
  config once.

Pause, resume and the console switch: [TTY-SESSION.md](../TTY-SESSION.md#input-from-logind).

## Outputs

- The engine reports displays to the compositor in the `connected_displays`
  event on the engine C ABI (`DomicileConnectedDisplay`). A nested run never
  sends it.
- `output.profiles` arranges displays, and the compositor tells the engine
  which connectors to light and where.
- Details: [DISPLAYS.md](../DISPLAYS.md).

## The clipboard

The compositor owns the clipboard. `drm_clipboard.h` is the browser's
`PlatformClipboard`, which forwards to it:

- **Copy in a page:** `OfferClipboardData` → `SetDomicileCopiedCallback` →
  engine ABI → the seat's selection.
- **Copy anywhere else:** the compositor reads it from the client → engine ABI
  → `SetDomicileClipboard` → `SetContents`.

The compositor pushes every selection, so:

- `RequestClipboardData` answers synchronously from memory.
- The browser is never the selection owner.

Contents cross keyed by MIME type (`DomicileClipboardContents`, patch `0111`):
the text once, offered under every text type, and an image under its own type
(`image/png` from a page). Other types, such as the HTML a copied image comes
with, stay in the browser.

The primary selection works too (`zwp_primary_selection_device_manager_v1`).
A nested run still uses the host's clipboard; `ROADMAP.md` tracks it.

## The window has to be the size of the CRTC

- `ScreenManager` binds a window to a CRTC only on an exact rectangle match
  (`FindWindowAt`). With no match, page flips are dropped and the screen stays
  black with a clean log.
- Chromium's default window on a 2880x1920 panel is 1050x1900 at (10,10).
- `domicile-launch` passes `--start-fullscreen` on the scanout platform only.
  `DrmWindowHost::SetFullscreen` (patch `0018`) sizes the window from
  `display::Screen`, which reads the same snapshots as the modeset.
- Domicile does not use `--window-size`. `drm_util.cc` picks the first
  preferred mode, not the largest, so the size could be wrong.
- Patch `0023` stops the fullscreen bubble from leaving fullscreen. The
  bubble's window never presents, so its presentation watchdog fired.

## Popups and tooltips

- Popups (select lists, date pickers, menus) stay inside their parent window
  (patch `0051`), as on ash.
- Tooltips do too (patch `0076`). A top-level tooltip would be a window of
  its own, which no CRTC shows.
- On a monitor other than the host's, a presenter mirrors them
  ([One page for the desk](ONE-PAGE-FOR-THE-DESK.md#browser-one-page-n-presenters)).

## Software output

A card with no 3D (2D virtio-gpu, Hyper-V, simpledrm, vkms) gives the GPU
process no GL. The desktop is composited on the CPU instead.

- **Who decides:** `domicile-launch` (`software_compositing.rs`), once per run,
  on drm only. The CPU composites when no render node has 3D: simpledrm, vkms,
  hyperv_drm and bochs have no render node, and virtio-gpu has 3D only with the
  `VIRTIO_GPU_F_VIRGL` feature bit (`device/features`, first character).
  `DOMICILE_SOFTWARE_COMPOSITING=yes` or `no` decides instead.
- **Engine:** gets `--disable-gpu`, so viz composites in software.
  `GbmSurfaceFactory::CreateCanvasForWidget` returns a `DrmCanvas`
  (patch `0135`, `domicile/drm_canvas.h`):
  - Viz paints into a frame in memory.
  - Each present copies what changed into one of two XRGB8888 dumb buffers
    and page-flips the window's CRTC to it. The dumb buffers are only written:
    on hardware they are write-combined.
  - A buffer misses the frames shown while the other was up, so each keeps the
    region it is stale by.
  - A swap is acknowledged when its flip lands (`MaxFramesPending` 1).
  - `SWAP_NAK_RECREATE_BUFFERS` reallocates both buffers.
  - A card with no GBM still gets a DRM device: mesa has no driver for
    simpledrm, and 2D virtio-gpu failed `gbm_create_device` in the GPU
    process. It modesets with a dumb buffer; a GBM buffer on it fails,
    logged.
- **Compositor:** gets `--software-compositing yes` and hands windows over in
  shared memory. See
  [WINDOW-COMPOSITING.md](WINDOW-COMPOSITING.md#wl_shm-clients-on-the-cpu).
- `--disable-gpu-process-crash-limit` stays: a GPU process that fell back to
  software on its own would get dmabufs it cannot show.
- **Not covered:** no vsync provider (viz's begin frames pace painting), casts
  of a window in memory, and dmabuf clients, which the CPU path cannot show.

## Key decisions

- **Patch ozone/drm's build; do not fork it.** Its `.cc` files contain no
  `BUILDFLAG(IS_CHROMEOS)` at the pin, and a fork would need rebasing at every
  pin bump.
- **Write an embedder; do not port `ui/display/manager`.** That is about 40
  files of ChromeOS display management. Domicile needs only snapshots →
  `Configure` and a `PlatformScreen`.
- **The engine is the only DRM master.** The compositor renders on a render
  node.
- **logind owns the VT.** The engine asks it for switches and follows the
  session's `Active` property.
- **Input comes from logind.** The `input` group would give every process the
  user runs permanent keyboard access, and nothing revokes it on a console
  switch.
- **No fallback to `open()`.** A missing session or a `TakeControl` held by
  someone else is fatal, and the message names the fix. A silent fallback is a
  desktop with no input.
- **The compositor pushes the clipboard to the browser.** It already reads
  every selection for the history, and a pull would add a round trip to each
  paste.
