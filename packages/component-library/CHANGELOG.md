# @domicile-desktop/component-library

## 2.2.0

### Minor Changes

- 6f4cabd: `EmptyState` draws its icon on a tinted disc, and takes `tone="warning"` with a `detail` tooltip and `layout="inline"`. Panels that showed a line of text when empty or unreadable use it, and Saved networks opens from a button beside the Wi-Fi switch.
- b7d85c0: Danger buttons draw white text in both themes, and a `dangerGhost` variant draws red text with no fill. Settings uses it for Uninstall in Extensions and Stop in Agents.
- d194a0d: A Ctrl+click opens in a new window wherever a middle click does: Back, Forward, the pages in their menus, and the profiles in the profile menu.
  
  - `@domicile-desktop/component-library/new-tab-click`: `newTabClick(onOpen, onOpenInNew)` gives `onClick` and `onAuxClick` handlers that call `onOpenInNew` for a middle click or a Ctrl+click, as a link opens in a new tab.
  - `ListRow`'s `onMiddlePress` is `onPressInNew`, and takes a Ctrl+click too.
- ce56535: The tray's menu button opens after icons were dragged. A right click anywhere on an app's row in the tray's menu opens its menu, and `ListRow` takes `onSecondaryPress`. A pressed `ListRow` with `actions` cuts a long label short instead of pushing its actions out.
- 3977a25: Quick settings' Wi-Fi, Wired and Bluetooth tiles light their icon in the accent color while connected, as the toggles do while on. `QuickTile` takes a required `lit`.
- 728d513: Portal dialogs and the on-screen region picker animate out once answered, instead of vanishing. `AppChooser` takes `open` and `onOpenChangeComplete`.
- 86c57d9: An agent let reach the entire desktop can be remembered, and comes in without asking from then on. A running agent's reach can be changed from the bar, and Settings › Agents lists every agent connected or remembered, to stop or forget. `domicile list-agents`, `stop-agent` and `forget-agent` do the same. The SDK adds `PortalAnswer.Agent(reach, remember)`, `PortalAnswer.Change()`, the dialog's `current` and `remembered`, `portals.changeAgent`, `portals.agents` and `portals.forgetAgent`; `AgentDialog` draws the Remember switch and the change dialog, and the capturing indicator and Manganese's bar a Change button.
- 382819f: Manganese draws an Electron app's menu bar under its window's tab. The app's accelerators run their entries, Alt and a menu's letter open it, and Alt shows or hides a bar the app auto-hides. The SDK reads a window's menu with `@domicile-desktop/sdk/app-menu` (`appMenu`, `acceleratedBy`, `openedByMnemonic`), and the component library has a `MenuBar`.
- 4a4f057: Electron apps on the engine behave more like their own Electron:
  
  - Closing a window asks the app first, so an app that closes to its tray, as Slack and Element do, keeps running there instead of quitting.
  - `win.hide()`, `win.show()` and `show: false` hide and show a window, its page still running. The engine lists a hidden window with `isHidden`, and Manganese keeps it off every workspace until its app shows it.
  - A window's own title (`setTitle`, or `page-title-updated` prevented) is the one the desktop shows, so Claude Desktop reads "Claude", not "index.html".
  - `ipcRenderer` is an EventEmitter, so `ipcRenderer.emit` reaches the preload's own listeners. Element's preload calls it as it starts, and showed "Unable to load config file" without it.
  - Manganese draws an app window with its app's icon, in its title bar and in the screenshot and screen cast pickers, instead of its page's.
  - A window has the properties Electron gives for what its methods set: `autoHideMenuBar`, `menuBarVisible`, `fullScreen`, `resizable` and the rest, and its page `audioMuted`, `backgroundThrottling` and `userAgent`. Element reads `autoHideMenuBar` once its page loads.
