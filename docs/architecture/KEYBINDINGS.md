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
| Chords | engine `modules/domicile/domicile_chord.*`, `DomicileHost.grabShortcut` | Parses chords and resolves them against the table, again when it changes. Throws `SyntaxError` on a bad chord and `NotFoundError` on a keysym the layout cannot type. A press arrives as `shortcut` with its `chord` |
| Modes | `@domicile-desktop/sdk/own-keybindings` | Gives each chord one spelling and files the bindings by mode |
| Dispatch | `@domicile-desktop/sdk/bind-keys` | Grabs every chord, matches `shortcut.chord` in the current mode, runs `Mode`, passes `SendShell` to `onCommand` |

**Chord syntax:** `+`-separated modifiers, then one xkb keysym name.

- Modifiers (any case): `Meta`/`Super`/`Logo`/`Mod4`, `Shift`,
  `Ctrl`/`Control`, `Alt`/`Mod1`.
- Modifiers match exactly: `Meta+l` does not fire while Shift is held.

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
  [PORTALS.md](PORTALS.md).
- **Grabs are permanent.** The engine's `ShortcutRegistry` has no release. If
  a layout change moves a keysym to another key, the old key stays grabbed
  until restart.

## Plan

- [x] Key table, wire message, engine event, SDK dispatch
- [x] Keybindings as shell props; manganese and shell-simple bind their own
- [ ] `domicile send-shell <word>…`: run a `SendShell` action from a terminal,
      routed supervisor → compositor → every page
