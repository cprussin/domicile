# @domicile-desktop/manganese-bar-module-volume

A manganese bar item: the volume and its mixer.

## Use

Put `<Volume />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Volume } from "@domicile-desktop/manganese-bar-module-volume";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Volume key="volume" />] },
});
```

It takes no props. It reads `useDomicile()` and `useBar()`; the sound server is watched once per desktop. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-volume
```
