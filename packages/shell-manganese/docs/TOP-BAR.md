# The top bar

A transparent bar across the top of every screen. Windows tile in the space
below it.

## Layout

`runManganese({ bar })` takes three columns of React nodes: `left`, `center`
(centered on the screen) and `right`. Mix manganese's items with your own.
Each of manganese's items is its own package, takes no props, and is that
package's default export path:

| Item | Package |
|---|---|
| `LauncherButton` | `@domicile-desktop/manganese-bar-module-launcher-button` |
| `Tray` | `@domicile-desktop/manganese-bar-module-tray` |
| `WorkspaceSwitcher` | `@domicile-desktop/manganese-bar-module-workspace-switcher` |
| `Clock` | `@domicile-desktop/manganese-bar-module-clock` |
| `ThemeSwitch` | `@domicile-desktop/manganese-bar-module-theme-switch` |
| `IdleInhibitor` | `@domicile-desktop/manganese-bar-module-idle-inhibitor` |
| `Network` | `@domicile-desktop/manganese-bar-module-network` |
| `Bluetooth` | `@domicile-desktop/manganese-bar-module-bluetooth` |
| `Volume` | `@domicile-desktop/manganese-bar-module-volume` |
| `Brightness` | `@domicile-desktop/manganese-bar-module-brightness` |
| `Battery` | `@domicile-desktop/manganese-bar-module-battery` |
| `Notifications` | `@domicile-desktop/manganese-bar-module-notifications` |
| `Sharing` | `@domicile-desktop/manganese-bar-module-sharing` |
| `Cast` | `@domicile-desktop/manganese-bar-module-cast` |

Items no default bar has:

| Item | Package |
|---|---|
| `Mode` | `@domicile-desktop/manganese-bar-module-mode` |
| `Gmail` | `@domicile-desktop/manganese-bar-module-gmail` |
| `GoogleMessages` | `@domicile-desktop/manganese-bar-module-google-messages` |

```tsx
import { runManganese } from "@domicile-desktop/manganese";
import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
import { Tray } from "@domicile-desktop/manganese-bar-module-tray";
import { WorkspaceSwitcher } from "@domicile-desktop/manganese-bar-module-workspace-switcher";

export const Shell = runManganese({
  bar: {
    left: [<Tray key="tray" />, <WorkspaceSwitcher key="workspaces" />],
    center: [<Clock key="clock" />],
    right: [<MailCount key="mail" />],
  },
});
```

Each item reads what it shows from context:

- `useBar()` (`@domicile-desktop/manganese-bar/bar-context`): the bar's
  `screen` and whether the desktop is `locked`.
