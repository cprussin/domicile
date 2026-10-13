# @domicile-desktop/manganese-bar-module-gmail

A manganese bar item: one Gmail account's inbox count, read with the Google
sign-in of the browser windows' profile. No separate sign-in.

## Use

Put `<Gmail />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`. No default bar has it.

```tsx
import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
import { Gmail } from "@domicile-desktop/manganese-bar-module-gmail";

export const Shell = runManganese({
  bar: {
    ...DEFAULT_BAR,
    right: [
      <Gmail email="me@gmail.com" key="gmail" nickname="Work" />,
      ...DEFAULT_BAR.right,
    ],
  },
});
```

- `email`: the Google account.
- `nickname`: its name on the bar.

What it shows, and how it reads the inbox:
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#gmail). The reads go through
the engine's `fetchWithCookies`
([SHELL-SYSTEM-ACCESS.md](../../docs/SHELL-SYSTEM-ACCESS.md#the-browsers-cookies)).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-gmail
```
