# @domicile-desktop/manganese-bar-module-gmail

## 2.1.0

### Minor Changes

- 79166e4: Email links can be written from a Gmail alias. `gmailInbox` lists the account's verified "Send mail as" addresses, and writing from one saves the message as a draft from it, then opens that draft. This needs the `gmail.settings.basic` and `gmail.compose` scopes, so each Gmail account signs in again once.
- 15b8ec4: A Gmail inbox given a browser `profile` opens Gmail's own address (`https://mail.google.com/mail/`) in that profile, signed in with the profile's Google account. Without a profile it still picks the account with `?authuser=`. `inboxAddress` takes an optional `profile`.
- befeb71: Gmail and Messages inboxes, the Gmail bar module and launcher bookmarks take a `profile`, the browser profile they open in, so two Gmail accounts can live in two profiles. A site's app window is now in a browser profile, its site's by default, and `domicile open --app --profile <id>`, `browser.openApp(url, { profile })` and `browser.fetch(url, { profile })` pick one.
- f268f2d: Email links ask which inbox, and which of its addresses, to write from, then open a new message in that inbox's window. `Inbox.Watched` takes a `write`, and an inbox's `InboxReading.Counted` may name the addresses it sends from; `gmailInbox` writes from the account.

### Patch Changes

- 394ecc7: Electron apps can pop up menus (`Menu.popup`), as Claude's menu button does: the shell draws the app's menu where the button was pressed, with the same look as the app's menu bar, and the entry chosen runs in the app. Shells read a window's popup menu from `popupMenu` (`appPopupMenu` in `@domicile-desktop/sdk/app-menu`) and answer it with `domicile.browser.answerPopupMenu`.
- 2794947: Electron apps can make their windows fullscreen (`setFullScreen`), and they read and hear what the shell makes them (`isMaximized`, `isFullScreen`, `maximize`, `enter-full-screen` and the rest) instead of a window that always reads as normal. Shells read what an app asks from a window's `wantsMaximized`, `wantsMinimized` and `wantsFullscreen`, and report what they made it with `domicile.browser.setWindowState`.
- 51a769e: Pressing a new-mail notification opens the mail beside the inbox list, as a click in Gmail does: it shows the inbox and clicks the mail's row once Gmail lists it. A mail Gmail never lists in 20 seconds opens on its own.
- 6e41263: A browser window lists what its Electron app asks of its looks and input: `urgent`, `ignoresPointer` and `shape`. `FakeDomicileHost.setLooks` sets them.
- Updated dependencies [6f4cabd]
- Updated dependencies [02fe478]
- Updated dependencies [b7d85c0]
- Updated dependencies [7680c50]
- Updated dependencies [9478a19]
- Updated dependencies [87ac040]
- Updated dependencies [394ecc7]
- Updated dependencies [8f74f44]
- Updated dependencies [d3978bb]
- Updated dependencies [2794947]
- Updated dependencies [0e71fa1]
- Updated dependencies [d194a0d]
- Updated dependencies [ce56535]
- Updated dependencies [f5fbd04]
- Updated dependencies [4acd3cd]
- Updated dependencies [d0fbc5b]
- Updated dependencies [3977a25]
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
- Updated dependencies [728d513]
- Updated dependencies [d566f68]
- Updated dependencies [86c57d9]
- Updated dependencies [057faa5]
- Updated dependencies [51a769e]
- Updated dependencies [52e71af]
- Updated dependencies [5a70826]
- Updated dependencies [dba9a81]
- Updated dependencies [5c11ddc]
- Updated dependencies [8c477cc]
- Updated dependencies [382819f]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [5b3650f]
- Updated dependencies [ebfad4b]
- Updated dependencies [2bf4b1b]
- Updated dependencies [1cbbfb5]
- Updated dependencies [adb0ef5]
- Updated dependencies [5a896a8]
- Updated dependencies [28238ca]
- Updated dependencies [69247ca]
- Updated dependencies [4799f21]
- Updated dependencies [94e5909]
- Updated dependencies [bc8db8f]
- Updated dependencies [e821d1f]
- Updated dependencies [46d7737]
- Updated dependencies [8ff882e]
- Updated dependencies [14704ae]
- Updated dependencies [0a4d218]
- Updated dependencies [3600d3b]
- Updated dependencies [9c805c4]
- Updated dependencies [9bd54ab]
- Updated dependencies [a2cab16]
- Updated dependencies [d6373e3]
- Updated dependencies [09be8b7]
- Updated dependencies [dabcc0c]
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
- Updated dependencies [5fe0d76]
- Updated dependencies [6e41263]
- Updated dependencies [dec9fc2]
- Updated dependencies [6aad1fa]
  - @domicile-desktop/component-library@2.2.0
  - @domicile-desktop/sdk@3.0.0
  - @domicile-desktop/react@0.2.0
  - @domicile-desktop/system-apps@1.3.0
  - @domicile-desktop/manganese-host@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [f9bbf5d]
