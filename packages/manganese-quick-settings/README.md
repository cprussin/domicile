# @domicile-desktop/manganese-quick-settings

A manganese bar item: quick settings. The network, Bluetooth, sound and
battery icons in one button, and their controls in one panel, with brightness,
keep awake, night light, dark mode and a way to the Settings app. In manganese's
default bars.

## Use

Put `<QuickSettings />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { QuickSettings } from "@domicile-desktop/manganese-quick-settings";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<QuickSettings key="quick-settings" />] },
});
```

It reads `useDomicile()`. Its parts come from the hardware items' packages
(`manganese-bar-module-network`, `-bluetooth`, `-volume`, `-brightness`,
`-battery`, `-idle-inhibitor`, `-theme-switch`), whose own bar items stay
usable on their own. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#quick-settings).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-quick-settings
```
