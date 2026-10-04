# Keybindings are a shell's

A shell binds its keys as its props, sway-style: a chord maps to an action. The
compositor says which key each keysym is on; the engine resolves and grabs a
chord by name; the SDK grabs a shell's chords and answers them.

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

Manganese takes these as `runManganese({ keybindings })`, built with its typed
commands (`focus("right")`, `mode("resize")`), and binds sway's keys on Meta
when given none.

## Design

```
compositor ─▶ keymap.rs: every keysym → evdev key ─▶ shell_config { keys } ─▶ engine ─────────────▶ SDK bindKeys
                                                                              grabShortcut(chord)   grabs every chord,
                                                                              resolves, matches,    answers `shortcut`
                                                                              `shortcut.chord`      by chord and mode
```

| Piece | Where | Does |
|---|---|---|
| the table | `domicile-compositor` (`keymap.rs`, `shell_config.rs`) | each keysym the configured layout types, and the lowest key it is on |
| wire | `HostMessage::ShellConfig { keys }` / `packages/e2e-harness/src/protocol.ts` | the table, on connecting and when a reload moves the keyboard |
| chords | engine `modules/domicile/domicile_chord.*`, `DomicileHost.grabShortcut` | the grammar, resolved against the table and again when it moves; a bad chord is a `SyntaxError`, an untypeable keysym a `NotFoundError`; a press comes back as `shortcut` with its `chord` |
| modes | `@domicile-desktop/sdk/own-keybindings` | the grammar only: one spelling per chord, filed by mode |
| dispatch | `@domicile-desktop/sdk/bind-keys` | grabs every chord, matches `shortcut.chord` in the current mode, runs `Mode`, hands `SendShell` on |

**Chord**: `+`-separated modifiers (`Meta`/`Super`/`Logo`/`Mod4`, `Shift`,
`Ctrl`/`Control`, `Alt`/`Mod1`, any case), then one xkb keysym name. Modifiers
are exact: `Meta+l` does not fire with Shift held.

## Key decisions

- **Keysyms, resolved against the compositor's keymap.** A chord names
  `parenleft`, as sway's does; the compositor owns the xkb keymap and sends
  where each keysym is. That replaced manganese's hand-kept Programmer's
  Dvorak table, which was right on exactly one keyboard.
- **The table, not the chords, crosses the wire.** The page has the chords and
  the compositor the keymap; sending the whole table one way needs no message
  the other way. The engine reads it, so a chord is resolved where the press
  is matched.
- **The engine matches, not the compositor.** A grabbed chord is matched in
  the browser process, in a `<webview>` or on the page; the compositor sees
  neither press.
- **Modes are the SDK's.** The shell is told the mode to show it and never
  interprets keys itself.
- **Claims are never given back** (the engine's `ShortcutRegistry` has no
  release), so a key a layout change moves off stays swallowed until restart.

## Plan

- [x] the table, wire, engine event, SDK dispatch
- [x] keys as a shell's props; manganese and shell-simple bind their own
- [ ] `domicile send-shell <word>…`: the same action from a terminal, routed
      supervisor → compositor → every page
