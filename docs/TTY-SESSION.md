# The tty session: DRM master, console switching and input

How the engine shares a tty with logind. Overview:
[A-DESKTOP-ON-A-TTY.md](architecture/A-DESKTOP-ON-A-TTY.md). Code is in
`packages/domicile-engine/src/ui/ozone/platform/drm/domicile/`.

## The session

`DrmLogindSession` holds control of the logind session. Every card, keyboard
and mouse comes from it.

- `InitializeUI` builds it, before the primary card is opened and before the
  evdev thread starts. It calls `Manager.GetSessionByPID(0)`, subscribes to
  the session's signals, then calls `Session.TakeControl(false)`.
- logind accepts `TakeDevice` only from the D-Bus connection that called
  `TakeControl`, so the cards and the input devices share this one.
- Calls block the bus's own thread, never the caller's, except at startup and
  when a card is taken. Those wait on the UI thread for one round trip, so
  `DrmLogindSession` is a friend of
  `ScopedAllowBaseSyncPrimitivesOutsideBlockingScope` (patch `0131`).
- Signals arrive on the UI thread. A card's (DRM major 226) are handled
  there; an input device's go to `DrmLogindInput` on the evdev thread.
- Its destructor calls `ReleaseControl`, which releases every device.

## DRM master

logind owns DRM master. The engine makes no master ioctls.

- **Taking a card.** `OpenDrmDevice` calls `DrmLogindSession::TakeCard`, which
  is `Session.TakeDevice`. logind opens the card and sets master while the
  session is active. A card the session already holds is released first, as
  when a relaunched GPU process opens the primary card again.
- **Switching away.** A seat with VTs gets `PauseDevice(..., "force")` for the
  card: logind drops master before the switch, then `Active` goes false. A
  flip in between fails with `EACCES`. `HardwareDisplayController` asks the
  kernel (`DrmWrapper::HoldsMaster`), records master as lost and skips the
  frame, so `PageFlipWatchdog` stays disarmed. Then `DrmVtSwitcher`'s
  relinquish records it for every card (`DrmWrapper::AssumeMaster(false)`).
- **Switching back.** logind sets master on the same file, sends
  `ResumeDevice`, then answers `Active`. `DrmVtSwitcher` reads `Active` with a
  round trip to logind, so master is set before the GPU process is told to
  draw (`AssumeMaster(true)`).
- **Relight after a take.** Master does not restore the mode. The kernel
  restores its own framebuffer when the last master leaves, so the GPU
  process's state is stale. `StepVtSwitch` answers a successful take with
  `kRelightDisplay`, and `DrmModeset::Relight` runs a modeset. It runs only
  after the take, never while another console holds the card.
- **A removed card** is given back with `ReleaseDevice`.
- On a seat without VTs logind sends "pause" instead, and the session answers
  `PauseDeviceComplete` at once.

`scripts/test-the-card-comes-from-logind.sh` checks the series for each of
these; `HardwareDisplayControllerTest.AFlipAfterLogindTookMasterIsSkipped`
covers the skipped flip.

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
- `DrmConsoleChordSink`, a dispatcher added ahead of every window, stops the
  chord there, so no page or client sees it.
- The switch is `Seat.SwitchTo(n)` on the seat named by the session's `Seat`
  property, an `(so)` of id and path. `/org/freedesktop/login1/seat/self` does
  not work: logind resolves `self` from the caller's credentials and returns
  `UnknownObject` on a real tty.
- The engine reads `Seat` at startup. If the session has no seat (`Seat` reads
  `("", "/")`), the engine exits with an error naming the fix.
- The session's `Active` property drives `DrmVtSwitcher`. Its ordering is a
  tested free function, because `Active` can flip twice before the display
  delegate answers once.

## Suspend

`DrmSleep` follows logind's `PrepareForSleep` and relights the screens on wake.
The compositor locks the desktop before the sleep
([LOCK.md](LOCK.md#sleep-and-logind)).
logind does not pause devices or drop master for a sleep, so only the GPU state
is lost.

## Input from logind

`DrmLogindInput` is the `InputDeviceOpener`. `DrmTakenDevices` tracks state.

| Event | Action |
|---|---|
| evdev thread starts | Listen to `DrmLogindSession`'s input-device signals |
| udev announces a device | `stat` the node, `Session.TakeDevice(major, minor)`; open the device when logind answers |
| `PauseDevice(..., "force")` | logind has already revoked the fd. Mark the device revoked; send no reply |
| `PauseDevice(..., "pause")` (seat without VTs) | Reply `PauseDeviceComplete` |
| `PauseDevice(..., "gone")` after our own `ReleaseDevice` | Ignore it; `released_` records the release. Not yet run on hardware: input after a console round trip is unverified |
| `PauseDevice(..., "gone")` otherwise | Unplugged; forget the device |
| `ResumeDevice(major, minor, fd)` | Park the fd; close and reopen the device |
| session `Active` goes true | `ReleaseDevice` and `TakeDevice` each revoked device again |
| reopen | `RemoveInputDevice(path)`, then `AddInputDevice(id, path)`; the open takes the parked fd or a fresh one |
| shutdown | `ReleaseDevice` per device; `DrmLogindSession` then calls `ReleaseControl` |

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
`drm_logind_input.cc` and `drm_logind_session.cc` talk to D-Bus and have no
unit test.

### The D-Bus thread

- `OpenInputDevice` answers with a callback (patch `0132`).
  `DrmLogindInput` asks `DrmLogindSession` for the device and answers when
  logind does, so the evdev thread keeps reading every open device through a
  console switch.
- `InputDeviceFactoryEvdev` attaches the converter when the opener answers,
  posted to the evdev thread.
- logind answers calls in order, so a `TakeDevice` sent right after a
  `ReleaseDevice` does not wait for the release's answer. A release's "gone"
  echo is expected from when the call is sent: logind sends it before it
  answers.
- The session's bus runs blocking calls on its own thread. `dbus::Bus` needs
  an IO thread's `FileDescriptorWatcher`, which a thread-pool worker has.
- Each bus (`DrmLogindSession`, `DrmVtSwitcher`, `DrmSleep`) has a
  `DEDICATED` single-thread runner. On a shared runner, the session's blocking
  calls (about 45 per switch on a 15-device laptop) would delay
  `DrmVtSwitcher`'s `Active` signal.

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
