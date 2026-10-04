# Portals

Domicile becomes the desk's only `xdg-desktop-portal` backend: every
interface a desktop can sensibly answer is answered by the compositor, every
dialog is drawn by the shell, and `xdg-desktop-portal-gtk` leaves the desk.

Today the compositor answers `Settings` and routes everything else to gtk, so
an Electron app's file dialog is a GTK window, and screen sharing, remote
desktop and global shortcuts have no backend at all.

## Design

```
app ──org.freedesktop.portal.*──▶ xdg-desktop-portal ──impl.portal.*──▶ compositor
                                                                         │ domicile_host::portals: the queue
                                    HostMessage::PortalRequests { items } ▼
                                         engine: `portalrequests` event (one patch, every kind)
                                                                         ▼
                        shell: DomicileClient.on("portal_requests") → <PortalDialogs>
                        ◀── answerPortalRequest(id, answer) ── engine ── compositor ──▶ Response
```

One mechanism for all dialogs, then one backend per interface on top of it.

| Piece | Where |
|---|---|
| Wire: `HostMessage::PortalRequests`, `ChromeMessage::AnswerPortalRequest`, `PortalRequest`, `PortalAnswer` | `packages/domicile-protocol` |
| The queue: pending requests, their apps, their answers' validation | `packages/domicile-host/src/portals/` |
| The bus: one name, one object, every interface; `Request`/`Session` objects | `packages/domicile-compositor/src/portals/` (`appearance.rs`'s `Settings` moves in) |
| `portalrequests` event, `answerPortalRequest()`, `listDirectory()` | `control_channel.mojom`, `modules/domicile/`, one patch |
| Request kinds, parsed with Zod | `@domicile-desktop/sdk/portal` |
| Ready-made dialogs any shell mounts | `@domicile-desktop/component-library/PortalDialogs` |
| `parent_window` → a window | `zxdg_exporter_v2` / `v1` in the compositor |
| Which interfaces route here | `nix/domicile.portal`, `nix/domicile-portals.conf` |

## Key decisions

- **No gtk.** Nothing gtk's backend does needs gtk: every dialog is UI the
  shell already draws better (manganese has a file picker, a launcher with the
  desktop entries, a notification drawer). Falling back would mean two looks
  and two keyboards on one desk. Gtk stays routed per interface only until
  that interface lands here, then leaves the NixOS and home-manager modules.
- **Secret is the one interface not ours.** It is the keyring's
  (`gnome-keyring` or `oo7-portal`), not a desktop's: no UI, and the store
  must outlive the desk. `domicile-portals.conf` names the keyring for it.
- **A request is state, pushed whole.** `PortalRequests` carries every
  unanswered request on every change and on connect, like notifications, so a
  reload or a second monitor's page still sees a dialog the app is blocked on.
  The first answer wins; the rest are refused.
- **Request bodies cross the engine untyped; the SDK is the contract.** The
  engine carries each request's body as a `base::Value` and the SDK parses it
  with Zod. One engine patch serves every kind, so a new portal costs no
  four-hour build. Over a typed mojom union per kind because the engine only
  relays it, and the compositor and SDK already validate both ends.
- **A shell that mounts no dialogs refuses.** An unanswered kind is refused
  with response `2` once the dispatch finds no listener, as
  `domicile-file-chooser` does for `<webview>`. `<PortalDialogs />` is one
  element, so shell-simple and the example shell get every dialog for free.
- **The dialog sits on its parent.** `parent_window` (`wayland:<handle>`)
  resolves through our own `xdg_foreign` export to an app id; the shell draws
  the dialog modal over that `<app>`. No handle, or an unknown one, is a
  dialog over the focused screen.
- **The app is named.** The frontend's `app_id` resolves through
  `domicile_host::desktop_entries` to a name and icon for every dialog and
  every grant ("Zoom wants to share your screen").
- **Capture: the compositor owns PipeWire.** A window source is the client's
  buffer, already in the compositor. A monitor source is the composited desk,
  which only viz has: the engine runs a `FrameSinkVideoCapturer` on the
  display's root frame sink and passes each frame's dmabuf over the broker
  socket. One producer, one place for cursor modes and restore tokens, over
  the engine running a PipeWire node of its own.
- **Input: EIS.** RemoteDesktop and InputCapture hand out a libei socket
  (`ConnectToEIS`) served by the compositor (`reis`). Emulated input enters
  the same injection path the engine's input does, so the lock still refuses
  it.
- **Grants persist in the frontend's `PermissionStore`**, not here. Restore
  tokens for ScreenCast and RemoteDesktop are ours, kept under
  `$XDG_STATE_HOME/domicile/`.
- **A region across monitors is captured at the highest density it
  touches.** Monitors may differ in density and a stream has one scale;
  downscaling loses nothing a lower one could show.
- **No print preview.** The portal hands over the document only after the
  dialog closes, so there is nothing to preview; gtk's backend draws none
  either.
- **While something is shared, the shell shows it.** A `capturing` state rides
  the same push (who, what, stop), so a shell can draw an indicator and end a
  session.

## Interfaces

| Interface | What the compositor does | What the shell draws | Phase |
|---|---|---|---|
| Settings | `color-scheme` today; add `accent-color`, `contrast`, `reduced-motion` from the shell's config | — | 1 |
| FileChooser | `OpenFile`, `SaveFile`, `SaveFiles`; filters, `current_folder`, `choices` | picker (manganese's `FilePicker`, moved to component-library) | 1 |
| AppChooser | candidates from desktop entries and `mimeapps.list`; `UpdateChoices` | app list | 1 |
| OpenURI | (frontend) | — via AppChooser | 1 |
| Access | — | yes/no prompt with the app's name | 1 |
| Account | user name, avatar from `AccountsService` | confirm | 1 |
| Email | open the `mailto:` handler with the fields | — | 1 |
| Notification | v2 straight into `domicile_host::notifications`; drops gtk's hop | the existing drawer | 1 |
| Inhibit | idle inhibit through `idle.rs`; logout/suspend inhibitors recorded; `QueryEndResponse` when the desk gets a session end | "X is preventing logout" | 1 |
| Lockdown | properties from the config | — | 1 |
| ScreenCast | sources: windows, monitors, region; cursor embedded/metadata/hidden; PipeWire streams; restore tokens | source picker, sharing indicator | 2 |
| Screenshot | one frame from the same sources, PNG to `$XDG_PICTURES_DIR`; `PickColor` | region picker, color picker | 2 |
| RemoteDesktop | EIS socket; legacy `Notify*` methods into the same path | device grant | 3 |
| Clipboard | selection to and from a RemoteDesktop session through `clipboard.rs` | part of that grant | 3 |
| InputCapture | pointer barriers at screen edges; EIS | grant | 3 |
| GlobalShortcuts | binds into the keymap the shell's own keys use; `Activated`/`Deactivated` | review and rebind | 4 |
| Background | autostart entries; `GetAppState` from the compositor's clients | "X wants to run in the background" | 4 |
| Wallpaper | forwards the image | the shell's wallpaper | 4 |
| DynamicLauncher | writes the `.desktop` file and icon | install confirm | 4 |
| Usb | device list from udev | device grant | 4 |
| Print | printers and options over IPP from CUPS; the job to CUPS | print dialog | 5 |
| Secret | not ours: the keyring | — | — |

Outside the portal, and part of the same pass because apps expect it:
`ext-data-control-v1`, so clipboard managers and `wl-paste` work with no
focused window.

## Plan

Phase 0: the mechanism.

- [ ] `PortalRequest`, `PortalAnswer`, the two messages; protocol round-trip tests
- [ ] `domicile_host::portals`: the queue, first answer wins, refused on no taker
- [ ] `src/portals/`: one name, `Request` and `Session` objects, `Settings` moved from `appearance.rs`
- [ ] engine patch: `portalrequests`, `answerPortalRequest`, `listDirectory` (`file_choice.cc`'s `DirectoryEntries`); guard against a stand-in compositor
- [ ] SDK: `portal_requests`, kinds parsed with Zod
- [ ] `zxdg_exporter_v2` and `v1`; a handle resolves to an app id
- [ ] `<PortalDialogs />` in component-library; mounted in manganese, shell-simple, `examples/minimal-shell`
- [ ] `domicile.portal` lists each interface as it lands; the conf routes it here

Phase 1: dialogs.

- [ ] FileChooser, with `FilePicker` moved to component-library
- [ ] AppChooser
- [ ] Access, Account, Email, Lockdown
- [ ] Notification v2
- [ ] Inhibit
- [ ] Settings: accent color, contrast, reduced motion

Phase 2: capture.

- [ ] PipeWire producer in the compositor; window sources from client buffers
- [ ] engine: `FrameSinkVideoCapturer` per display, dmabufs over the broker socket
- [ ] ScreenCast, with restore tokens and the sharing indicator
- [ ] Screenshot and `PickColor`
- [ ] ROADMAP's "no screenshot or screencast portal" comes out

Phase 3: input.

- [ ] EIS server in the compositor
- [ ] RemoteDesktop, Clipboard, InputCapture
- [ ] `ext-data-control-v1`

Phase 4: the rest.

- [ ] GlobalShortcuts
- [ ] Background, Wallpaper, DynamicLauncher, Usb

Phase 5: printing, and gtk leaves.

- [ ] Print over IPP
- [ ] `xdg-desktop-portal-gtk` out of `nix/nixos.nix`, `nix/home-manager.nix` and the flake's checks; the conf names only domicile and the keyring
