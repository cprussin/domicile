# Start from manganese

Manganese is a set of React packages. Build your shell from it: change its
options, add your own bar items, or take its parts into a shell of your own.

## Change its options

`runManganese` is manganese as a shell. Every option is optional:

```tsx
// shell.tsx
import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
import { DEFAULT_KEYBINDINGS, exec } from "@domicile-desktop/manganese-window-management/keyboard/commands";

export const Shell = runManganese({
  bar: DEFAULT_BAR,
  floating: [{ app: "pinentry" }],
  keybindings: {
    keybindings: { ...DEFAULT_KEYBINDINGS, "Meta+Return": exec("foot") },
  },
});
```

```sh
domicile ./shell.tsx
```

- `bar`: the top bar's `left`, `center` and `right` columns
  ([TOP-BAR.md](/packages/shell-manganese/docs/TOP-BAR.md)).
- `keybindings`: the key table
  ([KEYS.md](/packages/manganese-window-management/docs/KEYS.md)).
- `floating`: windows that open floating
  ([WINDOW-MANAGEMENT.md](/packages/manganese-window-management/docs/WINDOW-MANAGEMENT.md#opening-floating)).
- `applications`: the launcher's hidden apps and bookmarks
  ([LAUNCHER.md](LAUNCHER.md)).
- `inboxes`: Gmail and Google Messages in the notification drawer
  ([TOP-BAR.md](/packages/shell-manganese/docs/TOP-BAR.md#inboxes)).

The same `Shell` export in `~/.config/domicile/domicile.tsx` makes it your
desktop ([SHELL-CONFIG.md](SHELL-CONFIG.md#a-config-module)).

## Add a bar item

A bar item is a React component. It reads the desktop with
`@domicile-desktop/react`'s hooks and styles itself with manganese's Panda
CSS:

```tsx
import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
import { css } from "@domicile-desktop/manganese/css";
import { useWindows } from "@domicile-desktop/react/windows";

const WindowCount = () => (
  <span className={css({ color: "muted" })}>{useWindows().length} windows</span>
);

export const Shell = runManganese({
  bar: { ...DEFAULT_BAR, center: [...DEFAULT_BAR.center, <WindowCount key="count" />] },
});
```

More: [CUSTOM-BAR-ITEMS.md](/packages/shell-manganese/docs/CUSTOM-BAR-ITEMS.md),
[HOST-READOUTS.md](/packages/shell-manganese/docs/HOST-READOUTS.md).

## Take its parts

Each part of manganese is its own package: the bar and each bar item, window
management, the launcher, notifications, the clipboard, the lock screen, the
wallpaper. Mount the ones you want in your own shell. The list:
[shell-manganese](/packages/shell-manganese/README.md#packages), and how they
fit: [SOURCE.md](/packages/shell-manganese/docs/SOURCE.md).
