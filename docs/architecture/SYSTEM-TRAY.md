# The system tray

Applications' tray icons on a desk: the compositor is the
StatusNotifierItem host, and the shell draws what it is told.

## Design

```
application ──RegisterStatusNotifierItem──▶ compositor (org.kde.StatusNotifierWatcher)
            ◀──GetAll, New* signals─────────       │  HostMessage::Tray { items }
                                                    ▼
                                         engine: `tray` event, DomicileTrayItem
                                                    ▼
                                    shell: DomicileClient.on("tray") → icons
shell click ─ activateTrayItem(id, action) ─▶ engine ─ activate_tray_item ─▶ compositor
            ─▶ Activate / SecondaryActivate / ContextMenu on the item
```

| Piece | Where |
|---|---|
| Wire: `HostMessage::Tray`, `ChromeMessage::ActivateTrayItem`, `TrayItem`, `TrayAction` | `packages/domicile-protocol` |
| What an item's properties show as (title, picture, hidden), the `Registry`, pixmap → PNG | `packages/domicile-host/src/tray.rs`, `png.rs` |
| The bus: watcher, host name, signals, clicks | `packages/domicile-compositor/src/tray.rs` |
| `tray` event, `activateTrayItem()` | `components/domicile/mojom/control_channel.mojom`, `modules/domicile/domicile_tray_*`, patch 0063 |
| `TrayItem`, `TrayAction`, `activateTrayItem` | `@domicile-desktop/sdk/tray`, `domicile-client` |
| Manganese's tray, one row with the extensions' actions, reorderable | `packages/shell-manganese/src/tray/` |

## Key decisions

- **StatusNotifierItem over XEmbed.** The only tray a Wayland client can speak.
- **The compositor hosts, not the page.** The bus is the compositor's; a page has
  none. The same arrangement as the settings portal in `appearance.rs`.
- **The whole tray every time**, pushed on change and on connect, like
  `clipboard`. `Host::set_tray` says nothing when nothing moved.
- **Pictures as `data:` URLs.** Named icons are looked up in `hicolor`
  (`status`, `apps`, `devices`, `panel`) and the item's `IconThemePath`; pixels
  are encoded as a stored-deflate PNG, no dependency added.
- **An icon is named by its `Id`**, not its bus name, which is new every run:
  manganese keeps an icon's place by it, so a reopened application comes back
  where it was. Two with one `Id` get `#2`; one with none, its bus and path.
- **`Passive` items are not sent.** Every tray hides them.
- **A click passes the lock.** It goes through the Wayland thread, and a locked
  desk refuses it as a command, like `Spawn`.
- **Reads never block the worker.** Each `GetAll` is a thread of its own;
  zbus 4 has no method timeout.
- **A secondary click is `ContextMenu`.** The item opens its own menu, if it
  has one.

## Open questions

- **Menus.** Most libappindicator items only offer `com.canonical.dbusmenu`,
  so their secondary click does nothing yet. Recommendation: read the layout in
  the compositor and send it as a message of its own, drawn by the shell with
  the component library's menu.
- **A desk inside another session** finds `org.kde.StatusNotifierWatcher`
  taken by that session's panel and hosts nothing. Recommendation: leave it —
  a nested desk is a developer's run.
