# Keys

Manganese binds sway's keys on Meta (Super, `Mod4`) by default:
`DEFAULT_KEYBINDINGS` for mode `default` and `DEFAULT_MODES` for the rest.
`runManganese({ keybindings })` replaces them.

## Default bindings

| Keys | Action |
|---|---|
| Meta+H/J/K/L, Meta+arrows | Move focus. Wraps at the ends of a container. |
| Meta+Shift+H/J/K/L, Meta+Shift+arrows | Move the window in that direction (sway's `move`), onto the next screen past the edge. |
| Meta+1 … Meta+0 | Go to workspace 1–10. |
| Meta+Shift+1 … Meta+Shift+0 | Send the window to workspace 1–10 and stay. |
| Meta+B / Meta+V | `splith` / `splitv`. |
| Meta+W / Meta+S / Meta+E | `layout tabbed` / `layout stacking` / `layout toggle split`. |
| Meta+A / Meta+Shift+A | `focus parent` / `focus child`. |
| Meta+F / Meta+Shift+F | Fullscreen on this screen / on every screen. |
| Meta+Tab | `focus mode_toggle`: switch between floating and tiled windows. |
| Meta+Shift+Tab | `floating toggle`. |
| Meta+Minus / Meta+Shift+Minus | `scratchpad show` / `move scratchpad`. |
| Meta+Shift+Q | Close the window. |
| Meta+Space, Meta+D | Toggle the launcher. |
| Meta+Shift+V | Toggle the clipboard history. |
| Meta+Shift+Return | Lock. Does nothing if the config has no `lock`. |
| Print | Take a screenshot: pick the area in the screenshot dialog. |
| Meta+R | Enter resize mode. |

There is no terminal key. Bind one with `exec`.

### Resize mode

- Meta+H/J/K/L (or arrows) grows the window that way. Meta+Return or
  Meta+Escape leaves.
- The keys need Meta, unlike sway. `grabShortcut` claims are never released,
  so a bare `h` in a mode would be taken from every client for the session.
- A tiled window grows by 1/50 of its container per press. A floating window
  grows by 10 px.

## Commands

Build commands with the exported helpers (`focus`, `move`, `workspace`,
`moveToWorkspace`, `grow`, `mode`, `exec`, …). They use sway's names:

| Command | Action |
|---|---|
| `kill` | Close the window. |
| `focus left/right/up/down` | Move focus. |
| `focus parent` / `focus child` | Select the enclosing container, or go back to the window. |
| `focus mode_toggle` | Switch between floating and tiled windows. |
| `move left/right/up/down` | Move the window. |
| `move scratchpad` / `scratchpad show` | Hide the window / show the last hidden one. |
| `move container to workspace <name>` | Send the window to workspace `1`–`10`. |
| `workspace <name>` | Go to workspace `1`–`10`, or back to the previous one if it is already shown. |
| `split h` / `split v` | Wrap the focus in a new container. |
| `layout stacking/tabbed/toggle split` | Set the container's layout. |
| `fullscreen toggle [global]` | Fullscreen on this screen, or every screen. |
| `floating toggle` | Float or tile the window. |
| `exec <argv…>` | Spawn `argv` from the compositor's `PATH`. |

Manganese-only commands:

| Command | Action |
|---|---|
| `lock` | Lock the desktop. |
| `launcher` | Toggle the launcher. |
| `clipboard` | Toggle the clipboard history. |
| `screenshot` | Take a screenshot, as Print does. |
| `resize grow left/right/up/down` | Grow the window that way. |

- `mode(name)` comes from the SDK's `bindKeys`. Each monitor's page keeps its
  own mode. The bar shows any mode other than `default`.
- An unknown command logs to the console and does nothing.
- While the launcher is open, only the `launcher` command and mode changes
  run.

## Key names

- Keysyms resolve through the compositor's keymap (`input.keyboard`).
  `Meta+h` is whatever key types `h` in your layout.
- Shift is literal: `Meta+Shift+parenleft` is the `parenleft` key with Shift
  held.

## Example

The defaults, plus a terminal on Meta+Return and workspaces on the
Programmer's Dvorak number row:

```tsx
import {
  DEFAULT_KEYBINDINGS,
  DEFAULT_MODES,
  exec,
  moveToWorkspace,
  runManganese,
  workspace,
} from "@domicile-desktop/manganese";

/** Programmer's Dvorak's number row, unshifted, for workspaces 1 to 10. */
const ROW = [
  "parenleft", "parenright", "braceright", "plus", "braceleft",
  "bracketright", "bracketleft", "exclam", "equal", "asterisk",
];

export const Shell = runManganese({
  keybindings: {
    keybindings: {
      ...DEFAULT_KEYBINDINGS,
      "Meta+Return": exec("kitty"),
      ...Object.fromEntries(
        ROW.flatMap((key, at) => [
          [`Meta+${key}`, workspace(String(at + 1))],
          [`Meta+Shift+${key}`, moveToWorkspace(String(at + 1))],
        ]),
      ),
    },
    modes: DEFAULT_MODES,
  },
});
```

These keysyms need the matching layout in the config. The compositor defaults
to plain `us`:

```ts
export const input = {
  keyboard: { xkb_layout: "us", xkb_variant: "dvp", xkb_options: ["caps:swapescape"] },
};
```

## Where bindings work

Bindings work whether the shell, a Wayland window or a browser window has
focus. Each press runs once. See
[KEYBINDINGS.md](../../../docs/architecture/KEYBINDINGS.md).

## Differences from sway

- **`exec` takes an argv**, not a `sh -c` string. For pipes, `&&` or `$VAR`,
  use `exec("sh", "-c", "…")`.
- **No per-window rules** (`for_window`). Every window opens tiled.
- **No `reload` or `exit`.** There is no config to re-read or session to end
  from the page.
- **No output, input or bar config.** The compositor's config sets displays and
  the keyboard. The bar is part of the page.
- **No per-window borders** or `hideEdgeBorders`. Every window has the same
  CSS frame.
