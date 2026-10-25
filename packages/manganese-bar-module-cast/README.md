# @domicile-desktop/manganese-bar-module-cast

A manganese bar item: casting to TVs.

## Use

Put `<Cast />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Cast } from "@domicile-desktop/manganese-bar-module-cast";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Cast key="cast" />] },
});
```

It takes no props. It reads `useDomicile()`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md) and
[CASTING-TO-TVS.md](../../docs/CASTING-TO-TVS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-cast
```
