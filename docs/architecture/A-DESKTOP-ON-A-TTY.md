# A desktop on a tty

**Getting `gn gen` to accept `ozone_platform_drm = true`, and a `chrome` out
the other side, is a patch: nine edits, eight of them around the DRM platform
rather than inside it.** The ninth is inside and mechanical: two constants in
`drm_util.h` became functions, because a `const` whose initializer calls
`base::FeatureList::IsEnabled()` runs that call during static initialization,
and that is fatal. It was found by running a host tool, not by reading, and it
is the first of the nine that a compiler and a linker both let through.
Getting a lit screen out of it is a port — of the *embedder* ozone/drm has
never had off ChromeOS, not of ozone/drm itself. It is not a fork: at
`bbbfd22b56d9df22e578e9faf55b286714b7303c` the 49 `.cc` files in
`//ui/ozone/platform/drm:gbm` contain **two** references to ChromeOS between
them and **zero** `BUILDFLAG(IS_CHROMEOS)`.

## Problem

`ROADMAP.md` says a tty desktop is blocked at `ui/ozone/platform/drm/BUILD.gn`
line 14:

```gn
assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")
```

and `ui/ozone/BUILD.gn:43` makes `platform/drm:gbm` a dependency of
`//ui/ozone` the moment the argument is true, so `gn gen` refuses before
anything compiles. True, and it says nothing about depth. This doc establishes
the depth.