- 5b3650f: Popups close when the desk changes under them. `PopupScene` closes every popup inside it when its `scene` key changes, and `PopupBoundary` closes its popups when its box moves. Manganese keys the scene on the overview, launcher, clipboard, each screen's workspace, fullscreen and scratchpad windows.
- 1cbbfb5: `Button` takes `label` on a text button as a longer name, such as "Forget Codex", and still draws it as text. Only an element child makes an icon-only button. Settings' Agents page draws Sign out, Forget and Stop with their padding again.
- 69247ca: The tray has a menu of every icon at its end. Pin or unpin any app or extension icon, switch extensions on and off, and change what each can do: its options, which websites it can read, private windows, local files and user scripts, or uninstall it. Settings your config sets show locked. Shells get the same through `domicile.extensions.installed`, `setEnabled`, `configure` and `uninstall`. `Menu` holds check, radio and submenu items, and `ListRow` takes `actions` beside a pressed row.
- 133ce8a: Browser profiles have an order. The config's `browser.order` lists profile ids, and the profiles it leaves out follow by id. The compositor sends the profiles in that order, so the profile menu and Settings list them that way.
  
  Settings' Profiles page moves a profile up or down. After its swatches, a color well takes any color, and the swatches now include the theme's cyan.
  
  In the profile menu, middle-clicking a profile opens the page in a new window of that profile, using `ListRow`'s new `onMiddlePress`. The profile button writes its name in black on light colors, where white would be hard to read.
- b95da52: An agent asks before it drives the desktop. `domicile mcp`'s first tool call runs `domicile agent`, which puts an `agent` dialog to the shell: the entire desktop, or only the windows the user checks. Every tool call after is checked against the answer, and the agent is listed as an `agent` capturing session, with what it did last, until it disconnects or the user stops it. The SDK parses them as `PortalKind.Agent`, `PortalAnswer.Agent` and `CapturingKind.Agent`; `<PortalDialogs />` draws the dialog and takes `omitAgents`; Manganese's bar shows each agent as a violet pill with a Stop button.

### Patch Changes

- 02fe478: "Select on screen" in the screenshot and share pickers draws over a dialog already up, such as the launcher, instead of under it.
- 394ecc7: Electron apps can pop up menus (`Menu.popup`), as Claude's menu button does: the shell draws the app's menu where the button was pressed, with the same look as the app's menu bar, and the entry chosen runs in the app. Shells read a window's popup menu from `popupMenu` (`appPopupMenu` in `@domicile-desktop/sdk/app-menu`) and answer it with `domicile.browser.answerPopupMenu`.
- 2794947: Electron apps can make their windows fullscreen (`setFullScreen`), and they read and hear what the shell makes them (`isMaximized`, `isFullScreen`, `maximize`, `enter-full-screen` and the rest) instead of a window that always reads as normal. Shells read what an app asks from a window's `wantsMaximized`, `wantsMinimized` and `wantsFullscreen`, and report what they made it with `domicile.browser.setWindowState`.
- dba9a81: A `ModalDialog` opened over another, such as the screenshot dialog over the launcher, dims all of it instead of drawing its backdrop under the other's popup.
- 2bf4b1b: Menus, popovers, tooltips and dialogs (`zIndex.modal`, `zIndex.modalBackdrop`) stack over every window a shell places, a fullscreen one's included. Only the lock screen is higher.
- adb0ef5: A `Popover` that something else's focus shuts as it opens now logs an error naming the element that took focus, so a panel that seems never to open can be traced.
- 28238ca: A `ListRow`'s folded details sit tighter around a `PanelFooter`, and Wi-Fi's Disconnect and Forget are `dangerGhost` buttons.
- 4799f21: Volume and brightness toasts and the slider's level meter move their fills with a transform, so a new level skips layout.
- 14704ae: The lock screen is above every window depth, so the overview's workspace outline blurs with the rest of the desk instead of staying sharp over it.
- 3600d3b: Loading skeletons in History and the splash's dot grid move with transforms, and shadows that fade in fade on their own layer, so they no longer repaint every frame. A check fails on new animations of properties the compositor cannot run.
- dabcc0c: `RegionPicker` takes the keyboard when it opens and takes it back from a browser window's page, so Ctrl+C and Escape reach it.
- 5fe0d76: A screenshot dialog test waits for an app window's icon to load instead of reading it the moment the app's name shows.
- 6e41263: A browser window lists what its Electron app asks of its looks and input: `urgent`, `ignoresPointer` and `shape`. `FakeDomicileHost.setLooks` sets them.
- Updated dependencies [7680c50]
- Updated dependencies [9478a19]
- Updated dependencies [87ac040]
- Updated dependencies [394ecc7]
- Updated dependencies [8f74f44]
- Updated dependencies [d3978bb]
- Updated dependencies [2794947]
- Updated dependencies [0e71fa1]
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
- Updated dependencies [5a70826]
- Updated dependencies [5c11ddc]
- Updated dependencies [8c477cc]
- Updated dependencies [382819f]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [ebfad4b]
- Updated dependencies [5a896a8]
- Updated dependencies [69247ca]
- Updated dependencies [94e5909]
- Updated dependencies [bc8db8f]
- Updated dependencies [e821d1f]
- Updated dependencies [46d7737]
- Updated dependencies [8ff882e]
- Updated dependencies [0a4d218]
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
- Updated dependencies [6e41263]
- Updated dependencies [dec9fc2]
- Updated dependencies [6aad1fa]
  - @domicile-desktop/sdk@3.0.0
  - @domicile-desktop/system-apps@1.3.0

