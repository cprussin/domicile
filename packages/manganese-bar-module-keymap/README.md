# @domicile-desktop/manganese-bar-module-keymap

A manganese bar item: the keymap the desktop types on, and a list to switch
it.

## Use

Manganese's default bar and lock screen have `<Keymap />`. To put it in your
own bar:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Keymap } from "@domicile-desktop/manganese-bar-module-keymap";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Keymap key="keymap" />] },
});
```

- It shows only for a config with several `input.keyboard.keymaps`
  ([SHELL-CONFIG.md](../../docs/SHELL-CONFIG.md#keyboard)).
- It takes no props. The shell option `keymap.hideDefault` hides it while the
  first keymap is active.

See [TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#keymap).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-keymap
```
