# Keybindings live in the config

A desk's keys are written in the compositor's TOML, sway-style: a chord maps to
an action, and an action is a domicile command. A shell owns what its commands
*do*, not which keys reach them.

```toml
[keybindings]                        # every shell, mode "default"
"Meta+Return" = "send-shell terminal"

[shells.manganese.keybindings]       # only the shell named "manganese"
"Meta+l" = "send-shell focus right"
"Meta+r" = "mode resize"

[shells.manganese.modes.resize]      # a mode, as sway's `mode "resize" { … }`
"Meta+l" = "send-shell resize grow right"
"Meta+Escape" = "mode default"

[shells.manganese.options]           # freeform, handed to that shell as JSON
```

## Design

```
config ─▶ domicile-config ─▶ compositor ─▶ shell_config ─▶ engine ─▶ shellconfig event ─▶ SDK bindKeys
          parse, validate     keysym → evdev                 forwards       claims, matches, dispatches
                              via the live keymap            the line       send-shell → the shell
```

| Piece | Where | Does |
|---|---|---|
| schema | `domicile-config` (`keybindings.rs`, `shells.rs`) | chord and action grammar, every refusal that needs no keymap |
| resolution | `domicile-compositor` (`keymap.rs`) | each keysym to the evdev key it is on, in the layout `input.keyboard` names |
| wire | `HostMessage::ShellConfig` / `@domicile/chrome-sdk/protocol` | every mode's bindings, top-level and per shell, plus each shell's `options` |
| transport | engine `control_channel.cc` → `DomicileShellConfigEvent` | the line verbatim as `config: string` |
| dispatch | `@domicile/chrome-sdk/bind-keys` | claims every chord, matches presses in the current mode, runs `mode`, hands `send-shell` on |

**Chord**: `+`-separated modifiers (`Meta`/`Super`/`Logo`/`Mod4`, `Shift`,
`Ctrl`/`Control`, `Alt`/`Mod1`, any case), then one xkb keysym name. Modifiers
are exact: `Meta+l` does not fire with Shift held.

**Action**: `send-shell <word>…` or `mode <name>`. A shell's vocabulary is in
its README.

## Key decisions

- **Keysyms, resolved by the compositor.** The config names `parenleft`, as
  sway's does; the compositor owns the xkb keymap and turns it into the key it
  is on. That replaced manganese's hand-kept Programmer's Dvorak table, which
  was right on exactly one keyboard. A keysym on no key refuses the config the
  way an uncompilable keyboard does.
- **The SDK dispatches, not the compositor.** Claims are matched in the browser
  process (a focused `<webview>`) and in the page (a focused Wayland window);
  the compositor sees neither press. Dispatching where the press already lands
  costs no round trip and no engine change beyond carrying the message.
- **Forwarded as a string.** `[shells.<name>.options]` is freeform and cannot
  be typed in WebIDL, so the engine carries the line and the SDK parses it with
  Zod. One engine change covers every later field.
- **Per shell, keyed by name.** One file holds every shell a desk may load;
  `bindKeys(domicile, "manganese", …)` picks its own and merges it over the
  top-level tables, the shell's binding winning on the same chord.
- **Modes are the SDK's.** `mode` is generic and sway's; the shell is told the
  mode to show it and never interprets keys itself.
- **Claims are never given back** (the engine's `ShortcutRegistry` has no
  release), so a chord a reload removes stays swallowed until restart.

## Plan

- [x] schema, resolution, wire, engine event, SDK dispatch
- [x] manganese and shell-simple read their keys from the config
- [ ] `domicile send-shell <word>…`: the same action from a terminal, routed
      supervisor → compositor → every page
