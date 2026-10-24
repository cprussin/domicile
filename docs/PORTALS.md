# Portals

Domicile is the session's only `xdg-desktop-portal` backend:

- The compositor implements every portal interface except `Secret`, which
  goes to the keyring.
- The shell draws every portal dialog.
- `xdg-desktop-portal-gtk` is not in the session.

## Design

```
app ──org.freedesktop.portal.*──▶ xdg-desktop-portal ──impl.portal.*──▶ compositor
                                                                         │ domicile_host::portals (queue)
                                    HostMessage::PortalRequests { items } ▼
                                         engine: `portalrequests` event (all kinds)
                                                                         ▼
                        shell: domicile.addEventListener("portalrequests") → <PortalDialogs>
                        ◀── answerPortalRequest(id, answer) ── engine ── compositor ──▶ Response
```

One request channel carries all dialogs. Each interface's backend builds on it.

| Piece | Where |
|---|---|
| Wire types: `HostMessage::PortalRequests`, `ChromeMessage::AnswerPortalRequest`, `PortalRequest`, `PortalAnswer` | `packages/domicile-protocol` |
| Queue: pending requests, their apps, answer validation | `packages/domicile-host/src/portals.rs` |
| D-Bus service: one name, one object, all interfaces; `Request`/`Session` objects | `packages/domicile-compositor/src/portals/` (`Settings` in `settings.rs`) |
| `portalrequests` event, `answerPortalRequest()` | `control_channel.mojom`, `modules/domicile/`; new files only, no patch |
| Request kinds, parsed with Zod | `@domicile-desktop/sdk/portal` |
| Ready-made dialogs for any shell | `@domicile-desktop/component-library/PortalDialogs` |
| `parent_window` to window lookup | `zxdg_exporter_v2` / `v1` in the compositor |
| EIS server: devices per grant, regions, translation to seat input | `packages/domicile-compositor/src/eis.rs` |
| Interface routing | `distro/nix/domicile.portal`, `distro/nix/domicile-portals.conf` |

## Key decisions

- **No gtk fallback.** The shell already draws every dialog gtk would
  (manganese has a file picker, a launcher with desktop entries, a
  notification drawer). A fallback would give one session two looks and two
  keyboard models. The NixOS and home-manager modules offer no gtk backend.
- **The frontend starts under this desktop's name.** `xdg-desktop-portal`
  reads `XDG_CURRENT_DESKTOP` once, at startup. Without `domicile` it routes
  every interface to gtk as a last resort.
  - The launcher exports `XDG_CURRENT_DESKTOP` to the systemd user manager
    before starting any component (`graphical_session::name`). The engine
    starts first and can D-Bus activate the frontend.
  - The compositor sets it in the D-Bus and systemd activation environments,
    then restarts `xdg-desktop-portal.service` if its main process lacks the
    name (`portals::reroute_frontend`). It finds the process by the unit's
    `MainPID`, not the bus name, so a frontend still loading its backends is
    caught.
  - Check with `tr '\0' '\n' </proc/$(systemctl --user show -p MainPID
    --value xdg-desktop-portal)/environ | grep XDG_CURRENT_DESKTOP`.
- **`Secret` goes to the keyring.** `gnome-keyring` or `oo7-portal` implements
  it. It has no UI, and the store must outlive the session.
  `domicile-portals.conf` routes it to the keyring.
- **Requests are pushed whole.** `PortalRequests` carries every unanswered
  request on each change and on connect, as notifications do. A reloaded page
  or a second monitor's page still sees a pending dialog. The first answer
  wins; later answers are refused.
- **The engine relays request bodies untyped.** It carries each body as a
  `base::Value`; the SDK parses it with Zod. One engine change serves every
  kind, so a new portal needs no four-hour engine build. A typed mojom union
  per kind adds nothing: the compositor and SDK already validate both ends.
- **No dialog listener means refusal.** If no listener takes a request, it is
  refused with response `2`, as `domicile-file-chooser` does for `<webview>`.
  `<PortalDialogs />` is one element, so shell-simple and the example shell
  get every dialog by mounting it.
