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

## Quick settings

`@domicile-desktop/manganese-bar-module-idle-inhibitor/quick-settings` exports its parts
for [`QuickSettings`](../shell-manganese/docs/TOP-BAR.md#quick-settings):
`KeepAwake`.

## Keep awake pill

`@domicile-desktop/manganese-bar-module-idle-inhibitor/kept-awake` exports
`KeptAwake`: a bar pill shown while anything keeps the screens on. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#keep-awake-pill).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-idle-inhibitor
```
