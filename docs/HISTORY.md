# History

Every desktop has a History app: Chrome's history page for browser windows.
`domicile-history`, or **History** in the launcher, opens it in an app window.
It is an app module ([APP-MODULES.md](architecture/APP-MODULES.md)), not an
extension.

- Lists visits by day, newest first, with search, "More from this site",
  removing entries and **Clear browsing data** (history, cookies, cached files
  and more, over a time range).
- Clicking a row opens its page in a new window, which the shell places beside
  History, in its group.
- A row's **Clear cookies for this site** removes the cookies and site
  storage of the row's origin.
- Source and design: [`packages/app-history`](/packages/app-history/README.md).

## How it works

```
History page ─ spawn, stdio ─▶ domicile-app-host ─ DOMICILE_SOCK ─▶ domicile ─ command socket ─▶ engine
 (app module)                                         history,                       history,
                                                      visits,                        visits,
                                                      delete_history,                delete_history,
                                                      clear_browsing_data            clear_browsing_data
```

| Part | Where |
|---|---|
| Visits and their favicons go into the profile's history | `AttachTabHelpers` gives every tab guest a `HistoryTabHelper` and a favicon driver (`chrome/browser/domicile/domicile_tab_helpers.cc`). An app window gets `AttachAppTabHelpers`, which leaves out the `HistoryTabHelper`. Patch 0106 lets the helper record a guest, which is in no `Browser`. |
| The app | `history.js`, an app module in `libexec/domicile/app-modules/history`. `DOMICILE_APP_MODULES` names another directory of app modules. |
| The host | `domicile-app-host`, which Settings also spawns ([SETTINGS.md](SETTINGS.md#how-it-works)). Protocol: `domicile_launch::app_host`. |
| Listing and searching | The engine's `history` command: the pages matching a search, last visited before a time, each with its favicon as a `data:` URL. `visits` gives the times a page was visited. |
| Removing entries | The engine's `delete_history` command deletes visits by their times. |
| Clearing browsing data | The engine's `clear_browsing_data` command clears the named data types since a time, for the named origins or every origin. |
| Opening it | `domicile-history` runs `domicile open --app` on `history.js`. |

Times are milliseconds since the epoch, fractional, on every hop.

## Key decisions

- **An app module over a `chrome://history` page.** `HistoryUI` crashes a
  `<webview>` (patch 0083). The engine's commands give the app what the
  history page reads and deletes.
- **Favicons as `data:` URLs.** An app page cannot load `chrome://favicon2`.
- **Private browser windows record nothing**, as in Chrome: they are in the
  off-the-record profile, which has no history.
- **App windows record nothing.** An app ([WEB-APPS.md](architecture/WEB-APPS.md))
  is not browsing, so Settings, History and every `domicile open --app` window
  stay out of the history.
- **Extension pages are hidden.** Chrome records `chrome-extension://` URLs,
  and the shell's window records `domicile://shell/`. The app hides every
  `chrome-extension://` and `domicile://` page from the list.

## Launcher entries

`share/applications` holds Domicile's own entries, which launchers list:

| Entry | Runs |
|---|---|
| `domicile-history.desktop` | `domicile-history` |
| `domicile-settings.desktop` | `domicile-settings` ([SETTINGS.md](SETTINGS.md)) |
| `domicile-screenshot.desktop` | `domicile screenshot` |
| `domicile-screen-record.desktop` | `domicile screen-record` ([PORTALS.md](PORTALS.md#screen-recording)) |
| `domicile-shutdown.desktop` | `domicile power-off`: `systemctl poweroff` after a yes in Domicile's Access dialog |
| `domicile-reboot.desktop` | `domicile reboot`: `systemctl reboot` after the same |
| `domicile-logout.desktop` | `domicile log-out`: `loginctl terminate-session` after the same |

Each names an SVG icon and an `X-Domicile-Preview` picture
([LAUNCHER.md](LAUNCHER.md)).