- Updated dependencies [c664ef4]
- Updated dependencies [1af639c]
- Updated dependencies [eba7d0d]
- Updated dependencies [62ccd23]
- Updated dependencies [af7415e]
- Updated dependencies [bb1e4cb]
- Updated dependencies [c1988f7]
- Updated dependencies [d69b2f4]
- Updated dependencies [e81703a]
- Updated dependencies [8eaae53]
- Updated dependencies [f592184]
- Updated dependencies [18413ff]
- Updated dependencies [69fe0d8]
- Updated dependencies [3d22f74]
- Updated dependencies [a354497]
- Updated dependencies [75708d7]
- Updated dependencies [9246b97]
- Updated dependencies [50318b4]
- Updated dependencies [cdb3534]
- Updated dependencies [eeb9468]
  - @domicile-desktop/component-library@2.1.0
  - @domicile-desktop/sdk@2.2.0
  - @domicile-desktop/system-apps@1.2.0
  - @domicile-desktop/manganese-host@2.0.2
  - @domicile-desktop/react@0.1.2

## 2.0.1

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0
  - @domicile-desktop/component-library@2.0.1
  - @domicile-desktop/manganese-host@2.0.1
  - @domicile-desktop/react@0.1.1
  - @domicile-desktop/system-apps@1.1.1

## 2.0.0

### Major Changes

- bbcc610: New Gmail mail raises a desktop notification: the account's nickname, the sender and the subject, or one "5 new emails" notification when more than 3 arrive at once. A press opens the message. Mail already unread at startup or sign-in is not notified. Reading headers needs the `gmail.metadata` scope, so each account signs in again once. `deskInbox(domicile)(email, client, nickname)` takes the nickname notifications use.

### Minor Changes

- 690c592: The Gmail item reads the inbox 1 and 5 seconds after a Gmail window opens, closes, navigates or changes title, so it follows the mail you read. It polls every 30 seconds instead of every minute.
- 3f7e261: Gmail's unread count is a badge on the item's end corner, like Messages and the notification bell; the item shows the inbox total. The badge is the new `CountBadge` component, which Messages and the bell now share. Messages caps its badge at "9+" and pops it in, as the bell does.
- a113605: Inboxes open as app windows instead of a page in the notifications drawer. Messages is one window that keeps running in the background: closing it hides it. Each Gmail account has one window, reused by its inbox row, its bar counter and its new-mail notifications. `Inbox.Page` is replaced by `Inbox.Window`, and an inbox's `launcherName` adds a launcher entry that opens its window.
- be59aae: Inboxes in the notification drawer: `runManganese({ inboxes })` lists inboxes above the notifications, and their unread conversations count toward the bell. An inbox is plain data (`Inbox.Watched` or `Inbox.Page`, from `@domicile-desktop/manganese-notifications/inbox`). New packages `@domicile-desktop/manganese-inbox-gmail` (`gmailInbox`) and `@domicile-desktop/manganese-inbox-google-messages` (`messagesInbox`, which opens in the drawer, widened, with a back button). The Gmail and Google Messages bar items stay, and export what the inboxes share. `SlideOver` gains `keepMounted`, `onBack` and `wide`.
- 5bdc699: The launcher previews an inbox by its account, unread count and newest unread mail, instead of the command it runs.

### Patch Changes

