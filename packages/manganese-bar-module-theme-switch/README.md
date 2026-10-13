# @domicile-desktop/manganese-bar-module-theme-switch

A manganese bar item: the light and dark theme toggle.

## Use

Put `<ThemeSwitch />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { ThemeSwitch } from "@domicile-desktop/manganese-bar-module-theme-switch";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<ThemeSwitch key="theme-switch" />] },
});
```

It takes no props. It reads the component library's `ThemeProvider`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-theme-switch
```
