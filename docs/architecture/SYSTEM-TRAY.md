# System tray

The compositor is the StatusNotifierItem host. It sends the tray items to the
shell, and the shell draws the icons and forwards clicks.

## Design

```
application ── RegisterStatusNotifierItem ──▶ compositor (org.kde.StatusNotifierWatcher)
            ◀── GetAll, New* signals ───────       │ HostMessage::Tray { items }
                                                   ▼
                                    engine: `tray` attribute, DomicileTrayItem
                                                   ▼
                                   shell: domicile.tray, traychanged → icons
shell click ─ activateTrayItem(id, action) ─▶ engine ─ activate_tray_item ─▶ compositor
            ─▶ Activate / SecondaryActivate / ContextMenu on the item
```

| Piece | Where |
|---|---|
| Wire types: `HostMessage::Tray`, `ChromeMessage::ActivateTrayItem`, `TrayItem`, `TrayAction` | `packages/domicile-protocol` |
| Item properties → title, image, hidden; the `Registry`; pixmap → PNG | `packages/domicile-host/src/tray.rs`, `png.rs` |
| D-Bus: watcher, host name, signals, clicks | `packages/domicile-compositor/src/tray.rs` |
| `tray` attribute, `activateTrayItem()` | `components/domicile/mojom/control_channel.mojom`, `modules/domicile/domicile_tray_*`, patch 0063 |
| SDK: `DomicileTrayItem`, `tray`, `activateTrayItem`; `TrayItem`, `TrayAction` | `@domicile-desktop/sdk/domicile-host`, `@domicile-desktop/sdk/tray` |
| Manganese tray: one reorderable row shared with extension actions | `packages/shell-manganese/src/tray/` |

## Key decisions

- **StatusNotifierItem**, because it is the only tray protocol Wayland clients
  use. XEmbed needs X11.
- **The compositor hosts the tray** because it owns the session bus
  connection; pages have none. The desktop portal in `portals/` works the
  same way.
- **The compositor sends the full tray** on every change and on connect, as it
  does for `clipboard`. `Host::set_tray` sends nothing when nothing changed.
- **Icons are sent as `data:` URLs.**
  - Named icons are looked up in `hicolor` (`status`, `apps`, `devices`,
    `panel`) and in the item's `IconThemePath`.
  - Pixmaps are encoded as uncompressed (stored-deflate) PNGs, with no new
    dependency.
- **Items are keyed by their `Id`.** The bus name changes every run; the `Id`
  does not. Manganese uses it to keep an icon's position, so a restarted
  application's icon returns to its old place.
  - Duplicate `Id`s get a `#2` suffix.
  - An item with no `Id` is keyed by its bus name and path.
- **`Passive` items are not sent.** Trays conventionally hide them.
- **Clicks respect the lock.** They go through the Wayland thread, which
  refuses them while locked, the same as `Spawn`.
- **Reads never block the D-Bus worker.** Each `GetAll` runs on its own thread,
  because zbus 4 has no method timeout.
- **Secondary click sends `ContextMenu`.** The item opens its own menu, if it
  has one.

## Open questions

- **Menus.** Most libappindicator items only expose `com.canonical.dbusmenu`,
  so secondary click does nothing for them. Each `TrayItem` carries its `bus`
  and its `Menu` path (`menu`, absent for none or `/NO_DBUSMENU`).
  Recommendation: a TypeScript library drives the menu with `dbusCall` and
  `dbusMatch` (`GetLayout`, `Event`, `LayoutUpdated`) and draws it with the
  component library's menu. The lock refuses those calls.
- **Nested sessions.** Inside another desktop session, that session's panel
  already owns `org.kde.StatusNotifierWatcher`, so the compositor hosts
  nothing. Recommendation: leave it; nested runs are for development.
