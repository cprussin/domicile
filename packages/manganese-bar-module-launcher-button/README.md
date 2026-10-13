# @domicile-desktop/manganese-bar-module-launcher-button

A manganese bar item: the button that opens the launcher.

## Use

Put `<LauncherButton />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { LauncherButton } from "@domicile-desktop/manganese-bar-module-launcher-button";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<LauncherButton key="launcher-button" />] },
});
```

It takes no props. It reads `useLauncher()` from `@domicile-desktop/manganese-launcher/launcher-context`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-launcher-button
```
