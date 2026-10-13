# @domicile-desktop/manganese-bar-module-workspace-switcher

A manganese bar item: the screen's workspaces.

## Use

Put `<WorkspaceSwitcher />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { WorkspaceSwitcher } from "@domicile-desktop/manganese-bar-module-workspace-switcher";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<WorkspaceSwitcher key="workspace-switcher" />] },
});
```

It takes no props. It reads `useBar()` and `useWorkspaces()` from `@domicile-desktop/manganese-window-management/workspaces-context`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-workspace-switcher
```
