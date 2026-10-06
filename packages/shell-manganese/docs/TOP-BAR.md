# The top bar

A transparent bar across the top of every screen. Windows tile in the space
below it.

## Layout

`runManganese({ topBar })` takes three columns of React nodes: `left`,
`middle` (centered on the screen) and `right`. Mix manganese's items with your
own. Manganese's items take no props:

`Launcher`, `Tray`, `WorkspaceSwitcher`, `Clock`, `Mode`, `ThemeSelector`,
`Volume`, `Brightness`, `Battery`, `Notifications`.

```tsx
import { Clock, runManganese, Tray, WorkspaceSwitcher } from "@domicile-desktop/manganese";

export const Shell = runManganese({
  topBar: {
    left: [<Tray key="tray" />, <WorkspaceSwitcher key="workspaces" />],
    middle: [<Clock key="clock" />],
    right: [<MailCount key="mail" />],
  },
});
```

To style your own items with manganese's Panda CSS, see
[CUSTOM-BAR-ITEMS.md](CUSTOM-BAR-ITEMS.md).

`DEFAULT_TOP_BAR` (`src/top-bar/layout.tsx`) is:

- **left**: launcher button, tray, workspaces
- **middle**: clock
- **right**: binding mode (when not `default`), theme selector, volume,
  brightness, battery, notification bell

## Readability over the wallpaper

- Text is white with a tight dark shadow (`shadows.textOverPhoto`) in both
  themes, since the photo does not change with the theme.
- A gradient scrim (`gradients.scrimOverPhoto`) darkens the bar. It extends
  half the bar's height below the bar so the text sits in the darkest part.
  The overhang ignores the pointer.

## Workspaces

- Each bar lists the workspaces on its screen that have windows, plus the one
  the screen shows.
- Each is a number in a fixed-size circle. Hover draws an outline. The shown
  workspace is filled on the screen with the keyboard and outlined on other
  screens (sway's `focused_workspace` / `active_workspace`).

## Clock

- Reads like `Wednesday 2026-09-16 20:53:40` and ticks every second.
- Centered on the bar, so it does not shift as other items change.
- A fixed English day and ISO date keep the width stable.

## Battery

- A bolt when on AC, a meter filled to the level, and the percentage.
- At 10% or less it turns `danger`. At 5% or less it also flashes
  (`chargeFlashing`). Both thresholds use the displayed percentage. Neither
  applies on AC.
- Hidden on machines without a battery.
- The compositor reads the battery. See [Host readouts](HOST-READOUTS.md#battery).

## Brightness

- A sun icon: dotted, rayed or filled by level. Hidden with no backlight.
- Click for a slider in a popover. Scroll over it to step by 5%.
- The level never goes to zero. See [Host readouts](HOST-READOUTS.md#brightness).
- The slider shows the level the compositor reports. During a drag it stays
  under the pointer.
- The popover closes on an outside click or focus loss, including a click in
  a `<webview>`.

## Volume

- A speaker icon with zero, one or two waves, or a cross when muted. Hidden
  with no sound server.
- Scroll over it to step the output by 5%. Click for the mixer:
  - Default output and default input, each with mute, slider, level meter and
    port, a quiet `Select` after its name. These are the server's defaults;
    with no default, the first output and the first input that isn't a
    monitor.
  - Drawers, shown when non-empty: **More outputs**, **More inputs**, **Apps**
    (per-app streams) and **Cards** (profiles).
  - Names wrap instead of truncating. `Select` lists stay over the panel.
  - A PipeWire filter's own stream (e.g. laptop speaker correction) isn't
    listed under Apps.
- Sliders stop at 100%. A device set higher elsewhere shows its value.
- Level meters run only while the mixer is open, for the devices it shows.
  They show -60 to 0 dB.
- See [Host readouts](HOST-READOUTS.md#volume) for how the compositor reads
  audio.
- A locked desktop rejects mixer requests and meters.

## Notifications

- Toasts stack in the top-right corner under the bar and fan out on hover.
- Clicking a toast runs its action. The close button or a right swipe
  dismisses it.
- Critical toasts stay up and have a red ring.
- No toasts show while locked.
- The bell shows the count since it was last opened. It opens a drawer of
  every uncleared notification, where you can open, clear or clear all.
- The compositor keeps the history, so it survives a reload. See
  [NOTIFICATIONS.md](../../../docs/architecture/NOTIFICATIONS.md).

## Tray

One row of icons: each app's StatusNotifierItem, and each configured
extension with an action. See
[SYSTEM-TRAY.md](../../../docs/architecture/SYSTEM-TRAY.md).

- **Drag to reorder.** The order is saved in `localStorage` (`tray-order:v1`)
  and shared by every screen. Extensions are keyed by id, apps by title. New
  icons go last, apps first.
- **App icons**: click sends `Activate`, middle-click `SecondaryActivate`,
  right-click `ContextMenu`.
- **Extension icons**: every click calls `activateExtension(id)`, giving the
  extension `activeTab` on the focused browser window.
  - With a popup, the click opens the popup in a `<webview>` panel under the
    icon. An outside click or the popup's `window.close()` closes it.
    Escape closes it only if focus is on the shell, not inside the popup.
  - Without a popup, the click fires `action.onClicked`.
  - Disabled actions are hidden. Action state follows the focused browser
    window. See [EXTENSIONS.md](../../../docs/architecture/EXTENSIONS.md).
