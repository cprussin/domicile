# Portals

Make Domicile the session's only `xdg-desktop-portal` backend:

- The compositor implements every portal interface except `Secret`.
- The shell draws every portal dialog.
- `xdg-desktop-portal-gtk` is removed from the session.

Today the compositor implements `Settings`, `Access`, `AppChooser`,
`FileChooser`, `Notification`, `Inhibit`, `RemoteDesktop`, `Clipboard`,
`InputCapture`, `Account`, `Email`, `Lockdown`, `GlobalShortcuts`,
`Background`, `Wallpaper`, `DynamicLauncher`, `Usb`, `Print`, `ScreenCast` and
`Screenshot`, and routes `Secret` to the keyring. No other backend is routed.

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
| D-Bus service: one name, one object, all interfaces; `Request`/`Session` objects | `packages/domicile-compositor/src/portals/` (`Settings` moves here from `appearance.rs`) |
| `portalrequests` event, `answerPortalRequest()` | `control_channel.mojom`, `modules/domicile/`; new files only, no patch |
| Request kinds, parsed with Zod | `@domicile-desktop/sdk/portal` |
| Ready-made dialogs for any shell | `@domicile-desktop/component-library/PortalDialogs` |
| `parent_window` to window lookup | `zxdg_exporter_v2` / `v1` in the compositor |
| EIS server: devices per grant, regions, translation to seat input | `packages/domicile-compositor/src/eis.rs` |
| Interface routing | `nix/domicile.portal`, `nix/domicile-portals.conf` |

## Key decisions