## 2.1.0

### Minor Changes

- 62ccd23: Manganese has an overview: each monitor's workspaces at once, with their live windows. Open it with Meta+O, a four-finger pinch in, or the new button before the workspaces in the bar. Click a workspace or a window to go there, or drag a window onto another workspace to move it. A four-finger pinch out opens the launcher, whose button now shows a sparkle that twinkles when pointed at. The component library adds `AnimatedSparkleIcon`.
- c1988f7: - `ListRow`'s `disclosure` drawer slides open and shut.
  - Wi-Fi's Disconnect sits on the connection's row, as a Bluetooth device's does.
- 50318b4: The notifications panel's Do not disturb switch is now a Pause button in its header. Pause for 1 hour, until 8 AM tomorrow, or until you resume; the header says until when, and Resume ends it early. Clear all moves beside the Recent label. Do not disturb left on carries over as a pause until resumed.
  
  - `useNotifications` returns `pause`, `pauseFor` and `resume` in place of `doNotDisturb` and `setDoNotDisturb`.
  - `NotificationDrawer` takes `pause`, `onPause` and `onResume` in place of `doNotDisturb` and `onDoNotDisturb`; `NotificationBell` and the drawer context take `paused`.
  - The component library adds `Menu`, a menu opened from a button, and a `status` line on `PanelHeader`.

### Patch Changes

- f9bbf5d: A `ListRow` drawer has more room above and below its details, and a `PanelFooter` at its foot sits centered between its rule and the tile's edge.
- e81703a: Wi-Fi's Disconnect sits at the foot of the connection's details, under a rule.
- 3d22f74: A closing popover no longer closes the one opened in its place, so clicking another extension's action opens its popup.
- 75708d7: The workspace switcher's chip slides smoothly when a workspace comes or goes at the end of the row: the bar items beside its empty middle no longer clip while they resize (`FluidItem`'s new `overflow` prop), and the chip's clip no longer depends on the row's width.
- eeb9468: A `PanelFooter` action in a `ListRow` drawer keeps a gap from the tile's right edge instead of hanging past the drawer's padding.
- Updated dependencies [c664ef4]
- Updated dependencies [1af639c]
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
- Updated dependencies [cdb3534]
  - @domicile-desktop/sdk@2.2.0
  - @domicile-desktop/system-apps@1.2.0

## 2.0.1

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0
  - @domicile-desktop/system-apps@1.1.1

## 2.0.0

### Major Changes

