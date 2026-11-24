# @domicile-desktop/manganese-inbox-gmail

## 0.2.0

### Minor Changes

- 79166e4: Email links can be written from a Gmail alias. `gmailInbox` lists the account's verified "Send mail as" addresses, and writing from one saves the message as a draft from it, then opens that draft. This needs the `gmail.settings.basic` and `gmail.compose` scopes, so each Gmail account signs in again once.
- 15b8ec4: A Gmail inbox given a browser `profile` opens Gmail's own address (`https://mail.google.com/mail/`) in that profile, signed in with the profile's Google account. Without a profile it still picks the account with `?authuser=`. `inboxAddress` takes an optional `profile`.
- befeb71: Gmail and Messages inboxes, the Gmail bar module and launcher bookmarks take a `profile`, the browser profile they open in, so two Gmail accounts can live in two profiles. A site's app window is now in a browser profile, its site's by default, and `domicile open --app --profile <id>`, `browser.openApp(url, { profile })` and `browser.fetch(url, { profile })` pick one.
- f268f2d: Email links ask which inbox, and which of its addresses, to write from, then open a new message in that inbox's window. `Inbox.Watched` takes a `write`, and an inbox's `InboxReading.Counted` may name the addresses it sends from; `gmailInbox` writes from the account.

### Patch Changes

- Updated dependencies [7680c50]
- Updated dependencies [9478a19]
- Updated dependencies [87ac040]
- Updated dependencies [394ecc7]
- Updated dependencies [8f74f44]
- Updated dependencies [d3978bb]
- Updated dependencies [2794947]
- Updated dependencies [79166e4]
- Updated dependencies [0e71fa1]
- Updated dependencies [51a769e]
- Updated dependencies [f5fbd04]
- Updated dependencies [4acd3cd]
- Updated dependencies [d0fbc5b]
- Updated dependencies [03dcccf]
- Updated dependencies [996cc29]
- Updated dependencies [5ef4689]
- Updated dependencies [3e37020]
- Updated dependencies [2a1913f]
- Updated dependencies [cd75f9a]
- Updated dependencies [d2a68f5]
- Updated dependencies [c454256]
- Updated dependencies [09a3ad4]
- Updated dependencies [3bdac3b]
- Updated dependencies [f268f2d]
- Updated dependencies [fb07c3f]
- Updated dependencies [24b88fb]
- Updated dependencies [81215c5]
- Updated dependencies [d566f68]
- Updated dependencies [86c57d9]
- Updated dependencies [057faa5]
- Updated dependencies [51a769e]
- Updated dependencies [52e71af]
- Updated dependencies [15b8ec4]
- Updated dependencies [5a70826]
- Updated dependencies [5c11ddc]
- Updated dependencies [8c477cc]
- Updated dependencies [382819f]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [ebfad4b]
- Updated dependencies [3e08ff0]
- Updated dependencies [5a896a8]
- Updated dependencies [69247ca]
- Updated dependencies [94e5909]
- Updated dependencies [bc8db8f]
- Updated dependencies [e821d1f]
- Updated dependencies [46d7737]
- Updated dependencies [8ff882e]
- Updated dependencies [0a4d218]
- Updated dependencies [3600d3b]
- Updated dependencies [9c805c4]
- Updated dependencies [9bd54ab]
- Updated dependencies [a2cab16]
- Updated dependencies [d6373e3]
- Updated dependencies [09be8b7]
- Updated dependencies [da632d6]
- Updated dependencies [85ad296]
- Updated dependencies [539ce11]
- Updated dependencies [e4f3394]
- Updated dependencies [e7b707c]
- Updated dependencies [8a2777f]
- Updated dependencies [756c1bd]
- Updated dependencies [133ce8a]
- Updated dependencies [b95da52]
- Updated dependencies [9478a19]
- Updated dependencies [a85afe8]
- Updated dependencies [25522ef]
- Updated dependencies [19cc2c5]
- Updated dependencies [a5ade39]
- Updated dependencies [5315b06]
- Updated dependencies [f268f2d]
- Updated dependencies [6e41263]
- Updated dependencies [dec9fc2]
- Updated dependencies [6aad1fa]
  - @domicile-desktop/sdk@3.0.0
  - @domicile-desktop/manganese-bar-module-gmail@2.1.0
  - @domicile-desktop/react@0.2.0
  - @domicile-desktop/manganese-notifications@2.1.0

## 0.1.2

### Patch Changes

