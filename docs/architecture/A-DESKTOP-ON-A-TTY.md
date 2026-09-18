# A desktop on a tty

**A desktop comes up on a bare console.** On a tty `domicile` starts the engine
under `--ozone-platform=drm`, takes DRM master as the card arrives, modesets the
panel at its native mode, fills that mode exactly, takes every keyboard and
pointer from logind, and asks logind for a console switch on `Ctrl+Alt+F<n>`.

Two pieces of work got it there and the distinction is still the useful one.
Letting `gn gen` accept `ozone_platform_drm = true` is a **patch**: nine edits,
eight of them around the DRM platform rather than inside it. Getting a lit
screen out of it is a **port**, of the *embedder* ozone/drm has never had off
ChromeOS. Neither is a fork of ozone/drm: at
`bbbfd22b56d9df22e578e9faf55b286714b7303c` the 49 `.cc` files in
`//ui/ozone/platform/drm:gbm` contain **two** references to ChromeOS between
them and **zero** `BUILDFLAG(IS_CHROMEOS)`.

Every Chromium citation below is read at the pin in
`packages/domicile-engine/CHROMIUM_PIN`; the rest are read in systemd's sources
or the kernel's.

## What stands, and on what evidence

Four kinds of standing, and they are not interchangeable. A thing reasoned from
source has been wrong here before — the audit predicted that logind's ACLs
covered a keyboard, and the first run on hardware said otherwise.

| Claim | Standing |
|---|---|
| `gn gen` accepts the argument and `//ui/ozone` compiles and links with it | **CI.** `.github/workflows/engine-drm-probe.yml`, run 34623575435 |
| A connected panel modesets at its native mode | **Hardware.** 2880x1920@120, one `Configure`, confirmed by the DRM thread, and the self-caused hotplug behind it suppressed |
| The screen lights at startup rather than after a VT round trip | **Hardware**, on `engine-9dd6e30`. Four runs before it drew nothing until the user had been to another console and back |
| The desktop fills the CRTC and stays filling it | **Hardware for the failure**, which is a black screen with a clean log: a run reported a desktop of 2880x1920 and, 1.37 s later, one of 1050x1900. Patches `0018` and `0023` |
| Keys reach the shell with the layout the config names | **Hardware.** Every tty run logged `No current XKB state` before every press — which is a press that arrived, through descriptors logind handed over. Patch `0024` |
| A device logind force-pauses comes back | **Reasoned from source, not yet run.** Landed as #381 and #384 the same night; `DrmInputDevicesTest` (19 cases) and `scripts/test-input-comes-from-logind.sh` are what stand behind it |
| `Ctrl+Alt+F<n>` reaches `Seat.SwitchTo` | **Reasoned from source since the fix.** The chord decoded on hardware and the call died on `/org/freedesktop/login1/seat/self`; reading the session's own `Seat` instead has not been run |
| The display is dropped on the way out of the console and retaken on the way back | **Reasoned from source.** `DrmVtSwitcherTest` holds the ordering; no run has switched away and back |
| A stop asked for during startup is a stop | **Unit tests.** `domicile-launch`'s milestone tests. It matters here and nowhere else — see [What a tty costs on the way out](#what-a-tty-costs-on-the-way-out) |

