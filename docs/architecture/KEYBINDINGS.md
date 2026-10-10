# Keybindings

A shell passes its keybindings as props, in sway style: each chord maps to an
action. The compositor sends the keyboard layout. The engine resolves and grabs
each chord by name. The SDK grabs the shell's chords and runs the actions.

```ts
bindKeys(domicile, {
  keybindings: {
    "Meta+Return": KeyAction.SendShell(["exec", "kitty"]),
    "Meta+r": KeyAction.Mode("resize"),
  },
  modes: {
    resize: {
      "Meta+l": KeyAction.SendShell(["resize", "grow", "right"]),
      "Meta+Escape": KeyAction.Mode("default"),
    },
  },
}, { onCommand, onModeChanged });
```

Manganese takes the same shape as `runManganese({ keybindings })`, built with
its typed commands (`focus("right")`, `mode("resize")`). With no keybindings it
binds sway's defaults on Meta.

`domicile send-shell focus right` in a terminal on the desktop runs the same
command as a `SendShell(["focus", "right"])` binding.

## Design

```
compositor: keymap.rs ─▶ shell_config { keys } ─▶ engine ─────────────▶ SDK bindKeys
(keysym → evdev key)                              (grabShortcut(chord): (grabs every chord,
                                                   resolves, matches,    runs `shortcut` by
                                                   `shortcut.chord`)     chord and mode)
```

| Piece | Where | Does |
|---|---|---|
| Key table | `domicile-compositor` (`keymap.rs`, `shell_config.rs`) | Maps each keysym the layout can type to the lowest key that types it |
| Wire | `HostMessage::ShellConfig { keys }`, `packages/e2e-harness/src/protocol.ts` | Sends the table on connect and when a reload changes the keyboard |
| Chords | engine `modules/domicile/domicile_chord.*`, `DomicileHost.grabShortcut` | Parses chords and resolves them against the table, again when it changes. Throws `SyntaxError` on a bad chord and `NotFoundError` on a keysym the layout cannot type. A press arrives as `shortcut` with its `chord`, its release as `shortcutrelease` |
| Modes | `@domicile-desktop/sdk/own-keybindings` | Gives each chord one spelling and files the bindings by mode |
| Dispatch | `@domicile-desktop/sdk/bind-keys` | Grabs every chord, matches `shortcut.chord` in the current mode, runs `Mode`, passes `SendShell` to `onCommand` |

**Chord syntax:** `+`-separated modifiers, then one xkb keysym name.

- Modifiers (any case): `Meta`/`Super`/`Logo`/`Mod4`, `Shift`,
  `Ctrl`/`Control`, `Alt`/`Mod1`.
- Modifiers match exactly: `Meta+l` does not fire while Shift is held.

### Commands from a terminal

```
domicile send-shell ─▶ $DOMICILE_SOCK ─▶ supervisor ─▶ compositor ─────────────────▶ every page
                       (control socket)               (system_request send_shell)    (system_event shell_command
                                                                                       ─▶ bindKeys onCommand)
```

| Piece | Where | Does |
|---|---|---|
| Verb | `domicile-launch` (`cli.rs`, `control.rs`) | `send-shell <word>…`; every word after it is the command |
| Supervisor | `domicile-launch` (`compositor_socket::send_shell`) | Sends `send_shell` on the compositor's chrome socket without `hello`, as `domicile screenshot` does |
| Fan-out | `domicile_host::shell_commands`, `domicile_host::system` | Tells every page listening with `shell_commands`; answers `sent`, or fails when none listens |
| Listener | `@domicile-desktop/sdk/system` `shellCommands()`, `bindKeys` | `bindKeys` listens while bound and passes each command to `onCommand` |

## Key decisions

- **Chords name keysyms** (`parenleft`), as in sway. The compositor owns the
  xkb keymap, so it reports which key types each keysym.
- **The compositor sends the key table; the chords stay in the page.** Data
  flows one way, so it needs no reply message. The engine reads the table, so
  a chord is resolved where its press is matched.
- **The engine matches.** The compositor never sees the press: the browser
  process matches a grabbed chord in a `<webview>` or on the page.
- **The SDK owns modes.** It reports the current mode through `onModeChanged`
  so the shell can display it. The shell never interprets keys.
- **Applications' global shortcuts are grabs too.** The GlobalShortcuts
  portal's chords use this syntax and grab path; see
  [PORTALS.md](../PORTALS.md).
- **A terminal command is a system call, not a host message.** The engine
  relays system lines whole, so the route needs no engine change. A new
  `HostMessage` would need a fork change and an engine release.
- **Every page listening hears a terminal command.** The compositor does not
  know which page the user is looking at.
- **A locked desktop refuses `send_shell` but allows `shell_commands`.** A
  page reloaded while locked still hears commands after unlock. See
  [LOCK.md](../LOCK.md).
- **Grabs are permanent.** The engine's `ShortcutRegistry` has no release. If
  a layout change moves a keysym to another key, the old key stays grabbed
  until restart.
