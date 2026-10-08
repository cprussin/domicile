# Desktop events in a shell

What a shell receives about the desktop around its windows: displays, theme,
tray icons, notifications and application dialogs. Part of [WRITING-A-SHELL.md](WRITING-A-SHELL.md).

## Displays

The shell is one page covering the bounding box of every display, in logical
pixels. Each display is a rectangle in it.

```ts
// DomicileDisplay: { name, x, y, width, height, scale, modeWidth, modeHeight, transform }
const show = () => layOut(domicile.displays); // null until described
show();
domicile.addEventListener("displayschanged", show);
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

- The shell reads `domicile.theme`; `themechanged` reports changes.
- The compositor also publishes it to the settings portal
  (`org.freedesktop.appearance` `color-scheme`, followed by GTK4, Qt6,
  Electron and Firefox) and applies it to browser windows.
- `theme.accent_color`, `contrast` and `reduced_motion` go to the settings
  portal and to the shell, as `domicile.accentColor`, `highContrast` and
  `reducedMotion` with an `appearancechanged` event. `watchAppearance` in
  `@domicile-desktop/sdk/appearance` reads them now and on each change. `applyAppearance` in
  `@domicile-desktop/component-library/appearance` applies them to the preset:
  the `accent` token, the `_contrastHigh` condition and shortened animations.
- `prefers-color-scheme` in the shell's page follows it.
- `domicile.setTheme("light")` changes it until the desktop exits. It does not
  write the config. A later config edit overrides it.

Windows change theme after the shell has captured its old frame, so a shell
can animate the switch:

1. `themechanged` fires.
2. The shell captures its old frame (for example, starts a view transition)
   and calls `domicile.themeCaptured(theme)`. With no animation, it calls it
   at once.
3. Once every shell has called it, the compositor repaints the windows and
   sets `windowsTheme` and fires `windowsthemechanged`.
4. If no shell calls it, windows switch after about a second.

In a view transition, call `themeCaptured` inside the update callback and
return a promise that resolves on `windowsthemechanged`.

`ThemeProvider` in `@domicile-desktop/component-library` runs the view
transition. Implement its `ThemeSource.turnWindows` to call
`domicile.themeCaptured(theme)` and resolve on `windowsthemechanged` (see
manganese's `theme/host-theme.ts`).

## System tray

Apps' tray icons (StatusNotifierItem, hosted by the compositor on the session
bus) are `domicile.tray`, the full list; `traychanged` reports changes.

```ts
domicile.addEventListener("traychanged", () => {
  drawTray(domicile.tray ?? []); // { id, title, icon: a data: URL or "" }
});
domicile.activateTrayItem(id, "primary"); // or "secondary", "context"
```

- The app decides what a click does.
- Tray menus are not supported yet
  ([SYSTEM-TRAY.md](/docs/architecture/SYSTEM-TRAY.md)).
- Manganese's: [`tray/Tray.tsx`](/packages/shell-manganese/src/tray/Tray.tsx).

## Notifications

App notifications, and sites' Web Notifications, are
`domicile.notifications`: every uncleared notification, oldest first.
`notificationschanged` reports changes.

```ts
domicile.addEventListener("notificationschanged", () => {
  // { id, appName, summary, body, icon, urgency, actions, clickable, timeoutMs, time }
  draw(domicile.notifications ?? []);
});
domicile.invokeNotificationAction(id, "default"); // a click (if clickable), or an action's key
domicile.dismissNotifications([id]);              // clear; the app is told
```

- The shell decides which are new. The first list is history.
- The shell decides how long a toast stays up. A notification stays in the
  list until cleared.
- Design: [NOTIFICATIONS.md](/docs/architecture/NOTIFICATIONS.md).
  Manganese's: [`notifications/`](/packages/shell-manganese/src/notifications/).

## Application dialogs

Applications ask for dialogs through `xdg-desktop-portal`, and the compositor
is its backend. The shell draws each one. See
[PORTALS.md](architecture/PORTALS.md).

```tsx
import { PortalDialogs } from "@domicile-desktop/component-library/PortalDialogs";

<PortalDialogs
  host={domicile}
  screen={focusedScreen}
  screenOf={(appId) => screenShowing(appId)}
  shellChords={ownedChords(keybindings)}
/>;
```

- `PortalDialogs` draws every kind it knows and refuses the rest: `Access` (a
  yes/no question), `Account` (share the user's name and picture),
  `AppChooser` (an app list for "Open with" and `OpenURI`), `FileChooser` (the
  component library's `FilePicker`), `RemoteDesktop` (which devices and the
  clipboard an application may control), `InputCapture`, `GlobalShortcuts`
  (review the chords an app asks for), `Wallpaper` (a picture to preview),
  `DynamicLauncher` (an install confirm with an editable name), `Usb` (a
  device grant), `ScreenCast` (a picker of the windows or screens to share,
  or a region to draw), `Print` (a
  printer and its options, or "No printers are set up."), `Screenshot` (pick
  the desk, a monitor, a window or a dragged area of a frozen frame) and
  `PickColor` (pick a pixel of it, with a magnifier). Answer `Access`,
  `Account`, `Wallpaper` and `Usb` with `PortalAnswer.Access()` to allow, and
  `DynamicLauncher` with `PortalAnswer.DynamicLauncher(name)`.
- The app list, the file picker, the account picture and the wallpaper
  preview read the system through `@domicile-desktop/sdk/system` (desktop
  entries, `mimeapps.list`, `readDir`, `readFile`), so `host` must take system
  calls. `domicile` does.
- A dialog goes on the screen `screenOf` names for the window that asked, or
  on `screen` when the application named no window.
- An `Inhibit` request is an application holding off logout, user switching
  or suspend (`body.what`), listed until it lets go. It asks nothing, so a
  shell only shows it ("Editor is preventing logout"). The compositor refuses
  answers to it.
- It also shows each running screen cast, remote desktop or input capture
  session, with a Stop button. Pass `omitScreenCasts` when the shell shows
  screen casts itself, as manganese's `Sharing` bar item does.
- Dialogs and the indicator name an application by its desktop entry, with
  its icon, else by its app id; no app id is "An application".
  `useApps` in `@domicile-desktop/component-library/useApps` does the same for
  a shell's own UI, and `sourceName` in `./source-name` names a screen cast's
  sources.
- `PortalDialogs` also fires the chords apps hold. `shellChords` are the
  shell's own, which a review flags as taken.
- Without React, `watchPortalRequests` and `answerPortalRequest` in
  `@domicile-desktop/sdk/portal` give the requests, parsed, and send answers.
  `watchCapturing` and `stopCapturing` do the same for running sessions.
  `fireGlobalShortcuts` in `@domicile-desktop/sdk/global-shortcuts` fires the
  chords.
- A shell must answer every request. One left unanswered keeps its application
  waiting until it gives up.
- The compositor refuses answers while the desktop is locked.
- `watchPortalWallpaper` gives the pictures applications set for the
  background and the lock screen, as paths; `usePortalWallpaper` in
  `@domicile-desktop/component-library/usePortalWallpaper` is the hook.
  `usePictureUrl` in
  `@domicile-desktop/component-library/usePictureUrl` turns a path into a URL
  for an `<img>`.