- **Dialogs are modal over their parent.** `parent_window`
  (`wayland:<handle>`) resolves through the compositor's `xdg_foreign` export
  to an app id. The shell draws the dialog over that `<app>`. A missing or
  unknown handle puts the dialog over the focused screen.
- **File filters become extensions.** The picker matches extensions, so the
  compositor turns each glob (`*.[pP][nN][gG]` is `png`) and MIME type (through
  shared-mime-info's `globs2`) into a list. A filter with no extension, such as
  `Makefile`, is left out. The shell answers with paths and a filter index; the
  compositor answers the portal with `file://` URIs and the original filter.
- **Dialogs name the app.** The frontend's `app_id`, and a ScreenCast
  window's Wayland `app_id`, resolve in the shell through
  `@domicile-desktop/system-apps` to a name and icon ("Zoom wants to share
  your screen").
- **Account shows what is shared.** The compositor looks the user up before
  asking; the dialog shows the name and picture.
- **AppChooser offers the frontend's `choices`.** The shell names them from
  their desktop entries and picks `last_choice`, else the first default
  `mimeapps.list` gives the type (`domicile-mimeapps.list` first). The
  compositor checks the answer is one of the current choices.
- **The compositor owns PipeWire.** A window source is the client's buffer,
  which the compositor already has. A monitor source is the composited
  output, which only viz has: the engine runs a `FrameSinkVideoCapturer` on
  the display's root frame sink and sends each frame's dmabuf over the broker
  socket. One producer keeps cursor modes and restore tokens in one place.
  The producer is `src/casting/`: `Casting::start` takes a `Source` and
  reports the node. `Source::Monitor` names a `wl_output`; `Source::Region`
  is a desktop rectangle in logical pixels. The pointer is drawn where the
  engine last saw it (`desk_pointer`), so it shows over pages and windows
  alike. It is the pointer the engine draws (`desk_cursor`): a hand over a
  link is a hand in the cast. Until the engine has said, it is a built-in
  arrow. While the engine hides the pointer, no cast shows it. The image is
  resized to the source's density, never below one pixel a logical pixel,
  or a call that scales the stream down would make it a speck. A window's
  density is its buffer pixels a surface point, which `wp_viewport` makes
  fractional under `wp_fractional_scale`. As metadata,
  the cursor's meta size is a range up to 384×384, as Mutter's is: a
  consumer makes room for its own largest cursor (WebRTC asks for 64×64),
  and PipeWire drops a meta whose sizes do not meet. A pointer larger than
  the room is shrunk into it.
  - `Source::BrowserWindow` is a browser window's page alone, by the
    engine's window id: the engine captures its frame sink
    (`CaptureBrowserWindow`), as a browser window screenshot does. The
    capture keeps the page drawing while the shell hides it, so a hidden
    tab still streams. The stream is the page's size. Its pointer is where the engine puts it
    over the page, as a fraction of it (`desk_pointer`'s `windows`).
  - The compositor does not list browser windows. The dialog says
    `browser_windows` when windows may be picked, and the shell offers
    `DomicileHost.browserWindows`. A pick of a closed window fails to start.
  - Restore tokens keep a browser window only while the compositor runs
    (persist mode 1): engine ids do not survive a restart.
  - The picker is laid out as the screenshot picker is (`SourcePicker`): screens
    and windows in a list beside a desk shot taken as it opens (`desk`, a
    `FrozenDesk`), which outlines each pick. Several picks are checkboxes.
    Without a shot it says there is no preview. A window not on screen is
    drawn alone instead (`previewWindow`), and a part of it may be dragged
    over it: the pick's `area`, in the pixels of the frame the preview drew.
    The stream is that part of the window's frame alone, kept inside the
    frame if the window shrinks. A part is not kept by a restore token.
  - When the application may have a region, the list starts with
    "Everything", the whole desk as a region, picked as it opens.
- **Input uses EIS.** RemoteDesktop and InputCapture hand out a libei socket
  (`ConnectToEIS`) served by the compositor (`reis`). Emulated input takes the
  engine's input injection path, so the lock screen still blocks it.
  - A point lands on the window under it by the page's last window bounds;
    overlaps go to the focused window, then the smallest. A point over the
    shell reaches nothing: only the engine can deliver to the page.
  - The seat has no touchscreen, so a touch is the left button, one finger
    at a time.
  - The legacy `NotifyPointerMotionAbsolute` and `NotifyTouch*` take a
    ScreenCast stream's coordinates. A session that shares no screen has no
    stream, so they are refused; EIS's absolute pointer covers the displays.
  - InputCapture sees only what the engine forwards: keys, and pointer events
    over a window. So the pointer reaches a barrier only over a window, and
    captured motion is the change between reported points, which stops at
    the screen's edge. Relative motion past the edge needs an engine change.
    No touchscreen capture.
  - A Clipboard paste hands the application the pasting client's pipe, so the
    data never passes through the compositor.
- **Grants live in the frontend's `PermissionStore`.** Domicile stores only
  ScreenCast and RemoteDesktop restore tokens and the global shortcut choices,
  under `$XDG_STATE_HOME/domicile/`.
- **Global shortcuts are the shell's grabs.** Only the engine sees keys, so the
  compositor lists each bound chord in the `PortalRequests` push
  (`shortcuts`); `<PortalDialogs />` grabs it with `grabShortcut` and answers
  `pressed` under its id on `shortcut`, and `released` on `shortcutrelease`.
  It gives a chord back with `ungrabShortcut` once no app holds it.
  The compositor signals `Activated` and `Deactivated` for them. A locked desk
  refuses both answers.
  - The review dialog spells each chord as `bindKeys` does and flags one the
    shell or another app holds.
  - Choices are kept per app id in `global-shortcuts.json`. A `BindShortcuts`
    whose every id has a choice binds without a dialog.
  - **Decline** clears every chord, so the app is not asked again; it can
    still ask with `ConfigureShortcuts`. Dismissing the dialog keeps no
    choice.
  - A chord is released when its key or one of its modifiers comes up,
    wherever the keyboard is. The page pairs each release with its press
    (`components/domicile/common/held_chords.h`). A key that comes up in a
    `<webview>` reaches the page through `ShortcutRegistry::Release`.
- **Multi-monitor regions use the highest density.** A stream has one scale,
  so a region spanning monitors is captured at the highest density it
  touches. Lower-density monitors lose nothing.
- **A screenshot freezes the desk first.** Each `Screenshot` and `PickColor`
  takes one frame of every monitor from the display captures, composed at the
  highest density (`Casting::shoot`). The picker and the color picker draw that
  frame, so they never capture themselves; the shell answers an area or a
  pixel in frame pixels. Saved as a PNG under
  `$XDG_PICTURES_DIR/Screenshots/`.
  - **Copy, or Ctrl+C, in the picker copies the pick** (desk, screen,
    window or area) to the clipboard as a PNG and closes it (`copy` on the answer). It
    becomes a clipboard history row. An application that asked still gets
    its file; the shell's own screenshot is not saved
    (`SystemReply::Copied`).
  - The picker lists "Everything" (the whole desk), then screens, then
    windows, beside the frozen desk. The desk outlines the pick with its
    size; arrow keys move through the list. A screen is named by its make and model, a window by
    its title over its application's desktop entry.
  - A window is answered `screenshot_window` and saved from the last frame
    it showed, which the engine still holds. What is over it, such as a
    notification, is left out, and so is the shell's title bar or tab. This
    covers windows the shell does not show (a hidden tab, another
    workspace).
  - A window or browser window the shell does not show is drawn alone in
    place of the desk when picked: the `preview_window` system call draws
    it as the screenshot would save it. A part dragged over it is the
    answer's `area`, in that frame's pixels, and only that part is saved.
  - The picker outlines a shown window on the frozen desk by its box. The
    shell passes its boxes as `shownWindows`; without them the picker reads
    the page's `<app>` and `<webview window>` boxes. A box is placed with
    the frozen desk's `desk` rectangle: the page's CSS pixels are the desk's
    logical pixels.
  - A browser window is answered `screenshot_browser_window` by its
    browser window id. The engine captures its page's own frame sink
    (`CaptureBrowserWindow`) and the compositor saves the first frame. The
    shot is the page alone: no address bar, title bar or anything over it.
    One not on screen, such as a tab behind another, is offered too: the
    capture keeps its page drawing.
  - The frontend checks the `PermissionStore` for a non-interactive
    screenshot (`permission_store_checked`). Without that, the backend asks
    through an `Access` dialog once per app and keeps the answer in the same
    `screenshot` table.
  - The shell takes its own through the `screenshot` system call
    (`portals::screenshot::for_the_shell`): an interactive screenshot asked as
    `SHELL_APP_ID`, which the dialog draws without an asker. Given a file,
    it writes the whole desk there without a dialog. `domicile screenshot`
    sends either, with the file it was given or none.
- **No print preview.** The portal sends the document only after the dialog
  closes, so there is nothing to preview. Gtk's backend has none either.
- **Print speaks IPP itself.** `domicile_host::ipp` encodes the few message
  shapes CUPS needs, rather than adding the `ipp` crate and its HTTP stack. A
  token's choice lives in memory until `Print` takes it.
- **Save to PDF is a destination.** The dialog lists it after CUPS's
  printers, and alone when there are none. The shell's file picker chooses
  the file. GTK's settings say "Print to File" with that `output-uri`, and
  `Print` writes the application's own PDF there. A document that is not a
  PDF ends with `2`.
- **Browser windows print through the portal.** The engine's print dialog is
  Chromium's `PrintDialogLinuxPortal`, so `view.print()` and a page's
  `window.print()` reach this backend as any application's print does. Print
  Preview is off: it is a `chrome://` page.
- **Browser windows capture through the portal.** A page's
  `getDisplayMedia()` opens a ScreenCast session from the engine, as any
  application does, through webrtc's PipeWire capturer. The page gets the
  same picker and indicator. The engine asks before it answers the page, so a
  cancel rejects `getDisplayMedia()`; the capture then restores the pick from
  the picker session's restore token (`persist_mode` 1). See
  [SHELL-BROWSER-WINDOWS.md](SHELL-BROWSER-WINDOWS.md#permissions).
- **A cast carries its source's sound.** A window's cast holds a PipeWire
  `Audio/Source/Virtual` node, `domicile-sound-window-<stream id>`, into
  which the compositor links the audio streams of the window's client
  process and its children (by each stream's PipeWire client's
  `application.process.id`, else its socket peer). A monitor's or region's
  cast holds `domicile-sound-desk`, which links every app's. Apps keep
  playing where they were. A node outlives its last cast and consumer by 5
  s, so a page capture that restores its pick in a new session finds it.
  The ScreenCast interface has no audio, so only the engine reads the node,
  by name. An app in its own PID namespace, as Flatpak's are, may report a
  pid the compositor does not know, and is then not heard. The code is
  `src/casting/audio.rs`.
- **The shell shows active sharing.** `portal_requests` carries `capturing`:
  each running session (id, app, what it holds). The shell stops one by
  answering its id with `stop`. `<PortalDialogs />` draws the indicator;
  `omitScreenCasts` leaves screen casts to a shell that shows them itself, as
  manganese's bar does.
- **The wallpaper rides the same push.** `PortalRequests` carries `wallpaper`:
  the background and lock-screen pictures applications set, as paths the shell
  reads with `read_file`. The engine relays that line untyped, so no engine
  change. The compositor copies each picture to
  `$XDG_STATE_HOME/domicile/wallpaper/` and keeps the choice there, so it
  outlives the application's file and the session.
- **Background asks through Access.** The frontend puts `RequestBackground` to
  the user as an `AccessDialog`; the impl interface has no such method.
  `NotifyBackground` posts a notification ("X is running in the background")
  through the desktop's own notification server and answers `2` (allow this
  instance): the user already chose once. `GetAppState` comes from each
  window's `app_id`; an application with no window is absent, which the
  frontend reads as background.
- **Restore tokens name windows by app id and title.** Host ids do not
  survive a restart. A window whose title changed matches by app id alone.
  A monitor is named by its `wl_output` name, and a region by its rectangle
  relative to the monitor it is mostly on, so it follows that monitor.
- **Asking for monitors offers a region too.** A region is part of a
  monitor, so a `types` with `MONITOR` or `VIRTUAL` lets the user drag one.
  Browsers ask for monitors and windows, never `VIRTUAL`.
- **A region is dragged on the desk shot.** As in the screenshot picker,
  the user drags over the picker's desk preview, and the area is turned
  into the desktop's logical pixels, grown to whole ones. With no desk shot,
  "Draw a region" closes the dialog and the user drags over the page, whose
  pixels are the desktop's logical pixels.

- **The frontend installs launchers.** `Install`, `Uninstall`,
  `LaunchDesktopFile`, `GetDesktopEntry` and `GetIcon` are frontend methods:
  it writes the `.desktop` file and icon under
  `$XDG_DATA_HOME/xdg-desktop-portal/` and links them into `applications/`
  and `icons/`, where the shell's desktop entries (`system-apps`) find them.
  The backend only confirms (`PrepareInstall`).
- **No install tokens.** `RequestInstallToken` is refused for every app, so
  every launcher install shows the dialog. Domicile has no software store to
  trust; trusting an app id would let any app claiming it skip the user.
- **USB is granted whole.** The dialog allows every device asked for or none.
  The spec allows a subset, but an app asks for the devices it needs.

## Interfaces

| Interface | Compositor | Shell UI |
|---|---|---|
| Settings | `org.freedesktop.appearance` `color-scheme`, `accent-color`, `contrast`, `reduced-motion` from shell config; `org.gnome.desktop.interface` `color-scheme` (`prefer-dark`/`prefer-light`), `enable-animations` (the inverse of `reduced_motion`), and `icon-theme`, `cursor-theme`, `cursor-size`, `font-name`, `monospace-font-name` when the matching `theme` key is set; a per-mode `cursor-theme` follows the color scheme | — |
| FileChooser | `OpenFile`, `SaveFile`, `SaveFiles`; filters, `current_folder`, `choices` | picker (component-library's `FilePicker`) |
| AppChooser | candidates from desktop entries and `mimeapps.list`; `UpdateChoices` | app list |
| OpenURI | (frontend) | via AppChooser |
| Access | `grant_label`, `deny_label`; Domicile's own `destructive` makes the yes a danger button | yes/no prompt with the app's name; none for Domicile's own questions |
| Account | user name, avatar from `AccountsService`, else passwd | confirm; allowed with the `access` answer |
| Email | opens the `mailto:` handler from `mimeapps.list` with the fields; attachments as `attach=`, which Thunderbird ignores | — |
| Notification | v2, direct to `domicile_host::notifications` | existing drawer |
| Inhibit | idle inhibit through `idle.rs`; logout/suspend inhibitors listed as `inhibit` requests; `QueryEndResponse` on session end (the desk has no session end yet, so no query-end is sent) | "X is preventing logout" |
| Lockdown | properties from the config's `lockdown`; signaled on reload | — |
| ScreenCast | windows, browser windows, monitors, region; cursor embedded/metadata/hidden; PipeWire streams; restore tokens | source picker, sharing indicator |
| Screenshot | one frame from the same sources, PNG to `$XDG_PICTURES_DIR`; `PickColor` | region picker, color picker |
| RemoteDesktop | EIS socket; legacy `Notify*` methods use the same path | device grant |
| Clipboard | selection to/from a RemoteDesktop session through `clipboard.rs` | part of that grant |
| InputCapture | pointer barriers at screen edges; EIS | grant |
| GlobalShortcuts | binds into the shell's keymap; `Activated`/`Deactivated` | review and rebind |
| Background | autostart entries (`EnableAutostart`); `GetAppState` from windows and focus; `NotifyBackground` as a notification | via Access |
| Wallpaper | copies the picture; `set-on` background, lock screen or both | preview dialog, shell wallpaper and lock screen |
| DynamicLauncher | `PrepareInstall` asks; no install tokens; `SupportedLauncherTypes` application and web app | install confirm, name editable |
| Usb | names each device from its udev properties, else udev's database | device grant, all or none |
| Print | printers and options from CUPS over IPP (`domicile_host::cups`, its own IPP codec); GTK `settings`/`page-setup` round-trip; `Print-Job` with the token's choice; Save to PDF writes the application's PDF to the file picked | printer or PDF, paper, copies, pages, sides, color, orientation, quality |
| Secret | keyring, not Domicile | — |

Outside the portal, the compositor serves `ext-data-control-v1`, so clipboard
managers and `wl-paste` work without a focused window.

## Sandboxed clients

The compositor serves `wp_security_context_v1`. A sandbox engine (Flatpak,
or an integrator's container launcher) opens a listener with it, and every
client that connects through that listener is sandboxed.

- **Hidden from sandboxed clients:** `ext-data-control-v1`,
  `zwlr_data_control_v1`, `ext-image-copy-capture-v1`,
  `ext-image-capture-source-v1`, `zwlr_screencopy_manager_v1` and
  `wp_security_context_manager_v1` (the protocol forbids nesting).
- **Kept:** `wl_data_device`, the clipboard while focused, and the portals,
  which ask the shell.
- **Unsandboxed clients** see every global.
- **The shell** reads each window's sandbox from `DomicileWindow`
  ([WRITING-A-SHELL.md](WRITING-A-SHELL.md#windows)). The engine, app id and
  instance id are claims by whichever client created the context, and any
  unsandboxed client can create one. Verify them with the window's `pid`,
  `uid` and `gid` before a security decision.
- New privileged globals filter on `sees_privileged_globals` in
  `packages/domicile-compositor/src/clients.rs`.

## Wayland capture

The compositor also serves `ext-image-copy-capture-v1` (with
`ext-image-capture-source-v1` output and toplevel sources),
`ext-foreign-toplevel-list-v1` and `zwlr_screencopy_manager_v1` v3, so `grim`
and `wf-recorder` work. The code is `src/screencopy/`.

- **Each session is a cast** of its monitor or window
  (`Casting::start_for_client`), at the monitor's density or the window's
  buffer size. The toplevel list names each Wayland window; browser windows
  are not on it. The cast fills the client's buffers as it fills
  PipeWire's, and its display capture runs until the session ends.
  `src/screencopy/taking.rs` lends a frame's buffer to the cast.
- **A frame is ready once there is damage the client has not seen.** The
  first frame is damaged whole. Damage is reported in buffer pixels.
- **Buffers** are shm `xrgb8888` or `argb8888` with packed rows, or a dmabuf
  of either on the render node, with a modifier the renderer draws to. The
  cast draws a dmabuf on the GPU and an shm frame into a copy, which is
  copied into the client's buffer when ready.
- **The pointer** is drawn into the frame when the session asks for
  `paint_cursors`, or the wlr frame for `overlay_cursor`.
- **wlr frames** have no session. A client's frames of one monitor, region
  and pointer choice share one cast, which stops once the client has copied
  nothing for two seconds. `copy` fills the buffer at once;
  `copy_with_damage` waits for damage. A wlr region is cut at the monitor's
  edges. A wlr client may bring a dmabuf of any modifier.
- **A resized monitor** gets new constraints, and the frame being captured
  fails with `buffer_constraints`. An unplugged one stops its sessions.
- **No asking and no lock check.** Any unsandboxed client may capture, as it
  may use data control; a sandboxed one is offered neither
  ([Sandboxed clients](#sandboxed-clients)). The portal refuses no capture
  while locked either: a
  running cast or a granted screenshot shows the lock screen.
- **Cursor sessions** follow the pointer casts draw
  (`Streams::pointer_over`): `position` is the hotspot in the source's
  pixels, and the capture session copies the engine's pointer image at the
  source's density, as shm `argb8888`. A frame waits for an image it has not
  had. Until the pointer first enters, no buffer size is sent.
