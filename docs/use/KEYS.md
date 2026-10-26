# Keys

Manganese uses [sway](https://swaywm.org)'s keys on the Meta key (the Windows
or Super key).

## Windows

| Keys | Does |
|---|---|
| Meta+H/J/K/L, Meta+arrows | Focus the window left, down, up or right |
| Meta+Shift+H/J/K/L, Meta+Shift+arrows | Move the window that way, onto the next monitor past the edge |
| Meta+Shift+Q | Close the window |
| Meta+F | Fullscreen on this monitor |
| Meta+Shift+F | Fullscreen across every monitor |
| Meta+Shift+Tab | Float the window, or tile it again |
| Meta+Tab | Switch between floating and tiled windows |
| Meta+Minus | Show or hide the scratchpad |
| Meta+Shift+Minus | Move the window to the scratchpad |

## Workspaces

| Keys | Does |
|---|---|
| Meta+1 … Meta+0 | Go to workspace 1–10 |
| Meta+Shift+1 … Meta+Shift+0 | Send the window to workspace 1–10 |

## Layout

| Keys | Does |
|---|---|
| Meta+W | Tabs |
| Meta+S | Stacked |
| Meta+E | Side by side, switching between across and down |
| Meta+B / Meta+V | Put the next window beside / below this one |
| Meta+A / Meta+Shift+A | Select the window's group / back to the window |

## The desktop

| Keys | Does |
|---|---|
| Meta+Space, Meta+D | [The launcher](LAUNCHER.md) |
| Meta+Shift+V | [Clipboard history](CLIPBOARD.md) |
| Meta+Shift+Space | Open the copied address, or search for the copied text |
| Meta+Shift+Return | Lock |
| Print | [Screenshot](SCREENSHOTS.md) |
| Volume, mute and brightness keys | Step the level, shown in a small notice |

## In a browser window

| Keys | Does |
|---|---|
| Alt+Left / Alt+Right | Back / forward |
| Ctrl+R | Reload |
| Ctrl+F | Find in the page |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset |
| Ctrl+Shift+P | Print |
| Ctrl+Shift+I | Developer tools |

## Add your own

Keys are set in a config module, `~/.config/domicile/domicile.tsx`, in place
of `domicile.json`. Edit it in any editor, or on the Settings app's **Code**
page; the desktop reloads it when you save. This one keeps the defaults and
adds a terminal on Meta+Return:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import {
  DEFAULT_KEYBINDINGS,
  exec,
} from "@domicile-desktop/manganese-window-management/keyboard/commands";

export const Shell = runManganese({
  keybindings: {
    keybindings: { ...DEFAULT_KEYBINDINGS, "Meta+Return": exec("kitty") },
  },
});
```

- `exec` takes the program and its arguments. For a shell line, use
  `exec("sh", "-c", "…")`.
- Every other action has a command too, such as `resize grow left`,
  `notifications`, `night-light` and `keymap next`. The full list, and an
  example for other keyboard layouts:
  [KEYS.md](../../packages/manganese-window-management/docs/KEYS.md#commands).
- `domicile send-shell <command>` runs one from a terminal:
  `domicile send-shell workspace 2`.
