# @domicile-desktop/manganese-bar-module-sharing

A manganese bar item: the screen-sharing indicator.

## Use

Put `<Sharing />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Sharing } from "@domicile-desktop/manganese-bar-module-sharing";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Sharing key="sharing" />] },
});
```

It takes no props. It reads `useDomicile()`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-sharing
```
