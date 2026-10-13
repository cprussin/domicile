# @domicile-desktop/manganese-bar-module-battery

A manganese bar item: the battery charge.

## Use

Put `<Battery />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Battery } from "@domicile-desktop/manganese-bar-module-battery";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Battery key="battery" />] },
});
```

It takes no props. It reads `useDomicile()`; UPower is watched once per desktop. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-battery
```
