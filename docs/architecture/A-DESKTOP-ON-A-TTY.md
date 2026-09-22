# A desktop on a tty

**A desktop comes up on a bare console and can be used.** On a tty `domicile`
starts the engine under `--ozone-platform=drm`, takes DRM master as the card
arrives, modesets the panel at its native mode, fills that mode exactly, takes
every keyboard and pointer from logind, and asks logind for a console switch on
`Ctrl+Alt+F<n>`. Keys reach the shell, an arrow is drawn on the cursor plane,
the trackpad moves it, and a click lands in the page under it.

Two pieces of work got it there and the distinction is still the useful one.
Letting `gn gen` accept `ozone_platform_drm = true` is a **patch**: nine edits,
eight of them around the DRM platform rather than inside it. Getting a lit
screen out of it is a **port**, of the *embedder* ozone/drm has never had off
ChromeOS. Neither is a fork of ozone/drm: at
`3d773601242cc8a52641671348d4a40ac66af750` the 50 `.cc` files in
`//ui/ozone/platform/drm:gbm` contain **three** references to ChromeOS between
them and **zero** `BUILDFLAG(IS_CHROMEOS)` — a protected-media build flag, a
comment about ChromeOS boards, and one include of
`ui/events/ozone/chromeos/cursor_controller.h`. Re-counted at this pin rather
than carried over: the file count and the references both moved by one when the
pin did, and the claim they support did not.

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
| Keys reach the shell with the layout the config names | **Hardware.** Patches `0024` and `0025`. The descriptors arrived from the start; what was missing was a window that told views it was active, so nothing held focus and every key was dropped |
| A device logind force-pauses comes back | **Hardware.** `DrmInputDevices` answers a resume from `names_`, not from the descriptors it had already forgotten — a run handed back 13 live descriptors 0.93 s in and threw all 13 away before that |
| An arrow is drawn where the pointer is | **Hardware.** Patch `0026`. `BitmapCursorFactory` answers every type with a typed, bitmapless cursor, so `wm::CursorLoader` never reaches the asset arrow and the empty bitmap becomes `drmModeSetCursor(fd, crtc, 0, 0, 0)` — the kernel's word for *off*, which succeeds, so nothing is logged |
| The trackpad moves it | **Hardware.** Patch `0027` and `use_libinput = true`. Off ChromeOS `CreateConverter` has no touchpad branch at all, so a pad falls to `EventConverterEvdevImpl`, which has no `EV_ABS` case and drops every finger position |
| A click reaches the page under the pointer | **Hardware**, on `engine-f38ef3f`, with a mouse and with the pad |
| `Ctrl+Alt+F<n>` reaches `Seat.SwitchTo` | **Reasoned from source since the fix.** The chord decoded on hardware and the call died on `/org/freedesktop/login1/seat/self`; reading the session's own `Seat` instead has not been run |
| The display is dropped on the way out of the console and retaken on the way back | **Reasoned from source.** `DrmVtSwitcherTest` holds the ordering |
| The screens come back after a console round trip | **Hardware.** A log from a real switch shows the CHANGE event suppressed by the hotplug guard (`the displays read the same as last time`) and then, on the session going Active, `configuring 1 display(s)` → `Modeset succeeded` → `the DRM thread confirmed the modeset`. The relight is what gets past the guard, and it works |
| The desktop is usable again after a console round trip | **No.** The same log says why, and it is input rather than display. `ReleaseDevice` makes logind report the device it freed as `PauseDevice(..., "gone")`; every `GiveBack` buys one, the echo lands after the `TakeDevice` it made room for, and treating it as an unplug forgot the name. Measured: thirteen force pauses, thirteen "gone" in the 141 µs after them, `reclaimed 0 of 0` on the way back, thirteen `logind resumed device N, which this session never took`. No keyboard, no pointer, no chord to leave with. `released_` is the fix and has not been through a run |
| The screens light again when the machine wakes up | **Reasoned from logind's sources.** No runner suspends, so nothing in CI sleeps; `DrmSleepTest` holds the reading of `PrepareForSleep` and `DrmModesetTest` the relight it drives past the hotplug guard |
| A stop asked for during startup is a stop | **Unit tests.** `domicile-launch`'s milestone tests. It matters here and nowhere else — see [What a tty costs on the way out](#what-a-tty-costs-on-the-way-out) |

