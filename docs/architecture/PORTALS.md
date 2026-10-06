# Portals

Make Domicile the session's only `xdg-desktop-portal` backend:

- The compositor implements every portal interface except `Secret`.
- The shell draws every portal dialog.
- `xdg-desktop-portal-gtk` is removed from the session.

Today the compositor implements `Settings` and `Access` and routes the rest to
gtk.
So an Electron app's file dialog is a GTK window, and screen sharing, remote
desktop and global shortcuts have no backend.

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
  keyboard models. Gtk stays routed for each interface until that interface
  lands here, then leaves the NixOS and home-manager modules.
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
- **Dialogs name the app.** The frontend's `app_id` resolves through
  `domicile_host::desktop_entries` to a name and icon ("Zoom wants to share
  your screen").
- **The compositor owns PipeWire.** A window source is the client's buffer,
  which the compositor already has. A monitor source is the composited
  output, which only viz has: the engine runs a `FrameSinkVideoCapturer` on
  the display's root frame sink and sends each frame's dmabuf over the broker
  socket. One producer keeps cursor modes and restore tokens in one place.
  The producer is `src/casting/`: `Casting::start` takes a `Source` and
  reports the node, and a monitor is another `Source`.
- **Input uses EIS.** RemoteDesktop and InputCapture hand out a libei socket
  (`ConnectToEIS`) served by the compositor (`reis`). Emulated input takes the
  engine's input injection path, so the lock screen still blocks it.
  - A point lands on the window under it by the page's last window bounds;
    overlaps go to the focused window, then the smallest. A point over the
    shell reaches nothing: only the engine can deliver to the page.
  - The seat has no touchscreen, so a touch is the left button, one finger
    at a time.
- **Grants live in the frontend's `PermissionStore`.** Domicile stores only
  ScreenCast and RemoteDesktop restore tokens, under
  `$XDG_STATE_HOME/domicile/`.
- **Multi-monitor regions use the highest density.** A stream has one scale,
  so a region spanning monitors is captured at the highest density it
  touches. Lower-density monitors lose nothing.
- **No print preview.** The portal sends the document only after the dialog
  closes, so there is nothing to preview. Gtk's backend has none either.
- **The shell shows active sharing.** A `capturing` state in the same push
  (who, what, stop) lets a shell draw an indicator and end the session.

## Interfaces

| Interface | Compositor | Shell UI | Phase |
|---|---|---|---|
| Settings | `color-scheme` (exists); add `accent-color`, `contrast`, `reduced-motion` from shell config | — | 1 |
| FileChooser | `OpenFile`, `SaveFile`, `SaveFiles`; filters, `current_folder`, `choices` | picker (manganese's `FilePicker`, moved to component-library) | 1 |
| AppChooser | candidates from desktop entries and `mimeapps.list`; `UpdateChoices` | app list | 1 |
| OpenURI | (frontend) | via AppChooser | 1 |
| Access | — | yes/no prompt with the app's name | 1 |
| Account | user name, avatar from `AccountsService` | confirm | 1 |
| Email | opens the `mailto:` handler with the fields | — | 1 |
| Notification | v2, direct to `domicile_host::notifications` | existing drawer | 1 |
| Inhibit | idle inhibit through `idle.rs`; records logout/suspend inhibitors; `QueryEndResponse` on session end | "X is preventing logout" | 1 |
| Lockdown | properties from config | — | 1 |
| ScreenCast | windows, monitors, region; cursor embedded/metadata/hidden; PipeWire streams; restore tokens | source picker, sharing indicator | 2 |
| Screenshot | one frame from the same sources, PNG to `$XDG_PICTURES_DIR`; `PickColor` | region picker, color picker | 2 |
| RemoteDesktop | EIS socket; legacy `Notify*` methods use the same path | device grant | 3 |
| Clipboard | selection to/from a RemoteDesktop session through `clipboard.rs` | part of that grant | 3 |
| InputCapture | pointer barriers at screen edges; EIS | grant | 3 |
| GlobalShortcuts | binds into the shell's keymap; `Activated`/`Deactivated` | review and rebind | 4 |
| Background | autostart entries; `GetAppState` from compositor clients | "X wants to run in the background" | 4 |
| Wallpaper | forwards the image | shell wallpaper | 4 |
| DynamicLauncher | writes the `.desktop` file and icon | install confirm | 4 |
| Usb | device list from udev | device grant | 4 |
| Print | printers and options from CUPS over IPP; sends the job to CUPS | print dialog | 5 |
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

- [ ] FileChooser, with `FilePicker` moved to component-library; it lists directories with `readDir` ([SHELL-SYSTEM-ACCESS.md](../SHELL-SYSTEM-ACCESS.md))
- [ ] AppChooser
- [ ] Access, Account, Email, Lockdown
- [ ] Notification v2
- [ ] Inhibit
- [ ] Settings: accent color, contrast, reduced motion

Phase 2: capture.

- [x] PipeWire producer in the compositor; window sources from client buffers
- [ ] engine: `FrameSinkVideoCapturer` per display, dmabufs over the broker socket
- [ ] ScreenCast, with restore tokens and the sharing indicator
- [ ] Screenshot and `PickColor`
- [ ] Remove ROADMAP's "no screenshot or screencast portal" item

Phase 3: input.

- [x] EIS server in the compositor
- [ ] RemoteDesktop, Clipboard, InputCapture
- [x] `ext-data-control-v1`

Phase 4: the rest.

- [ ] GlobalShortcuts
- [ ] Background, Wallpaper, DynamicLauncher, Usb

Phase 5: printing, and remove gtk.

- [ ] Print over IPP
- [ ] Remove `xdg-desktop-portal-gtk` from `nix/nixos.nix`, `nix/home-manager.nix` and the flake's checks; the conf names only domicile and the keyring
