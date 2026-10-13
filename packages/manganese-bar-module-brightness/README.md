# @domicile-desktop/manganese-bar-module-brightness

A manganese bar item: the screen brightness and its slider.

## Use

Put `<Brightness />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Brightness } from "@domicile-desktop/manganese-bar-module-brightness";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Brightness key="brightness" />] },
});
```

It takes no props. It reads `useDomicile()`; the backlight is watched once per desktop. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-brightness
```