Everything below is read from the sparse checkout at the pin in
`packages/domicile-engine/CHROMIUM_PIN`. The reading is no longer the only
evidence: `.github/workflows/engine-drm-probe.yml` builds `//ui/ozone` with
`ozone_platform_drm = true` and the patch applied, and what it found is in
[What the compiler said](#what-the-compiler-said). Three of the eight edits are
there because it ran — a static read had not found them and, as that section
explains, could not have.

## What the assert guards

Nothing in the platform. `git grep` over `ui/ozone/platform/drm` at the pin:

| Search | Hits |
|---|---|
| `include "ash/`, `"chromeos/`, `"chrome/` | 1 — `gpu/page_flip_watchdog.cc:9` |
| `include "ui/base/ime/ash/` | 1 — `ozone_platform_drm.cc:63` |
| `BUILDFLAG(IS_CHROMEOS)` / `IS_CHROMEOS_ASH` | 0 |
| `is_chromeos` | 2, both in `BUILD.gn` (lines 14 and 169) |

**That table is accurate and it is not sufficient — do not re-derive a bound
from it.** Three of the eight edits in the patch are about things *outside*
this directory that it merely consumes, and no search scoped to the platform's
own path could have found any of them. One is worth naming, because it is a
lesson about the method rather than about ozone/drm:

The first row searches for `include "chromeos/`, a pattern anchored at the
*start* of the include path. `host/drm_cursor.cc:22` includes
`ui/events/ozone/chromeos/cursor_controller.h`, where `chromeos/` is a path
segment rather than a prefix — the row could never have matched it, however
many times it is re-run. And that one is invisible to the compiler as well:
`ui/events/ozone/BUILD.gn:44` compiles `chromeos/cursor_controller.cc` only
`if (is_chromeos)` while shipping the header on every platform, so the include
resolves, the call type-checks, and the only thing that ever objects is the
linker. It cost three probe rounds to reach, and it is the reason the last
edit in the patch exists.

The two hits the table does find are incidental, and neither is load-bearing:

| Hit | What it does | Cost to remove |
|---|---|---|
| `page_flip_watchdog.cc:18,53` — `ash::switches::IsRevenBranding()` | picks the page-flip flake threshold before `LOG(FATAL)`, and emits `Platform.FlexPageFlipFlakes2` | one constant; the histogram is ChromeOS Flex telemetry |
| `ozone_platform_drm.cc:173` — `ash::InputMethodAsh` | the whole of `OzonePlatform::CreateInputMethod` | `InputMethodMinimal`, exactly as `ozone_platform_headless.cc:104-108` already does on Linux |

Those two account for the whole of `deps += [ "//ash/constants",
"//ui/base/ime/ash" ]` (`BUILD.gn:164-167`) — the only entries in the target's
dependency list carrying an `is_chromeos` assert of their own
(`ash/constants/BUILD.gn:5`, `ui/base/ime/ash/BUILD.gn:5`).

Every other dependency builds on desktop Linux at this pin:

| Dep | Status on `is_linux` |
|---|---|
| `//third_party/minigbm` | `use_system_minigbm = is_linux && !is_castos`, so it resolves to `pkg_config("gbm")` — system Mesa |
| `//build/config/linux/libdrm` | `assert(is_linux \|\| is_chromeos)`; on Linux it is the bundled `//third_party/libdrm` |
| `//ui/events/ozone/evdev` | `assert(use_ozone && (is_linux \|\| is_chromeos))`; every ChromeOS dep sits inside `if (is_chromeos)` at lines 149 and 347 |
| `//ui/display/types` | no assert — `NativeDisplayDelegate`, `DisplaySnapshot`, `DisplayMode` are all Linux-buildable |
| `//ui/display/util` | EDID parsing, no assert |
| `//ui/ozone/platform/drm/mojom`, `//ui/ozone/common` | no ChromeOS anything |

Outside `ui/display/types`, the sources reach for `ui/display/display.h`,
`ui/display/screen.h`, `ui/display/display_features.h` and
`ui/display/util/*` — all in ungated targets. The only `ui/display/manager/`
include anywhere in the platform is `manager/test/fake_display_snapshot.h`,
and only the `gbm_unittests` target reaches it.

### The assert is conservative about the platform and honest about the embedder

What the DRM platform genuinely cannot do alone is two things ash does for it,
and both are outside the assert's reach.

**1. It has no `PlatformScreen`.**

```cpp
// ui/ozone/platform/drm/ozone_platform_drm.cc:86
std::unique_ptr<PlatformScreen> CreateScreen() override { NOTREACHED(); }
void InitScreen(PlatformScreen* screen) override { NOTREACHED(); }
```

On ChromeOS `ash` installs `display::Screen` itself and never asks. A views
browser on Linux goes `views::DesktopScreenOzone` → `aura::ScreenOzone` →
`OzonePlatform::CreateScreen()` (`ui/aura/screen_ozone.cc:25`) and hits that
`NOTREACHED()` on the way up. **This is the single strongest piece of evidence
that step 2 is a port rather than a patch**: the gap is deliberate, marked by
the `NOTREACHED()`, and nothing in the tree fills it for a non-ash embedder.

**2. Nothing modesets.**

The only route to a lit CRTC is `DrmThread::ConfigureNativeDisplays`
(`gpu/drm_thread.cc:382`) → `DrmGpuDisplayManager::ConfigureDisplays` →
`ScreenManager::ConfigureDisplayControllers`, reached over mojo from
`DrmNativeDisplayDelegate::Configure`. The only caller of
`NativeDisplayDelegate::Configure` in the tree is `display::DisplayConfigurator`
and its `ConfigureDisplaysTask`, and `ui/display/manager/BUILD.gn:7` is:

```gn
assert(is_chromeos)
```

A build with the assert relaxed and nothing else comes up with DRM devices
opened, snapshots read, and every CRTC still off.

`ui/display/manager` is ~40 files: `DisplayManager`, `DisplayChangeObserver`,
touch transforms, content protection, layout stores. Domicile needs the
`DisplaySnapshot` → modeset slice of it and none of the rest.

## How big the embedder is

**Two files and no port of `ui/display/manager`.** What is ChromeOS-only is the
*caller*; every seam it calls is ungated and already implemented by the DRM
platform.

### `DrmScreen`

`PlatformScreen` has **nine** pure virtuals (`ui/ozone/public/platform_screen.h`)
and seven more with defaults. `HeadlessScreen` — 63 + 243 lines — is the
reference, not `WaylandScreen`'s 151 + 586: headless has no window-system output
protocol either, so it builds its display list from nothing, and DRM is that
shape with real snapshots in place of the fiction.

Six of the nine are delegations, because two ungated helpers already exist:

| Pure virtual | Supplied by |
|---|---|
| `GetAllDisplays` | `DisplayList::displays()` |
| `GetPrimaryDisplay` | `DisplayList::GetPrimaryDisplayIterator()` |
| `AddObserver` / `RemoveObserver` | `DisplayList::Add/RemoveObserver` — it notifies on `AddDisplay`/`UpdateDisplay`/`RemoveDisplay`, so hotplug needs no observer code of its own |
| `GetDisplayNearestPoint` | `display::FindDisplayNearestPoint` (`ui/display/display_finder.h`) |
| `GetDisplayMatching` | `display::FindDisplayWithBiggestIntersection` (same) |

The three that are real work are the widget ones, and `DrmWindowHostManager`
already holds the map (`std::map<AcceleratedWidget, DrmWindowHost*>`). Two
details there cost a build round each if they are found by compiling:

- `GetWindowAt` matches on `GetBoundsInPixels()`, and
  `GetAcceleratedWidgetAtScreenPoint` is handed a point in **DIP**. The lookup
  is free; converting is the work.
- `GetWindow` is `NOTREACHED()` on a widget it does not hold, so
  `GetDisplayForAcceleratedWidget` cannot pass one through unchecked.

### The modeset driver

`DrmNativeDisplayDelegate` implements the whole seam, and
`OzonePlatform::CreateNativeDisplayDelegate()` (`ozone_platform_drm.cc:166`) is
how to get one:

| Need | Call |
|---|---|
| the display list | `GetDisplays(GetDisplaysCallback)` → `DisplaySnapshot`s |
| light a CRTC | `Configure(std::vector<DisplayConfigurationParams>, callback)` |
| hotplug | `AddObserver(NativeDisplayObserver*)` — two methods, `OnConfigurationChanged` and `OnDisplaySnapshotsInvalidated` |
| DRM master, for VT | `TakeDisplayControl` / `RelinquishDisplayControl` |

`DisplayConfigurationParams` is `{id, origin, mode, enable_vrr}`
(`ui/display/types/display_configuration_params.h`), and a snapshot's
`native_mode()` fills `mode`. So "snapshots → modeset" is a loop over
`GetDisplays`' result.

**What `ui/display/manager` holds that Domicile skips** is
`DisplayChangeObserver` — 478 lines converting snapshots into
`ManagedDisplayInfo`, which is ChromeOS product surface. Domicile wants
`DisplaySnapshot` → `display::Display` directly.

### The physical size is already in the snapshot

`DisplaySnapshot::physical_size()` is millimeters, which is exactly what
`wl_output` wants and what the compositor fabricates as `size: (300, 200)`
(`main.rs:3211`). The display-list event under [Outputs](#outputs) does **not**
carry it yet: that event is built in the browser process out of
`display::Display`, which has no physical size, and the snapshot that does is a
layer below. `DrmScreen`'s `DisplayPhysicalSizeMm` is the seam waiting for it.

## The session and DRM master

**There is no session abstraction to plug into.** ozone/drm opens the card
node itself, from the browser process, with a bare `open`:

```cpp
// ui/ozone/platform/drm/host/drm_display_host_manager.cc:116
int fd = HANDLE_EINTR(open(dev_path.value().c_str(), O_RDWR | O_CLOEXEC));
```

and hands the fd to the GPU process over mojo (`mojom/drm_device.mojom:48`,
`AddGraphicsDevice(path, handle<platform>)`). `GetPrimaryDisplayCardPath()`
walks `/dev/dri/card%d` and `LOG(FATAL)`s if none opens
(`drm_display_host_manager.cc:246, 273`). The open path then loops on
`drmGetMagic`/`drmAuthMagic` **forever**, 100 ms at a time, until it
authenticates — which is how it waits out frecon on ChromeOS, and which on a
tty means "something else already holds master" presents as a hang rather than
an error.

`ui/ozone/public/platform_session_manager.h` is not this: it is
xdg-session-management window restore. There is no logind, no libseat, no
D-Bus and no fd-passing seat interface anywhere in ozone.

Master itself is `DrmWrapper::SetMaster` / `DropMaster`
(`common/drm_wrapper.cc:204, 211`), driven only from
`DrmGpuDisplayManager::TakeDisplayControl` / `RelinquishDisplayControl`
(`gpu/drm_gpu_display_manager.cc:407, 437`), whose only caller is
`DisplayConfigurator::TakeControl` / `RelinquishControl`
(`ui/display/manager/display_configurator.cc:608, 650`) — the chromeos-only
target again.

What a normal Linux tty has to supply:

| Need | Who supplies it today | What a tty needs |
|---|---|---|
| open `/dev/dri/card0` | `open()` in the browser process | a logind session on an active VT gives the session user an ACL on the card node, so the bare `open` works unprivileged. Root also works. No code change |
| become DRM master | implicit: the first opener of an unused card is master | nothing, *if* nothing else holds it |
| drop master on VT-away, retake on VT-back | `DisplayConfigurator`, on a ChromeOS signal | does not exist. `TakeDisplayControl` / `RelinquishDisplayControl` are the right seam and are already plumbed to the DRM thread; the caller is what is missing |
| open `/dev/input/event*` | `open()` in the browser process | **fails.** logind ACLs a card node and not a keyboard, so the fds have to come from `Session.TakeDevice`, which is a seam ozone does not have (see [Input](#input)) |
| revoke input on VT-away | — | the same seam: logind `EVIOCREVOKE`s the fd it passed when it pauses the device |

**Domicile needs exactly one DRM master, and it is the engine.** The
compositor never touches a card node: `dmabuf_import.rs`'s `headless_renderer`
brings up GLES on whatever render node EGL offers, because it composites
nothing — a client's dmabuf goes to the engine. So ozone/drm in the engine
holds master and the Smithay side is unaffected.

## Input

**Ozone DRM supplies evdev on this pin, and the existing forwarding path
survives unchanged.**

`OzonePlatformDrm::InitializeUI` builds the same evdev stack any ozone platform
on Linux can (`ozone_platform_drm.cc:194-209`):

```cpp
device_manager_ = CreateDeviceManager();                  // udev
event_factory_ozone_ = std::make_unique<EventFactoryEvdev>(
    cursor_.get(), device_manager_.get(),
    KeyboardLayoutEngineManager::GetKeyboardLayoutEngine());
```

`InputDeviceOpenerEvdev::OpenInputDevice` opens `/dev/input/event*` directly
with `open(O_RDWR | O_NONBLOCK)`
(`ui/events/ozone/evdev/input_device_opener_evdev.cc:114`) — and **that open
fails on an ordinary desktop.** This is the one thing about input the audit
had wrong, and the first run on real hardware is what said so.

**logind's ACLs do not cover a keyboard.** `70-uaccess.rules` tags `drm
card*` and `renderD*`; among input devices it tags only
`ID_INPUT_JOYSTICK`. A keyboard or a mouse keeps its group-owned mode on an
active VT and the session user gets no ACL entry on it. So the card node
opens and every evdev node does not — which is exactly the shape of that run:
`Modeset succeeded` at `2880x1920p@120`, and fifteen
`Cannot open /dev/input/eventN: Permission denied (13)`.

What logind supplies instead is fd-passing.
`org.freedesktop.login1.Session.TakeDevice(major, minor)` returns an open fd
for a device on the session's seat, and `PauseDevice` / `ResumeDevice` are how
it takes one back and returns it. That is what libseat wraps and what a
Wayland compositor on a tty uses. Domicile's own compositor is not a second
copy of it to borrow from: it opens no devices at all, and Smithay's session,
DRM and udev backends are deliberately outside its dependency tree
(`packages/domicile-compositor/Cargo.toml:48`). The seam belongs in the
engine, where the `open()` is.

Today's route into the compositor's seat is the chrome forwarding
`ClientRequest::Key { app_id, keycode, pressed }` over the host socket, where
`keycode` is "a Linux evdev code"
(`packages/domicile-protocol/src/lib.rs:132`), and the compositor injects it
through `inject_key` (`packages/domicile-compositor/src/main.rs:1491`, +8 for
the X keycode the keymap wants). That route lives entirely inside the engine
and the host socket: it does not care whether the engine learned the key from
`wl_keyboard` or from `/dev/input/event3`. **Input needs no new route.**

Two things do change:

- **The revoke is the same mechanism, not a second one.** Chromium has no
  `EVIOCREVOKE` call and no VT awareness, so an fd opened while the session
  was active keeps delivering after the user switches away — a keylogger
  rather than a papercut. `TakeDevice` closes it for free: logind
  `EVIOCREVOKE`s the fd itself on `PauseDevice`. Getting the fds and giving
  them up are one seam and one checklist item.
- **The keymap is stated twice.** The compositor sets its seat's `XkbConfig`;
  the engine's `XkbKeyboardLayoutEngine` is configured separately from ozone.
  Two keymaps over one keyboard is a divergence a nested run never had, because
  the host compositor owned the keymap.

## Outputs

Multi-output already exists on the compositor side and is not the problem.
`screens.rs` carries `Screens::described` (n outputs from config, with
positions and per-output scale), `Rearrangement`/`Slot::Kept` (add, remove and
restate without destroying a `wl_output` that merely resized), and
`adopt_the_desktop` (`main.rs:2191`) applies one at runtime. Hotplug is that
function called from somewhere new.

What does assume one fixed output:

| Assumption | Where |
|---|---|
| a window-following desktop has exactly one output | `main.rs:2077, 2103, 2125, 2133` — four `.expect("a window-following desktop advertises its one output")` |
| refresh is a constant | `const ADVERTISED_REFRESH_MHZ: i32 = 60_000` (`main.rs:4045`), also the frame budget at `main.rs:1672` |
| scale is an integer | `Scale::Integer(...)` at `main.rs:2135` and `main.rs:3184` |
| physical size is a fiction | `size: (300, 200)` on every output (`main.rs:3160`) — harmless nested, a wrong DPI on a real panel |
| the display list comes from the config, or from Domicile's own window | `screens.rs` has exactly two constructors, `described` and `following_the_window` |

The last row **was** the real gap and is now closed for the list itself. On a
tty the display list comes from DRM, which the **engine** owns, so the C ABI
carries a fourth event -- `displays`, an array of `DomicileDisplay` -- and
`Screens::from_the_engine` is the third constructor beside `described` and
`following_the_window`. `Screens::replugged_into` is which of the two sources
wins: a described desktop is the user stating their monitors and DRM does not
overrule it, and a nested run is never sent the event at all, because the
browser watches displays only under `--ozone-platform=drm`.

What the event does **not** carry is physical size and refresh. `display::Display`
has neither, and the `DisplaySnapshot` that does is a layer below where the
browser process reads the list from -- so `wl_output` still fabricates
`(300, 200)` and `ADVERTISED_REFRESH_MHZ`. That is the last row of the table
above and its own checklist item.

## The window has to be the size of the CRTC

**This is why the first desktop on real hardware was black, and nothing about
it was an error.** The modeset succeeded, the CRTC took `2880x1920`, and
`DrmScreen` reported it correctly. The engine's window was `1050x1900` at
`(10,10)`.

`ScreenManager::UpdateControllerToWindowMapping` pairs a window with a
controller through `FindWindowAt`, which compares
`window->bounds() == gfx::Rect(controller->origin(), controller->GetModeSize())`
-- an exact rectangle (`screen_manager.cc:1001`). No match means the window is
given no controller, every page flip is dropped before it reaches the kernel,
and the CRTC keeps the blank buffer the modeset put up. A black screen with a
clean log.

The window is Chromium's ordinary default, and
`WindowSizer::GetDefaultWindowBounds` reproduces it exactly on a 2880x1920 work
area:

| | |
|---|---|
| `default_width` | `min(2880 - 2×10, kWindowMaxDefaultWidth)` = 1050 |
| `default_height` | `1920 - 2×10` = 1900 |
| origin | `(10 + work_area.x(), 10 + work_area.y())` = (10,10) |
| the side-by-side halving | skipped: 2880/1920 = 1.5, under the 1.6 threshold |

Nothing on a tty maximises a window: there is no window manager and no session
to restore bounds from. `--window-size=2880,1920 --window-position=0,0` is read
at `browser_window_state.cc:180` and makes the two rectangles match, which is
the one-run experiment. **The flag is not the fix** -- a desktop has to fill
whatever mode the CRTC took, on every machine and across a hotplug -- so this
belongs in the fork, at the window's bounds.

That arithmetic is also the strongest evidence `DrmScreen` works: 1050 and 1900
are derivable only from a 2880x1920 work area.

### How to see a modeset

`DRM configuring:` and `Modeset succeeded.` are `VLOG(1)` in
`ui/ozone/platform/drm/gpu/screen_manager.cc:383, 405`, and
`--vmodule=drm*=1,gbm*=1,ozone*=1` prints neither -- none of those three
patterns matches `screen_manager`. Name it:

    --vmodule=screen_manager=1,drm*=1,gbm*=1,ozone*=1

A run without it says nothing either way about whether the hardware modeset,
and reading the absence of those lines as a failure costs a cycle. What a run
*can* say without it: `domicile: the displays read the same as last time` is
reachable only once a `Configure` has been confirmed, so that line is itself
proof a modeset landed.

## Key decisions

- **Patch the assert; do not fork ozone/drm.** Two incidental ChromeOS
  references and zero `IS_CHROMEOS` across 49 files is not a coupling worth
  forking over, and a fork would need rebasing at every pin bump.
- **Write the embedder; do not port `ui/display/manager`.** Domicile needs
  `DisplaySnapshot` → `DisplayConfigurationParams` → `Configure`, plus a
  `PlatformScreen` over the same snapshots. `DisplayManager`, layout stores,
  touch transforms and content protection are ChromeOS product surface.
- **The engine holds DRM master; the compositor keeps its render node.** One
  master, and the Smithay side of Domicile does not change.
- **VT handling is Domicile's, at the `TakeDisplayControl` /
  `RelinquishDisplayControl` seam.** Both are already plumbed from the host
  process to the DRM thread; only the caller is missing.
- **Prove step 1 in CI before designing step 2.** The cheapest fact available
  is whether the patched tree configures and links, and it costs one engine-job
  slot.

## What the compiler said

`.github/workflows/engine-drm-probe.yml` configures `out/DrmProbe` with
`ozone_platform_drm = true` on top of the patch series and builds `//ui/ozone`.
It is a manual-dispatch job on the engine runner, it takes the same tree lock
the release build takes, and it deletes its output directory whether it passes
or fails. It exists because the question "does the patched tree compile" has no
honest answer short of compiling it.

`gn gen` accepted the argument on the first attempt and on every attempt since.
What it found after that:

| Round | Reached | First failure |
|---|---|---|
| 1 | 9336 / 9413 compile steps | `gpu/hardware_display_plane_manager_atomic.cc:345` — `no member named 'kCtmColorManagement' in namespace 'display::features'` |
| 2 | 9373 / 9412 compile steps | `gpu/drm_thread_proxy.cc:42` — `use of undeclared identifier 'ERROR'` at `PLOG(ERROR)` |
| 3 | every compile step; failed at `SOLINK libui_ozone.so` | `mold: undefined symbol: ui::CursorController::GetInstance()`, referenced by `host/drm_cursor.cc` |

Three distinct failures in three categories, none of them a repeat, each one
further than the last:

1. **`is_chromeos`-gated symbols in `ui/display`.** `kCtmColorManagement` and
   `kDrmColorSpaceDefaultIsRec709` are declared inside a
   `#if BUILDFLAG(IS_CHROMEOS)` in `ui/display/display_features.h`. The
   namespace exists on Linux; the members do not. Four call sites, each now
   taking the branch a disabled flag would take.
2. **Include-what-you-use gaps.** `PLOG` without `base/logging.h`. Not
   ChromeOS-specific at all — upstream has simply never compiled these files
   anywhere the header was not already on the path. Seven files, found with one
   query rather than one build apiece.
3. **A ChromeOS-gated *target*.** `CursorController`, described under
   [What the assert guards](#what-the-assert-guards) — header everywhere,
   object file only on ChromeOS, so only the linker complains.

None of the three is inside the DRM platform's logic, which is what keeps step 1
a patch rather than a port. But the count is eight edits and not the five a
reading of the platform predicted, and the difference is entirely category 1 and
3: things the platform *uses* that are conditional where it is not.

**Round 4 is green.** With all eight edits, on run 34623575435:

```
drm probe: gn gen accepted ozone_platform_drm = true
drm probe: ui/ozone built with ozone_platform_drm = true

ozone_platform_drm = true configures and //ui/ozone compiles at this pin
```

So the headline of this doc is measured rather than reasoned: `gn gen` accepts
the argument, and `//ui/ozone` -- the DRM platform included -- compiles and
links with it, at this pin, with this patch. The eight edits are the whole of
what the assert was standing in front of.

What that sentence does **not** say is worth as much as what it does. It builds
`//ui/ozone`, not `chrome`. Nothing here has run a binary, opened a DRM device,
or lit a display. Step 2 is still the port
described below, and the first Open question that a build could answer is now
answered while the ones a build cannot are not.

## Plan

Step 1 — make the tree accept the argument (the patch):

All eight edits are one patch,
`packages/domicile-engine/patches/0012-domicile-let-gn-gen-accept-ozone_platform_drm-off-Ch.patch`.

It compiled nothing that shipped when it landed, and that was the point: both
`scripts/build.sh` and `.github/scripts/engine-release-build.sh` set
`ozone_auto_platforms = false` and named only wayland and headless, so
`//ui/ozone/BUILD.gn` never added `platform/drm:gbm` and
`ui/ozone/platform/drm/BUILD.gn` was not loaded at all. **That is no longer
true and the last item of step 2 is why** -- both blocks name
`ozone_platform_drm = true` now, so this patch is compiled on every engine run
rather than only by the probe. The staging was deliberate: an assert relaxed
long before anything depended on it having been.

- [x] add a patch to the series relaxing `ui/ozone/platform/drm/BUILD.gn:14` to
      `assert(is_linux || is_chromeos)` and moving `deps += [ "//ash/constants",
      "//ui/base/ime/ash" ]` under `if (is_chromeos)`
- [x] replace `ash::switches::IsRevenBranding()` in `gpu/page_flip_watchdog.cc`
      with the non-Flex threshold on non-ChromeOS, and drop the
      `Platform.FlexPageFlipFlakes2` histogram there
- [x] swap `ash::InputMethodAsh` for `InputMethodMinimal` in
      `ozone_platform_drm.cc:170-174` on non-ChromeOS, matching
      `ozone_platform_headless.cc:104-108`
- [x] remove `+ash/constants/ash_switches.h` from
      `ui/ozone/platform/drm/gpu/DEPS`
- [x] gate the `gbm_unittests` target's use of
      `ui/display/manager/test/fake_display_snapshot.h` on `is_chromeos`, or
      drop the target from the build — gated, not dropped: `//ui/ozone/BUILD.gn`
      names `platform/drm:gbm_unittests` unconditionally when the argument is
      true, so dropping it moves the `gn gen` failure rather than removing it,
      and only `gpu/drm_display_unittest.cc` and `gpu/screen_manager_unittest.cc`
      reach for the header
- [x] add a CI job that takes the `crux` tree lock, runs `gn gen out/DrmProbe
      --args='use_ozone=true ozone_auto_platforms=false
      ozone_platform_headless=true ozone_platform_drm=true'`, then `autoninja -C
      out/DrmProbe ui/ozone`, and reports the first failure verbatim. It
      contends with the guards for the single-slot engine runner, so it runs on
      demand rather than per-PR — `.github/workflows/engine-drm-probe.yml`,
      `workflow_dispatch` only and in engine.yml's `concurrency` group
- [x] record the job's verdict here and fix whatever it finds

Step 2 — the embedder (the port):

- [x] `DrmScreen : PlatformScreen` over the snapshots `DrmDisplayHostManager`
      already holds, replacing the two `NOTREACHED()`s at
      `ozone_platform_drm.cc:86-87` — patch `0013`. It came in at the size this
      section costed: six of the nine pure virtuals are the delegations the
      table above names, the conversion is three free functions, and the only
      edit to a file Chromium owns beyond the two `NOTREACHED()`s is
      `DrmWindowHostManager::HasWindow` — the non-fatal lookup beside a
      `GetWindow` that is `NOTREACHED()` on a widget it does not hold. 12 tests
      in `ozone_unittests`. Two members are stubs a unit test cannot reach:
      `GetCursorScreenPoint` (the position is in `DrmCursor`, which the screen
      is not given — it comes with input, below) and the window-present half of
      the two widget lookups, which needs a `DrmWindowHost` and so a GPU thread
      adapter. The `chrome --ozone-platform=drm` run below is what exercises
      those
- [x] the seven `NOTREACHED()`s in `DrmWindowHost`, which are what a views
      browser hits next — patch `0015`. This was costed as two,
      `GetBoundsInDIP` (reached from `WindowTreeHost::InitHost()`) and
      `SetBoundsInDIP`; a run on the build host found that answering those two
      only moves the crash to `SizeConstraintsChanged()`, reached from
      `DesktopNativeWidgetAura::InitNativeWidget()`, and that with throwaway
      bodies in **all seven** the browser process stops failing entirely. So
      all seven landed together rather than one four-hour build at a time.
      `HeadlessWindow` models every one of them.
      `scripts/test-drm-window-answers-in-dip.sh` reads the assertion out of
      the series, so it runs in the shell group without a Chromium tree
- [x] `PlatformScreen::IsScreenSaverActive` and `CalculateIdleTime` on
      `DrmScreen`. They were not fatal, only a `Not implemented reached` in
      every startup log; both are answered now, with two unit tests
- [x] a minimal modeset driver: snapshots → `DisplayConfigurationParams` →
      `DrmNativeDisplayDelegate::Configure`, and the same again on a udev
      hotplug event, without `//ui/display/manager` — patch `0016`. The
      arithmetic is a free function with six unit tests; what is left around it
      is a delegate, two asynchronous callbacks and a thread.

      **Confirmed on real hardware**, after a run that looped and a run that
      never modeset at all: one `Configure`, confirmed by the DRM thread, and
      the self-caused hotplug behind it correctly suppressed. The proof is
      `domicile: the displays read the same as last time`, which is reachable
      only with a confirmed modeset behind it — `confirmed_` is assigned in one
      place and the failure branch logs instead
- [x] **why the GL framebuffer is incomplete on this machine — measured, and it
      is the host rather than the code.** Not an embedder port, and the
      checklist around it should not be read as implying the rest of the work
      is. Past the seven methods above, the browser process
      gets as far as asking viz for a root compositor frame sink and the **GPU**
      process dies:

          [FATAL:ui/ozone/platform/drm/gpu/gbm_surface_factory.cc:356]
            DCHECK failed: thread_checker_.CalledOnValidThread().
          #7  ui::GbmSurfaceFactory::CreateCanvasForWidget()
          #8  viz::OutputSurfaceProviderImpl::CreateSoftwareOutputDeviceForPlatform()

      The DCHECK is the symptom; the line under it is the finding — `"Software
      rendering mode is not supported with GBM platform"`. **ozone/drm refuses
      software compositing by design**, and the run had fallen back to it after
      three GPU process restarts on
      `GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT` → `Unable to initialize SkSurface`
      → `Context was lost`.

      **The two selections do not both land on vkms. They land on different
      cards, and that is the whole finding.** Measured on `crux` 2026-09-14,
      read-only, no Chromium tree and no tree lock required:

      | | |
      |---|---|
      | `/proc/cmdline` | **no `nvidia_drm.modeset=1`** — and it does not matter, see below |
      | `card0` | `driver=vkms`, `crtcs=1 connectors=1 encoders=2`, `Virtual-1` **connected**, preferred 1024x768@60 |
      | `card1` | `driver=nvidia-drm`, `crtcs=4 connectors=4 encoders=6`, all four **disconnected** |
      | `/dev/dri/by-path` | `pci-0000:01:00.0-card -> card1`, `pci-0000:01:00.0-render -> renderD128`. vkms appears in neither: it has no PCI path and no render node |

      `nvidia-drm` reports four CRTCs **without** `nvidia_drm.modeset=1` on the
      command line, so the prediction above is wrong on this host: the nvidia
      card is not filtered out of `GetValidDisplayCards()`, and no reboot is
      needed to make it a candidate. (`/sys/module/nvidia_drm/parameters/modeset`
      is root-only, so whether a driver default or an initrd `modprobe.d` set it
      is unknown; the CRTC count is the answer either way.)

      `gbm_create_device()` succeeds on all three nodes, and each allocates a
      `GBM_BO_USE_RENDERING` buffer:

          /dev/dri/card0       drv=vkms         gbm=drm     render_bo=ok
          /dev/dri/card1       drv=nvidia-drm   gbm=nvidia  render_bo=ok
          /dev/dri/renderD128  drv=nvidia-drm   gbm=nvidia  render_bo=ok

      `eglQueryDevicesEXT`, which is exactly what `GetPreferredEGLDevice()`
      enumerates:

          EGL devices: 3
            [0] drm_device=/dev/dri/card1   render_node=/dev/dri/renderD128
            [1] drm_device=/dev/dri/card1   render_node=/dev/dri/renderD128
            [2] drm_device=(none)           render_node=(none)

      **vkms is not in that list.** It has no render node, so it never becomes
      a DRM-backed EGL device, and `GetPreferredEGLDevice()` skips entries with
      no `EGL_DRM_DEVICE_FILE_EXT` as "Not a DRM device". Its `devices[0]`
      fallback therefore lands on **nvidia**, while
      `GetPrimaryDisplayCardPath()`'s `cards[0]` fallback lands on **vkms**:

      | selection | code | lands on |
      |---|---|---|
      | scanout card | `drm_display_host_manager.cc:260`, sent to the GPU process by `GpuAddGraphicsDevice` | `card0`, vkms |
      | render device | `gbm_surface_factory.cc:74`, via `EGL_PLATFORM_DEVICE_EXT` | `card1`, nvidia |

      So the GPU process is handed a scanout device that cannot render and a
      render device that is not the scanout device. That is the incomplete
      framebuffer.

      **And making them agree is not available on this host either.** EGL on
      each card's own GBM device, with no Chromium involved:

          == /dev/dri/card0 ==              == /dev/dri/card1 ==
            gbm backend : drm                 gbm backend : nvidia
            eglInitialize : ok 1.5            eglInitialize : ok 1.5
            EGL_VENDOR : Mesa Project         EGL_VENDOR : NVIDIA
            eglChooseConfig : 1 config        eglChooseConfig : 1 config
            eglCreatePlatformWindowSurface:   GL_RENDERER : NVIDIA GeForce GTX 970
              FAILED 0x3009 EGL_BAD_MATCH     glClear + eglSwapBuffers : ok

      vkms takes a GBM device and an EGL display and then refuses a window
      surface, with or without `GBM_BO_USE_SCANOUT`. nvidia renders a frame and
      swaps it — it wants `GBM_BO_USE_SCANOUT` present, and returns
      `0x3003 EGL_BAD_ALLOC` without it.

      ### What "no patch applicable" means, precisely

      Three things it does **not** mean:

      - *Not* "this host cannot render on any node". `renderD128` renders: an
        ES2 context, a `glClear` and a successful `eglSwapBuffers`.
      - *Not* "the fork should choose its render device separately from its
        scanout card". **It already does**, by accident of the two fallbacks —
        and that separation is what fails. The seam exists; it is pointed at two
        cards that cannot cooperate.
      - *Not* "adding `nvidia-drm` to `GetPreferredDrmDrivers()` would fix it".
        That makes both selections agree on nvidia, which renders and has
        nothing plugged in. Nothing lights.

      What it does mean: the only configuration that would put a frame on the
      connected connector is **render on `card1`, scan out on `card0`** — a
      buffer rendered on one device imported for scanout on another. That is
      cross-device PRIME, it is a capability rather than a selection, and
      ozone/drm does not have it. It would be a large piece of work whose only
      beneficiary is a machine shaped like this one.

      ### Which findings are about ozone/drm, and which are about `crux`

      **About ozone/drm, and true anywhere:** one list (`GetPreferredDrmDrivers()`)
      answers two different questions, and upstream can conflate them because on
      ChromeOS the rendering device and the scanout device are the same card. On
      any host where they are not, the two fallbacks diverge silently and the
      failure surfaces four layers away as an incomplete framebuffer. That is
      worth knowing regardless of `crux`.

      **About `crux`, and not a property of the fork:** this machine has no card
      that both renders and has a display. A host with one ordinary GPU with a
      monitor on it would exercise none of the above — both selections would
      land on that card and agree.

      ### What would actually get a lit screen

      In rough order of cost, for whoever picks this up:

      - **Plug a monitor into `card1`.** A dummy HDMI/DP EDID plug is enough and
        costs a few pounds. Both selections then land on nvidia and agree, and
        `A-DESKTOP-ON-A-TTY` gets its first lit CRTC with no code at all. This is
        the cheapest answer and it is hardware, not software.
      - **Force a connector on `card1`.** `video=DP-1:1024x768e` on the kernel
        command line, or `drm_kms_helper.edid_firmware=`. Free, but needs a
        reboot, and nvidia-drm's support for those parameters should be checked
        before spending one — they are best documented for the in-tree drivers.
      - **A different machine**, with one GPU that both renders and has a
        display, which is what any ordinary desktop is.
      - **Cross-device PRIME in ozone/drm**, described above. Large, and only
        worth it if a split-device host is a target rather than an accident.

      `nvidia_drm.modeset=1` is **not** on this list: it is already effectively
      on, and setting it explicitly changes nothing measured here.

- [x] VT handling: watch the VT, call `RelinquishDisplayControl` on switch away
      and `TakeDisplayControl` on switch back — patch `0017`. `VT_SETMODE` in
      `VT_PROCESS` mode, a signal per edge, and the handshake
      `console_ioctl(2)` documents. The order is the whole of it and it is a
      free function with eleven tests: a relinquish that FAILS refuses the
      switch, because acknowledging one we could not release for hands the
      console to the kernel while Chromium is still scanning out on it.

      **It is not a recovery mechanism**, and the checklist should not be read
      as if it were. The handshake runs in the browser process, so an engine
      wedged in a GPU wait never answers `relsig` and the kernel refuses the
      switch; an engine that *dies* needs none of this, because the kernel
      drops master when the fd closes and switches anyway. What this buys is a
      working desktop you can switch away from.

      **It does not work on the machine it was written for**, and the switcher
      is not what is wrong: every `Ctrl+Alt+F<n>` was refused, correctly,
      behind `RelinquishDisplayControlDrm drop master failed`. See the open
      question below — the drop may be in the wrong process
- [ ] the window fills the CRTC, so that `FindWindowAt` matches it to a
      controller and page flips reach the kernel. Chromium's default window is
      1050x1900 at (10,10) on a 2880x1920 panel and an exact rectangle is what
      the mapping wants, so nothing is scanned out. See
      [The window has to be the size of the CRTC](#the-window-has-to-be-the-size-of-the-crtc).
      **This is what stands between here and a desktop on a screen**, and
      `--window-size`/`--window-position` is the experiment rather than the fix
- [ ] take the evdev fds from logind's `Session.TakeDevice` instead of
      `open()`ing them, and follow `PauseDevice` / `ResumeDevice` — which is
      the `EVIOCREVOKE` at those same two moments, because logind does it to
      the fd it passed. One item rather than two: on an ordinary desktop the
      bare `open` is `Permission denied` and there is nothing to revoke yet.
      See [Input](#input)
- [x] name `ozone_platform_drm = true` in `scripts/build.sh` and
      `engine-release-build.sh` — after `DrmScreen` and the modeset driver,
      because a platform with no embedder behind it turns a clear refusal into
      a crash. Both of those landed first, in that order, and then this did.

      The safety argument is that the default platform does not move, and it is
      read out of the pin rather than assumed: `ozone_platform` is unset in
      both blocks, `generate_ozone_platform_list.py` reorders only when
      `--default` names a platform that is in the list, so the order is
      `//ui/ozone/BUILD.gn`'s own -- headless, then drm, then wayland. Headless
      stays first and stays the default, so nothing that ran yesterday gets a
      different platform today. `scripts/test-the-builds-agree-on-ozone.sh`
      holds both halves of that: the two blocks name the same three platforms,
      and neither sets `ozone_platform`, because setting it to `"drm"` looks
      like a one-word tidy-up and would flip the default on every machine
      including the ones with no card node
- [ ] a `drm` arm in `domicile-launch`'s `platform()`, so a machine with no
      `WAYLAND_DISPLAY` gets a tty rather than `PlatformError::NoDisplayServer`.
      Auto-detection only, and last: `OZONE=drm` already overrides outright, so
      nothing is blocked on this
- [x] a display-list event on the engine C ABI, and `Screens::from_the_engine`
      beside `described` and `following_the_window` -- `DisplayListObserver` on
      `mojom::FrameSinkBroker`, fed in the browser process by a
      `display::DisplayObserver` over the screen ozone built, which on this
      platform is `DrmScreen` reading the same snapshots the modeset driver
      configures from. Registered ONLY under `--ozone-platform=drm`: a nested
      engine's screen is the host's monitors, and a producer told about those
      would take its desktop away from the window that defines it
- [x] drive `adopt_the_desktop` from that event, so a hotplug rearranges rather
      than restarts -- `Screens::rearranged_into` matches on the `wl_output`
      name and the name is `drm-<display id>`, which ozone derives from the
      EDID, so a monitor unplugged and plugged back in keeps the output its
      clients are on rather than being handed a new one
- [ ] real physical size and refresh on `wl_output`, from the snapshot rather
      than `(300, 200)` and `ADVERTISED_REFRESH_MHZ`

## Open questions

- **Does the patched tree actually compile and link?** **Answered: yes**, by
  `.github/workflows/engine-drm-probe.yml` run 34623575435 — `gn gen` accepts
  `ozone_platform_drm = true` and `//ui/ozone` builds and links with it. The
  question was right to be here and right to be first: it took four rounds, and
  three of the eight edits in the patch exist only because a compiler and then a
  linker said so. The `is_chromeos`-conditional header this question predicted
  turned out to be an `is_chromeos`-conditional *source file* --
  `ui/events/ozone/BUILD.gn:44` — which ships its header on every platform, so
  it defeated the grep and the compiler both and surfaced only at the link.
- **Does the engine's `chrome` target start at all under ozone/drm with no
  ash?** **Answered: further than expected, and not all the way.** With
  `DrmScreen` in and the static-initializer edit above, `chrome
  --ozone-platform=drm` clears `PreSandboxStartup`, clears `CreateScreen()` and
  `InitScreen()`, and reaches `Browser::Create()` — then dies about twenty
  frames deeper:

  ```
  FATAL:ui/ozone/platform/drm/host/drm_window_host.cc:99] NOTREACHED hit.
  #7  ui::DrmWindowHost::GetBoundsInDIP()
  #8  views::DesktopWindowTreeHostPlatform::CalculateRootWindowBounds()
  #9  aura::WindowTreeHost::InitHost()
  #12 BrowserDesktopWindowTreeHostLinux::Init()
  ```

  The audit predicted display state it had not traced and that is exactly what
  this is — the same shape as `CreateScreen()`, one layer out: `GetBoundsInDIP`
  and `SetBoundsInDIP` are both `NOTREACHED()` on the grounds that DRM has no
  scaling and should use pixel bounds, which holds on ChromeOS, where ash never
  routes a window through `DesktopWindowTreeHostPlatform`. A views browser on
  Linux does, during `InitHost()`. `HeadlessWindow::GetBoundsInDIP` is the
  model, as `HeadlessScreen` was for the screen.

  **This run wants repeating before it is treated as measured.** It was built
  without taking `.github/scripts/engine-tree-lock.sh`, and CI reset the
  checkout twice inside the build window (15:50 and 16:36 on 2026-09-13), which
  is the mixture-of-two-trees case that lock exists to prevent. Both findings
  are independently readable in the source -- `drm_util.h`'s constants do call
  `IsEnabled()` at the pin, and `drm_window_host.cc:99` is `NOTREACHED()` at the
  pin -- so neither is an artifact. The binary that produced the trace may be.

  Measured on `crux`, whose `/dev/dri/card0` is **vkms** (`Virtual-1`
  `connected`, preferred 1024x768@60, GBM up and a scanout bo allocated on it);
  `card1` is the nvidia GPU with four disconnected connectors. A vkms CRTC
  presents to nobody, so what this can answer is whether the path executes, not
  whether a desktop appears.
- **libseat/seatd, logind ACLs, or root.** **Answered by the first run on
  real hardware, and not the way this recommended.** ACLs carry the card node
  and nothing else — `70-uaccess.rules` tags `drm card*` and `renderD*` — so
  the card opened and modeset while all fifteen `/dev/input/event*` came back
  `Permission denied (13)`. There is no ACL to ship on for input.
  *Decision:* the fd-passing seam, in front of `InputDeviceOpenerEvdev`, fed
  by logind's `TakeDevice` — directly or through libseat. Putting the user in
  the devices' group (`input`, conventionally) would also make the bare
  `open` work, and is rejected twice over: it is a standing keyboard grant to
  every process that user runs, and it revokes nothing on a VT switch.
- **Can the GPU process drop DRM master?** **Measured: not on this machine.**
  Every `Ctrl+Alt+F<n>` was refused behind
  `RelinquishDisplayControlDrm drop master failed for: .../card1`
  (`drm_gpu_display_manager.cc:438`). The VT switcher is doing its job — it
  will not acknowledge a switch it could not release for — so what is broken is
  under it. *Hypothesis, not measured:* the kernel's `drm_master_check_perm`
  keys on the pid that **opened** the fd. The browser opens the card and
  becomes master implicitly, which is why no `SetMaster` is ever called and why
  everything else works; the **GPU** process is the one calling `DropMaster`,
  and it is sandboxed without `CAP_SYS_ADMIN`. *Recommendation:* test
  `drmDropMaster` on a passed fd before writing anything. If that is the
  reason, the drop belongs in the process that opened the card and patch
  `0017`'s seam is one process out.
- **Fractional scale.** `wl_output` scale is `Scale::Integer` here and DRM
  panels routinely want 1.5. *Recommendation:* stay integer — `ROADMAP.md`'s
  existing "fractional scaling rounds up" gap is the same decision, and it
  should stay one decision.
