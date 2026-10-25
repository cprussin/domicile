# domicile

## 1.1.0

### Minor Changes

- fff3e24: A window's screen cast carries its app's sound, and a monitor's every app's, in a PipeWire audio node beside the video.
- 64ffcb7: `domicile theme [light|dark|toggle]` switches the desktop's theme from a terminal, or prints it. It works with any shell and needs no pointer.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- b2c6fd5: Cast the desktop to Miracast TVs (Fire TV, Roku, Samsung, LG, Windows wireless displays) over Wi-Fi Direct or the LAN. The new `domicile-miracast` service runs each cast; `miracastCast(domicile)` in `@domicile-desktop/sdk/miracast` is its backend, and the `Cast` bar item lists its TVs.
- 93f015d: A page can ask for window management, local fonts, idle detection and automatic downloads. The shell asks the user, and Settings and the site panel show each.
- fccc784: Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `domicile.displays.setColorTemperature(kelvin)`.
- cd52ce3: The launcher's "Open with…" now lists first the app Enter opens the file with, so the two always agree. `domicile open --which <file|url>` prints the app `domicile open` would run, and the desktop puts its own `domicile` first on its apps' `PATH`.
- bbf849b: A client can ask to be laid out at a named place in the shell's page (`domicile_anchor_v1`). Shells read it as `DomicileWindow.anchor`.
- 93f015d: A page's `getDisplayMedia()` reports the surface picked (window, browser window or monitor) and, when it asks for audio, gets the source's sound. A browser window is captured as a tab, with its sound, `cropTo()` and capture handle.
- 3bb9bd5: A download's file picker starts in the download folder (`XDG_DOWNLOAD_DIR`). The file chooser event has `currentFolder`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 2430e48: Screen recording: `domicile screen-record` and the Screen Record launcher entry pick a screen, window or region and record it with its sound to `~/Videos/Screen recordings/`, with a floating toolbar (pause, resume, stop, discard) left out of the recording.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- 33444d9: Settings has a Site data page: each site that stores cookies or other data, its size, and a button that removes it.
- 912dcac: A desktop on a tty lights a screen with no 3D (2D virtio-gpu, Hyper-V, simpledrm, vkms): the engine composites on the CPU and windows reach it in shared memory. `DOMICILE_SOFTWARE_COMPOSITING=yes` or `no` overrides the guess.
- ca86667: A shell can add a monitor with no connector, which the desk extends onto and only a capture shows, with `system(domicile).addVirtualMonitor()`. Casting to a TV extends the desk this way.
- f50a783: Wayland capture tools (`grim`, `wf-recorder`, OBS's wlroots capture) copy from a running cast of the monitor, frame after frame, into shm or dmabuf buffers, and get only frames with damage they have not seen.
- cd5614b: Wayland capture tools can list windows (`ext-foreign-toplevel-list-v1`) and capture one alone, and follow the pointer with a cursor session.
- ee1cc17: `<webview partition="persist:name">` gives a page storage of its own, kept on disk; any other name keeps it in memory. `openBrowserWindow(url, partition)` opens a window in one, listed with its `partition`. A page's own navigation fires a cancelable `domicile-will-navigate` first.

### Patch Changes

- 58dac0a: An app module's system calls survive a compositor restart: the engine ends them with `compositor_gone` and dials the new compositor, so the SDK's watches and D-Bus matches listen again.
- dba9bdb: An idle blank turns the monitors off. The engine left every connector it was told to turn off out of the modeset, so the screens kept showing the desktop. A profile that turns a panel off turns it off too.
- c49b1d6: The screens stay off once they blank: a pointer that did not move no longer wakes them.
- 1dbe9e4: A browser window screen cast draws the pointer over the page.
- 8494716: On a tty, the engine takes each graphics card from logind, which hands DRM master over on a console switch, and keeps reading the keyboard and mouse while logind answers.
- 0af60e0: A screen cast draws the pointer at the screen's scale, so it is a normal-size arrow on a HiDPI screen rather than a speck.
- 623860a: While a TV is cast to, the desk holds off idle blanking and holds notification banners, which the TV could show. `inhibitIdle` takes the reason the portal is told.
- 5fc22c6: Sharing part of a hidden window from a page no longer reopens the picker: the restore token keeps the part while the compositor runs.
- 4759ab2: A fractionally scaled window's screen cast draws the pointer where it is, at its size.
- 47716fe: Screen casts drawn on the GPU show the pointer wherever it is, not only near the top left corner.
- dc2e78f: Screen casts draw the pointer that is on screen, such as a hand over a link, instead of a fixed arrow.
- 1161efd: `domicile --help` (or `-h`, `help`, or `<verb> --help`) lists every command.
- eda45b9: A window drawing faster than the engine can show it no longer crashes the engine's GPU process: while viz is 16 frames behind, the engine holds the window's newest frame and drops the ones it replaces.
- 93f015d: A browser window's `<select>` and other popups stay on the monitor they open on, rather than opening across a seam.
- 506b12f: Apps known only by an id that no desktop entry uses, such as `com.chromium.Chromium`, are named by a matching entry or a readable form of the id ("Chromium") in portal dialogs, the sharing indicators, global shortcut conflicts and portal notifications.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- b16913f: Typing or pointing in a browser window or the shell keeps the desk awake, so it no longer locks under somebody typing.
- 901b871: The keystroke latency run divides by the display frame viz reports, not an assumed 60 Hz, and also reports `commit to present` from viz's presentation feedback. Its guard allows `commit to pixel` the probe's floor plus one frame, so a 120 Hz panel passes.
- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.
- ce4b472: Site and shell notifications reach the desktop even when the compositor's notification server starts after the engine. The engine waits up to 20 seconds for it instead of falling back to Chrome's own popups.
- 670713c: The app chooser asks in plain words. With one application it asks "Open Claude?" beside Claude's icon ("Chromium wants to open this link in Claude."); with several, "Choose an app to open this link"; with none, "No app can open this link" and only Close. The link shows on one muted line at the bottom. `AppChooser` takes `asker`, `opened` and `address` in place of `title` and `description`.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 3acb12b: After a compositor crash, the new compositor launches again the clients Domicile launched that the crash took, on the same Wayland display. Qt 6.6 and later reconnect instead.
- 209873d: A menu its app repositions moves on the page, in the same frame as its new content.
- f1bfea4: Apps such as Electron's keep up better while you drag a window's edge: a window may now have three sizes it has not drawn yet, instead of one, so an app that draws several sizes at once no longer waits for each in turn.
- 575e7cd: Canceling a page's screen share picker rejects `getDisplayMedia()`, rather than starting a share that ends at once.
- f8c6cc4: A desktop on a second tty or nested in another one no longer breaks the first desktop's portals, notifications or tray. A nested desktop leaves them to its host, and a second login session hands them and the graphical session back when it exits.
- b39d80e: A screen cast that may share a monitor may share a region of one too, so a browser's share picker lets you drag an area.
- 2fe9fb4: A shared screen shows the pointer over the shell's page and browser windows, not only over an app's window.
- ee63a45: The top bar's sharing indicator says what is shared. It is a red "Sharing screen" pill, and its panel lists each source by name with what of it is shared: a window with its application, a screen by make and model, all screens, or part of a screen with its size. A region covering one whole screen is listed as that screen, and one covering every screen as all of them, instead of "Region". `Captured` carries a window's app id, a monitor's description, the monitor a region is on, and a new `Desk` kind.
- 93f015d: The shell's own page can open a file dialog, through the desktop's file picker, and a folder dropped on a page's folder input uploads its files.
- b241f68: A desktop that boots in a different theme from the one its shell remembered no longer stays stuck half faded in and ignoring the pointer. The compositor answers a theme capture with nothing to turn, and a wipe's hold can no longer freeze another view transition.
- eb6b52a: Dragging a browser window's edge no longer holds the whole desktop to the page's pace. While a `<webview>` has the `resizing` attribute, as an `<app>` already could, the page's latest frame stretches to each new box at once instead of the desktop waiting for the page to draw at it. Manganese sets it on every browser window during a resize.
- Updated dependencies [3980a9a]
- Updated dependencies [623860a]
- Updated dependencies [1062efc]
- Updated dependencies [e455955]
- Updated dependencies [ab2d2f0]
- Updated dependencies [e42226f]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [44d0983]
- Updated dependencies [cd02e0e]
- Updated dependencies [1ad2756]
- Updated dependencies [93f015d]
- Updated dependencies [e781b22]
- Updated dependencies [6b2a242]
- Updated dependencies [fccc784]
- Updated dependencies [3146073]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [45c846a]
- Updated dependencies [0bbe0f9]
- Updated dependencies [33444d9]
- Updated dependencies [f8b1742]
- Updated dependencies [e97b6b2]
- Updated dependencies [0abccd9]
- Updated dependencies [113dabe]
- Updated dependencies [f45bf2b]
- Updated dependencies [4096040]
  - @domicile-desktop/manganese@1.1.0
  - @domicile-desktop/app-history@0.0.2
  - @domicile-desktop/app-settings@0.1.0
  - @domicile-desktop/shell-simple@0.0.2
  - @domicile-desktop/shell-splash@0.0.2
  - @domicile-desktop/builder@0.0.2

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
