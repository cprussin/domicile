# domicile

## 1.1.0

### Minor Changes

- fff3e24: A window's screen cast carries its app's sound, and a monitor's every app's, in a PipeWire audio node beside the video.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- bbf849b: A client can ask to be laid out at a named place in the shell's page (`domicile_anchor_v1`). Shells read it as `DomicileWindow.anchor`.
- 3bb9bd5: A download's file picker starts in the download folder (`XDG_DOWNLOAD_DIR`). The file chooser event has `currentFolder`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- 33444d9: Settings has a Site data page: each site that stores cookies or other data, its size, and a button that removes it.
- 912dcac: A desktop on a tty lights a screen with no 3D (2D virtio-gpu, Hyper-V, simpledrm, vkms): the engine composites on the CPU and windows reach it in shared memory. `DOMICILE_SOFTWARE_COMPOSITING=yes` or `no` overrides the guess.
- f50a783: Wayland capture tools (`grim`, `wf-recorder`, OBS's wlroots capture) copy from a running cast of the monitor, frame after frame, into shm or dmabuf buffers, and get only frames with damage they have not seen.
- cd5614b: Wayland capture tools can list windows (`ext-foreign-toplevel-list-v1`) and capture one alone, and follow the pointer with a cursor session.
- ee1cc17: `<webview partition="persist:name">` gives a page storage of its own, kept on disk; any other name keeps it in memory. `openBrowserWindow(url, partition)` opens a window in one, listed with its `partition`. A page's own navigation fires a cancelable `domicile-will-navigate` first.

### Patch Changes

- 58dac0a: An app module's system calls survive a compositor restart: the engine ends them with `compositor_gone` and dials the new compositor, so the SDK's watches and D-Bus matches listen again.
- c49b1d6: The screens stay off once they blank: a pointer that did not move no longer wakes them.
- 1dbe9e4: A browser window screen cast draws the pointer over the page.
- 8494716: On a tty, the engine takes each graphics card from logind, which hands DRM master over on a console switch, and keeps reading the keyboard and mouse while logind answers.
- 0af60e0: A screen cast draws the pointer at the screen's scale, so it is a normal-size arrow on a HiDPI screen rather than a speck.
- 4759ab2: A fractionally scaled window's screen cast draws the pointer where it is, at its size.
- 47716fe: Screen casts drawn on the GPU show the pointer wherever it is, not only near the top left corner.
- dc2e78f: Screen casts draw the pointer that is on screen, such as a hand over a link, instead of a fixed arrow.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- b16913f: Typing or pointing in a browser window or the shell keeps the desk awake, so it no longer locks under somebody typing.
- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.
- ce4b472: Site and shell notifications reach the desktop even when the compositor's notification server starts after the engine. The engine waits up to 20 seconds for it instead of falling back to Chrome's own popups.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 3acb12b: After a compositor crash, the new compositor launches again the clients Domicile launched that the crash took, on the same Wayland display. Qt 6.6 and later reconnect instead.
- 209873d: A menu its app repositions moves on the page, in the same frame as its new content.
- 575e7cd: Canceling a page's screen share picker rejects `getDisplayMedia()`, rather than starting a share that ends at once.
- b39d80e: A screen cast that may share a monitor may share a region of one too, so a browser's share picker lets you drag an area.
- 2fe9fb4: A shared screen shows the pointer over the shell's page and browser windows, not only over an app's window.
- Updated dependencies [1062efc]
- Updated dependencies [e42226f]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [cd02e0e]
- Updated dependencies [1ad2756]
- Updated dependencies [e781b22]
- Updated dependencies [6b2a242]
- Updated dependencies [3146073]
- Updated dependencies [c4fe915]
- Updated dependencies [45c846a]
- Updated dependencies [0bbe0f9]
- Updated dependencies [33444d9]
- Updated dependencies [113dabe]
- Updated dependencies [f45bf2b]
- Updated dependencies [4096040]
  - @domicile-desktop/manganese@1.1.0
  - @domicile-desktop/app-settings@0.1.0
  - @domicile-desktop/app-history@0.0.2
  - @domicile-desktop/builder@0.0.2
  - @domicile-desktop/shell-simple@0.0.2
  - @domicile-desktop/shell-splash@0.0.2

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
