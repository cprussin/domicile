# @domicile-desktop/manganese-bar-module-bluetooth

A manganese bar item: Bluetooth and its devices panel.

## Use

Put `<Bluetooth />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Bluetooth } from "@domicile-desktop/manganese-bar-module-bluetooth";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Bluetooth key="bluetooth" />] },
});
```

It takes no props. It reads `useDomicile()` and `useBar()`; BlueZ is watched once per desktop. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-bluetooth
```