- bc45b4c: Gmail's page no longer notifies the same mail again while its window is open.
- d69b2f4: A page's notification names its browser window, so only the Gmail inbox's own window has its duplicate notifications cleared; Gmail in another window notifies again.
- Updated dependencies [c664ef4]
- Updated dependencies [1af639c]
- Updated dependencies [bc45b4c]
- Updated dependencies [eba7d0d]
- Updated dependencies [af7415e]
- Updated dependencies [bb1e4cb]
- Updated dependencies [d69b2f4]
- Updated dependencies [8eaae53]
- Updated dependencies [f592184]
- Updated dependencies [18413ff]
- Updated dependencies [69fe0d8]
- Updated dependencies [a354497]
- Updated dependencies [9246b97]
- Updated dependencies [50318b4]
- Updated dependencies [cdb3534]
  - @domicile-desktop/sdk@2.2.0
  - @domicile-desktop/manganese-notifications@2.0.0
  - @domicile-desktop/manganese-bar-module-gmail@2.0.2
  - @domicile-desktop/react@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0
  - @domicile-desktop/manganese-bar-module-gmail@2.0.1
  - @domicile-desktop/manganese-notifications@1.1.1
  - @domicile-desktop/react@0.1.1

## 0.1.0

### Minor Changes

- bbcc610: New Gmail mail raises a desktop notification: the account's nickname, the sender and the subject, or one "5 new emails" notification when more than 3 arrive at once. A press opens the message. Mail already unread at startup or sign-in is not notified. Reading headers needs the `gmail.metadata` scope, so each account signs in again once. `deskInbox(domicile)(email, client, nickname)` takes the nickname notifications use.
- a113605: Inboxes open as app windows instead of a page in the notifications drawer. Messages is one window that keeps running in the background: closing it hides it. Each Gmail account has one window, reused by its inbox row, its bar counter and its new-mail notifications. `Inbox.Page` is replaced by `Inbox.Window`, and an inbox's `launcherName` adds a launcher entry that opens its window.
- be59aae: Inboxes in the notification drawer: `runManganese({ inboxes })` lists inboxes above the notifications, and their unread conversations count toward the bell. An inbox is plain data (`Inbox.Watched` or `Inbox.Page`, from `@domicile-desktop/manganese-notifications/inbox`). New packages `@domicile-desktop/manganese-inbox-gmail` (`gmailInbox`) and `@domicile-desktop/manganese-inbox-google-messages` (`messagesInbox`, which opens in the drawer, widened, with a back button). The Gmail and Google Messages bar items stay, and export what the inboxes share. `SlideOver` gains `keepMounted`, `onBack` and `wide`.
- 5bdc699: The launcher previews an inbox by its account, unread count and newest unread mail, instead of the command it runs.

### Patch Changes

- d4b9da4: The bell counts an inbox's new mail or texts once: its own notifications stay out of the count, since its unread conversations already add to it. Every inbox names the sender its notifications arrive under, `notifiesAs`, and `useNotifications` takes the senders to leave out.
- Updated dependencies [a3c11aa]
- Updated dependencies [fe90bca]
- Updated dependencies [77fd631]
- Updated dependencies [9e60e1e]
- Updated dependencies [a62f35a]
- Updated dependencies [923e65b]
- Updated dependencies [3980a9a]
- Updated dependencies [66d220b]
- Updated dependencies [c99bfef]
- Updated dependencies [d961736]
- Updated dependencies [d3a65c5]
- Updated dependencies [eca2588]
- Updated dependencies [c429bd5]
- Updated dependencies [22844b3]
- Updated dependencies [c03a44b]
- Updated dependencies [9fe15f8]
- Updated dependencies [f71cc09]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [17064a7]
- Updated dependencies [a88ce23]
- Updated dependencies [ecd3fba]
- Updated dependencies [0e8c788]
- Updated dependencies [62a671f]
- Updated dependencies [56e1c22]
- Updated dependencies [98d378e]
- Updated dependencies [e42226f]
- Updated dependencies [bbcc610]
- Updated dependencies [73dd960]
- Updated dependencies [fd40a91]
- Updated dependencies [690c592]
- Updated dependencies [3f7e261]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [a113605]
- Updated dependencies [f6f6e5b]
- Updated dependencies [d4b9da4]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [a999398]
- Updated dependencies [9d4a876]
- Updated dependencies [44d0983]
- Updated dependencies [dc90c70]
- Updated dependencies [5bdc699]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [01b9340]
- Updated dependencies [fccc784]
- Updated dependencies [2bf4b18]
- Updated dependencies [0aa24da]
- Updated dependencies [cd83e49]
- Updated dependencies [40d7378]
- Updated dependencies [cbaa64e]
- Updated dependencies [1fcf33a]
- Updated dependencies [4ee2c21]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [e83ec4a]
- Updated dependencies [7a786a4]
- Updated dependencies [3bb9bd5]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [ae7874c]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [ee63a45]
- Updated dependencies [66bfb0d]
- Updated dependencies [9664607]
- Updated dependencies [d9f5353]
- Updated dependencies [1971d87]
- Updated dependencies [5d2376e]
- Updated dependencies [44f23d6]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [0c58b28]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
  - @domicile-desktop/manganese-notifications@1.1.0
  - @domicile-desktop/sdk@2.0.0
  - @domicile-desktop/manganese-bar-module-gmail@2.0.0
  - @domicile-desktop/react@0.1.0
