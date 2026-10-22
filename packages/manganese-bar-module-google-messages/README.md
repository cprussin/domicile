# @domicile-desktop/manganese-bar-module-google-messages

A manganese bar item: Google Messages in a panel, with a count of its new
messages.

## Use

Put `<GoogleMessages />` in a column of
[`runManganese`](../shell-manganese/README.md)'s `bar`. No default bar has it.

```tsx
import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
import { GoogleMessages } from "@domicile-desktop/manganese-bar-module-google-messages";

export const Shell = runManganese({
  bar: {
    ...DEFAULT_BAR,
    right: [<GoogleMessages key="messages" />, ...DEFAULT_BAR.right],
  },
});
```

Open the panel once to pair it with the phone: scan the QR code, or sign in
with Google. Then allow Messages' notifications when it asks.

What it shows, and how it keeps the page:
[TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#google-messages).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-bar-module-google-messages
```
