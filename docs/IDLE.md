# Idle blanking

The compositor turns the screens off after `idle.blank_after_seconds` without
input, and locks the desktop after `idle.lock_after_seconds`
([LOCK.md](LOCK.md)). What a shell does with this:
[SHELL-IDLE-AND-LOCK.md](SHELL-IDLE-AND-LOCK.md#idle).

## Two clocks

- Both timeouts count from the same last input, and the same inhibitors hold
  both off. Either may be the shorter.
- Blanking does not lock. Without `lock_after_seconds` the desktop locks only
  when the shell calls `lock()`.
- `Idle::lock_due` reports the lock edge once per spell without input. The
  timer, and any inhibitor change, checks it before a modeset, so the lock
  screen is up before a screen lights.
- Blanking waits until 1 second after the lock (`LOCK_SCREEN_DRAWS_WITHIN`),
  so the shell draws its lock screen on every monitor first. A monitor the
  page is mirrored to can show its last frame when it lights again, and that
  frame must not be the unlocked desktop.
- Releasing the last inhibitor after either timeout acts at once.
- **The engine reports all of its input** (`activity`). Only input to a
  client's window is forwarded, so without it a key typed into a browser
  window or the shell's page would not reset the clock, and the desk would
  lock under somebody typing.
- **Input is a key, a click, a scroll or a pointer that moved on the
  screen.** aura synthesizes a move under a still pointer after a window
  changes or the displays are configured, and blanking can be such a change. The
  engine forwards it with `moved: false` (Blink's `movementX/Y` are zero), so
  the client still hears it and the clock does not.

## Blanking

Blanking uses the same path as any layout change,
`domicile_displays_configure`
([DISPLAYS.md](DISPLAYS.md#which-connectors-light)).

- **Blanking sends every connector with `enabled: false`.** An empty list would
  light everything.
- **The list comes from the engine's display list** (`crate::idle::darkened`),
  not `Screens::scanout`, which omits monitors no profile names.
- **Relighting sends `Screens::scanout` again:** the profile's connectors, or
  the empty list.
- **The engine keeps the desk through a blank** (`DeskPlacesKept`). A layout
  that lights nothing leaves the shell's window and every presenter in place,
  so each monitor shows the page's current frame when it lights again.
- The engine lights a new monitor on its own, so the hotplug path also calls
  `keep_the_screens_dark`. A monitor plugged in while blanked stays off.
- `crate::idle` holds the clock and is unit-tested. The compositor sends a
  configure only when the answer changes. Otherwise a blanked desktop would
  modeset every tick.

### Telling the shell

`HostMessage::Idle` says whether anyone is at the desktop. It is sent on both
edges, before the modeset.

- It carries the state, not the edge, and a page that says hello gets the
  current state. A reloaded page has missed every earlier edge.
- The idle message arrives with the blanking, not before the timeout.
- A desktop with no timeout sends neither.

### Warning the shell

With `idle.warn_before_seconds`, the compositor warns the shell that long
before blanking.

- **The warning is a system call stream**, `SystemRequest::IdleWarnings`, so
  it needs no engine change ([SHELL-SYSTEM-ACCESS.md](SHELL-SYSTEM-ACCESS.md#wire)).
  Each `SystemEvent::IdleWarning` carries `blanks_in_ms`, or `null` when the
  warning ends.
- **Input or an inhibitor during the warning calls it off.** The screens stay
  on. Input restarts the timer; an inhibitor does not, so releasing it inside
  the warning window warns again and blanks at the original timeout.
- **The warning ends with the blanking.** The shell hears `null` as the
  screens go dark.
- **An inhibitor released after the timeout blanks at once**, with no warning.
- `crate::idle` decides the warning (`Blanking::Warn`, `Blanking::CallOff`).
  `domicile_host::idle_warnings` holds it for every connection, so a page that
  listens during a warning hears it at once.

### Idle inhibitors

`zwp_idle_inhibit_manager_v1` is advertised. An inhibitor blocks blanking. It does not reset the timer, so:

- an inhibitor taken while blanked relights the screens, with the same `ComeBack` edge
  as a keystroke;
- when the last inhibitor goes away after the timeout has passed, the screens
  blank at once.

An inhibitor holds only while its surface is a toplevel window
(`crate::idle::holds`):

| Check | Source |
|---|---|
| The client is alive | `WlSurface::is_alive`, checked after each round of client events. A crashed client sends no release |
| The surface is a mapped toplevel | The window list `new_toplevel` and `toplevel_destroyed` maintain |

- An inhibitor taken before its window maps starts holding when the window
  appears.
- An inhibitor whose window closes stops holding at once.
- An inhibitor on a subsurface holds nothing.

The Inhibit portal's idle flag (`8`) blocks blanking the same way while the
application holds it. It names no surface, so it holds with no window showing
(`Idle::held_by_portals`).

A shell holds one the same way: `dbusCall` to
`org.freedesktop.portal.Inhibit.Inhibit`, and `Request.Close` on the returned
handle to let go. Manganese's idle inhibitor bar item does this.

### What holds the desktop awake

- **`SystemRequest::IdleHolds` streams the holders**, as names. Each
  `SystemEvent::IdleHolds` carries the full list, at once and on each change.
  - A Wayland inhibitor is named by its window's app id, and only while it
    holds.
  - A portal inhibitor is named by its app id, or, for an unsandboxed
    application, its process name (`/proc/<pid>/comm`). A shell page's own
    hold is `domicile`.
  - A desktop with no timeout lists none.
- Manganese's eye opens while anything holds, and names the holders in its
  tooltip.
- Each change is logged at info, `what holds this desktop awake changed`.

### Finding what keeps a desktop awake

Input that restarts the clock after the desktop sat still for half its shortest
timeout is logged at info, `input restarts the idle clock`, with what it was
and how long the desktop had been still. For the browser's own input,
`detail` names the event and the device, e.g. `MouseMoved from Logitech USB
Receiver`. Where the compositor logs to the
journal, read both lines with:

```sh
journalctl -b --grep 'idle clock|holds this desktop'
```

- **No new protocol:** the portal already reaches `crate::idle`.
- **A reload lets go:** each page has its own D-Bus connection, which closes
  with the page, and xdg-desktop-portal closes the requests of a caller that
  leaves the bus.

### Checking it on hardware

CI has no `/dev/dri`. On hardware, look for:

```
nobody is at this desktop; its screens go dark soon
nobody is at this desktop; its screens go dark connectors=2
somebody is at this desktop again; its screens come back on
```

and, with `--vmodule=drm*=1`, `configuring N display(s)`.