- **No gtk fallback.** The shell already draws every dialog gtk would
  (manganese has a file picker, a launcher with desktop entries, a
  notification drawer). A fallback would give one session two looks and two
  keyboard models. The NixOS and home-manager modules offer no gtk backend.
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
- **Dialogs name the app.** The frontend's `app_id` resolves in the shell,
  through `@domicile-desktop/system-apps`, to a name and icon ("Zoom wants to
  share your screen").
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
  is a desktop rectangle in logical pixels. The pointer is drawn from the
  compositor's state, so it shows only over a window.
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
  The compositor signals `Activated` and `Deactivated` for them. A locked desk
  refuses both answers.
  - The review dialog spells each chord as `bindKeys` does and flags one the
    shell or another app holds.
  - Choices are kept per app id in `global-shortcuts.json`. A `BindShortcuts`
    whose every id has a choice binds without a dialog.
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
  - A window is its area on the desk, so it shows what is over it. Its own
    buffer is kept only while it is cast.
  - The frontend checks the `PermissionStore` for a non-interactive
    screenshot (`permission_store_checked`). Without that, the backend asks
    through an `Access` dialog once per app and keeps the answer in the same
    `screenshot` table.
  - The shell takes its own through the `screenshot` system call
    (`portals::screenshot::for_the_shell`): an interactive screenshot asked as
    `SHELL_APP_ID`, which the dialog draws without an asker. Given a file,
    it writes the whole desk there without a dialog; `domicile screenshot`
    sends that.
- **No print preview.** The portal sends the document only after the dialog
  closes, so there is nothing to preview. Gtk's backend has none either.
- **Print speaks IPP itself.** `domicile_host::ipp` encodes the few message
  shapes CUPS needs, rather than adding the `ipp` crate and its HTTP stack. A
  token's choice lives in memory until `Print` takes it.
- **No printers ends with `2`.** With CUPS unreachable or empty, the dialog
  says there are no printers; closing it is a failure, not a cancel.
- **The shell shows active sharing.** `portal_requests` carries `capturing`:
  each running session (id, app, what it holds). The shell stops one by
  answering its id with `stop`. `<PortalDialogs />` draws the indicator.
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
- **A region is drawn on the desk.** The picker's region option closes the
  dialog and the user drags a rectangle over the page, whose pixels are the
  desktop's logical pixels. The picker has no monitor thumbnails: the engine
  captures a display only while a stream shows it.

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

| Interface | Compositor | Shell UI | Phase |
|---|---|---|---|
| Settings | `color-scheme` (exists); add `accent-color`, `contrast`, `reduced-motion` from shell config | — | 1 |
| FileChooser | `OpenFile`, `SaveFile`, `SaveFiles`; filters, `current_folder`, `choices` | picker (manganese's `FilePicker`, moved to component-library) | 1 |
| AppChooser | candidates from desktop entries and `mimeapps.list`; `UpdateChoices` | app list | 1 |
| OpenURI | (frontend) | via AppChooser | 1 |
| Access | — | yes/no prompt with the app's name | 1 |
| Account | user name, avatar from `AccountsService`, else passwd | confirm; allowed with the `access` answer | 1 |
| Email | opens the `mailto:` handler from `mimeapps.list` with the fields; attachments as `attach=`, which Thunderbird ignores | — | 1 |
| Notification | v2, direct to `domicile_host::notifications` | existing drawer | 1 |
| Inhibit | idle inhibit through `idle.rs`; logout/suspend inhibitors listed as `inhibit` requests; `QueryEndResponse` on session end (the desk has no session end yet, so no query-end is sent) | "X is preventing logout" | 1 |
| Lockdown | properties from the config's `lockdown`; signaled on reload | — | 1 |
| ScreenCast | windows, monitors, region; cursor embedded/metadata/hidden; PipeWire streams; restore tokens | source picker, sharing indicator | 2 |
| Screenshot | one frame from the same sources, PNG to `$XDG_PICTURES_DIR`; `PickColor` | region picker, color picker | 2 |
| RemoteDesktop | EIS socket; legacy `Notify*` methods use the same path | device grant | 3 |
| Clipboard | selection to/from a RemoteDesktop session through `clipboard.rs` | part of that grant | 3 |
| InputCapture | pointer barriers at screen edges; EIS | grant | 3 |
| GlobalShortcuts | binds into the shell's keymap; `Activated`/`Deactivated` | review and rebind | 4 |
| Background | autostart entries (`EnableAutostart`); `GetAppState` from windows and focus; `NotifyBackground` as a notification | via Access | 4 |
| Wallpaper | copies the picture; `set-on` background, lock screen or both | preview dialog, shell wallpaper and lock screen | 4 |
| DynamicLauncher | `PrepareInstall` asks; no install tokens; `SupportedLauncherTypes` application and web app | install confirm, name editable | 4 |
| Usb | names each device from its udev properties, else udev's database | device grant, all or none | 4 |
| Print | printers and options from CUPS over IPP (`domicile_host::cups`, its own IPP codec); GTK `settings`/`page-setup` round-trip; `Print-Job` with the token's choice; no CUPS or no printers ends with `2` | printer, paper, copies, pages, sides, color, orientation, quality | 5 |
| Secret | keyring, not Domicile | — | — |

Also in scope, outside the portal: `ext-data-control-v1`, so clipboard
managers and `wl-paste` work without a focused window.

## Plan

Phase 0: request channel.

- [x] `PortalRequest`, `PortalAnswer`, the two messages; protocol round-trip tests
- [x] `domicile_host::portals`: queue, first answer wins, refuse when no listener
- [x] `src/portals/`: one name, `Request` and `Session` objects, `Settings` moved from `appearance.rs`
- [x] engine patch: `portalrequests`, `answerPortalRequest`; guard against a stand-in compositor
- [x] SDK: `portal_requests`, kinds parsed with Zod
- [x] `zxdg_exporter_v2` and `v1`; resolve a handle to an app id (`domicile_host::xdg_foreign`; no importer)
- [ ] `<PortalDialogs />` in component-library; mounted in manganese, shell-simple, `examples/minimal-shell`
- [x] `domicile.portal` lists each interface as it lands; the conf routes it here

Phase 1: dialogs.

- [x] FileChooser, with `FilePicker` moved to component-library; it lists directories with `readDir` ([SHELL-SYSTEM-ACCESS.md](../SHELL-SYSTEM-ACCESS.md))
- [x] AppChooser
- [x] Access, Account, Email, Lockdown
- [x] Notification v2
- [x] Inhibit
- [x] Settings: accent color, contrast, reduced motion

Phase 2: capture.

- [x] PipeWire producer in the compositor; window sources from client buffers
- [x] engine: `FrameSinkVideoCapturer` per display, dmabufs over the broker socket; monitor and region `Source`s
- [x] ScreenCast of windows, with restore tokens and the sharing indicator
- [x] ScreenCast of monitors and regions: offer the engine's display `Source`s in the picker and `AvailableSourceTypes`
- [x] Screenshot and `PickColor`
- [ ] Remove ROADMAP's "no screenshot or screencast portal" item

Phase 3: input.

- [x] EIS server in the compositor
- [x] RemoteDesktop, Clipboard, InputCapture
- [x] `ext-data-control-v1`

Phase 4: the rest.

- [x] GlobalShortcuts
- [x] engine: report a grabbed chord's release, for `Deactivated` on release
- [x] Background, Wallpaper
- [x] DynamicLauncher, Usb

Phase 5: printing, and remove gtk.

- [x] Print over IPP
- [x] Remove `xdg-desktop-portal-gtk` from `nix/nixos.nix`, `nix/home-manager.nix` and the flake's checks; the conf names only domicile and the keyring
