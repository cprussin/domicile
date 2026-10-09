# History

Every desktop has a History app: Chrome's history page for browser windows.
`domicile-history`, or **History** in the launcher, opens it in a browser
window.

- Lists visits by day, newest first, with search, "More from this site",
  removing entries and **Clear browsing data** (history, cookies, cached files
  and more, over a time range).
- Source and design: [`packages/app-history`](/packages/app-history/README.md).

## How it works

| Part | Where |
|---|---|
| Visits and their favicons go into the profile's history | `AttachTabHelpers` gives every tab guest a `HistoryTabHelper` and a favicon driver (`chrome/browser/domicile/domicile_tab_helpers.cc`). Patch 0104 lets the helper record a guest, which is in no `Browser`. |
| The app | An unpacked MV3 extension with the `history`, `browsingData` and `favicon` permissions. Its manifest `key` fixes its id, `dimbckmbklbplcobppahmnepgiponamj`. |
| Installing it | The flake puts it in `libexec/domicile/apps/history`. `domicile` passes `--apps` to the compositor, which adds each directory there to the config's `extensions.unpacked` (`domicile_launch::apps`). `DOMICILE_APPS` names another directory. |
| Opening it | `domicile-history` runs `domicile open-url chrome-extension://dimbckmbklbplcobppahmnepgiponamj/history.html`. |
| The tray | The app's manifest names no action, so the tray leaves it out. See [EXTENSIONS.md](architecture/EXTENSIONS.md#the-tray). |

## Key decisions

- **An extension over a `chrome://history` page.** `HistoryUI` crashes a
  `<webview>` (patch 0083). `chrome.history` and `chrome.browsingData` give an
  extension page everything the history page does.
- **Private browser windows record nothing**, as in Chrome: they are in the
  off-the-record profile, which has no history.
- **Extension pages are visits too.** Chrome records `chrome-extension://`
  URLs. The app hides its own page from the list.

## Launcher entries

`share/applications` holds Domicile's own entries, which launchers list:

| Entry | Runs |
|---|---|
| `domicile-history.desktop` | `domicile-history` |
| `domicile-screenshot.desktop` | `domicile screenshot` |
| `domicile-shutdown.desktop` | `systemctl poweroff`, after a yes in Domicile's Access dialog |
| `domicile-reboot.desktop` | `systemctl reboot`, after the same |

Each names an SVG icon and an `X-Domicile-Preview` picture
([LAUNCHER.md](LAUNCHER.md)).
