# @domicile-desktop/manganese-inbox-gmail

Manganese's Gmail inbox: one account's conversation count in the notification
drawer, read with the Gmail API. Its unread conversations count toward the
bell.

## Use

Put `gmailInbox(…)` in [`runManganese`](../shell-manganese/README.md)'s
`inboxes`.

```ts
import { runManganese } from "@domicile-desktop/manganese";
import { gmailInbox } from "@domicile-desktop/manganese-inbox-gmail";

export const Shell = runManganese({
  inboxes: [
    gmailInbox({
      client: { id: "….apps.googleusercontent.com", secret: "…" },
      email: "me@gmail.com",
      nickname: "Work",
    }),
  ],
});
```

- `client`: a Google Cloud OAuth client, Desktop app type. How to make one:
  [manganese-bar-module-gmail](../manganese-bar-module-gmail/README.md#use).
- `email`: the Google account.
- `nickname`: its name in the drawer.

A press opens the inbox in a browser window, or signs the account in. What it
shows: [TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#inboxes). It reads the
inbox as the `Gmail` bar item does.

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-inbox-gmail
```
