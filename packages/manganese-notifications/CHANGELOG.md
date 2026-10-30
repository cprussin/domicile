# @domicile-desktop/manganese-notifications

## 1.1.0

### Minor Changes

- a3c11aa: Animate clearing notifications in the drawer: a cleared card slides out, then the cards below close up. Several cleared at once leave in turn.
- c429bd5: The notifications panel has a Do not disturb switch. While it is on, only critical notifications pop up; the rest still collect in the panel, and the bell shows struck through.
- a113605: Inboxes open as app windows instead of a page in the notifications drawer. Messages is one window that keeps running in the background: closing it hides it. Each Gmail account has one window, reused by its inbox row, its bar counter and its new-mail notifications. `Inbox.Page` is replaced by `Inbox.Window`, and an inbox's `launcherName` adds a launcher entry that opens its window.
- be59aae: Inboxes in the notification drawer: `runManganese({ inboxes })` lists inboxes above the notifications, and their unread conversations count toward the bell. An inbox is plain data (`Inbox.Watched` or `Inbox.Page`, from `@domicile-desktop/manganese-notifications/inbox`). New packages `@domicile-desktop/manganese-inbox-gmail` (`gmailInbox`) and `@domicile-desktop/manganese-inbox-google-messages` (`messagesInbox`, which opens in the drawer, widened, with a back button). The Gmail and Google Messages bar items stay, and export what the inboxes share. `SlideOver` gains `keepMounted`, `onBack` and `wide`.
- 1fcf33a: The notification drawer opens as a panel under the bell, like quick settings, instead of sliding in from the screen's edge. Its sections have clearer headings, inbox rows are tighter, and each notification sits on its own tile. "Clear all" is in a quieter footer. An inbox's page, such as Messages, widens the panel and has a back button.
  
  `NotificationsDrawer` (from `notifications-context`) now holds a popover `handle` that every bell opens, in place of `open(screen)`. `NotificationDrawer` takes `handle`, `onOpen(screen)` and `onClose()` in place of `onOpenChange`.

### Patch Changes

- f6f6e5b: An empty inbox says "Empty" under its name, where its conversation count goes, rather than at the row's end.
- 4967b5d: Email inbox rows show the conversation total under the name and the unread count in the pill, which counts to 99+ in line with text.
- 4ee2c21: Panels over the wallpaper, such as the bar's popovers, stay dark in light mode. Everything in them, including buttons, fields and cards, now uses the dark theme's colors, so nothing is lost against the panel. Gray text is darker in light mode and lighter in dark mode, so it reads on cards. `CountBadge` takes `inline` to sit beside text.
  
  The notifications popup uses the see-through panel, like quick settings. An inbox's unread count is a pill at the end of its row, in place of the total.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- e83ec4a: Bar panels never show blank. New `EmptyState` and `Loading` panel parts: Wi-Fi, Bluetooth, Sound, notifications and inboxes say when they are off, empty or still checking, and Bluetooth says when it couldn't be read.
- 7a786a4: Quick settings, its Wi-Fi, Bluetooth and Sound details, and the notifications panel are built from shared panel parts (`Panel`, `PanelHeader`, `PanelSection`, `ListRow`, `DetailList`, `SliderRow`, `PanelNote`, `PanelFooter`, `IconButton`) with one type scale and set of colors, so they line up and nothing spills out of its panel. Bluetooth devices are grouped as connected, paired and nearby; refusals say what failed in plain words; and a panel opened with the pointer no longer shows a focus ring on its first control.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- Updated dependencies [bafd922]
- Updated dependencies [fe90bca]
- Updated dependencies [77fd631]
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [a62f35a]
- Updated dependencies [923e65b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c7a232d]
- Updated dependencies [9d0934e]
- Updated dependencies [a9a62e8]
- Updated dependencies [fa78a81]
- Updated dependencies [509f948]
- Updated dependencies [a2ee8ea]
- Updated dependencies [c03a44b]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [17064a7]
- Updated dependencies [a88ce23]
- Updated dependencies [0e8c788]
- Updated dependencies [6fecbbd]
- Updated dependencies [258d9aa]
- Updated dependencies [d9f5353]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [7a29c8f]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [9d4a876]
- Updated dependencies [44d0983]
- Updated dependencies [6825067]
- Updated dependencies [cd02e0e]
- Updated dependencies [840418d]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [01b9340]
- Updated dependencies [fccc784]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
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
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [4064278]
- Updated dependencies [f4a973d]
- Updated dependencies [341debf]
- Updated dependencies [ae7874c]
- Updated dependencies [599d60f]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [66bfb0d]
- Updated dependencies [5a6a4fc]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [d9f5353]
- Updated dependencies [1971d87]
- Updated dependencies [570e7bb]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
- Updated dependencies [63728a9]
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@2.0.0
  - @domicile-desktop/react@0.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-bar@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/sdk@1.0.0
