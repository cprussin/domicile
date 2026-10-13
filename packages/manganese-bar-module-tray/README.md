# @domicile-desktop/manganese-bar-module-tray

A manganese bar item: the system tray: apps' StatusNotifierItems and extension actions.

## Use

Put `<Tray />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Tray } from "@domicile-desktop/manganese-bar-module-tray";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Tray key="tray" />] },
});
```

It takes no props. It reads `useDomicile()`, `useBar()` and `useTrayState()` (`src/tray-context.ts`). See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-tray
```
