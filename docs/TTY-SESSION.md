# The tty session: DRM master, console switching and input

How the engine shares a tty with logind. Overview:
[A-DESKTOP-ON-A-TTY.md](architecture/A-DESKTOP-ON-A-TTY.md). Code is in
`packages/domicile-engine/src/ui/ozone/platform/drm/domicile/`.

## DRM master

### Taking it

- The browser process opens the card with `open()`. A logind session on the
  active VT gives the user an ACL on the card node. This is the only ACL the
  tty desktop relies on.
- The `open()` takes master only if the card is free, and nothing checks.
- `DrmWrapper::has_master_` starts `true`, so `TakeDisplayControl` assumes
  master is already held. On ChromeOS, ash calls
  `DisplayConfigurator::TakeControl` at startup. Off ChromeOS nothing does.
- Without master, `DRM_IOCTL_MODE_ATOMIC` fails with `EACCES` and nothing
  draws until a console round trip.
- `DrmMaster::Add` calls `drmSetMaster` as each card arrives, after the `open`
  and before any commit. On a card already held by this file it is a no-op.
- A card that arrives while another console is active is recorded but not
  taken. The take on the way back covers it.

### Only the opening process may drop it

1. The browser process opens the card and becomes master, which sets
   `fpriv->was_master` (`drivers/gpu/drm/drm_auth.c`).
2. `drm_file_update_pid` stops updating the file's pid once it has been master
   (`drivers/gpu/drm/drm_file.c`). The pid stays the browser's.
3. The fd moves to the GPU process over `SCM_RIGHTS`, which shares the same
   `struct drm_file` and so the same pid.
4. `drm_dropmaster_ioctl` passes only if `was_master` and the pid matches the
   caller, or the caller has `CAP_SYS_ADMIN`. The GPU process has neither.
   `drmSetMaster` runs the same check.

So `DrmMaster` keeps a `dup` of every card, keyed by sysfs path, and both
ioctls run in the browser process. A `dup` shares the `struct drm_file`, so the
drop also applies to the GPU process's copy.

### Ordering

- **Release:** the GPU process detaches planes while master is still held,
  then the browser drops master. If the drop fails, the whole release fails, so
  the switcher retries on the way back.
- **Take:** master first. The GPU process is not asked if that fails.
- The GPU process cannot set master itself, so it calls
  `DrmWrapper::AssumeMaster` to set and clear the flag. Release must clear it
  before the switch completes. Otherwise `DrmWindow::SchedulePageFlip` keeps
  committing, the commit fails, and `PageFlipWatchdog` crashes the GPU process
  after 15 s.
- **Relight after a take.** Master does not restore the mode. The kernel
  restores its own framebuffer when the last master leaves, so the GPU
  process's state is stale. `StepVtSwitch` answers a successful take with
  `kRelightDisplay`, and `DrmModeset::Relight` runs a modeset. It runs only
  after the take, never while another console holds the card.

## Console switching

- `Session.TakeControl` runs logind's `session_prepare_vt`, which sets
  `K_OFF`, `KD_GRAPHICS` and `VT_PROCESS` on the VT.
- `K_OFF` disables the kernel's `Ctrl+Alt+F<n>`. Only the desktop can start a
  switch, as with every Wayland compositor.
- The engine makes no VT ioctls; `scripts/test-logind-owns-the-console.sh`
  checks this. A `VT_SETMODE` from the engine would silently replace logind's
  handler, and logind would then never pause devices or hand over the
  console.
- The chord is read in `PlatformEventObserver::WillProcessEvent` on
  `EventFactoryEvdev`. The browser is the only process with a keyboard fd.
- The switch is `Seat.SwitchTo(n)` on the seat named by the session's `Seat`
  property, an `(so)` of id and path. `/org/freedesktop/login1/seat/self` does
  not work: logind resolves `self` from the caller's credentials and returns
  `UnknownObject` on a real tty.
- The engine reads `Seat` at startup. If the session has no seat (`Seat` reads
  `("", "/")`), the engine exits with an error naming the fix.
- The session's `Active` property drives `DrmVtSwitcher`. Its ordering is a
  tested free function, because `Active` can flip twice before the display
  delegate answers once.
