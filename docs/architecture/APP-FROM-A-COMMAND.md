# An app from a command

A shell writes `<App cmd={["xsane"]} />`. Mounting it runs the command and
shows every window the command opens. Unmounting it closes those windows and
kills the command.

```tsx
<App
  cmd={["xsane"]}
  layout={(windows) => <Split>{windows.map((w) => <app app-id={w} />)}</Split>}
  fallback={(state) => <Placeholder state={state} />}
/>
```

A command does not map to one window: it may fork, open several windows, hand
off to a running instance, or open none. The compositor ties each window to the
launch that caused it, and the shell decides how to lay them out.

## Design

```
<App cmd> ─ callSystem {call:"launch"} ─▶ compositor
                                          ├─ listens on wayland-launch-<id>
                                          ├─ mints an activation token for <id>
                                          ├─ spawns cmd (WAYLAND_DISPLAY, XDG_ACTIVATION_TOKEN, own scope)
                                          └─ streams events back:
                                               window <appId>    a window joined the launch
                                               closed <appId>    it closed
                                               elsewhere <appId> a running app raised its existing window
                                               exited <Exit>     the process exited
<App> unmounts ─ cancel the call ─▶ close the launch's windows, then kill its scope
```

| Piece | Where | Does |
|---|---|---|
| `launch` system call | `domicile-compositor` (new `app_launch.rs`), `domicile_host::system` | Runs one launch, binds its windows, streams the events above, and ends it when the call is canceled |
| Per-launch socket | `domicile-compositor` `clients.rs` | Accepts clients like the main socket, tagging each with the launch id |
| Launch tokens | `domicile-compositor` `activation.rs` | One token per launch, kept apart from the newest-only tokens a press mints |
| `launch()` | `@domicile-desktop/sdk/system` | Wraps the call: an async iterable of events and an `end()` |
| `<App>` | manganese | Keeps the launch's window list and state, renders `layout` or `fallback`, and ends the launch on unmount |

## Binding a window to a launch

A toplevel joins a launch when either of these holds:

- **Its client connected through the launch's socket.** The command and its
  forked children inherit `WAYLAND_DISPLAY`, so this catches forks and every
  window they open. A Flatpak passes the socket into its sandbox, so it works
  there too.
- **It activated with the launch's token, as a new toplevel.** This catches a
  single-instance app whose new process asks the running instance to open a
  window, then exits.

Popups and dialogs are not bound on their own. They follow their parent, which
`DomicileWindow.parent` and `transientFor` already name.

A toplevel that activates with the launch's token but was already mapped is a
running app raising its existing window. It is focused where it is, and the
launch reports `elsewhere`. It is never moved into the `<App>`: one window can
embed in one place, and taking it from where the user put it would surprise
them.

## Key decisions

- **The socket over the scope as the main signal.** A scope exists only when
  `--scope-clients yes`. The socket works on every desk. The scope is still how
  a launch is killed, because it holds every forked process.
- **The socket over pid ancestry.** A double fork reparents the child to init,
  and reading `/proc` races the fork.
- **No `app_id` matching.** It cannot tell two launches of one app apart, and
  it would bind windows the launch did not open.
- **A system call over a new `DomicileHost` method.** A launch is a process
  with a stream of events, which is what `callSystem` carries, and it needs no
  engine release.
- **Every window goes to the shell.** The shell knows which commands want
  which layout (xsane's windows side by side, for example). The compositor
  only says which windows belong together.

## Ending a launch

Canceling the call (unmounting the `<App>`) ends the launch:

1. Send `xdg_toplevel.close` to each window the launch owns, so an app can ask
   to save.
2. After 5 s, `SIGTERM` the launch's scope, then `SIGKILL` 5 s later. Without a
   scope, the spawned pid gets the signals instead.
3. Close the socket and drop the token.

A window bound by token belongs to a process the launch did not start. Step 1
closes it. Steps 2 and 3 leave that process alone. An `elsewhere` window is
not closed at all.

A launch whose process exits, with no window left open, ends on its own. Its
`<App>` shows `fallback` with the exit.

## Plan

- [ ] per-launch socket and client tagging in the compositor
- [ ] per-launch activation tokens and binding by token
- [ ] the `launch` system call: events, cancel, close then kill
- [ ] `launch()` in `@domicile-desktop/sdk/system`
- [ ] `<App>` in manganese, with per-command layouts in its config

## Open questions

- **An app that D-Bus activates instead of forking** (some GNOME apps through
  `gapplication launch`). Its process starts under the bus, without the
  launch's socket. If it honors the token, binding by token catches the window.
  If not, the window opens unbound. Recommendation: accept that, and revisit if
  an app the user runs does it.
