# @domicile-desktop/manganese-bar-module-notifications

A manganese bar item: the bell that opens the notification drawer.

## Use

Put `<Notifications />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`:

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Notifications } from "@domicile-desktop/manganese-bar-module-notifications";

export const Shell = runManganese({
  bar: { center: [], left: [], right: [<Notifications key="notifications" />] },
});
```

It takes no props. It reads `useBar()` and `useNotificationsDrawer()` from `@domicile-desktop/manganese-notifications/notifications-context`. See
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-notifications
```
