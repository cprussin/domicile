# Desktop events in a shell

What a shell receives about the desktop around its windows: displays, theme,
tray icons and notifications. Part of [WRITING-A-SHELL.md](WRITING-A-SHELL.md).

## Displays

The shell is one page covering the bounding box of every display, in logical
pixels. Each display is a rectangle in it.

```ts
domicile.displays; // the current list, or undefined until the first message
domicile.on("displays", ({ displays }) => {
  layOut(displays); // DomicileDisplay: { name, x, y, width, height, scale, modeWidth, modeHeight, transform }
});
```

- On a tty the engine shows the page on every monitor, rotated and scaled per
  the config. Pointer events are always in page pixels. The shell does nothing
  for rotation or scale.
- `modeWidth`×`modeHeight` (the panel's unrotated scanout pixels) and
  `transform` are informational. A 4K panel rotated 90° at scale 1.2 has a
  3840×2160 mode and an 1800×3200 box.
- Config: [SHELL-CONFIG.md](SHELL-CONFIG.md#displays),
  [`transform`](SHELL-CONFIG.md#transform).

## Theme

`theme.mode` in the config is `"dark"` or `"light"`.

- The shell receives `theme` on connect and on every change.
- The compositor also publishes it to the settings portal
  (`org.freedesktop.appearance` `color-scheme`, followed by GTK4, Qt6,
  Electron and Firefox) and applies it to browser windows.
- `prefers-color-scheme` in the shell's page follows it.
- `domicile.setTheme("light")` changes it until the desktop exits. It does not
  write the config. A later config edit overrides it.

Windows change theme after the shell has captured its old frame, so a shell
can animate the switch:

1. The shell receives `theme`.
2. The shell captures its old frame (for example, starts a view transition)
   and calls `domicile.themeCaptured(theme)`. With no animation, it calls it
   at once.
3. Once every shell has called it, the compositor repaints the windows and
   sends `windows_theme`.
4. If no shell calls it, windows switch after about a second.

In a view transition, call `themeCaptured` inside the update callback and
return a promise that resolves on `windows_theme`.

`ThemeProvider` in `@domicile-desktop/component-library` runs the view
transition. Implement its `ThemeSource.turnWindows` to call
`domicile.themeCaptured(theme)` and resolve on `windows_theme` (see
manganese's `theme/host-theme.ts`).

## System tray

Apps' tray icons (StatusNotifierItem, hosted by the compositor on the session
bus) arrive as `tray`: the full list on every change and on connect.

```ts
domicile.on("tray", ({ items }) => {
  drawTray(items); // { id, title, icon: a data: URL or undefined }
});
domicile.activateTrayItem(id, "primary"); // or "secondary", "context"
```

- The app decides what a click does.
- Tray menus are not supported yet
  ([SYSTEM-TRAY.md](/docs/architecture/SYSTEM-TRAY.md)).
- Manganese's: [`tray/Tray.tsx`](/packages/shell-manganese/src/tray/Tray.tsx).

## Notifications

App notifications, and sites' Web Notifications, arrive as `notifications`:
every uncleared notification, oldest first, on every change and on connect.

```ts
domicile.on("notifications", ({ items }) => {
  draw(items); // { id, appName, summary, body, icon, urgency, actions, clickable, timeoutMs, time }
});
domicile.invokeNotificationAction(id, "default"); // a click (if clickable), or an action's key
domicile.dismissNotifications([id]);              // clear; the app is told
```

- The shell decides which are new. The first list is history.
- The shell decides how long a toast stays up. A notification stays in the
  list until cleared.
- Design: [NOTIFICATIONS.md](/docs/architecture/NOTIFICATIONS.md).
  Manganese's: [`notifications/`](/packages/shell-manganese/src/notifications/).
