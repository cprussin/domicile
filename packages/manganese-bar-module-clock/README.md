# @domicile-desktop/manganese-bar-module-clock

A manganese bar item: the date and time.

## Use

Put `<Clock />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Clock } from "@domicile-desktop/manganese-bar-module-clock";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Clock key="clock" />] },
});
```

It takes no props. It reads no context. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-clock
```