- **Known gap:** the card is not a logind device, so no `PauseDevice` holds the
  switch open. Master drops one D-Bus round trip after the switch. The console
  shows a stale frame for that time, not a black one. Fix:
  [take the card from logind](architecture/A-DESKTOP-ON-A-TTY.md#the-card-should-come-from-logind-too).

## Suspend

`DrmSleep` follows logind's `PrepareForSleep` and relights the screens on wake.
logind does not pause devices or drop master for a sleep, so only the GPU state
is lost.

## Input from logind

`DrmLogindInput` is the `InputDeviceOpener`. `DrmTakenDevices` tracks state.

| Event | Action |
|---|---|
| evdev thread starts | `Manager.GetSessionByPID(0)`, subscribe to signals, `Session.TakeControl(false)` |
| udev announces a device | `stat` the node, `Session.TakeDevice(major, minor)` |
| `PauseDevice(..., "force")` | logind has already revoked the fd. Mark the device revoked; send no reply |
| `PauseDevice(..., "pause")` (seat without VTs) | Reply `PauseDeviceComplete` |
| `PauseDevice(..., "gone")` after our own `ReleaseDevice` | Ignore it; `released_` records the release. Not yet run on hardware: input after a console round trip is unverified |
| `PauseDevice(..., "gone")` otherwise | Unplugged; forget the device |
| `ResumeDevice(major, minor, fd)` | Park the fd; close and reopen the device |
| session `Active` goes true | `ReleaseDevice` and `TakeDevice` each revoked device again |
| reopen | `RemoveInputDevice(path)`, then `AddInputDevice(id, path)`; the open takes the parked fd or a fresh one |
| shutdown | `ReleaseDevice` per device, then `ReleaseControl` |

`DrmTakenDevices` keeps device names in `names_`, so a resume works for a
device whose fd was already dropped.

### logind behaviors to rely on

Reasoned from systemd's source. Not yet run on hardware, apart from the
force-pause resume.

- **A seat with VTs gets "force", never "pause".** logind revokes every device
  (`EVIOCREVOKE`) before it sends `PauseDevice`. Every laptop is in this case.
- **`ResumeDevice` may never come.** So the engine follows the session's
  `Active` property and re-takes devices itself. `TakeDevice` on a device still
  held answers `Device is taken`, so it releases first.
- **`TakeDevice` returns `(h fd, b inactive)`.** For an inactive session the fd
  is already revoked. The engine checks the boolean.
- **An inactive answer is checked against the session.** `PropertiesChanged`
  fires only on a change, so a session that was already active would never get
  an edge. If the session is active now, the engine asks again, at most twice.
- A force pause and an inactive take are logged at `ERROR`, naming the device.
  `domicile-launch` runs the engine at `--log-level=2`, so `WARNING` would be
  hidden.

Tests: `DrmInputDevicesTest` covers the table.
`scripts/test-input-comes-from-logind.sh` checks what unit tests cannot;
`drm_logind_input.cc` talks to D-Bus and has no unit test.

### The D-Bus thread

- `OpenInputDevice` is synchronous and runs on the evdev thread. The bus is
  created there, so signals arrive on that thread with no locks.
- Method calls use `CallMethodAndBlock` on the bus's own D-Bus thread, with the
  evdev thread waiting on a `base::WaitableEvent`.
- The evdev thread cannot run the bus alone: it has a UI message pump, and
  `dbus::Bus` needs an IO thread's `FileDescriptorWatcher`.
- Each bus (`DrmLogindInput`, `DrmVtSwitcher`, `DrmSleep`) has a `DEDICATED`
  single-thread runner. On a shared runner, the input bus's blocking calls
  (about 45 per switch on a 15-device laptop) would delay `DrmVtSwitcher`'s
  `Active` signal, and the GPU process would crash on the page-flip watchdog.
- **Open item:** the evdev thread still blocks for the whole switch, so input
  stops during it. Fixing this needs `OpenInputDevice` to answer
  asynchronously.

### Reopening a revoked device

- A revoked fd reads `ENODEV`, and `EventConverterEvdevImpl` calls `Stop()`.
  Nothing restarts it, and swapping the fd with `dup2` drops the epoll
  registration.
- `InputDeviceFactoryEvdev::AttachInputDevice` is the only caller of
  `EventConverterEvdev::Start()`, so the device goes back through the factory.
- The explicit `RemoveInputDevice` comes first. Otherwise the dead converter
  stays attached until a later task.
- The factory passes the reopen callback in its constructor
  (`InputDeviceOpener::SetDeviceReopener`).
- The device id is reused. `converters_` is keyed by path, and
  `AttachInputDevice` reapplies per-device settings.