- 25b9bd3: Draw the Sound panel's device pickers as soft rows that match the panel.
  
  - `component-library`: `Select` takes `surface`: `field` (the default), `filled` (a soft row sized like a panel's `ListRow`, with an up-and-down caret) or `quiet`. `surface="quiet"` replaces the `quiet` prop. Inside a panel over the wallpaper, its list is dark in either theme, as the panel is.
  - `manganese-bar-module-volume`: the speaker, microphone, app and sound card pickers are `filled`.
  - `manganese-window-management`: site permission pickers use `surface="quiet"`.

### Minor Changes

- 77fd631: A bar button stays lit while the panel it opened is open. New `fillOverPhoto` color and `_hoverOrOpen` condition.
- 923e65b: Top bar tooltips are design-system tooltips: a frosted pill under the item that stays on its screen. `Tooltip` takes a `tone`, and `Popover` takes a `tooltip` for its trigger.
- cb4d2f9: The screen recording toolbar is bigger and easier to spot: it says "Recording" or "Paused", labels its Pause and Resume button, and a ring pulses from the red dot while it records.
- 3980a9a: A `Cast` bar item lists the TVs nearby: extend the desktop onto one, or cast what the share picker picks to it. `@domicile-desktop/sdk/cast` runs the casts, and `<PortalDialogs />` answers a cast's own ScreenCast request. No backend finds TVs yet, so the item stays hidden.
- 66d220b: Show a browser window's zoom and finished downloads in popups that hang from the address bar, as Chrome does. The downloads popup lists each file with Open, Show in folder and Remove from list, and the Downloaded indicator opens it again. `<webview>` gains `downloadCompletedPaths` and `removeCompletedDownload()`; `Popover` gains `anchor` and `quiet`; `ListRow` gains `endOnHover`.
- a2def76: Rework the clipboard history to look and steer like the launcher: a search box that narrows the copies, one highlight for keyboard and pointer, readable rows with a text or link glyph, and the previous copy highlighted on open so Enter swaps back. The launcher's result rows move to the component library as `ResultList`, `RowTile` and `Marked`.
- eca2588: Clipboard history rows show a thumbnail of a copied image: `DomicileClipboardEntry.thumbnail` is a small PNG `data:` URL (empty for none; the SDK gives `undefined`), and `RowTile` takes a `picture` to draw in place of its glyph.
- f15f43a: The clipboard history is wider and shows more of each copy: up to four lines of text with its line breaks, and a larger image preview beside its size. What is on your clipboard gets its own group above what was copied before. The compositor previews 480 characters and makes thumbnails up to 256 px. `RowTile` drops its `picture` prop.
- fc3ee2f: `ContextMenu`: letting go of the right button over an item chooses it, as in Chrome, so a right press held from opening the menu can pick an item.
- 9d0934e: Network details can be copied. `DetailList` values can be selected, and a `copyable` row shows a copy button on each line under the pointer. Wi-Fi and wired details offer one for each address, gateway, DNS server, interface name and hardware address. DNS servers sit one to a line.
- a9a62e8: The quick settings Dark mode switch wipes over to its new state with the rest of the screen. `useTheme` adds `painted`, the theme the page is drawn in.
- f71cc09: The Downloads bar item's panel opens by itself as a download starts, on the screen with the keyboard, and stays until dismissed. Removed downloads slide out as cleared notifications do. As the last download finishes, the item eases from its percent to a check and "Done", then back to its icon. Opening a file no app opens says so, in the downloads panel and in the launcher, instead of doing nothing.
  
  - `LeavingRow` and `useLeavingRows` (component library) hold the notification drawer's arrive and leave motion; `ListRow` takes it as `motion`.
  - `Bar` has `popsUp`: whether an item may open its panel by itself.
  - `opens` and `nothingOpens` (`@domicile-desktop/system-apps/opens`) ask `domicile open --which` before opening a file.
  - `Launcher` takes `opens`.
- aeb6f92: The Downloads panel stays put as the bar item grows and shrinks: items on the bar's right grow leftward, keeping their right edges still, and the panel hangs from the item's end. `FluidItem` gains `anchor`. The resting Downloads item has no empty space after its icon.
- 0e8c788: Extension popups size themselves as in Chrome: Blink's auto-resize, between 25x25 and 800x600. Phantom no longer grows wider on every layout, and Solflare gets its full 402x600. The tray shows a popup once its page has loaded, so it no longer opens narrow and then jumps. `contentWidth` and `contentHeight` report only for an `extensionpopup` view. `Popover` takes `withheld`, to lay a panel out before showing it.
- d9f5353: The file dialog's sidebar lists every user folder `user-dirs.dirs` names (including Templates and Public), under its own name, each directory once and never the home again. `Folders` has `userFolders`.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- 54472b5: Bar items ease in, out and between widths: each sits in a new `FluidItem`, which follows its content's width, fades as it comes and goes, and keeps what left drawn until it has faded. Quick settings' icons do the same. `QuickSettingsParts.Indicators` is now a list of components, one per icon.
- 3f7e261: Gmail's unread count is a badge on the item's end corner, like Messages and the notification bell; the item shows the inbox total. The badge is the new `CountBadge` component, which Messages and the bell now share. Messages caps its badge at "9+" and pops it in, as the bell does.
- b49fa3a: Add a Google Messages bar item: Messages for web in a panel, with a count of its new messages. Popovers can stay mounted while closed and open from triggers on other bars, and a bar item's panel can keep the keyboard.
- 2d2289b: Leave closed inboxes' windows out of the screenshot, share and record pickers. `PortalDialogs` takes `closedBrowsers`, the browser windows a shell keeps running but shows as closed; `closedBrowsersOf` lists a manganese desktop's.
- 7a29c8f: Icons in the bar, quick settings and level notices move when their state changes or they are pointed at: the bell swings, Wi-Fi arcs fill out, Bluetooth dots slide out, speaker waves pulse, a slash draws across what is off, the dark mode sun turns to a moon, and more. New `Animated*Icon` components and `_controlHover` / `_controlActive` conditions in the component library. The notifications bar item no longer exports a Panda preset.
- be59aae: Inboxes in the notification drawer: `runManganese({ inboxes })` lists inboxes above the notifications, and their unread conversations count toward the bell. An inbox is plain data (`Inbox.Watched` or `Inbox.Page`, from `@domicile-desktop/manganese-notifications/inbox`). New packages `@domicile-desktop/manganese-inbox-gmail` (`gmailInbox`) and `@domicile-desktop/manganese-inbox-google-messages` (`messagesInbox`, which opens in the drawer, widened, with a back button). The Gmail and Google Messages bar items stay, and export what the inboxes share. `SlideOver` gains `keepMounted`, `onBack` and `wide`.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- 6825067: The launcher is a quicker panel: the search box is its header (no "Open" title, no outline, a line under it), it is narrower (880px), matched letters are bold rather than teal, the picked row is a neutral highlight, and the footer is gone. Glass dialogs are near white in light mode. `Input` takes `flush`, `ModalDialog` takes `titleHidden`, and `ModalDialog`'s `lg` size is 880px.
- cd02e0e: The volume, microphone and brightness toast is larger, with a big icon, the level as a number and a thick meter. Pressing a key again while it is up updates it in place instead of showing it again. The component library adds `LevelToast`.
- 840418d: Wi-Fi and Bluetooth lists hold their height while they load or are empty. Searching shows what it looks for with rings spreading out from it, "No networks nearby" offers a "Look again" button, and the Scan button turns while it scans. `Loading` gains an `icon` and drops its `row` layout, `EmptyState` gains an `action`, and `IconButton` a `busy` prop.
- 7aa450b: Page Down and Page Up move the highlight a page in the launcher, clipboard history, file picker and app chooser. Ctrl+D and Ctrl+U move it half a page. `stepOf` in `list-walk` takes the page size, which `pageOf` measures from the list's scroller.
- e1205bb: Add `Notice`, a pill that briefly shows a change such as a zoom level or volume, with an optional level meter.
- 670713c: The app chooser asks in plain words. With one application it asks "Open Claude?" beside Claude's icon ("Chromium wants to open this link in Claude."); with several, "Choose an app to open this link"; with none, "No app can open this link" and only Close. The link shows on one muted line at the bottom. `AppChooser` takes `asker`, `opened` and `address` in place of `title` and `description`.
- e7cbd52: The Open With dialog matches the other dialogs: launcher-style rows with a neutral wash on the picked app, 16px names, no ring around the list, and who asks in the footer. `LogoTile` in `RowTile` shows a logo in a row tile's place; the launcher uses it.
- 4ee2c21: Panels over the wallpaper, such as the bar's popovers, stay dark in light mode. Everything in them, including buttons, fields and cards, now uses the dark theme's colors, so nothing is lost against the panel. Gray text is darker in light mode and lighter in dark mode, so it reads on cards. `CountBadge` takes `inline` to sit beside text.
  
  The notifications popup uses the see-through panel, like quick settings. An inbox's unread count is a pill at the end of its row, in place of the total.
- e83ec4a: Bar panels never show blank. New `EmptyState` and `Loading` panel parts: Wi-Fi, Bluetooth, Sound, notifications and inboxes say when they are off, empty or still checking, and Bluetooth says when it couldn't be read.
- 7a786a4: Quick settings, its Wi-Fi, Bluetooth and Sound details, and the notifications panel are built from shared panel parts (`Panel`, `PanelHeader`, `PanelSection`, `ListRow`, `DetailList`, `SliderRow`, `PanelNote`, `PanelFooter`, `IconButton`) with one type scale and set of colors, so they line up and nothing spills out of its panel. Bluetooth devices are grouped as connected, paired and nearby; refusals say what failed in plain words; and a panel opened with the pointer no longer shows a focus ring on its first control.
- d80e2f5: Popups stay inside their window. `PopupBoundary` keeps every tooltip, popover, menu and list inside it within its box; `Popover` and `Tooltip` take `spansWindows` to leave it. Each window and tab keeps its popups inside its frame, so a tab's tooltip no longer covers the windows beside it. `test-support/popup-layout` fakes the layout a popup is placed by.
- 58d2cfe: A browser window's zoom popup no longer closes when Reset is pressed, and stays up while the pointer is anywhere over it. Its zoom and downloads popups close when another window takes the focus or another tab covers the page. A download's name runs into the room its buttons take until the pointer comes. `Popover` takes `onHoverChange`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- f4a973d: Quick settings: Wi-Fi and Bluetooth tiles open their panels instead of switching; Keep awake, Night light and Dark mode become a row of switches (`QuickToggle`). The network panel groups by Wired and Wi-Fi with details folded away (`ListRow` `disclosure`). Sound lists outputs and inputs by port name to pick from.
- 341debf: Quick settings: one bar item (`@domicile-desktop/manganese/QuickSettings`) replaces the theme, keep awake, brightness, volume, Bluetooth, network and battery items in `DEFAULT_BAR` and `LOCK_BAR`. Its button shows the network, sound and battery, plus the eye while the screens are kept on and Bluetooth while a device is connected. Its panel has labeled tiles (Wi-Fi or Wired, Bluetooth, Keep awake, Night light, Dark mode), the brightness and volume sliders, and the battery in words with the time left, and a Settings button. A tile's arrow opens the item's panel in place. Each hardware item exports its parts as `./quick-settings`; the component library adds `QuickTile`, and `system-battery` reads UPower's `TimeToEmpty` as `secondsLeft`.
- 599d60f: Make IPv6 addresses in the network panel easier to read.
  
  - `system-network`: `Addressing` splits `addresses` into `ipv4` and `ipv6`, and leaves out temporary IPv6 addresses.
  - `component-library`: `DetailList` takes an `address` option that wraps a value only between its colon-separated groups and grays its prefix length.
  - `manganese-bar-module-network`: the details show IPv4 and IPv6 addresses on their own rows, as addresses.
- 2430e48: Screen recording: `domicile screen-record` and the Screen Record launcher entry pick a screen, window or region and record it with its sound to `~/Videos/Screen recordings/`, with a floating toolbar (pause, resume, stop, discard) left out of the recording.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- c4fe915: The screenshot picker lists what to save beside one preview of the desk, which outlines the pick with its size. It fits on the screen, arrow keys move through the list, and a Copy button copies the pick.
- 1e2aeca: Select an area on the real screen from the screenshot, screen share, recording and cast pickers ("Select on screen"). The area stays with corners to resize it, can be dragged to move it, and has its own Back, Cancel and Share or Save buttons.
- 21b82af: The share picker picks a region by dragging over its desk preview, as the screenshot picker does.
- 427c184: The screen share picker is laid out as the screenshot picker is: screens and windows in a list beside the desk, which outlines each pick. The screenshot picker offers browser windows that are not on screen, such as a tab behind another.
- 5a6a4fc: Simplify the sound mixer:
  
  - Speakers and microphone each get a picker over their volume.
  - Only the microphone is metered, inside its slider's track.
  - Each app has one volume; its page moves it to another device.
  - Sound card modes move to their own page, with plain names.
  - `DrilldownPage` opens a page one level deeper than a `Drilldown`'s view. A `Drilldown`'s `detail` is optional.
- 0bd0d2a: The desktop draws its text in Inter, which ships with it, instead of the computer's default sans-serif face. The manganese `font` option picks another installed face.
- b741b92: The title of the window being worked in keeps its heavier look without shifting sideways when focus moves: a stroke under the letters replaces the medium weight. Adds the `borderWidths.fauxMedium` token.
- 570e7bb: Tabs, title bars and the browser's address bar share one look. Titles are 13px with 16px icons. The open tab, the focused title bar and the browser toolbar are one surface (white in light mode) on a darker tab strip, which resting title bars match. A tab shows its float and maximize buttons only under the pointer, and a hidden tab its close button, so titles get the room. The address field is a 13px, tinted, edgeless field until clicked; the padlock is gray; zoom controls show only while a page is zoomed. `Autocomplete` takes `filled`.
- 63728a9: Window and browser icons move too. Tabs and title bars: Close snips, New tab reaches out, Float's windows lift apart and gather into Tile's squares, Maximize's corners push out and travel into Restore's, and a group's new layout builds in. Browser toolbar: Back and Forward dart, Reload winds and spins into Stop, zoom's minus and plus draw in and reach out, the lock snaps shut on a secure page, site settings' knobs slide, and each new download drops into its tray. New `AnimatedCloseIcon`, `AnimatedPlusIcon`, `AnimatedMinusIcon`, `AnimatedFloatIcon`, `AnimatedMaximizeIcon`, `AnimatedLayoutIcon`, `AnimatedCaretIcon`, `AnimatedReloadIcon`, `AnimatedLockIcon`, `AnimatedSlidersIcon` and `AnimatedDownloadIcon`, and a `direction` for icon parts.

### Patch Changes

- bafd922: Settings and History show their icon in title bars and the screenshot and screen recording pickers. The pickers also show each browser window's site icon.
- a62f35a: Bar item text (battery, keyboard layout, Gmail, mode, tray letters) is 13px, like the clock. New `fontSizes.ui` token (13px), the desktop's one text size.
- 44eb13c: A screenshot, color pick or screen cast opens over a portal dialog already up, such as the app chooser, so it can capture that dialog.
- c7a232d: Center a panel footer's line between its rule and the panel's edge.
- 7c8d9e2: Components load the library's prebuilt stylesheet, which the package now
  ships, so a shell that renders one, such as `PortalDialogs`, needs no Panda
  step.
- fa78a81: Darken panels over the wallpaper in dark mode too, so their text reads over a bright website.
- 509f948: Darken panels over the wallpaper in light mode, so their text reads over a white wallpaper.
- a2ee8ea: Access dialogs: Allow is drawn in the accent, the body is one muted line, and who asks sits opposite the buttons. Dialog corners are rounder.
- c80cd2a: Docs site: a folded docs menu on phones, "On this page" contents on long guides, a quick start for portal dialogs, accurate lock docs, and a line under the homepage's buttons for trying Domicile in a window.
- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- a1569c6: File dialog rows are easier to read: names are 16px, as in the launcher, and the kind column and sidebar 14px.
- 6fecbbd: The file dialog's fields are a soft fill, edged only on hover or focus.
- 258d9aa: The file dialog is calmer: folders have a plain teal icon and files a gray one with no tile behind them, the picked row and the current place use a neutral highlight, column headers are 11px, sidebar and list text are 13px, and the list is white in light mode.
- fb9e591: File picker: drop the path box and its pencil button (Ctrl+L). Type `/` or `~/` in the search box to jump to a path.
- 14e6071: An application's file chooser, and the print dialog's save picker, are modal like every other dialog: drawn over every window, with the rest of the desktop inert. A window's open tab and floating windows covered them.
- 506b12f: Apps known only by an id that no desktop entry uses, such as `com.chromium.Chromium`, are named by a matching entry or a readable form of the id ("Chromium") in portal dialogs, the sharing indicators, global shortcut conflicts and portal notifications.
- 00e5da2: Disabled ghost and outline buttons fade further, so they read as disabled next to enabled ones (e.g. the browser's Back and Forward).
- 75b9403: Ghost and other buttons in Settings, History and the site lose the outline they drew when not focused. The preset now sets the page's color scheme, light or dark, so packages no longer replace its `html` rules. A switch in Settings says "Off" when it is off.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- 4967b5d: Email inbox rows show the conversation total under the name and the unread count in the pill, which counts to 99+ in line with text.
- 7ac9e00: File picker: larger icons in the file list. Rows keep the launcher's height.
- a472a59: `ModalDialog` starts its content fresh when reopened before its close animation ends, so the launcher and clipboard history no longer keep the last query.
- 40d7378: Rebalance notification cards: a larger picture beside the sender and summary, the body across the full width under them, even padding, and action buttons in body-size text. Avatar's `sm` size is now 40px.
- 8bc5b85: Elements draw an outline only while it can show: on keyboard focus, and always on controls so their focus ring still fades. A transparent outline on every element made Chromium repaint anything that moved, every frame.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 4759ab2: The share and screenshot pickers call the whole desk "Everything".
- 0f4582e: - The share picker offers the whole desk and picks it at first, as the screenshot picker does.
  - A hidden window's preview keeps the share and screenshot pickers' size.
  - A picked item keeps its fill under the pointer: a selected tab, the current tab rail tab or file picker place, a picked file or picker row.
- a5bff8c: Applications' dialogs take the keyboard while they are up, so a file chooser's box takes typing instead of the window behind it.
- d138939: Center the quick settings button's icons. The Wi-Fi icon dims its unlit arcs instead of hiding them, so it keeps its shape at any signal. The battery in the button drops its own inset and the room it kept for `100%` (new `fitted` prop, `BatteryIndicator` export), so both ends of the button match.
- 4064278: Quick settings is tidier. The panel is narrower and evenly padded. A tile's status line is easier to read on the accent color. The brightness and volume sliders start and end together, and their percentages are larger. The battery line and Settings button are smaller and quieter. The mixer's captions match the slider figures.
- 74a9564: Selecting an area on screen keeps the keyboard, so Ctrl+C copies it and Escape goes back even when a browser window had focus.
- 065ff4b: Ctrl+C copies a screenshot area selected on screen, as the Copy button does.
- b39d80e: A screen cast that may share a monitor may share a region of one too, so a browser's share picker lets you drag an area.
- ee63a45: The top bar's sharing indicator says what is shared. It is a red "Sharing screen" pill, and its panel lists each source by name with what of it is shared: a window with its application, a screen by make and model, all screens, or part of a screen with its size. A region covering one whole screen is listed as that screen, and one covering every screen as all of them, instead of "Region". `Captured` carries a window's app id, a monitor's description, the monitor a region is on, and a new `Desk` kind.
- 113dabe: The boot splash crossfades into manganese's themed background instead of white.
- 2edc3c1: `Tabs`: a tab row too wide for its space scrolls sideways instead of widening the page.
- b241f68: A desktop that boots in a different theme from the one its shell remembered no longer stays stuck half faded in and ignoring the pointer. The compositor answers a theme capture with nothing to turn, and a wipe's hold can no longer freeze another view transition.
- 5d2376e: Clicking a notification popup opens it on the first click. The popup's swipe-to-dismiss took the click away from the card.
- 6c3db42: A virtual monitor can be resized in place with `resize`, keeping its output, windows and casts.
- Updated dependencies [fe90bca]
- Updated dependencies [3980a9a]
- Updated dependencies [66d220b]
- Updated dependencies [d3a65c5]
- Updated dependencies [eca2588]
- Updated dependencies [22844b3]
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
- Updated dependencies [506b12f]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [a999398]
- Updated dependencies [9d4a876]
- Updated dependencies [44d0983]
- Updated dependencies [e612f06]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [fccc784]
- Updated dependencies [2bf4b18]
- Updated dependencies [cd52ce3]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [3bb9bd5]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [ee63a45]
- Updated dependencies [66bfb0d]
- Updated dependencies [d9f5353]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [0c58b28]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
  - @domicile-desktop/sdk@2.0.0
  - @domicile-desktop/system-apps@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-apps@1.0.0
