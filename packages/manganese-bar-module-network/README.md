# @domicile-desktop/manganese-bar-module-network

A manganese bar item: the network connection and its Wi-Fi panel.

## Use

Put `<Network />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Network } from "@domicile-desktop/manganese-bar-module-network";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Network key="network" />] },
});
```

It takes no props. It reads `useDomicile()`; the network service is watched once per desktop. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-network
```
