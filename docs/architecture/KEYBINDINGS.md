# Keybindings

A shell passes its keybindings as props, in sway style: each chord maps to an
action. The compositor sends the keyboard layout. The SDK resolves the chords,
claims the keys and runs the actions.

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

## Design

```
compositor: keymap.rs ─▶ shell_config { keys } ─▶ engine ─▶ SDK bindKeys
(keysym → evdev key)                              (passes   (resolves chords, claims,
                                                   through)  matches, dispatches)
```

| Piece | Where | Does |
|---|---|---|
| Key table | `domicile-compositor` (`keymap.rs`, `shell_config.rs`) | Maps each keysym the layout can type to the lowest key that types it |
| Wire | `HostMessage::ShellConfig { keys }`, `@domicile-desktop/sdk/protocol` | Sends the table on connect and when a reload changes the keyboard |
| Transport | engine `control_channel.cc` → `DomicileShellConfigEvent` | Passes the message through as `config: string` |
| Chords | `@domicile-desktop/sdk/own-keybindings` | Parses chords and resolves them against the table. Throws on a bad chord or a keysym the layout cannot type |
| Dispatch | `@domicile-desktop/sdk/bind-keys` | Claims every chord, matches presses in the current mode, runs `Mode`, passes `SendShell` to `onCommand` |

**Chord syntax:** `+`-separated modifiers, then one xkb keysym name.

- Modifiers (any case): `Meta`/`Super`/`Logo`/`Mod4`, `Shift`,
  `Ctrl`/`Control`, `Alt`/`Mod1`.
- Modifiers match exactly: `Meta+l` does not fire while Shift is held.

## Key decisions

- **Chords name keysyms** (`parenleft`), as in sway. The compositor owns the
  xkb keymap, so it reports which key types each keysym.
- **The compositor sends the key table; the chords stay in the page.** Data
  flows one way, so it needs no reply message and no engine change.
- **The SDK dispatches.** The compositor never sees the press: the browser
  process matches claims when a `<webview>` has focus, and the page matches
  them when a Wayland window has focus.
- **The SDK owns modes.** It reports the current mode through `onModeChanged`
  so the shell can display it. The shell never interprets keys.
- **Claims are permanent.** The engine's `ShortcutRegistry` has no release. If
  a layout change moves a keysym to another key, the old key stays claimed
  until restart.

## Plan

- [x] Key table, wire message, engine event, SDK dispatch
- [x] Keybindings as shell props; manganese and shell-simple bind their own
- [ ] `domicile send-shell <word>…`: run a `SendShell` action from a terminal,
      routed supervisor → compositor → every page