- 77fd631: A bar button stays lit while the panel it opened is open. New `fillOverPhoto` color and `_hoverOrOpen` condition.
- 9e60e1e: The bar's right-hand items are spaced evenly and a little wider apart: the battery readout is inset like the icon buttons around it. The Gmail counter keeps its text clear of its rounded ends.
- a62f35a: Bar item text (battery, keyboard layout, Gmail, mode, tray letters) is 13px, like the clock. New `fontSizes.ui` token (13px), the desktop's one text size.
- 923e65b: Top bar tooltips are design-system tooltips: a frosted pill under the item that stays on its screen. `Tooltip` takes a `tone`, and `Popover` takes a `tooltip` for its trigger.
- 73dd960: Gmail's new-mail notifications are drawn with Gmail's site icon, the one the launcher shows, instead of a letter. A notification's picture may be an image's `data:` URL.
- fd40a91: A Gmail notification clears once its message is read, in Gmail or anywhere else. One for many messages clears once all of them are read.
- dc90c70: The launcher's inbox preview is centered at any height, shows up to eight newest unread emails, and marks an inbox with nothing unread with a check.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 1971d87: React hooks for system state. Each `system-*` package has a `/react` with hooks and one watch per desktop: `useBattery`, `useBluetooth`, `useNetwork`, `useWifi`, `useAudio` and more. `@domicile-desktop/react` gains the shared watches (`sharedWatch`, `perDesktop`, `useSharedWatch`, `useDeskWatch`, `watchPresence`). manganese-host's `domicile-context`, `per-host`, `shared-watch`, `useSharedWatch` and `watch-presence` move there, and manganese uses `<DomicileProvider>`.
- 44f23d6: The top bar is easier to read: the clock is larger, workspaces are numbers with the current one on a lit square instead of a white disc, and bar buttons light up as rounded squares like the rest of the desktop.
- Updated dependencies [bafd922]
- Updated dependencies [fe90bca]
- Updated dependencies [77fd631]
- Updated dependencies [6bbc80b]
- Updated dependencies [a62f35a]
- Updated dependencies [923e65b]
- Updated dependencies [cb4d2f9]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c7a232d]
- Updated dependencies [66d220b]
- Updated dependencies [a2def76]
- Updated dependencies [d3a65c5]
- Updated dependencies [eca2588]
- Updated dependencies [f15f43a]
- Updated dependencies [7c8d9e2]
- Updated dependencies [fc3ee2f]
- Updated dependencies [9d0934e]
- Updated dependencies [a9a62e8]
- Updated dependencies [fa78a81]
- Updated dependencies [509f948]
- Updated dependencies [a2ee8ea]
- Updated dependencies [22844b3]
- Updated dependencies [c80cd2a]
- Updated dependencies [c03a44b]
- Updated dependencies [9fe15f8]
- Updated dependencies [f71cc09]
- Updated dependencies [aeb6f92]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [17064a7]
- Updated dependencies [a88ce23]
- Updated dependencies [ecd3fba]
- Updated dependencies [0e8c788]
- Updated dependencies [62a671f]
- Updated dependencies [a1569c6]
- Updated dependencies [6fecbbd]
- Updated dependencies [258d9aa]
- Updated dependencies [d9f5353]
- Updated dependencies [fb9e591]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [98d378e]
- Updated dependencies [54472b5]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [2d2289b]
- Updated dependencies [7a29c8f]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [a999398]
- Updated dependencies [9d4a876]
- Updated dependencies [44d0983]
- Updated dependencies [7ac9e00]
- Updated dependencies [e612f06]
- Updated dependencies [6825067]
- Updated dependencies [cd02e0e]
- Updated dependencies [840418d]
- Updated dependencies [7aa450b]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [a472a59]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [01b9340]
- Updated dependencies [fccc784]
- Updated dependencies [2bf4b18]
- Updated dependencies [e1205bb]
- Updated dependencies [40d7378]
- Updated dependencies [670713c]
- Updated dependencies [cd52ce3]
- Updated dependencies [e7cbd52]
- Updated dependencies [8bc5b85]
- Updated dependencies [4ee2c21]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [e83ec4a]
- Updated dependencies [7a786a4]
- Updated dependencies [4759ab2]
- Updated dependencies [3bb9bd5]
- Updated dependencies [0f4582e]
- Updated dependencies [d80e2f5]
- Updated dependencies [58d2cfe]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [a5bff8c]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [d138939]
- Updated dependencies [4064278]
- Updated dependencies [f4a973d]
- Updated dependencies [341debf]
- Updated dependencies [ae7874c]
- Updated dependencies [599d60f]
- Updated dependencies [74a9564]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [065ff4b]
- Updated dependencies [1e2aeca]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [66bfb0d]
- Updated dependencies [5a6a4fc]
- Updated dependencies [25b9bd3]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [d9f5353]
- Updated dependencies [1971d87]
- Updated dependencies [b741b92]
- Updated dependencies [570e7bb]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [5d2376e]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [0c58b28]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
- Updated dependencies [63728a9]
  - @domicile-desktop/component-library@2.0.0
  - @domicile-desktop/sdk@2.0.0
  - @domicile-desktop/manganese-host@2.0.0
  - @domicile-desktop/react@0.1.0
  - @domicile-desktop/system-apps@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.
- 0ff84ad: The Gmail item reads the inbox with the Gmail API and signs in with OAuth. It takes a `client` prop: a Google Cloud OAuth client of the Desktop app type.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/sdk@1.0.0
