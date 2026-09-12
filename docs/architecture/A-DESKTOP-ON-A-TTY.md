# A desktop on a tty

**Getting `gn gen` to accept `ozone_platform_drm = true` is a patch: eight
edits, and not one of them is inside the DRM platform's own logic.**
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
| revoke input on VT-away | — | does not exist (see [Input](#input)) |

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
(`ui/events/ozone/evdev/input_device_opener_evdev.cc:114`) — again, an active
logind session's ACLs suffice, and again there is no seat interface.

Today's route into the compositor's seat is the chrome forwarding
`ClientRequest::Key { app_id, keycode, pressed }` over the host socket, where
`keycode` is "a Linux evdev code"
(`packages/domicile-protocol/src/lib.rs:132`), and the compositor injects it
through `inject_key` (`packages/domicile-compositor/src/main.rs:1491`, +8 for
the X keycode the keymap wants). That route lives entirely inside the engine
and the host socket: it does not care whether the engine learned the key from
`wl_keyboard` or from `/dev/input/event3`. **Input needs no new route.**

Two things do change:

- **Nothing revokes the keyboard on a VT switch.** Chromium has no
  `EVIOCREVOKE` call and no VT awareness; an fd opened while the session was
  active keeps delivering after the user switches away. On a tty that is a
  keylogger, not a papercut.
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

The last row is the real gap. On a tty the display list comes from DRM, which
the **engine** owns, and the engine's C ABI has no event for it: `engine::Event`
is `Configure` / `Frame` / `Released`
(`packages/domicile-compositor/src/engine.rs:130`). A tty desktop needs a third
source of `Screens` and a new ABI event to feed it, carrying mode, physical
size, refresh and hotplug off the `DisplaySnapshot`s the engine already has.

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
`//ui/ozone`, not `chrome`, and `crux` has no card node. Nothing here has run a
binary, opened a DRM device, or lit a display. Step 2 is still the port
described below, and the first Open question that a build could answer is now
answered while the ones a build cannot are not.

## Plan

Step 1 — make the tree accept the argument (the patch):

All eight edits are one patch,
`packages/domicile-engine/patches/0012-domicile-let-gn-gen-accept-ozone_platform_drm-off-Ch.patch`,
and it compiles nothing that ships: `scripts/build.sh` and
`.github/scripts/engine-release-build.sh` both set `ozone_auto_platforms =
false` and name only wayland and headless, so `//ui/ozone/BUILD.gn` never adds
`platform/drm:gbm` and `ui/ozone/platform/drm/BUILD.gn` is not loaded at all.

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

- [ ] `DrmScreen : PlatformScreen` over the snapshots `DrmDisplayHostManager`
      already holds, replacing the two `NOTREACHED()`s at
      `ozone_platform_drm.cc:86-87`
- [ ] a minimal modeset driver: snapshots → `DisplayConfigurationParams` →
      `DrmNativeDisplayDelegate::Configure`, and the same again on a udev
      hotplug event, without `//ui/display/manager`
- [ ] VT handling: watch the VT, call `RelinquishDisplayControl` on switch away
      and `TakeDisplayControl` on switch back
- [ ] `EVIOCREVOKE` (or a libseat-shaped equivalent) on the evdev fds at those
      same two moments
- [ ] a `drm` arm in `domicile-launch`'s `platform()`, replacing the refusal
      `PlatformError::NoDisplayServer` gives today
- [ ] a display-list event on the engine C ABI, and `Screens::from_the_engine`
      beside `described` and `following_the_window`
- [ ] drive `adopt_the_desktop` from that event, so a hotplug rearranges rather
      than restarts
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
  ash?** Beyond `CreateScreen()`, browser startup touches display state in
  places this audit did not trace. *Recommendation:* the same job cannot answer
  this — `crux` has no card node — so it belongs in `ROADMAP.md`'s "Needs a
  machine with a screen", phrased as one run of the built binary with
  `--ozone-platform=drm`.
- **How wide `DrmScreen` has to be.** `display::Screen` is a broad interface
  and neither `WaylandScreen` nor `X11Screen` is small. *Recommendation:* cost
  it by reading `ui/ozone/platform/wayland/host/wayland_screen.h` when step 2
  starts; do not put a number of weeks on step 2 before that.
- **libseat/seatd, logind ACLs, or root.** ACLs on an active VT make the
  unmodified `open()` calls work and need no code; libseat would need an
  fd-passing seam ozone does not have. *Recommendation:* ship on logind ACLs,
  and revisit only if multi-seat or a non-logind system asks.
- **Fractional scale.** `wl_output` scale is `Scale::Integer` here and DRM
  panels routinely want 1.5. *Recommendation:* stay integer — `ROADMAP.md`'s
  existing "fractional scaling rounds up" gap is the same decision, and it
  should stay one decision.
