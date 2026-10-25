# @domicile-desktop/manganese-bar-module-idle-inhibitor

A manganese bar item: a toggle that keeps the screens from blanking.

## Use

Put `<IdleInhibitor />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { IdleInhibitor } from "@domicile-desktop/manganese-bar-module-idle-inhibitor";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<IdleInhibitor key="idle-inhibitor" />] },
});
```

It takes no props. It holds an idle inhibitor through the Inhibit portal, and
a shell reload lets go of it. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#idle-inhibitor) and
[IDLE.md](../../docs/IDLE.md#idle-inhibitors).

The `idle-inhibitor` command toggles the same inhibitor from a key or a
terminal: `domicile send-shell idle-inhibitor`. The shell reaches it through
`deskIdleInhibitor` in `./desk-idle-inhibitor`.

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-idle-inhibitor
```
