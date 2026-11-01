# domicile

## 1.1.0

### Minor Changes

- fe90bca: App windows can belong to an app id, and a launch can reuse that app's open window instead of opening another: `domicile open --app --id <id> --reuse focus|navigate <url>`, or `browser.openApp(url, { id, reuse })`. Windows list their `appId`. `browser.countMatches(id, selector)` counts elements in a browser window's page, hidden or not.
- fff3e24: A window's screen cast carries its app's sound, and a monitor's every app's, in a PipeWire audio node beside the video.
- 64ffcb7: `domicile theme [light|dark|toggle]` switches the desktop's theme from a terminal, or prints it. It works with any shell and needs no pointer.
- 0ba4ab7: `domicile monitor <name> <W>x<H>[@Hz]` adds a virtual monitor until stdin ends, resizing it to each size read.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- f3156a1: Emulated input (remote desktop, input sharing) on a desktop on a TTY now reaches the shell and the lock screen, as on a headless desktop. A headless desktop's monitors draw at their own scale, and emulated pointers land where they point on a scaled or rotated monitor.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- 5955f66: On a headless desktop, input from a remote desktop app (EIS) reaches the shell and its lock screen, so the desktop can be driven and unlocked with no keyboard or mouse attached. Screen casts of a headless desktop now show the pointer.
- 401b0b4: `OZONE=headless` runs a full desktop with no display device or seat, such as on WSL2. Its monitors are virtual ones the shell adds, and screen casts show each one. Apps draw in shared memory, GL apps included.
- 9d4a876: The keep awake pill names the website a browser window keeps the screens on for ("Kept awake by youtube.com"), with its icon, instead of the engine. `<webview>` gains `wakeLock` and `domicile-wake-lock-change`, and the compositor lists the engine's own hold as `domicile-browser`.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- b2c6fd5: Cast the desktop to Miracast TVs (Fire TV, Roku, Samsung, LG, Windows wireless displays) over Wi-Fi Direct or the LAN. The new `domicile-miracast` service runs each cast; `miracastCast(domicile)` in `@domicile-desktop/sdk/miracast` is its backend, and the `Cast` bar item lists its TVs.
- 3da1465: `domicile monitor` takes an optional scale after the size, like `domicile monitor TV 3840x2160 2`, and so does each resize line on stdin.
- 93f015d: A page can ask for window management, local fonts, idle detection and automatic downloads. The shell asks the user, and Settings and the site panel show each.
- fccc784: Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `domicile.displays.setColorTemperature(kelvin)`.
- cd52ce3: The launcher's "Open with…" now lists first the app Enter opens the file with, so the two always agree. `domicile open --which <file|url>` prints the app `domicile open` would run, and the desktop puts its own `domicile` first on its apps' `PATH`.
- bbf849b: A client can ask to be laid out at a named place in the shell's page (`domicile_anchor_v1`). Shells read it as `DomicileWindow.anchor`.
- 93f015d: A page's `getDisplayMedia()` reports the surface picked (window, browser window or monitor) and, when it asks for audio, gets the source's sound. A browser window is captured as a tab, with its sound, `cropTo()` and capture handle.
- 3bb9bd5: A download's file picker starts in the download folder (`XDG_DOWNLOAD_DIR`). The file chooser event has `currentFolder`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 1c7e183: The desktop stays smooth while the machine is busy without joining the `domicile` group: the engine asks rtkit to raise its drawing threads when the limits refuse. The NixOS module enables rtkit, and the packages recommend it. The group is optional and gives the most reliable result.
- 2430e48: Screen recording: `domicile screen-record` and the Screen Record launcher entry pick a screen, window or region and record it with its sound to `~/Videos/Screen recordings/`, with a floating toolbar (pause, resume, stop, discard) left out of the recording.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- 33444d9: Settings has a Site data page: each site that stores cookies or other data, its size, and a button that removes it.
- 912dcac: A desktop on a tty lights a screen with no 3D (2D virtio-gpu, Hyper-V, simpledrm, vkms): the engine composites on the CPU and windows reach it in shared memory. `DOMICILE_SOFTWARE_COMPOSITING=yes` or `no` overrides the guess.
- 6c3db42: A virtual monitor can be resized in place with `resize`, keeping its output, windows and casts.
- 9c89f16: A virtual monitor can have a scale of its own, such as 1.5, when added or resized (`addVirtualMonitor` and `resize` take `scale`).
- ca86667: A shell can add a monitor with no connector, which the desk extends onto and only a capture shows, with `system(domicile).addVirtualMonitor()`. Casting to a TV extends the desk this way.
- f50a783: Wayland capture tools (`grim`, `wf-recorder`, OBS's wlroots capture) copy from a running cast of the monitor, frame after frame, into shm or dmabuf buffers, and get only frames with damage they have not seen.
- cd5614b: Wayland capture tools can list windows (`ext-foreign-toplevel-list-v1`) and capture one alone, and follow the pointer with a cursor session.
- ee1cc17: `<webview partition="persist:name">` gives a page storage of its own, kept on disk; any other name keeps it in memory. `openBrowserWindow(url, partition)` opens a window in one, listed with its `partition`. A page's own navigation fires a cancelable `domicile-will-navigate` first.

### Patch Changes

- 58dac0a: An app module's system calls survive a compositor restart: the engine ends them with `compositor_gone` and dials the new compositor, so the SDK's watches and D-Bus matches listen again.
- dba9bdb: An idle blank turns the monitors off. The engine left every connector it was told to turn off out of the modeset, so the screens kept showing the desktop. A profile that turns a panel off turns it off too.
- c49b1d6: The screens stay off once they blank: a pointer that did not move no longer wakes them.
- 866cf8e: Video calls and films in a browser window keep the screens on. The compositor serves `org.freedesktop.ScreenSaver`, so a screen wake lock (Google Meet, YouTube) holds the desktop awake while its window is shown.
- 1dbe9e4: A browser window screen cast draws the pointer over the page.
- af3a4e8: Fix black recordings and casts of a browser window: its stream now starts at the page's size instead of one pixel.
- 8494716: On a tty, the engine takes each graphics card from logind, which hands DRM master over on a console switch, and keeps reading the keyboard and mouse while logind answers.
- 0af60e0: A screen cast draws the pointer at the screen's scale, so it is a normal-size arrow on a HiDPI screen rather than a speck.
- 623860a: While a TV is cast to, the desk holds off idle blanking and holds notification banners, which the TV could show. `inhibitIdle` takes the reason the portal is told.
- 5fc22c6: Sharing part of a hidden window from a page no longer reopens the picker: the restore token keeps the part while the compositor runs.
- 4759ab2: A fractionally scaled window's screen cast draws the pointer where it is, at its size.
- 47716fe: Screen casts drawn on the GPU show the pointer wherever it is, not only near the top left corner.
- dc2e78f: Screen casts draw the pointer that is on screen, such as a hand over a link, instead of a fixed arrow.
- 4594119: The shell no longer crashes when an animation ends just as a page with text stops being opaque: the engine waits for the frame it is about to show before redrawing that text.
- 1161efd: `domicile --help` (or `-h`, `help`, or `<verb> --help`) lists every command.
- 22844b3: Docs audit: Wayland-only app support and the apps we check, the config schema served from domicile-desktop.com, locking in a `nix run` trial, portal requests a shell must answer, a complete packaging example, GPU troubleshooting for users, a NixOS flake example, differences from Chrome, and contributor-only sections labeled in the package references.
- eda45b9: A window drawing faster than the engine can show it no longer crashes the engine's GPU process: while viz is 16 frames behind, the engine holds the window's newest frame and drops the ones it replaces.
- 17064a7: A browser window whose `<webview>` moves in the shell's document shows its page again where it lands. Before, the page stayed detached and the window froze, which happened when a window crossed monitors while being resized.
- 93f015d: A browser window's `<select>` and other popups stay on the monitor they open on, rather than opening across a seam.
- 506b12f: Apps known only by an id that no desktop entry uses, such as `com.chromium.Chromium`, are named by a matching entry or a readable form of the id ("Chromium") in portal dialogs, the sharing indicators, global shortcut conflicts and portal notifications.
- 8ffb4c5: On a device whose render node allocates no GBM buffers, such as vgem under WSL2, the compositor allocates on the device's primary node, so shared-memory windows and casts are no longer blank there.
- 73dd960: Gmail's new-mail notifications are drawn with Gmail's site icon, the one the launcher shows, instead of a letter. A notification's picture may be an image's `data:` URL.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- 4b76732: A hidden window, on another workspace or behind a tab, no longer keeps the screens on with its idle inhibitor. It holds them again once shown, as the protocol asks.
- b16913f: Typing or pointing in a browser window or the shell keeps the desk awake, so it no longer locks under somebody typing.
- b0e0a13: The keep-awake eye names what holds the screens on as you know it (Claude, not com.anthropic.Claude), from each application's desktop entry.
- 901b871: The keystroke latency run divides by the display frame viz reports, not an assumed 60 Hz, and also reports `commit to present` from viz's presentation feedback. Its guard allows `commit to pixel` the probe's floor plus one frame, so a 120 Hz panel passes.
- 4ac3c0d: The launcher previews PDFs again: the PDF viewer starts in the shell instead of drawing an empty gray pane.
- b85d9bb: Name what keeps the screens on. A new `idle_holds` system call (`session.idleHolds()` in the SDK) lists the windows and applications holding idle inhibitors, and the bar's eye opens and names them. The compositor logs each change, and the input that restarts the idle clock when it was getting close to blanking or locking, naming the event and device for the browser's own input.
- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.
- 7dc458f: The night light turns off again, on schedule and from its switch.
- 508f227: A notification that comes without an icon is drawn with its app's icon, found from its `desktop-entry` hint or its app name, instead of a letter.
- 2c10391: Pressing a notification from an app that is running with no window open, such as Slack closed to its tray, starts the app again so it shows its window.
- 3a7a001: Pressing a notification raises its app's window even when the app asks with its own activation token instead of the one the press hands it, as Slack and other apps on Electron before 42 do.
- ce4b472: Site and shell notifications reach the desktop even when the compositor's notification server starts after the engine. The engine waits up to 20 seconds for it instead of falling back to Chrome's own popups.
- 61ef2b4: An application's notifications clear once you look at it: when its window gets the keyboard, or when you press any of its notifications. Slack and most Linux applications never close their own.
- e2d8a62: Sharing from Slack asks once: an app's casts started together take the one pick, instead of putting up a picker each.
- 670713c: The app chooser asks in plain words. With one application it asks "Open Claude?" beside Claude's icon ("Chromium wants to open this link in Claude."); with several, "Choose an app to open this link"; with none, "No app can open this link" and only Close. The link shows on one muted line at the bottom. `AppChooser` takes `asker`, `opened` and `address` in place of `title` and `description`.
- 3ee3ca0: PDFs, images and videos open in a browser window of the desktop by default, as links do.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 01c092d: A window whose page shows an `alert()`, `confirm()` or `prompt()` no longer slows a workspace switch, or a window growing or shrinking. The shell waited for the paused page to draw on every frame.
- 99ff136: Keep the default log quiet. Routine compositor lines (idle holders, display reloads, casts, thread priorities, requests refused while locked) are debug, and the launcher prints its choices and the shell build's progress only on a terminal.
- 4ad0520: Screen recordings of a screen or region are scaled down to at most 4K's pixels, so a whole desk of high-density monitors records smoothly instead of at a few frames a second.
- 270cf9a: Screen recordings are encoded on the GPU (AV1 or VP9 through VA-API) when it can, so a recording near 4K keeps up instead of dropping to about 15 frames a second. Without a GPU encoder they are VP8 on the CPU, as before, with the color conversion now spread over every core.
- 3acb12b: After a compositor crash, the new compositor launches again the clients Domicile launched that the crash took, on the same Wayland display. Qt 6.6 and later reconnect instead.
- 209873d: A menu its app repositions moves on the page, in the same frame as its new content.
- cd794f9: A native window no longer shows zoomed in while you resize it on a scaled monitor.
- 75799a0: Dragging a window's edge no longer makes its contents jitter. While an `<app>` or `<webview>` has `resizing`, the window's latest frame shows at its own size in the top left corner until the window draws at the new size, instead of being stretched to the new size and then snapping back.
- f1bfea4: Apps such as Electron's keep up better while you drag a window's edge: a window may now have three sizes it has not drawn yet, instead of one, so an app that draws several sizes at once no longer waits for each in turn.
- 6f85479: Apps no longer crash when a display goes away, such as a TV the desk extended onto. The compositor withdraws a removed display's `wl_output` first and frees it a few seconds later, so an app that binds it in the meantime keeps running.
- 0f16f99: The engine is built on a newer Chromium, with its fixes and web platform updates.
- 575e7cd: Canceling a page's screen share picker rejects `getDisplayMedia()`, rather than starting a share that ends at once.
- f8c6cc4: A desktop on a second tty or nested in another one no longer breaks the first desktop's portals, notifications or tray. A nested desktop leaves them to its host, and a second login session hands them and the graphical session back when it exits.
- b39d80e: A screen cast that may share a monitor may share a region of one too, so a browser's share picker lets you drag an area.
- 2fe9fb4: A shared screen shows the pointer over the shell's page and browser windows, not only over an app's window.
- 5ef82d2: Apps that ask to share a screen, as Slack and Discord do, can pick a window too.
- ee63a45: The top bar's sharing indicator says what is shared. It is a red "Sharing screen" pill, and its panel lists each source by name with what of it is shared: a window with its application, a screen by make and model, all screens, or part of a screen with its size. A region covering one whole screen is listed as that screen, and one covering every screen as all of them, instead of "Region". `Captured` carries a window's app id, a monitor's description, the monitor a region is on, and a new `Desk` kind.
- 93f015d: The shell's own page can open a file dialog, through the desktop's file picker, and a folder dropped on a page's folder input uploads its files.
- 067e0c4: Smoother recordings and casts of a whole monitor or the desk: frames are paced on a steady beat instead of dropping one every few dozen, filled once when sent instead of on every engine frame, and drawn on the GPU with one read back instead of reading back and scaling each monitor on the CPU.
- 623fb41: The engine is smaller: it leaves out Chrome's own settings, New Tab page and other pages the desk never opens, WebUI code caches, and, in every language but English, the strings of Chrome's own UI. Web pages' strings stay translated.
- b241f68: A desktop that boots in a different theme from the one its shell remembered no longer stays stuck half faded in and ignoring the pointer. The compositor answers a theme capture with nothing to turn, and a wipe's hold can no longer freeze another view transition.
- eb6b52a: Dragging a browser window's edge no longer holds the whole desktop to the page's pace. While a `<webview>` has the `resizing` attribute, as an `<app>` already could, the page's latest frame stretches to each new box at once instead of the desktop waiting for the page to draw at it. Manganese sets it on every browser window during a resize.
- Updated dependencies [bafd922]
- Updated dependencies [8fa9c05]
- Updated dependencies [3980a9a]
- Updated dependencies [623860a]
- Updated dependencies [a2def76]
- Updated dependencies [9d0934e]
- Updated dependencies [bb92965]
- Updated dependencies [1062efc]
- Updated dependencies [c429bd5]
- Updated dependencies [e455955]
- Updated dependencies [c03a44b]
- Updated dependencies [ab2d2f0]
- Updated dependencies [64b22f3]
- Updated dependencies [e42226f]
- Updated dependencies [75b9403]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [7a29c8f]
- Updated dependencies [a113605]
- Updated dependencies [3ded272]
- Updated dependencies [d4b9da4]
- Updated dependencies [be59aae]
- Updated dependencies [9d4a876]
- Updated dependencies [10ee944]
- Updated dependencies [44d0983]
- Updated dependencies [cd02e0e]
- Updated dependencies [5e0723d]
- Updated dependencies [8946a22]
- Updated dependencies [3757596]
- Updated dependencies [1ad2756]
- Updated dependencies [93f015d]
- Updated dependencies [e781b22]
- Updated dependencies [6b2a242]
- Updated dependencies [fccc784]
- Updated dependencies [1fcf33a]
- Updated dependencies [2ce51b8]
- Updated dependencies [3146073]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [a1f9bb9]
- Updated dependencies [341debf]
- Updated dependencies [ae7874c]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [45c846a]
- Updated dependencies [0bbe0f9]
- Updated dependencies [33444d9]
- Updated dependencies [e645e06]
- Updated dependencies [f8b1742]
- Updated dependencies [e97b6b2]
- Updated dependencies [0abccd9]
- Updated dependencies [96a82ac]
- Updated dependencies [2d0838f]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [1971d87]
- Updated dependencies [f45bf2b]
- Updated dependencies [4096040]
- Updated dependencies [de5d134]
- Updated dependencies [6c3db42]
  - @domicile-desktop/app-settings@0.1.0
  - @domicile-desktop/app-history@0.0.2
  - @domicile-desktop/manganese@1.1.0
  - @domicile-desktop/shell-simple@0.0.2
  - @domicile-desktop/shell-splash@0.0.2
  - @domicile-desktop/builder@0.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Minor Changes

- e90c8ad: On a tty, a touchpad ignores input while a keyboard types. `domicile disable-while-typing [on|off|toggle]` turns it off and on.

### Patch Changes

- d32d8f7: A `domicile://` page can `fetch()` its own files, and only its own.
- 0bf1018: The boot splash crossfades straight into the shell instead of through a white page.
- Updated dependencies [2056529]
- Updated dependencies [0ff84ad]
- Updated dependencies [0bf1018]
  - @domicile-desktop/manganese@1.0.0
  - @domicile-desktop/builder@0.0.1
  - @domicile-desktop/shell-simple@0.0.1
  - @domicile-desktop/app-history@0.0.1
  - @domicile-desktop/app-settings@0.0.1
  - @domicile-desktop/shell-splash@0.0.1
