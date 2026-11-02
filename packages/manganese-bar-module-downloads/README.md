# @domicile-desktop/manganese-bar-module-downloads

A manganese bar item: the desk's downloads, from every browser window and app
window. Shown while there are any.

## Use

Put `<Downloads />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Downloads } from "@domicile-desktop/manganese-bar-module-downloads";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Downloads key="downloads" />] },
});
```

It takes no props. It reads `useDomicile()` and `useBar()`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md) and "Downloads" in
[SHELL-BROWSER-WINDOWS.md](../../docs/SHELL-BROWSER-WINDOWS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-downloads
```
