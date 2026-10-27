# @domicile-desktop/manganese-inbox-google-messages

Manganese's Google Messages inbox:
[Google Messages for web](https://messages.google.com/web/) in the
notification drawer. Its unread conversations count toward the bell.

## Use

Put `messagesInbox()` in [`runManganese`](../shell-manganese/README.md)'s
`inboxes`.

```ts
import { runManganese } from "@domicile-desktop/manganese";
import { messagesInbox } from "@domicile-desktop/manganese-inbox-google-messages";

export const Shell = runManganese({ inboxes: [messagesInbox()] });
```

A press shows the page in the drawer. Pair it once there. Don't also use the
`GoogleMessages` bar item: Messages runs one web session at a time. What it
shows: [TOP-BAR.md](../shell-manganese/docs/TOP-BAR.md#inboxes).

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-inbox-google-messages
```
