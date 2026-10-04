# Idle blanking

The compositor turns the screens off after `idle.blank_after_seconds` without
input. If `lock` is configured, the desktop locks at the same moment
([LOCK.md](LOCK.md)). What a shell does with this:
[SHELL-IDLE-AND-LOCK.md](SHELL-IDLE-AND-LOCK.md#idle).

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
- The idle message arrives with the blanking, not before the timeout. There is
  no warning to dim or count down with.
- A desktop with no timeout sends neither.

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

### Checking it on hardware

CI has no `/dev/dri`. On hardware, look for:

```
nobody is at this desktop; its screens go dark connectors=2
somebody is at this desktop again; its screens come back on
```

and, with `--vmodule=drm*=1`, `configuring N display(s)`.