The one substantive item still open is [taking the card node from
logind](#the-card-should-come-from-logind-too).

## What the assert guards

`ROADMAP.md` used to put a tty desktop behind `ui/ozone/platform/drm/BUILD.gn`
line 14:

```gn
assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")
```

with `ui/ozone/BUILD.gn:43` making `platform/drm:gbm` a dependency of
`//ui/ozone` the moment the argument is true, so `gn gen` refused before
anything compiled. What the assert guards is nothing in the platform. `git grep`
over `ui/ozone/platform/drm` at the pin:

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
linker. It cost three probe rounds to reach, and it is the reason the last edit
in the patch exists.

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
`ui/display/screen.h`, `ui/display/display_features.h` and `ui/display/util/*`
— all in ungated targets. The only `ui/display/manager/` include anywhere in
the platform is `manager/test/fake_display_snapshot.h`, and only the
`gbm_unittests` target reaches it.

### The assert is conservative about the platform and honest about the embedder

What the DRM platform genuinely cannot do alone is two things ash does for it,
and both are outside the assert's reach.

**1. It had no `PlatformScreen`.**

```cpp
// ui/ozone/platform/drm/ozone_platform_drm.cc:86
std::unique_ptr<PlatformScreen> CreateScreen() override { NOTREACHED(); }
void InitScreen(PlatformScreen* screen) override { NOTREACHED(); }
```

On ChromeOS `ash` installs `display::Screen` itself and never asks. A views
browser on Linux goes `views::DesktopScreenOzone` → `aura::ScreenOzone` →
`OzonePlatform::CreateScreen()` (`ui/aura/screen_ozone.cc:25`) and hit that
`NOTREACHED()` on the way up. **This is the single strongest piece of evidence
that the embedder is a port rather than a patch**: the gap is deliberate,
marked by the `NOTREACHED()`, and nothing in the tree filled it for a non-ash
embedder.

**2. Nothing modeset.**

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

## The embedder

**Two files and no port of `ui/display/manager`.** What is ChromeOS-only is the
*caller*; every seam it calls is ungated and already implemented by the DRM
platform. Both came in at the size a reading of the platform predicted.

### `DrmScreen`

`PlatformScreen` has **nine** pure virtuals (`ui/ozone/public/platform_screen.h`)
and seven more with defaults. `HeadlessScreen` — 63 + 243 lines — was the
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
  `GetDisplayForAcceleratedWidget` cannot pass one through unchecked. Patch
  `0013`'s one edit to a file Chromium owns beyond the two `NOTREACHED()`s is
  `DrmWindowHostManager::HasWindow`, the non-fatal lookup beside it.

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
`GetDisplays`' result — `ModesetParamsFromSnapshots`, a free function with its
own tests, and a delegate, two asynchronous callbacks and a thread around it.

**What `ui/display/manager` holds that Domicile skips** is
`DisplayChangeObserver` — 478 lines converting snapshots into
`ManagedDisplayInfo`, which is ChromeOS product surface. Domicile wants
`DisplaySnapshot` → `display::Display` directly.

### Two answers that look the same and are not

Two failure modes of one guard, a run on hardware apiece to find.

**A modeset asked for twice is a screen that never settles.** Every `Configure`
makes the kernel emit a udev CHANGE for the card, which the browser turns into
`OnConfigurationChanged`, which reads the displays and configures them again.
The first run on hardware modeset on a loop, seconds apart, in the mode it was
already in. The rule that breaks it: the params come from the hardware's own
report, so an unchanged report cannot produce a different answer
(`ModesetWouldChangeAnything`). A real hotplug changes the report and always
gets through.

**A modeset the browser answered itself is not a confirmation.** The comparison
above is against what the hardware last *confirmed*, and for a while that
included an answer no hardware saw. `DrmModeset::Start()` runs at
`OzonePlatformDrm::InitScreen` time, before a GPU process exists, so
`DrmDisplayHostManager::UpdateDisplays` finds `proxy_->GpuRefreshNativeDisplays()`
false and answers synchronously out of the **dummy** snapshots its own
constructor built; `DrmDisplayHostManager::ConfigureDisplays` reads `is_dummy()`
and runs the callback with `true` without leaving the process. On the machine
this was found on the yes arrived three microseconds after the ask.

What tells the two apart is the shape of the answer rather than its value: a
real modeset is committed on the DRM thread and answered on a later task, so
anything that answers before `Configure` has returned is by construction this
process. That is `inside_configure_`, and it is logged and not recorded. Left
in, a single-card machine whose dummy reading matches its real one would read
its first real reading as a repeat and **never modeset at all**.

### The physical size is in the snapshot, and it leaves as a DPI

`DisplaySnapshot::physical_size()` is millimeters, which is exactly what
`wl_output` wants, and `DrmScreen`'s `DisplayPhysicalSizeMm` is where it is
read. Getting it out of ozone is the awkward part, and the reason is one
missing field.

**`display::Display` is the whole of what the browser process learns about a
snapshot.** The display-list event under [Outputs](#outputs) is built from
`display::Screen::Get()->GetAllDisplays()`, which on this platform is
`DrmScreen`'s own list; the `DisplaySnapshot` behind it lives in
`//ui/ozone/platform/drm`, where `//content` cannot see it and where no
dependency may point. So whatever is not set on a `display::Display` in
`DisplayFromSnapshot` does not exist anywhere the compositor can be told it
from.

`display::Display` has a refresh rate — `set_display_frequency`, in Hz, which is
what every other platform's screen reports a mode with. It has **no physical
size**: the field that does is on `ManagedDisplayInfo`, which is
`//ui/display/manager` and not ported. What it has instead is
`set_pixels_per_inch`, per axis, whose value *is* the panel's size expressed as
a density — so the millimeters cross as one and
`components/domicile/browser/display_list.cc` divides them back out by the same
`display::kInchInMm`. Both ends assert the same panel, so the pair cannot drift
apart silently.

**The one place this could go stale is closed by the id.**
`DisplayList::UpdateDisplay` copies a fixed set of fields and neither of these
two is in it, so a display the list already holds keeps the density and the rate
it was *added* with. That is safe for the same reason the output name is:
`display_id()` comes off the EDID, so an id the list already holds is the same
panel — and a panel's millimeters and its native mode are precisely the two
things about it that cannot change while it stays plugged in. What does change
on a hotplug is the origin, and `bounds` *is* copied.

## The session, the console and DRM master

**There is no session abstraction in ozone to plug into.** ozone/drm opens the
card node itself, from the browser process, with a bare `open`:

```cpp
// ui/ozone/platform/drm/host/drm_display_host_manager.cc:116
int fd = HANDLE_EINTR(open(dev_path.value().c_str(), O_RDWR | O_CLOEXEC));
```

and hands the fd to the GPU process over mojo (`mojom/drm_device.mojom:48`,
`AddGraphicsDevice(path, handle<platform>)`). `GetPrimaryDisplayCardPath()`
walks `/dev/dri/card%d` and `LOG(FATAL)`s if none opens
(`drm_display_host_manager.cc:246`, and again in the constructor at `:273`). The
open path then loops on `drmGetMagic`/`drmAuthMagic` **forever**, 100 ms at a
time, until it authenticates — which is how it waits out frecon on ChromeOS, and
which on a tty means "something else already holds master" presents as a hang
rather than an error.

`ui/ozone/public/platform_session_manager.h` is not this: it is
xdg-session-management window restore. There is no logind, no libseat, no D-Bus
and no fd-passing seat interface anywhere in ozone.

Master itself is `DrmWrapper::SetMaster` / `DropMaster`
(`common/drm_wrapper.cc:204, 211`), driven only from
`DrmGpuDisplayManager::TakeDisplayControl` / `RelinquishDisplayControl`
(`gpu/drm_gpu_display_manager.cc:407, 437`), whose only caller is
`DisplayConfigurator::TakeControl` / `RelinquishControl`
(`ui/display/manager/display_configurator.cc:608, 650`) — the ChromeOS-only
target again.

What a normal Linux tty has to supply, and where each half now is:

| Need | Who supplied it | Where it is now |
|---|---|---|
| open `/dev/dri/card0` | `open()` in the browser process | unchanged. A logind session on an active VT gives the session user an ACL on the card node, so the bare `open` works unprivileged. Root also works. This is the one place a tty desktop still leans on an ACL |
| become DRM master | implicit: the first opener of an unused card is master | `DrmMaster::Add`, as a card arrives |
| drop master on VT-away, retake on VT-back | `DisplayConfigurator`, on a ChromeOS signal | `DrmVtSwitcher`, driven by the logind session's `Active` property. `TakeDisplayControl` / `RelinquishDisplayControl` were already plumbed to the DRM thread; what was missing was a caller |
| start a VT switch | the kernel, on `Ctrl+Alt+F<n>` | the desktop, by `Seat.SwitchTo(u)`. The kernel's own chord handling is off from the moment input is taken — see below |
| open `/dev/input/event*` | `Session.TakeDevice(major, minor)` on the evdev thread | `DrmLogindInput`. The bare `open()` is `Permission denied` (see [Input](#input)) |
| revoke input on VT-away | logind, on `PauseDevice` | the same seam: logind `EVIOCREVOKE`s the fd it passed |

**Domicile needs exactly one DRM master, and it is the engine.** The compositor
never touches a card node: `dmabuf_import.rs`'s `headless_renderer` brings up
GLES on whatever render node EGL offers, because it composites nothing — a
client's dmabuf goes to the engine. So ozone/drm in the engine holds master and
the Smithay side is unaffected.

### Nothing in this fork ever asked the kernel for master

That is why four tty runs drew nothing at startup and then drew everything the
moment the user visited another console and came back. The GPU process said so:
`DRM_IOCTL_MODE_ATOMIC` is a `DRM_MASTER` ioctl and `drm_ioctl_permit` answers
`EACCES` to anyone who is not the current master, so
`hardware_display_plane_manager_atomic.cc` failed to commit for the modeset.

**Both processes assert ownership neither asked for.** The browser's `open`
takes master only if the card was free (`drm_master_open` → `drm_new_set_master`)
and no caller checks; `DrmWrapper::has_master_` is initialized `true` and
`DrmDisplayHostManager::display_externally_controlled_` `false`, which is
`TakeDisplayControl`'s own early-out for "already owned". On ChromeOS ash closes
that with `DisplayConfigurator::TakeControl` at startup, and off ChromeOS there
is no `DisplayConfigurator` at all — so the only `drmSetMaster` in the tree sat
behind `DrmVtSwitcher`'s take arm, reachable only from `kBackground` or
`kForegroundWithoutDisplay`. Startup begins in `kForeground` with the session
active, so the first `drmSetMaster` a desktop ever ran was the one a trip to
another console and back asked for.

`DrmMaster::Add` takes it as a card arrives, which is where the browser hands
the card to the GPU process: after the `open` and before anything can commit on
it. `DrmModeset::Start` is earlier and holds no card to ask about. The ask is
idempotent — the kernel answers 0 for a file that is already the current master
— so a machine whose `open` did take master pays one ioctl and no behaviour.

**A card that arrives on somebody else's console is recorded and not taken**, or
a display plugged in during a VT switch would be mastered by a desktop nobody
can see. The take on the way back asks for every card held, that one included.

### Only the process that opened the card may drop master

Not a machine, a sandbox or a permission bit. The kernel forbids it by
construction, and the five lines of source that say so are the whole answer:

1. The **browser** process opens the card (`drm_display_host_manager.cc:116`,
   reached from `:202`).
2. Nothing else holds master on a bare tty, so that open takes it, and
   `drm_set_master` sets `fpriv->was_master = true`
   (`drivers/gpu/drm/drm_auth.c:151-159`).
3. `drm_file_update_pid` **refreshes the recorded pid on every ioctl except for
   a file that was ever master** (`drivers/gpu/drm/drm_file.c:452-463`, and the
   comment there says it is deliberately so that `drm_master_check_perm` keeps
   working). The pid on this fd is frozen as the browser's, permanently.
4. The fd is then **moved** to the GPU process —
   `DrmWrapper::ToScopedFD(std::move(...))` (`drm_wrapper.cc:524`) at
   `drm_display_host_manager.cc:492` and `:538`. `SCM_RIGHTS` shares the
   `struct drm_file`; it does not make a new one, so the frozen pid travels with
   it.
5. `drm_dropmaster_ioctl` calls `drm_master_check_perm`
   (`drivers/gpu/drm/drm_auth.c:233-243`), which passes only if
   `was_master && pid == task_tgid(current)` — false in the GPU process — and
   otherwise demands `CAP_SYS_ADMIN`, which a renderer-adjacent process does not
   have. `-EACCES`.

No probe is needed and none should be written: a `drmDropMaster` test on a
passed fd would measure `capable(CAP_SYS_ADMIN)`, which is already known.
`drmSetMaster` is the same story — it runs the same check *before* its
already-master early-out, so leaving it in the GPU process and hoping it no-ops
does not work either.

So `DrmMaster` keeps a `dup` of every card the browser hands over, keyed by the
sysfs path a removal carries, and both ioctls run there. A `dup` shares the one
`struct drm_file`, so the drop takes effect for the GPU's copy as well and the
caller's tgid is the recorded one.

**The ordering carries a decision.** A relinquish is GPU-first:
`DrmGpuDisplayManager::RelinquishDisplayControl` detaches planes while this
process still holds master, and only then does `GpuRelinquishedDisplayControl`
drop. A take is the mirror — master first, and the GPU is not asked at all if it
failed. A drop that fails fails the whole relinquish even when the GPU half
succeeded, so that the switcher records a display it does not have and asks for
it again on the way back rather than believing a drop that did not happen.

**The syscall moves; the GPU's `has_master()` stays honest**, and the difference
between those two is a live GPU process. `DrmWindow::SchedulePageFlip` reads
that flag to decide whether a frame is worth committing. Left saying yes while
the console belongs to somebody else it commits one; the atomic plane manager
has no `EACCES` exemption (the legacy one does, atomic is what a modern driver
uses), so the commit fails, arms `PageFlipWatchdog`, and its 15 s timer is
`LOG(FATAL) << "Failed to modeset ... Crashing GPU process."` Only a modeset
disarms it and nothing modesets on the way back. So the two loops call
`DrmWrapper::AssumeMaster` instead: the flag without the ioctl, because the
transition is decided in another process.

### logind owns the console, and the desktop asks it for a switch

`Session.TakeControl` is not optional — no ACL covers a keyboard — and taking it
runs logind's `session_prepare_vt`, which sets `KDSKBMODE K_OFF`,
`KDSETMODE KD_GRAPHICS` and `VT_SETMODE VT_PROCESS` on the session's VT. Two
things follow, and an earlier design — `VT_SETMODE` in `VT_PROCESS` mode with a
signal per edge — had neither right.

**`K_OFF` is the kernel's own `Ctrl+Alt+F<n>`, off.** From the moment the
desktop takes its input, the only process that can start a console switch is the
desktop — which is why every Wayland compositor binds the chord itself. Nothing
here did, so on real hardware the chord did nothing at all while the log said
`VT switching is on`.

**A second `VT_SETMODE` is a theft, not a conflict.** The kernel overwrites
`vt_mode` and `vt_pid` with no `EBUSY`, so a handshake installed here silently
took logind's: logind never got its release signal, never paused the devices it
had lent the session, and never handed the console over. A refused switch and a
stolen one look identical from inside the desktop, which is why this survived a
round of debugging aimed at the wrong half.

So there are zero VT ioctls in the fork — `scripts/test-logind-owns-the-console.sh`
counts them in `src/` and nets them out across the series — and the shape is
`Seat.SwitchTo(u)` outward, the session's `Active` property inward. `Active`
drives `RelinquishDisplayControl` and `TakeDisplayControl` through
`DrmVtSwitcher`, whose ordering table is a free function with tests because
`Active` can flip twice before the display delegate answers once.

The chord is read in `PlatformEventObserver::WillProcessEvent` on
`EventFactoryEvdev`, because the browser is the only process holding a keyboard
descriptor: the compositor advertises a `wl_seat` to its clients and pulls
neither libinput nor a session backend.

**`seat/self` is a lookup, not a name, and it fails on a real tty.**
`Seat.SwitchTo` was sent to `/org/freedesktop/login1/seat/self` and logind
answered `UnknownObject`. `seat_object_find` hands everything after
`/org/freedesktop/login1/seat/` to `manager_get_seat_from_creds`, which for
`self` resolves the *sending connection's* credentials to a session and then to
that session's seat, and answers `-ENXIO` if either half comes up empty — which
`seat_object_find` turns into "no such object". The session object is already in
hand from `GetSessionByPID`, and `org.freedesktop.login1.Session` carries a
`Seat` property, an `(so)` of the seat's id and its object path, naming the seat
this session is actually on. One `Get` on an object logind gave us, no
credentials resolved, and correct on the second seat of a machine that has two —
which `seat0` written out here would not be. A session on no seat is `("", "/")`,
and `/` is a well-formed object path, so it is refused where it is read rather
than travelling to a `SwitchTo` to fail as cryptically as the alias did.

**The drop is one D-Bus round trip late, and that is the remaining gap.** The
card is not one of logind's devices — the browser `open`s it, through the ACL
`70-uaccess.rules` does put on a card node — so no `PauseDevice` arrives for it
and there is nothing to hold the switch open with `PauseDeviceComplete`, the way
libseat holds a DRM device. `Active` is a statement about a switch logind has
already made. Late is not wedged: the kernel restores its own framebuffer when
the last master goes, so the console is stale for that width rather than black.

### The card should come from logind too

**This is the one substantive open item.** `Session.TakeDevice` on
`/dev/dri/card0` brings `PauseDevice` / `ResumeDevice` for the card with it, and
logind holds a switch open until every `PauseDeviceComplete` is in — which is
exactly how libseat and wlroots get the ordering right. It closes the late drop
above, and it supersedes the `dup` outright: the `dup` exists only because the
kernel freezes the permitted pid on a file that was ever master and `SCM_RIGHTS`
carries it to the GPU process, which is a problem a card taken from logind does
not have. It also removes the browser's own `open` of `/dev/dri/card0`, the last
thing on a tty that needs an ACL.

### What a tty costs on the way out

A desktop on a tty is the one configuration where a launcher killed before its
teardown runs is unrecoverable, and it is worth stating here because nothing
about it is visible from `domicile-launch`.

An orphaned engine still holds `Session.TakeControl`, every keyboard and pointer
logind handed it through `TakeDevice`, DRM master on the card, and a console
logind put in `K_OFF`, `KD_GRAPHICS` and `VT_PROCESS`. Nothing takes any of that
back: logind restores the VT only when the controller's bus name drops, and the
controller is still running. No keyboard, no pointer, no `Ctrl+Alt+F<n>`, and
the way out is the power switch. So a `SIGINT` or `SIGTERM` during startup has
to be answered during startup rather than after a milestone's patience expires
and the `SIGKILL` behind it arrives.

What restores the tty on any exit path is logind reacting to that bus name
dropping. No destructor runs on the `SIGTERM` path either — Chromium's handler
ends in `TerminateCurrentProcessImmediately`, which is `_exit`.

## Input

**The evdev descriptors come from logind, and nothing about the forwarding path
changed.** Patch `0020`, and `DrmLogindInput` / `DrmTakenDevices` in `src/`.

`OzonePlatformDrm::InitializeUI` builds the same evdev stack any ozone platform
on Linux can — udev device manager, `EventFactoryEvdev`, a thread of its own for
device I/O — and one thing about it is this platform's own: the
`InputDeviceOpener` that thread uses.

`InputDeviceOpenerEvdev::OpenInputDevice` opens `/dev/input/event*` directly with
`open(O_RDWR | O_NONBLOCK)`, and **that open fails on an ordinary desktop.** This
is the one thing about input the audit had wrong, and the first run on real
hardware is what said so.

**logind's ACLs do not cover a keyboard.** `70-uaccess.rules` tags `drm card*`
and `renderD*`; among input devices it tags only `ID_INPUT_JOYSTICK`. A keyboard
or a mouse keeps its group-owned mode on an active VT and the session user gets
no ACL entry on it. So the card node opens and every evdev node does not — which
is exactly the shape of that run: `Modeset succeeded` at `2880x1920p@120`, and
fifteen `Cannot open /dev/input/eventN: Permission denied (13)`.

**The `input` group is the other way to make that open work, and it is
rejected.** No other Wayland compositor requires it. It is a standing keyboard
grant to every process that user runs, and it revokes nothing: an fd opened while
the session was active goes on delivering after the user switches away, which is
a keylogger rather than a papercut.

**Chromium's own `dbus::Bus`, not libseat.** D-Bus is already compiled into this
engine and already in use by the browser process — the engine CI log carries
`ERROR:dbus/object_proxy.cc` and `ERROR:dbus/bus.cc` lines from UPower and
NetworkManager calls at runtime — so this adds no system or third-party
dependency. `//ui/ozone/platform/wayland` already depends on `//dbus` for its
idle monitor. libseat would add a third-party dependency for a protocol this
process can speak directly.

**No fallback to `open()`.** No session, or a `TakeControl` that something else
holds, is fatal, and the message names the remedy. A desktop that quietly comes
up deaf is the bug this removed. Nested and headless runs use another ozone
platform and no evdev at all, so the DRM platform is the only caller.

### What happens instead

| Moment | Call | Who |
|---|---|---|
| evdev thread starts | `Manager.GetSessionByPID(0)`, subscribe to three signals, then `Session.TakeControl(false)` | `DrmLogindInput`, in its constructor |
| udev announces a device | `stat` the node, then `Session.TakeDevice(major, minor)` | `DrmLogindInput::OpenDeviceFd`, from upstream's `OpenInputDevice` |
| logind revokes the lot | `PauseDevice(major, minor, "force")` arrives, per device, after the revoke; the device is marked revoked and nothing is answered | `DrmTakenDevices::Pause` |
| the console comes back | the session's `Active` goes true; every revoked device is `ReleaseDevice`d and taken again | `DrmLogindInput::OnPropertiesChanged` → `DrmTakenDevices::Reclaim` |
| a seat with no VTs pauses | `PauseDevice(..., "pause")`; answered with `PauseDeviceComplete` | `DrmTakenDevices::Pause` |
| `ResumeDevice(major, minor, fd)` arrives | the descriptor is parked and the device is closed and opened again | `DrmTakenDevices::Resume` |
| either way back | `RemoveInputDevice(path)` then `AddInputDevice(id, path)`; the reopened device consumes the parked descriptor or takes a fresh one | `InputDeviceFactoryEvdev`, through the callback it handed the opener |
| device unplugged | `PauseDevice(..., "gone")`; the device is forgotten | `DrmTakenDevices::Pause` |
| shutdown | `Session.ReleaseDevice` per device, then `Session.ReleaseControl` | `~DrmLogindInput` |

Domicile's own compositor is not a second copy of this to borrow from: it opens
no devices at all, and Smithay's session, DRM and udev backends are deliberately
outside its dependency tree (`packages/domicile-compositor/Cargo.toml:48`). So
the seam is in the engine, where the `open()` was — `InputDeviceOpener`, a
one-method pure virtual that `InputDeviceFactoryEvdev` already took as a
constructor argument.

### Held and live are two different facts

Conflating them is how a desktop goes deaf in silence, and it did: the internal
keyboard and the internal trackpad died in the same instant, with no log line,
and the way out was a hard reboot. Both halves of that signature come from one
place.

**logind never sends the polite pause on a seat with VTs, which is every
laptop.** `session_device_try_pause_all` is the only thing that sends
`PauseDevice` of type "pause"; its only caller is `session_activate`; and
`session_activate` returns `chvt(s->vtnr)` before it reaches that line when the
seat has VTs. What a laptop gets is **"force"**, and force is not a request:
`session_device_pause_all` has already run `session_device_stop` — `EVIOCREVOKE`
for evdev — over *every* device in `s->devices` before it says a word. That
atomicity is exactly the reported shape.

**And `ResumeDevice` is not promised either.** `session_device_resume_all` runs
only out of `seat_set_active`, while `session_leave_vt` force-pauses the whole
set on the kernel's release signal before any of that — so a relinquish with no
seat transition behind it leaves every descriptor revoked with no resume ever
coming. Re-taking is refused anyway: `TakeDevice` for a device the session still
holds answers `Device is taken`.

So a device that is **held** is not necessarily one that **reads**, and the two
facts are kept apart. A revoked device goes back through the factory, the way
back out is `ReleaseDevice` then `TakeDevice`, and the edge that drives it is the
session's `Active` property rather than a signal that may never arrive.

**`TakeDevice`'s reply is `hb` and the `b` is `inactive`, not `active`.** logind
writes `!sd->active` there: for a session that is not the one in front of the
user, `session_device_new` calls `session_device_open(sd, false)`, which
`EVIOCREVOKE`s the descriptor before handing it over, and logind's own comment
says the caller must read the boolean rather than trust the fd. Popping only the
descriptor is how a startup scan that lands during an inactive moment ends up
with a desktop full of dead devices and no complaint anywhere.

**An inactive answer is asked about, not waited on.** Honouring the boolean by
parking the device and waiting for `Reclaim` is a regression on its own, because
`OnPropertiesChanged` is `Reclaim`'s only caller and logind emits
`PropertiesChanged` on a *change*. A session that was already in front of the
user when the startup scan ran, and that never goes away and comes back, gets no
edge for the life of the process: every device sits revoked forever, which is a
desktop that draws its first frame and is deaf from it — with no keyboard to
leave the console with either. So the answer is checked against the session
instead of believed. If logind says the session is active right now, the
`inactive` it just sent was stale, no edge is coming, and the device is asked for
again — **twice at most**, a `for` with two turns rather than recursion, because
a race that does not settle in one more ask will not settle in ten.

Both the force pause and the inactive take are `LOG(WARNING)`, each naming the
device and what has already happened to it. A desktop that lost every input
device said nothing at all in its own log, which is why it cost a reboot instead
of a line to read.

**Reasoned from systemd's source and not yet run.** `DrmInputDevicesTest` has
nineteen cases over the table above and `scripts/test-input-comes-from-logind.sh`
guards the halves no unit test can see — `drm_logind_input.cc` talks to D-Bus and
has no in-tree unit test by design.

### The thread bridge

`OpenInputDevice` is **synchronous** and runs on the **evdev thread**;
`dbus::ObjectProxy::CallMethodAndBlock` is only legal on the thread that owns the
bus. The bus is therefore created **on the evdev thread**, with a thread-pool
single-thread runner of its own — the same shape `dbus_thread_linux::CreateSharedBus`
uses. That makes the evdev thread the bus's *origin* thread, so `ConnectToSignal`
and every `PauseDevice` / `ResumeDevice` / `PropertiesChanged` callback lands
there with no hop and no lock and the state machine is single-threaded, and it
leaves exactly one crossing: `CallMethodAndBlock` posted to the D-Bus thread with
the evdev thread waiting on a `base::WaitableEvent`.

Two alternatives, and why neither:

- **Run the bus on the evdev thread with no D-Bus thread at all.** Cannot work.
  `dbus::Bus` watches its socket through `base::FileDescriptorWatcher`, and
  `base::Thread` installs one only when `CurrentIOThread::IsSet()`
  (`base/threading/thread.cc`). The evdev thread runs a `MessagePumpType::UI`
  pump, so it does not have one.
- **Take the devices on the UI thread and hand descriptors across.** Costs
  re-plumbing `OpenInputDeviceParams`, `EventFactoryEvdev` and the factory proxy
  to carry a descriptor the seam is designed to produce, for no gain: blocking is
  what this call already did. The `open` it replaces and the `EVIOCG*` ioctls
  behind `EventDeviceInfo::Initialize` are synchronous on this same thread, and
  nothing disallows `//base` sync primitives on a plain `base::Thread`.

The bus is also the reason the shared one is not reused: its origin is the
browser's UI thread, and taking it over from here would move the thread every
other caller's signals are delivered on.

### The way back is a reopen, not a repair

**And that is not a style choice.** logind `EVIOCREVOKE`s the descriptor, so the
converter's next read is `ENODEV` and
`EventConverterEvdevImpl::OnFileCanReadWithoutBlocking` answers that with
`Stop()`. Nothing re-arms that watch, and swapping the descriptor underneath
cannot: `dup2` closes the revoked description, and the kernel drops an epoll
registration when the description behind a number is closed.
`InputDeviceFactoryEvdev::AttachInputDevice` is the **only** caller of
`EventConverterEvdev::Start()`.

So the device goes back through the factory: `RemoveInputDevice(path)` then
`AddInputDevice(id, path)`. The `OpenInputDevice` that follows either consumes a
descriptor a `ResumeDevice` parked against the path, or — on the force-pause
path, where there is none — gives the device back to logind and takes it again.
The explicit detach ahead of the open is not redundant either: `AttachInputDevice`
would detach, but a task later, leaving the dead converter watching in between.

The factory hands the opener that callback from its own constructor
(`InputDeviceOpener::SetDeviceReopener`), because an opener is built in order to
be given to the factory and so cannot be given the factory first. An opener that
`open`s its own descriptors never runs it; nothing takes those away.

**The id is reused, not minted.** `NextDeviceId()` is a counter on
`EventFactoryEvdev` on the UI thread and is not reachable from the evdev thread,
and nothing keys on an id being fresh: `converters_` is keyed by path, and
`OnInputDeviceRemoved(id)` only drops per-device settings for it, which
`AttachInputDevice` re-applies. Reuse is also what happened — it is the same
device coming back. The device list sees one removal and one addition per device
per round trip, which is honest about a descriptor that really was revoked.

### What did not change, and the one thing that did

The route into the compositor's seat is the chrome forwarding
`ClientRequest::Key { app_id, keycode, pressed }` over the host socket, where
`keycode` is "a Linux evdev code" (`packages/domicile-protocol/src/lib.rs:132`),
and the compositor injects it through `inject_key`
(`packages/domicile-compositor/src/main.rs:1584`, +8 for the X keycode the keymap
wants). That route lives entirely inside the engine and the host socket: it does
not care whether the engine learned the key from `wl_keyboard` or from
`/dev/input/event3`. **Input needs no new route.**

One thing diverged, and the audit had it backwards: **the keymap was not stated
twice, it was stated once.** The compositor set its seat's `XkbConfig` and the
browser's `XkbKeyboardLayoutEngine` was configured by nothing at all — off
ChromeOS the only caller that sets one is the *Wayland* platform's
(`WaylandKeyboard::OnKeymap` → `SetCurrentLayoutFromBuffer`), which a DRM/Ozone
build never runs, and `SetCurrentLayoutByName` is `NOTIMPLEMENTED()` there. Every
tty run said so, `No current XKB state` before every press, and it read as noise
because the static-table fallback behind it kept the non-printable keys working.
Printable ones came out as `DomKey::UNIDENTIFIED`.

Patch `0024` closes it: the compositor sends the keymap it compiled down the
chrome control socket with the handshake, as `keymap`, and the browser process
reads it there rather than passing it to the page. One layout, read from the
config once — which is what a nested run had for free, because the host
compositor owned the keymap. `components/domicile/browser/keyboard_layout.h` is
the mechanism in full.

## Outputs

Multi-output already existed on the compositor side and was never the problem.
`screens.rs` carries `Screens::described` (n outputs from config, with positions
and per-output scale), `Rearrangement`/`Slot::Kept` (add, remove and restate
without destroying a `wl_output` that merely resized), and `adopt_the_desktop`
(`main.rs:2280`) applies one at runtime. Hotplug is that function called from
somewhere new.

What does assume one fixed output:

| Assumption | Where |
|---|---|
| a window-following desktop has exactly one output | `main.rs:2170, 2196, 2217, 2222` — four `.expect("a window-following desktop advertises its one output")` |
| refresh is the display's, or unknown | `Advertised::refresh_mhz`, which the engine's displays carry and the other two desktops leave at `UNKNOWN_REFRESH_MHZ` — said rather than invented; the latency run's own frame budget keeps a `SPIKE_REFRESH_MHZ` of its own |
| scale is an integer | **No longer.** `Advertised::scale` is an `f64` and a profile's is fractional; `restate_output` hands Smithay `Scale::Fractional`, which sends `wl_output.scale` rounded up and lets `xdg_output` carry the logical size the density made. The window-following path is still `Scale::Integer` at `main.rs:2224`, because a window's density arrives as an integer |
| physical size is the panel's, or unknown | `Advertised::physical_mm`, off the engine's reading of the EDID, and `UNKNOWN_PHYSICAL_MM` where there is no panel — a described desktop is arithmetic and a nested one is a window |
| the display list comes from the config, or from Domicile's own window | `screens.rs` has exactly two constructors, `described` and `following_the_window` |

The last row **was** the real gap and is closed for the list itself. On a tty the
display list comes from DRM, which the **engine** owns, so the C ABI carries a
fourth event — `displays`, an array of `DomicileDisplay` — and
`Screens::from_the_engine` is the third constructor beside `described` and
`following_the_window`. `Screens::replugged_into` is which of the two sources
wins: a described desktop is the user stating their monitors and DRM does not
overrule it, and a nested run is never sent the event at all, because the browser
registers the observer only under `--ozone-platform=drm` — a nested engine's
screen is the host's monitors, and a producer told about those would take its
desktop away from the window that defines it.

A hotplug rearranges rather than restarts: `Screens::rearranged_into` matches on
the `wl_output` name, and the name is `drm-<display id>`, which ozone derives from
the EDID — so a monitor unplugged and plugged back in keeps the output its
clients are on.

### The layout is the config's, and it is applied again on every hotplug

`output.profiles` is the fourth source of a display list and the only one that is
a function of the hardware. It is kanshi's model without kanshi's file format:
a profile names exactly the displays it is for, and the first profile whose set
is plugged in wins.

```jsonc
{ "name": "home-office-full", "displays": [
    { "display": "drm-1", "enabled": false },
    { "display": "drm-2", "position": [0, 0],    "scale": 1.2, "transform": "rotate-270" },
    { "display": "drm-3", "position": [1800, 0], "scale": 1.2, "transform": "rotate-270" } ] }
```

| Source | Constructor | Decided by |
|---|---|---|
| `output.displays` | `Screens::described` | the config, outright |
| `output.profiles` | `Screens::from_the_layout` | the config, over what DRM reports |
| the engine's reading | `Screens::from_the_engine` | ozone, where no profile matches |
| Domicile's own window | `Screens::following_the_window` | the host, on a nested run |

The matching and the placement are `domicile-config`'s `profile.rs` — pure logic
and unit-tested, like the rest of that crate. `scale` is fractional because the
scales a desk is used at are: 1.5 on a 2880x1920 panel is the 1920x1280 desktop
it is readable at, and `Scale::Fractional` is what lets `wl_output` round it up
for clients while `xdg_output` reports the size it actually made.

Two events reach it and they are the same question from opposite sides. A
**hotplug** is the monitors changing under one config, and a **reload** is the
config changing over one set of monitors — so `main.rs` keeps the engine's last
display list on `engine_displays`, and `Screens::reloaded_into` re-matches
against it. Without that a profile would take effect only the next time a
monitor was unplugged, which would make the file unwritable: the way a profile
gets written is by saving it against the desk it is being written for.

**`replugged_into` used to drop every hotplug after the first**, and this is
where that was found. It asked whether the desktop still followed Domicile's own
window — which the *first* reading off DRM makes false — so a monitor unplugged
after that was read, matched and thrown away, and the desktop went on describing
a screen that was no longer there. Whether a desktop is the config's to define
is a fact about the config and does not change when a monitor does, so that is
what it asks now.

**A profile states no mode**, and the positions in one are sums of sizes it
therefore does not control: the mode arrives with the monitor and the scale
divides it into the logical size. kanshi pins one per output (`mode =
"3840x2160@60Hz"`), which is the other real difference between the two. It
costs nothing today, because `ModesetParamsFromSnapshots` lights a connector
at its native mode and that is the mode anyone would pin — but a
monitor that negotiated something else would move every display placed after
it, with nothing in the config to correct it with. The field belongs with the
scanout work below, which is what would give it something to do.

**What a profile does not yet do is turn a pixel.** Everything above is the
desktop the compositor *advertises*: `wl_output`'s position, mode, transform and
scale, the `xdg_output` logical size a toolkit lays out against, and the
`DisplayInfo` the chrome places its `<Screen>` regions from. The scanout is the
engine's and is unchanged — `ModesetParamsFromSnapshots` still lights every
connector that reports a mode at its native mode at the snapshot's own origin,
skipping the ones that report none, and
`DrmWindowHost::SetFullscreen` still puts one window on one display. So a
rotated monitor is advertised rotated and laid out rotated, and the glass still
scans out the way it always did. Closing that is the next step and is two
things: the profile's mode and origin reaching `DisplayConfigurationParams`, and
a rotation reaching the DRM plane — which on ChromeOS is `DisplayConfigurator`,
`//ui/display/manager`, the 478 lines this fork deliberately does not port.

**A profile names a monitor the way it is labelled.** The `wl_output` is still
`drm-<id>` — short, always there, and what clients are already on — but every
display now carries a *description* beside it: `"<MAKE> <MODEL> <SERIAL>"`, the
string kanshi and sway match on, and an entry's `display` matches either. So a
desk can be written down without first reading an int64 off a log, and it can
be written down a monitor at a time.

It travels the route the millimetres already take (*[The physical size is in
the snapshot](#the-physical-size-is-in-the-snapshot-and-it-leaves-as-a-dpi)*):
`display::Display::label` is the field that exists for it and that nothing on
this platform was setting, then the mojom `Display`, then a borrowed
`const char*` on `DomicileDisplay`.

The serial is the part that had to be written. `display::EdidParser` reads the
same descriptor and keeps only `descriptor_block_serial_number_hash()` — a
hash, deliberately, because a browser should not carry an identifier around.
That is the right default there and the wrong one here: the serial is the only
thing telling three identical U3219Qs apart, it is read off the user's own
hardware, shown to the user, and goes nowhere else.
`ui/ozone/platform/drm/domicile/edid_name.cc` is the descriptor walk, and it is
deliberately free of Chromium types so that the one piece of this with an
off-by-one in it compiles and runs outside a Chromium tree.

Two things it is not. The make is the three-letter PNP id — `DEL`, not
`Dell Inc.` — because that is what an EDID holds; the full vendor name is
hwdata's `pnp.ids`, which libdisplay-info carries and Chromium does not, so a
name here is one word off what sway prints. And a monitor that states none of
the three has an empty description and can still only be named `drm-<id>`.

The event carries the panel too: `physical_width_mm`, `physical_height_mm` and
`refresh_mhz` on `DomicileDisplay`, off the same snapshot, by the route
[The physical size is in the snapshot](#the-physical-size-is-in-the-snapshot-and-it-leaves-as-a-dpi)
describes. Any of the three may be zero, which is `wl_output`'s own word for a
screen with no such number and what a projector or a virtual output reports — so
the compositor advertises the reading, including when the reading is that there
is nothing to read.

## The window has to be the size of the CRTC

**This is why the first desktop on real hardware was black, and nothing about it
was an error.** The modeset succeeded, the CRTC took `2880x1920`, and `DrmScreen`
reported it correctly. The engine's window was `1050x1900` at `(10,10)`.

`ScreenManager::UpdateControllerToWindowMapping` pairs a window with a controller
through `FindWindowAt`, which compares
`window->bounds() == gfx::Rect(controller->origin(), controller->GetModeSize())`
— an exact rectangle (`screen_manager.cc:1001`). No match means the window is
given no controller, every page flip is dropped before it reaches the kernel, and
the CRTC keeps the blank buffer the modeset put up. A black screen with a clean
log.

The window is Chromium's ordinary default, and `WindowSizer::GetDefaultWindowBounds`
reproduces it exactly on a 2880x1920 work area:

| | |
|---|---|
| `default_width` | `min(2880 - 2×10, kWindowMaxDefaultWidth)` = 1050 |
| `default_height` | `1920 - 2×10` = 1900 |
| origin | `(10 + work_area.x(), 10 + work_area.y())` = (10,10) |
| the side-by-side halving | skipped: 2880/1920 = 1.5, under the 1.6 threshold |

That arithmetic is also the strongest evidence `DrmScreen` works: 1050 and 1900
are derivable only from a 2880x1920 work area.

Nothing on a tty maximises a window: there is no window manager and no session to
restore bounds from. **Fullscreen rather than a size on the command line**, and
the difference is not style. `--window-size=WxH --window-position=0,0` does work
— `browser_window_state.cc:180` applies both after `WindowSizer` and forces
`kNormal` — but the numbers are a guess: this panel advertises more than one
preferred mode and `drm_util.cc:880` takes the FIRST one flagged preferred, not
the largest. `DrmWindowHost::SetFullscreen` asks `display::Screen` instead, and
that it agrees with the CRTC is by construction: `DrmScreen` builds its list from
the same `DisplaySnapshot`s the modeset driver configures from, so a display's
bounds and `gfx::Rect(controller->origin(), GetModeSize())` are one rectangle —
through a mode change and a hotplug alike. `domicile-launch` passes
`--start-fullscreen` on the scanout platform only.

Upstream's `SetFullscreen` is an empty body and `GetPlatformWindowState` answers
`kUnknown` forever, both on the same premise as the seven `NOTREACHED()`s in
`DrmWindowHost`: ash sizes its own root window, so nothing on ChromeOS asks a DRM
window for either. `kUnknown` also makes
`DesktopWindowTreeHostPlatform::IsFullscreen()` permanently false, so views
re-enters fullscreen every time and its own `DCHECK_EQ` fails in a DCHECK build.

**And then something took it back out of fullscreen.** A tty run reported a
desktop of 2880x1920 and, 1.37 seconds later, one of 1050x1900 — the
`restored_bounds_` `DrmWindowHost::SetFullscreen` records on the way in. What
left fullscreen is a watchdog on a window that cannot answer it:
`ExclusiveAccessBubbleViews::Show` arms `presentation_watchdog_timer_` for 1500 ms
and stops it in `OnFirstPresentation`; the bubble is a top-level window of its
own, on ozone/drm it binds to no CRTC, so the presentation callbacks stay pending,
the timer cannot be stopped, and it fires on a healthy machine. Patch `0023`.

### How to see a modeset

`DRM configuring:` and `Modeset succeeded.` are `VLOG(1)` in
`ui/ozone/platform/drm/gpu/screen_manager.cc:382, 405`, and
`--vmodule=drm*=1,gbm*=1,ozone*=1` prints neither — none of those three patterns
matches `screen_manager`. Name it:

    --vmodule=screen_manager=1,drm*=1,gbm*=1,ozone*=1

A run without it says nothing either way about whether the hardware modeset, and
reading the absence of those lines as a failure costs a cycle. What a run *can*
say without it is `domicile: the displays read the same as last time`, which is
reachable only once a `Configure` has been confirmed from outside this process —
so that line is itself proof a modeset landed.

**Read `Modeset commit failed after a successful test-modeset.`
(`screen_manager.cc:407`) as naming a test that did not run.** The test-modeset
arm is `if (modeset_flags.Has(display::ModesetFlag::kTestModeset))` at `:386`,
and `DrmModeset` asks with `kCommitModeset` alone. The sentence is upstream's
and unconditional in the failure branch, so it invites a search for a difference
between a `TEST_ONLY` commit and a real one on a run where no `TEST_ONLY` commit
was asked for.

## Scanout and rendering can be different cards

**ozone/drm refuses software compositing by design.** Past the embedder, a run on
the build host got as far as asking viz for a root compositor frame sink and the
GPU process died:

    [FATAL:ui/ozone/platform/drm/gpu/gbm_surface_factory.cc:356]
      DCHECK failed: thread_checker_.CalledOnValidThread().
    #7  ui::GbmSurfaceFactory::CreateCanvasForWidget()
    #8  viz::OutputSurfaceProviderImpl::CreateSoftwareOutputDeviceForPlatform()

The DCHECK is the symptom; the line under it is the finding — `"Software
rendering mode is not supported with GBM platform"`. The run had fallen back to
software after three GPU process restarts on
`GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT` → `Unable to initialize SkSurface` →
`Context was lost`.

**One list answers two different questions, and upstream can conflate them
because on ChromeOS the rendering device and the scanout device are the same
card.** They are chosen independently:

| selection | code | fallback |
|---|---|---|
| scanout card | chosen by `GetPrimaryDisplayCardPath()` at `drm_display_host_manager.cc:259`, sent to the GPU process by `GpuAddGraphicsDevice` | `GetPrimaryDisplayCardPath()`'s `cards[0]` |
| render device | `gbm_surface_factory.cc:74`, via `EGL_PLATFORM_DEVICE_EXT` | `GetPreferredEGLDevice()`'s `devices[0]`, skipping entries with no `EGL_DRM_DEVICE_FILE_EXT` |

On a host where those land on different cards the divergence is silent and the
failure surfaces four layers away as an incomplete framebuffer. Measured on
`crux`, the build host, on 2026-09-14: its `card0` is **vkms** — the connected
connector, no render node, so it is not in `eglQueryDevicesEXT`'s list at all —
and its `card1` is an nvidia GPU with four disconnected connectors and the only
render node. The scanout selection lands on vkms and the render selection on
nvidia. The only configuration that would put a frame on the connected connector
there is render on `card1`, scan out on `card0`, which is cross-device PRIME: a
capability rather than a selection, and one ozone/drm does not have.

**So `crux` can answer whether the path executes and not whether a desktop
appears**, which is why every hardware claim in this document comes from a laptop
and not from CI. A host with one ordinary GPU with a monitor on it exercises none
of this — both selections land on that card and agree.

## Key decisions

- **Patch the assert; do not fork ozone/drm.** Two incidental ChromeOS references
  and zero `IS_CHROMEOS` across 49 files is not a coupling worth forking over, and
  a fork would need rebasing at every pin bump.
- **Write the embedder; do not port `ui/display/manager`.** Domicile needs
  `DisplaySnapshot` → `DisplayConfigurationParams` → `Configure`, plus a
  `PlatformScreen` over the same snapshots. `DisplayManager`, layout stores, touch
  transforms and content protection are ChromeOS product surface.
- **The engine holds DRM master; the compositor keeps its render node.** One
  master, and the Smithay side of Domicile does not change.
- **logind owns the VT and Domicile asks it for switches.** `TakeControl` takes
  the console, so the fork carries no VT ioctl: out goes `Seat.SwitchTo(u)`, in
  comes the session's `Active`.
- **Take input from logind, not from the `input` group, and never fall back to
  `open()`.** A silent fallback is a desktop that comes up deaf, which is the bug
  the seam exists to remove.
- **Prove what a build can prove in CI.** The probe cost one engine-job slot and
  found three of the eight edits in the patch, one of them a link error no `git
  grep` and no compiler could have reached.

## Plan

Step 1 — make the tree accept the argument. All eight edits are one patch,
`packages/domicile-engine/patches/0012-domicile-let-gn-gen-accept-ozone_platform_drm-off-Ch.patch`;
the ninth, `0014`, is the static-initializer fix that a host tool found and a
compiler and a linker both let through. `.github/workflows/engine-drm-probe.yml`
is green on run 34623575435, so the headline is measured rather than reasoned.

- [x] relax `ui/ozone/platform/drm/BUILD.gn:14` to `assert(is_linux || is_chromeos)` and move the two ash deps under `if (is_chromeos)`
- [x] the non-Flex page-flip threshold and no `Platform.FlexPageFlipFlakes2` off ChromeOS
- [x] `InputMethodMinimal` for `ash::InputMethodAsh`, as `ozone_platform_headless.cc:104-108` already does
- [x] drop `+ash/constants/ash_switches.h` from `gpu/DEPS`
- [x] gate `gbm_unittests`' use of `ui/display/manager/test/fake_display_snapshot.h` on `is_chromeos` — gated, not dropped, since `//ui/ozone/BUILD.gn` names the target unconditionally
- [x] two `is_chromeos`-gated `ui/display` feature flags at four call sites, seven include-what-you-use gaps, and `CursorController`, whose object file ships only on ChromeOS
- [x] a manual-dispatch CI job that configures and builds `//ui/ozone` with the argument on, inside `engine.yml`'s concurrency group

Step 2 — the embedder.

- [x] `DrmScreen : PlatformScreen` over the snapshots `DrmDisplayHostManager` already holds — patch `0013`, 12 tests
- [x] the seven `NOTREACHED()`s in `DrmWindowHost` — patch `0015`. Costed as two; a run found that answering those two only moves the crash, and `HeadlessWindow` models all seven. `scripts/test-drm-window-answers-in-dip.sh` reads the assertion out of the series
- [x] `PlatformScreen::IsScreenSaverActive` and `CalculateIdleTime` on `DrmScreen`
- [x] a minimal modeset driver — patch `0016`, plus the loop guard and the answered-from-inside guard
- [x] `DrmWindowHost::Close()` ends in `PlatformWindowDelegate::OnClosed()` — patch `0021`. Upstream's `{}` is the only Ozone platform whose close does not complete, and a views browser tearing a widget down dereferenced a compositor that was already gone
- [x] take DRM master when a card arrives — `DrmMaster::Add`
- [x] do the drop and the retake in the process that opened the card — patch `0019`
- [x] follow the session's `Active` rather than the kernel's VT signals, and bind the chord that starts a switch — patch `0022`, superseding `0017`'s handshake; `scripts/test-logind-owns-the-console.sh` counts the ioctls
- [x] read the seat off `Session.Seat` rather than `seat/self`
- [x] the window fills the CRTC — patch `0018`, `--start-fullscreen` on the scanout platform only, and patch `0023` for the watchdog that undid it
- [x] evdev fds from `Session.TakeDevice`, with `PauseDevice` / `ResumeDevice` — patch `0020`
- [x] survive a logind "force" pause and an inactive `TakeDevice`
- [x] the browser gets the compositor's keymap — patch `0024`
- [x] name `ozone_platform_drm = true` in `scripts/build.sh` and `engine-release-build.sh`, after the embedder was behind it. `scripts/test-the-builds-agree-on-ozone.sh` holds both halves: the two blocks name the same three platforms, and neither sets `ozone_platform`, because setting it to `"drm"` looks like a one-word tidy-up and would flip the default on every machine including the ones with no card node
- [x] a `drm` arm in `domicile-launch`'s `platform()` — `XDG_VTNR`, read after `WAYLAND_DISPLAY` and `DISPLAY`, because a Wayland or X11 session has a VT too and reading it first would take the console out from under the session the desktop was to be a window inside of. logind is what sets it, which is the same logind the engine then asks for `TakeControl` and `TakeDevice`. The refusal stays for a machine with neither — ssh, a container
- [x] a display-list event on the engine C ABI, and `Screens::from_the_engine`
- [x] drive `adopt_the_desktop` from that event
- [x] real physical size and refresh on `wl_output`, from the snapshot
- [ ] take the card node from logind too — `TakeDevice` on `/dev/dri/card0` plus `PauseDevice` / `ResumeDevice`. See [The card should come from logind too](#the-card-should-come-from-logind-too)

## Open questions

- **Fractional scale.** `wl_output` scale is `Scale::Integer` here and DRM panels
  routinely want 1.5. *Recommendation:* stay integer — `ROADMAP.md`'s existing
  "fractional scaling rounds up" gap is the same decision, and it should stay one
  decision.