Still open: [taking the card node from
logind](#the-card-should-come-from-logind-too), and a console switch away and
back on an engine carrying the "gone" echo fix.

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
| light the screens again on VT-back | `DisplayConfigurator`, which reconfigures after a take | `DrmVtSwitcher`, through `DrmModeset::Relight`. The take puts master back and nothing puts the mode back, so without it the desktop flips into a card somebody else modeset |
| start a VT switch | the kernel, on `Ctrl+Alt+F<n>` | the desktop, by `Seat.SwitchTo(u)`. The kernel's own chord handling is off from the moment input is taken — see below |
| open `/dev/input/event*` | `Session.TakeDevice(major, minor)` on the evdev thread | `DrmLogindInput`. The bare `open()` is `Permission denied` (see [Input](#input)) |
| revoke input on VT-away | logind, on `PauseDevice` | the same seam: logind `EVIOCREVOKE`s the fd it passed |
| light the screens again after a suspend | `DisplayConfigurator`, driven by ChromeOS's own power manager | `DrmSleep`, on logind's `PrepareForSleep`. Nothing is handed back for a sleep: `session_device_pause_all` and `DROP_MASTER` are VT paths in logind's sources, so the devices and the master stay this session's and only the GPU's state is lost |

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
— so a machine whose `open` did take master pays one ioctl and no behavior.

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
disarms it. So the two loops call `DrmWrapper::AssumeMaster` instead: the flag
without the ioctl, because the transition is decided in another process.

**And the way back is a modeset, not a take** — which is the second half of the
same fact and was missing until a console round trip locked a desktop up.
Master says who may program the card and nothing about what the card is
programmed to: the kernel restores its own framebuffer when the last master
goes, so the console handed back has been modeset by whoever held it, and the
controller state this process resumes with describes hardware that has moved.
Every flip into it is refused, which is the watchdog again. Nothing else would
send that modeset either — the connectors report exactly what they reported on
the way out, so `ModesetWouldChangeAnything` reads the next reading as "asking
again cannot help", the same wall a wake from suspend hits. So `StepVtSwitch`
answers a take that succeeded with `kRelightDisplay` and `DrmModeset::Relight`
runs, after the take has answered and never before it. One cell and no other:
a modeset asked for from a state that does not hold the console is a commit
over somebody else's frame.

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
than traveling to a `SwitchTo` to fail as cryptically as the alias did.

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
| this session releases a device | `PauseDevice(..., "gone")` for it, because logind reports the `SessionDevice` it freed the way it reports any other. Swallowed as the echo it is | `DrmTakenDevices::Pause`, against `released_` |
| `ResumeDevice(major, minor, fd)` arrives | the descriptor is parked and the device is closed and opened again | `DrmTakenDevices::Resume` |
| either way back | `RemoveInputDevice(path)` then `AddInputDevice(id, path)`; the reopened device consumes the parked descriptor or takes a fresh one | `InputDeviceFactoryEvdev`, through the callback it handed the opener |
| device unplugged | `PauseDevice(..., "gone")` with no release outstanding; the device is forgotten | `DrmTakenDevices::Pause` |
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

**An inactive answer is asked about, not waited on.** Honoring the boolean by
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
single-thread runner of its own. That makes the evdev thread the bus's *origin*
thread, so `ConnectToSignal` and every `PauseDevice` / `ResumeDevice` /
`PropertiesChanged` callback lands there with no hop and no lock and the state
machine is single-threaded, and it leaves exactly one crossing:
`CallMethodAndBlock` posted to the D-Bus thread with the evdev thread waiting on
a `base::WaitableEvent`.

**That runner is `DEDICATED`, and `SHARED` is what wedged a desktop.** All three
of this platform's buses — this one, `DrmVtSwitcher`'s and `DrmSleep`'s — were
built with `SingleThreadTaskRunnerThreadMode::SHARED` and identical traits,
copied from `dbus_thread_linux::CreateSharedBus`. The buses *it* builds do not
block; this one does, and a blocking call holds libdbus inside the socket read
until logind answers, so every other bus on that thread goes unread for the
duration. A console switch force-pauses every device at once and costs three
blocking round trips here per device — `ReleaseDevice`, `TakeDevice`, `Active` —
so on a fifteen-device laptop `DrmVtSwitcher`'s `PropertiesChanged` queues behind
about forty-five of them. That signal is the only thing that starts the
relinquish, and a relinquish that lands late is a GPU process still committing
flips into a card whose console is somebody else's: the commit fails,
`PageFlipWatchdog` arms, and fifteen seconds later it is `LOG(FATAL) ... Crashing
GPU process.` Whether the race is lost depends on how fast logind services
forty-five calls, which is why the desktop wedged **sometimes on the way out and
sometimes on the way back** rather than every time.

**A thread of its own is the cheap half.** The evdev thread still stops for the
length of the storm, so a console switch costs the desktop its input either way.
Ending that means `OpenInputDevice` answering later than it is asked — Chromium's
contract, not this fork's — which is the open item below.

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

```toml
[[output.profiles]]
name = "home-office-full"

  [[output.profiles.displays]]
  display = "drm-1"
  enabled = false

  [[output.profiles.displays]]
  display = "drm-2"
  position = [0, 0]
  scale = 1.2
  transform = "rotate-270"

  [[output.profiles.displays]]
  display = "drm-3"
  position = [1800, 0]
  scale = 1.2
  transform = "rotate-270"
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

**A profile states a mode and cannot set one**, and the two halves of that are
worth separating. `mode = [3840, 2160]` on a placement is an *assertion about
the monitor*: the positions in a profile are sums of the sizes it places, so a
monitor that comes up at another mode moves every display placed after it, and
a profile that names the mode it was written for turns that from a desk that
is quietly wrong into one that refuses to come up. `Layout::of` checks it
before anything is placed and returns `ConfigError::Validation` naming both
modes, which `reloaded_into` answers the way it answers a config that does not
parse — the desktop that is up stays up, with the complaint beside it. Never a
fallback to the mode that arrived: a desk that silently comes up at the wrong
resolution is the bug this field exists to make visible.

What a profile still cannot do is *ask* for a mode. `DomicileDisplayLayout`
carries an id, an enabled flag and a corner, and `ModesetParamsFromSnapshots`
configures every CRTC from that connector's own `native_mode()` — so the mode
a connector scans out is the hardware's, whatever the config says. That is why
this is a size and not a rate: kanshi pins `mode = "3840x2160@60Hz"`, and the
hertz is both the half that changes no arithmetic here (a logical size is a
mode turned and divided by a scale) and the half that could not be chosen
anyway. A monitor also legitimately reports no rate at all — `wl_output`'s
zero — so a profile that asserted one would refuse desks that are working.
Closing the other half is a field on `DomicileDisplayLayout` and a mode lookup
in `drm_modeset.cc`, which is the fork.

### A profile decides which connectors are lit, and in what order

`Layout::scanout` is the other half of a profile, and it is the half the
desktop above cannot carry. `Layout::placed` is logical, turned, and has the
displays a profile disabled already dropped; this is the glass — which
connectors to light at all, and where each one's mode goes on the *engine's*
own desktop. A display dropped from a desktop still has to be turned off.

It crosses because the two halves are in different processes: the config is the
compositor's and DRM master is the browser's.

```
Layout::scanout  →  Screens::scanout  →  domicile_displays_configure
  → FrameSinkBroker.ConfigureDisplays  →  OzonePlatform::SetDomicileDisplayLayout
  → DrmModeset::SetLayout              →  ModesetParamsFromSnapshots
```

| Rule | Why |
|---|---|
| **An empty layout means the hardware decides** | What every desktop but a matched profile's says, and what this did before a layout could be stated. It is also what *undoes* one: a profile that turned a panel off stops matching the moment a monitor is unplugged, and something has to say the panel comes back on |
| **A non-empty layout is the whole truth** | A connector it does not name is left dark rather than lit where the card put it. An origin nothing chose can land on top of one that was, and two controllers claiming one rectangle is the exact-rect mismatch `FindWindowAt` answers by binding no window at all. That case is a monitor plugged in between the reading the compositor answered and this one, and it lights on the next round trip |
| **A dark connector still gets a corner** | It is in the browser's display list whether or not it is lit, and one left where the card stacked it lands on top of a monitor that is on. The compositor puts the dark ones past the end of the row |
| **Primary is the first display the layout lights** | The difference between a desktop and a black screen. A views browser going fullscreen is sized from the display it is on, and the window it starts at is on whichever display holds `(10, 10)`. A profile that turns the laptop panel off is the ordinary case on a full desk, and a primary that is dark is a browser drawing correctly onto a screen nobody can see — with every log line saying the modeset succeeded |
| **The connectors are stepped across in the order the displays are placed** | Ozone lays its own desktop out in connector order, which is the card's business and says nothing about which monitor is on which side of a desk — so a pointer leaving one screen arrived on whichever connector was numbered next |
| **The mode, not the logical size** | This is the engine's desktop: a connector occupies what it scans out there, whatever the scale divides it into on ours |
| **All on one row** | Nothing is ever drawn across two connectors, so the only thing this arrangement decides is where a pointer crosses. Two monitors stacked vertically is the one thing a profile can say that this does not carry |

### Blanking is that same layout with the light taken out of it

A desktop nobody has touched for `idle.blank_after_seconds` turns its screens
off, and there is no second mechanism for it: DPMS here is
`domicile_displays_configure` again, carrying every connector the engine
reported with `enabled: false`. The path above is the whole path, and the
modeset that darkens a CRTC is the modeset that lit it.

Three things about that list are load-bearing, and each is the opposite of the
obvious answer:

| Rule | Why |
|---|---|
| **Dark is not the empty list** | An empty layout is the compositor having no opinion, which the engine answers by lighting what the hardware reports — so the shortest way to write "light nothing" is the one way to light everything |
| **Dark is built from the engine's display list, not from `Screens::scanout`** | A scanout list names the displays a *profile* named. A monitor no profile mentions is absent from it, and absent means untouched, which means still on. `crate::idle::darkened` reads `engine::Event::Displays`' own reading instead — every connector there is, at the origins the engine already put them |
| **Relighting restates what the desktop wants, which is usually nothing** | Coming back is `Screens::scanout` again: a profile's connectors on a desk that has one, and the empty "hardware decides" list on every desk that does not. The desktop is not stored twice |

The clock and the edge are `crate::idle`, which is pure and unit-tested; the
compositor holds one `Idle` and states the connectors only when the answer
*changed*. A desk that is already dark must not re-send a configure on every
tick — that is a modeset a second on a desk nobody is at — and one that is lit
must not re-send on every keystroke.

A client can veto the answer. `zwp_idle_inhibit_manager_v1` is advertised, and
an inhibitor a client holds makes the desk lit whatever the clock says — a
**veto** rather than a hand on the desk or a clock that is paused, which is
what makes the two awkward cases fall out of one predicate: a film started on a
desk that is already dark flips the answer back and takes the same `ComeBack`
edge a keystroke would, and the last inhibitor going away on a desk nobody has
touched in an hour goes dark then and there rather than a timeout later. The
one thing the protocol leaves to the compositor is the client that dies holding
one — smithay reports an inhibitor released only for the request that releases
it, so the compositor asks after every turn of its clients whether the surfaces
it is holding are still alive. A leaked inhibitor is a desk that never blanks
again with nothing anywhere saying why.

The case that is easy to miss is a monitor plugged in while the screens are
dark: it arrives lit, off the engine's own modeset, and `adopt_the_desktop`
would have restated the *desktop's* list and lit the rest of the desk with it.
So both paths go through one place, and a hotplug that does not rebuild the
desktop at all still keeps the dark (`keep_the_screens_dark`).

Nothing in this repository's checks can watch a panel go dark — no runner here
has a `/dev/dri` at all. What a person at a desk looks for is one line each
way:

```
nobody is at this desktop; its screens go dark connectors=2
somebody is at this desktop again; its screens come back on
```

and, under `--vmodule=drm*=1`, the `configuring N display(s)` that says the
modeset behind them ran.

### Turning a monitor is the page's job, and it took a window each to get there

**The modeset does not turn a pixel and never will.**
`DisplayConfigurationParams` is `{id, origin, mode, enable_vrr}` and has no
field for a rotation, so a rotated monitor is lit exactly as it was lying
down.

**And a rotation does not belong there anyway.** This used to say the answer
was `DisplayConfigurator` and `//ui/display/manager`, the 478 lines this fork
does not port. That was wrong, and checkably so: `display_configurator.h` at
the pin does not contain the string `rotat`. ChromeOS turns a screen in the
**render tree**, not at the modeset and not on the plane —
`ash::RootWindowTransformer::GetTransform` converts root-window DIP to host
window coordinates and "normally includes rotation and scaling"
(`ash/host/root_window_transformer.h`). The CRTC scans out its mode the way
it always does; what changes is what is drawn into it.

Which put it behind *one browser window per CRTC* rather than beside it. A
root transform belongs to a window, and one window covering a desk whose
monitors a profile may turn differently would have meant rotating per region
inside a single page, in coordinates that stop being the desktop's. Each
display has a window now, so the render tree is one region and the turn is a
CSS `transform` on it:

```
translate(0, 2160px) rotate(-90deg) scale(1.2)
```

That is `packages/component-library/src/Screen/cover-the-window.ts`, and a
shell writes none of it. `<Screen>` applies it, and it applies it only to a
region that is a whole window — which is what `fills_the_window` says, and what
is false on every desktop the page's window is the whole of.

**Everything downstream already handled it**, which is why this is a table
lookup and not a subsystem. A window is a layer in the page, so what CSS does
to the page it does to the windows; `measure` reports the element→screen affine
and `surfaceLocal` inverts it, so an app under any transform — rotated, scaled,
skewed — still gets correct surface-local pointer coordinates. That was written
for CSS the shell applies and it is the same seam.

**The scale comes free and was a bug on its own.** The window is the mode in
CSS pixels and the region is the logical box, so a 3840-wide panel at density
1.2 is a 3200-wide region in a 3840-wide window — an upright desktop in the
corner of a black screen, before any rotation. One `mode ÷ box`, read across
the turn, is both.

**What a desk still has to settle is which way round the two quarter turns
are.** `rotate-90` is the turn the *content* takes, which is the `wl_output`
convention and the config file's — an output bolted a quarter turn
counterclockwise needs what is drawn on it turned clockwise — and every list from
`domicile-config` to `TURNS` in `cover-the-window.ts` applies it as written.
Reading agrees with itself all the way down; only glass can say whether the
reading was right. Swapping two arms of one `switch` is the whole fix.

**A client that pre-rotates its own buffer is still wrong**, and rotation is
what makes that reachable. `wl_output.transform` is advertised so a client can
draw pre-turned and save a pass, and the compositor does not read
`wl_surface.set_buffer_transform` — so a toolkit that took the hint would be
turned twice. Nothing in the desk does today, and the fix is in the dmabuf
submit path rather than here.

**A desk of three monitors had the chrome on one of them**, because `--app=`
opens one window and `FindWindowAt` binds a window to a controller only on an
exact rectangle match — one window cannot be two rectangles. So the engine
opens one per display now, **on the platform that scans out and nowhere
else**, and keeps doing it: `ShellWindowsFor` answers what
has no window and what has no display, and a `display::DisplayObserver` asks
it again on every add, removal and bounds change. Two rules in it are the
difference between a desktop and a dead session — the last window is never
closed, because closing it is the browser exiting, and windows open before
they close, because a dock swapped at once would otherwise pass through zero.

Every one of those windows would otherwise draw the *same* thing — they all
load the same shell, and a shell lays its `<Screen>` regions out in the
desktop's own coordinates. So each window says which display it is, and the
compositor answers that connection alone with the desktop narrowed to that
display and moved to the origin.

That gate is the same one `DomicileDisplayWatcher` is behind and is there for
the same reason: **a nested run's screen is the host's monitors.** Windowing
those would open a browser window per monitor of the desk a developer run is
sitting on, and naming one would tell the compositor its desktop is a display
it has never heard of — which it answers by narrowing to nothing, so the shell
is told no screens at all and draws nothing. That is not a hypothetical: it is
what `guard-shell.sh` and the client-window guards reported the first time this
was written without the gate.

**The browser says it, not the page.** It placed that window on that display;
a page asked to work out which monitor it is could only guess from its own
geometry, and a guess here is a monitor showing another monitor's desktop with
nothing to say so. `ScreenOf` reads it off the frame's view on the UI thread
and `ControlChannel` states it on the socket right after the handshake —
second, because the compositor puts a connection on its list when it agrees
the protocol and a `set_screen` before that names a window it has no record
of.

**`set_screen` is the one message whose answer differs per connection**, and
the one the compositor cannot broadcast. The desk has one brain and a window
each, so the display a window covers is held beside that socket's writer
rather than on the `Host` they all drive, and the desktop is re-encoded per
chrome on the way out. Everything else is encoded once for everybody, which is
why the narrowing is a `Some`/`None` rather than a branch every message pays
for.

A shell does nothing about any of this. `<Screen name="left">` renders in the
window on the left monitor and nowhere else, which is what it always meant,
and `position` is still where the region goes on the page — it is just that
the page is one screen now.

**A profile names a monitor the way it is labeled.** The `wl_output` is still
`drm-<id>` — short, always there, and what clients are already on — but every
display now carries a *description* beside it: `"<MAKE> <MODEL> <SERIAL>"`, the
string kanshi and sway match on, and an entry's `display` matches any name a
monitor answers to — the output's, that description, and that description with
the maker spelled out. So a desk can be written down without first reading an
int64 off a log, and it can be written down a monitor at a time.

It travels the route the millimeters already take (*[The physical size is in
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

**The make an EDID holds is three letters, and the compositor spells it out.**
`DEL` is what the firmware states and what crosses the ABI; the vendor's own
name is hwdata's `pnp.ids`, which libdisplay-info carries and Chromium does
not. So the compositor reads that table itself —
`packages/domicile-compositor/src/pnp_ids.rs`, once at startup, out of
`DOMICILE_PNP_IDS` (the flake's wrapper sets it to hwdata's store path) or out
of where a distribution installs one. Read at run time rather than vendored or
generated from: the table is GPL-2+ and this tree is MIT OR Apache-2.0.

| | |
|---|---|
| the `wl_output` states | `Dell Inc. DELL U3219Q 2ZLS413` — what sway prints |
| an `output.profiles` entry matches | that, or `DEL DELL U3219Q 2ZLS413`, or `drm-<id>` |
| no table on this machine | the three letters, and one line at startup saying why |

Both panel spellings match because the shorter one is what every config that
names a monitor was written against; a desk that came up right yesterday comes
up right today.

One thing it is still not: a monitor that states none of the three has an empty
description and can only be named `drm-<id>`.

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

Nothing on a tty maximizes a window: there is no window manager and no session to
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
- **Expect the gap wherever ash is ozone/drm's only consumer.** Six times now
  the platform has compiled, linked and run while doing nothing, because the
  thing that drives it lives in ash: `DisplayConfigurator::TakeControl` behind
  an `is_chromeos` assert, DRM master never asked for, `DrmWindowHost::Close()`
  empty, `Activate()` a `NOTIMPLEMENTED_LOG_ONCE()`, `BitmapCursorFactory`
  answering with a bitmapless cursor, and `CreateConverter` having no touchpad
  branch at all. Every one was silent — nothing failed, so nothing logged. When
  a piece of ozone/drm appears to work and its effect never arrives, look for
  ash supplying the other half before looking for a bug.
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
- [x] light the screens again when the console comes back — patch `0034`. The take puts DRM master back and nothing puts the mode back, so a round trip ended with the desktop flipping into a card its last owner had modeset: a refused commit every frame and `PageFlipWatchdog` fifteen seconds later. `DrmModeset::Relight`, which a wake from suspend already needed, is the way past `ModesetWouldChangeAnything`
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
- [x] the window tells views it is active — patch `0025`. Descriptors were never the problem after `0020`: `DrmWindowHost::Activate()` was `NOTIMPLEMENTED_LOG_ONCE()`, so `DesktopWindowTreeHostPlatform::is_active_` stayed false, no view held focus, and every key that arrived was dropped
- [x] a cursor factory that answers nothing — patch `0026`, 4 unit tests. `wm::CursorLoader` reaches the asset arrow only when the platform answers null, and ash gets that by holding its loader with `use_platform_cursors=false`, which views does not
- [x] the touchpad goes to libinput — patch `0027` and `use_libinput = true` in both `gn gen` blocks, with libinput in `tools/nix/make-shell-for-system.nix` because the build runs host binaries that link it
- [x] the window says what it did with a click — patch `0028`. A one-shot gated only on `IsLocatedEvent()` is spent by the startup's own synthesized move, so it answered nothing; it now excludes `EF_IS_SYNTHESIZED`, reports a press apart from a move, and reads the `EventResult` the dispatch used to discard
- [ ] take the card node from logind too — `TakeDevice` on `/dev/dri/card0` plus `PauseDevice` / `ResumeDevice`. See [The card should come from logind too](#the-card-should-come-from-logind-too)
- [ ] stop the evdev thread blocking through a console switch — `InputDeviceOpener::OpenInputDevice` answering later than it is asked, which patch `0020` priced as re-plumbing `OpenInputDeviceParams`, `EventFactoryEvdev` and the factory proxy. A thread of its own per bus stops the starvation that killed the GPU process; it does not stop the desktop losing input for the length of the switch

## Open questions

- **Fractional scale.** `wl_output` scale is `Scale::Integer` here and DRM panels
  routinely want 1.5. *Recommendation:* stay integer — `ROADMAP.md`'s existing
  "fractional scaling rounds up" gap is the same decision, and it should stay one
  decision.