- `useDomicile()` (`@domicile-desktop/manganese-host/domicile-context`): the
  desktop. Readouts are watched once per desktop
  ([Host readouts](HOST-READOUTS.md#one-watch-per-desk)).
- The launcher, notification drawer, tray and workspaces each have a context
  the desktop provides: `useLauncher()`, `useNotificationsDrawer()`,
  `useTrayState()`, `useWorkspaces()`.

To style your own items with manganese's Panda CSS, see
[CUSTOM-BAR-ITEMS.md](CUSTOM-BAR-ITEMS.md).

Every bar and the lock screen share one watch per system readout. See
[Host readouts](HOST-READOUTS.md#one-watch-per-desk).

`DEFAULT_BAR` (`src/default-bars.tsx`, exported by
`@domicile-desktop/manganese`) is:

- **left**: launcher button, tray, workspaces
- **center**: clock
- **right**: sharing indicator (while recorded), Cast (while a TV is near or
  cast to), theme selector, idle
  inhibitor, brightness, volume, Bluetooth, network, battery, notification
  bell

## On the lock screen

- The lock screen draws the same bar on every screen, with only brightness,
  volume, Bluetooth and battery (`LOCK_BAR`, `src/default-bars.tsx`). The
  `bar` option does not change it.
- Each item offers only what a locked desktop allows
  ([LOCK.md](../../../docs/LOCK.md#lock-screen-readouts)):
  - Bluetooth: the icon, named as on the desktop; not a button.
  - Volume: the default output's slider and mute; no mixer.
  - Brightness and battery: as on the desktop.
- Panels draw over the lock screen and keep the keyboard until they close.
  Then it goes back to the passphrase.

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
- The shell options `clock.format` (`24h` or `12h`) and `clock.seconds` change
  that, e.g. `Wednesday 2026-09-16 08:53 PM`. See the
  [README](../README.md#configure).
- Centered on the bar, so it does not shift as other items change.
- A fixed English day and ISO date keep the width stable.

## Hardware

- An item for hardware hides only when the machine has none. Each looks in
  `/sys` every 10 seconds (`watchPresence`,
  `@domicile-desktop/manganese-host/watch-presence`), which works while
  locked.
- The theme selector, idle inhibitor and notification bell always show.

## Network

- The primary connection from NetworkManager, iwd or wpa_supplicant, whichever
  is on the system bus first in that order
  ([`@domicile-desktop/system-network`](../../system-network/README.md)).
  iwd and wpa_supplicant report Wi-Fi only.
- The hardware from `/sys/class/net`: interfaces with a `device`, wired or
  Wi-Fi. A wired port with a cable in counts as a wired link when the service
  reports none, as iwd and wpa_supplicant never do.
- An icon only. Wi-Fi: a signal icon graded strong, fair or weak by thirds.
  Wired, or any other kind such as a VPN: a network icon. No connection: a
  crossed-out Wi-Fi icon.
- Hover for the kind and the SSID or VPN name, e.g.
  `Wi-Fi, strong signal: Home`, and `; Wired` when a cable is in beside it.
- Dims with no connection. Turns `warning` when NetworkManager reports limited
  connectivity or a captive portal, or when the service fails
  (`Network unavailable: …`).
- On joining a network, the desk checks for a captive portal and shows its
  sign-in page in a dialog on the screen with the keyboard. The check asks
  `curl` for `http://www.gstatic.com/generate_204`, so it works with iwd and
  wpa_supplicant too. Any answer but `204` is a portal.
  - While the dialog shows, the check repeats every 3 seconds. The dialog
    closes once the probe answers `204`, or on leaving the network.
  - Closing it by hand stops the checks until the next network.
- Hidden only on a machine with no network hardware.
- The compositor refuses the service's calls while locked, so the watches
  start again on unlock.
- Click for the panel:
  - Each wired port: connected or no cable, speed, addresses, gateway,
    interface and hardware address. Addresses come from `ip -j` while the
    panel is open.
  - The Wi-Fi panel, from NetworkManager or iwd. With wpa_supplicant alone it
    says there is no Wi-Fi device.
    - A switch turns the radio on or off.
    - Opening it scans. The arrow scans again.
    - The connection: signal, frequency, speed, addresses, gateway, DNS,
      interface and hardware address, and **Disconnect**. iwd reports no
      addresses.
    - The other networks, strongest first, marked saved and secured. A click
      joins a saved or open network. A new secured one asks for its
      passphrase.
    - A refusal shows under what was asked.
    - Wi-Fi is read only while the panel is open.

## Bluetooth

- From BlueZ ([`@domicile-desktop/system-bluetooth`](../../system-bluetooth/README.md)).
- An icon for off, on, or on with a device connected. Dims while off. Its name
  and tooltip list the connected devices, each with its battery, e.g.
  `Bluetooth: WH-1000XM4 (80%)`.
- Click for the Bluetooth panel:
  - A switch turns every adapter on or off.
  - While open with an adapter on, it scans for devices.
  - Devices: connected, then paired, then new. Each shows its state, battery
    and address, and **Disconnect**, **Connect** or **Pair** (pair, then
    connect). Paired devices have a forget button.
  - Pairing registers no agent, so a device that asks for a code does not
    pair.
  - A refusal, such as an rfkill block, shows under what was asked.
- Hidden only without Bluetooth hardware: a controller or an rfkill switch
  for one in `/sys`. With hardware and no adapter from BlueZ it is the icon
  alone: `Bluetooth off` (such as an rfkill block), or
  `Bluetooth unavailable: …` in `warning` when BlueZ fails.

## Battery

- A meter filled to the level, with a bolt in it when on AC, and the
  percentage.
- Always as wide as `100%`.
- At 10% or less it turns `danger`. At 5% or less it also flashes
  (`chargeFlashing`). Both thresholds use the displayed percentage. Neither
  applies on AC.
- Hidden only on machines without a battery in `/sys/class/power_supply`
  (a peripheral's, scope `Device`, does not count). Until UPower reports it,
  a dimmed empty outline, `Battery unavailable`.
- Read from UPower by
  [`@domicile-desktop/system-battery`](../../system-battery/README.md).

## Idle inhibitor

- An eye: closed and dimmed while the screens blank and lock on idle, open on a
  lit circle while they are kept on. Click to toggle.
- Every bar shows the same inhibitor. It is disabled until the portal answers.
- Held through the Inhibit portal's idle flag, since the shell has no Wayland
  surface ([IDLE.md](../../../docs/IDLE.md#idle-inhibitors)).
- A shell reload lets go of it, and the eye starts closed.
- Not on the lock screen.

## Brightness

- A light bulb icon: empty, lit filament or filled by level.
- Hidden only with no backlight in `/sys/class/backlight`. Until there is a
  level, a dimmed bulb, `Brightness unavailable`.
- Click for a slider in a popover. Scroll over it to step by 5%.
- The level never goes to zero. See [Host readouts](HOST-READOUTS.md#brightness).
- The slider shows the level `/sys` reports. During a drag it stays under the
  pointer.
- The popover closes on an outside click or focus loss, including a click in
  a `<webview>`.

## Volume

- A speaker icon with zero, one (under 50%) or two waves, or slashed when
  muted. Dims while muted.
- Hidden only with no sound card in `/sys/class/sound`. With one and no sound
  server, a dimmed slashed speaker, `Sound unavailable`.
- Scroll over it to step the output by 5%. Middle-click to mute or unmute it.
  Click for the mixer:
  - Default output and default input, each with mute, slider, level meter and
    port, a quiet `Select` after its name. These are the server's defaults;
    with no default, the first output and the first input that isn't a
    monitor.
  - Drawers, shown when non-empty: **More outputs**, **More inputs**, **Apps**
    (per-app streams) and **Cards** (profiles).
  - A muted device's or stream's row is gray.
  - Names wrap instead of truncating. `Select` lists stay over the panel.
  - A PipeWire filter's own stream (e.g. laptop speaker correction) isn't
    listed under Apps.
- Sliders stop at 100%. A device set higher elsewhere shows its value.
- Level meters run only while the mixer is open, for the devices it shows.
  They show -60 to 0 dB.
- See [Host readouts](HOST-READOUTS.md#volume) for how audio is read.

## Notifications

- Toasts stack in the top-right corner of the screen with the keyboard,
  under its bar, and fan out on hover.
- Clicking a toast runs its action. The close button or a right swipe
  dismisses it.
- A notification that offers a reply has a reply field, in its toast and in
  the drawer.
- Critical toasts stay up and have a red ring.
- No toasts show while locked.
- The bell shows the count since it was last opened. It opens a drawer of
  every uncleared notification, where you can open, clear or clear all.
- The compositor keeps the history, so it survives a reload. See
  [NOTIFICATIONS.md](../../../docs/architecture/NOTIFICATIONS.md).

## Sharing

- Shown, in the warning color, while an application records the desktop
  through the ScreenCast portal. Its name says who.
- Click lists each recording application, by its desktop entry's name and
  icon, and what it records (a window's title, "Screen drm-1" or "Region"),
  with a
  **Stop sharing** button that ends that application's session.
- While the bar has this item, the portal dialogs' indicator leaves screen
  casts out, so each shows once. Without it, the indicator lists them.
- See [PORTALS.md](../../../docs/PORTALS.md).

## Gmail

`<Gmail client={{ id, secret }} email="me@gmail.com" nickname="Work" />`:
one account's inbox, read with the Gmail API. Not in `DEFAULT_BAR`.

- **Signed out:** a **Sign in to me@gmail.com** button opens Google's consent
  page in a browser window. Once the user agrees, the window closes and the
  count shows.
- **Empty inbox:** nothing.
- **Nothing unread:** an envelope, the nickname and the conversation count.
- **Unread:** the same with `unread / total`, the count semibold, on the lit
  pill the idle inhibitor shows when on.
- **Failed read:** the envelope, the nickname and a warning. Its tooltip
  says why.
- Click opens the inbox in a browser window.
- Read every 30 seconds, and 1 and 5 seconds after a Gmail browser window
  opens, closes, navigates or changes title. Not read while the desktop is
  locked. Counts are conversations, as Gmail's inbox counts them.
- How it reads:
  - `client` is a Google Cloud OAuth client of the Desktop app type, with the
    Gmail API on and the `gmail.labels` scope. Publish its consent screen:
    one in Testing expires sign-ins after 7 days.
  - Sign-in is Google's desktop flow. Consent redirects the window to a
    loopback address nothing listens on; the item reads the code from the
    window's address, closes it, and trades the code for a refresh token.
  - The refresh token is in `localStorage`, per account. One Google revokes
    signs the account out.
  - Each read asks `labels.get INBOX` for `threadsTotal` and
    `threadsUnread`, with an access token kept until it expires.
  - Requests go through `fetchWithCookies`
    ([SHELL-SYSTEM-ACCESS.md](../../../docs/SHELL-SYSTEM-ACCESS.md#the-browsers-cookies)).

## Google Messages

`<GoogleMessages />`: [Google Messages for web](https://messages.google.com/web/)
in a panel. Not in `DEFAULT_BAR`.

- A chat bubble. With unread conversations, it is lit with their count, as
  the Gmail item is for unread mail. The count is read from the page every 5
  seconds: conversations Messages marks unread, leaving out muted ones.
- Click opens the page in a panel under it. The panel keeps the keyboard while
  open.
- Pressing one of Messages' notifications opens the panel.
- The page's permission requests are asked above it. Allow notifications to
  get them.
- How it keeps the page:
  - The page loads with the shell and keeps running while the panel is
    closed, hidden like a background tab
    ([SHELL-BROWSER-WINDOWS.md](../../../docs/SHELL-BROWSER-WINDOWS.md#basics)).
    So its notifications keep coming and its count stays current.
  - The user's own storage, so the pairing lasts. Pair it once in the panel.
    A partition would get no notifications: Chromium denies them to a page in
    one.
  - One page for the desk: the first bar showing the item draws it, and every
    bar's item opens it. Messages runs one web session at a time. When that
    bar goes, the next one loads the page again.
  - A shell reload loads the page again.
- File pickers are not offered, so attachments cannot be sent from it.

## Tray

One row of icons: each app's StatusNotifierItem, and each configured
extension with an action. See
[SYSTEM-TRAY.md](../../../docs/architecture/SYSTEM-TRAY.md).

- **Drag to reorder.** The order is saved in `localStorage` (`tray-order:v1`)
  and shared by every screen. Extensions are keyed by id, apps by title. New
  icons go last, apps first.
- **App icons**: click sends `Activate`, middle-click `SecondaryActivate`.
  - Right-click opens the app's dbusmenu under the icon: submenus, check
    boxes and radio items; disabled entries are grayed and hidden ones left
    out. Choosing an entry sends it to the app and closes the menu. A menu
    that cannot be read shows "Menu unavailable".
  - An app without a dbusmenu gets `ContextMenu` on right-click instead.
  - An app that is only a menu (`ItemIsMenu`) gets the right-click
    behavior on click too.
  - Entries show their icon: the icon theme's for its name, else the app's
    own picture. Symbolic icons take the text's color. See
    [SHELL-CONFIG.md](/docs/SHELL-CONFIG.md#theme).
  - Each entry's mnemonic is underlined. Pressing that letter chooses the
    entry, or opens its submenu. Other letters highlight the next entry
    starting with them.
- **Extension icons**: every click calls `activateExtension(id)`, giving the
  extension `activeTab` on the focused browser window.
  - With a popup, the click opens the popup in a `<webview>` panel under the
    icon. An outside click or the popup's `window.close()` closes it.
    Escape closes it only if focus is on the shell, not inside the popup.
  - Without a popup, the click fires `action.onClicked`.
  - Disabled actions are hidden. Action state follows the focused browser
    window. See [EXTENSIONS.md](../../../docs/architecture/EXTENSIONS.md).
