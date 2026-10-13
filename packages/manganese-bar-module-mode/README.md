# @domicile-desktop/manganese-bar-module-mode

A manganese bar item: the binding mode.

## Use

Put `<Mode />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Mode } from "@domicile-desktop/manganese-bar-module-mode";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Mode key="mode" />] },
});
```

It takes no props. It reads `useWorkspaces()` from `@domicile-desktop/manganese-window-management/workspaces-context`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-mode
```
