# @domicile-desktop/app-history

The History app: an unpacked MV3 Chrome extension whose page,
`history.html`, replaces the blocked `chrome://history`.

- Lists visits newest first under day headers, one row per page per day,
  150 pages at a time with infinite scroll.
- Search (`/` or Ctrl+F), row menus, check boxes with Shift ranges, keyboard
  navigation, "Clear browsing data", and live updates from
  `chrome.history.onVisited` / `onVisitRemoved`.
- Follows `prefers-color-scheme` and `prefers-reduced-motion`, which Domicile
  sets from the desktop.

The manifest's `key` pins the id, so
`domicile open-url chrome-extension://dimbckmbklbplcobppahmnepgiponamj/history.html`
opens it.

## Removing a row

A row is one page's visits on one day. Removing it removes every visit to
that page on that day, as Chrome does, including visits on pages of the list
not loaded yet:

- `chrome.history.getVisits` gives the page's visits on the row's day.
- `chrome.history.deleteRange` runs once per visit, over the 4 µs around it.
  The range is wider than the visit because the API rounds microsecond times
  through fractional milliseconds.
- `deleteUrl` is not used: it removes every day's visits.

## Layout

| Path | What |
|---|---|
| `src/browser.ts` | The `chrome.*` calls, every answer parsed with Zod. |
| `src/history-page.ts` | Paging `history.search` + `getVisits` into rows. |
| `src/useHistory.ts` | Loads, pages, reloads and removes rows. |
| `src/App.tsx` | The page and its dialogs. |
| `public/manifest.json` | The extension manifest. |
| `icons/` | The app icon and the launcher preview. |

## Build and test

```sh
bun run turbo build:vite --filter @domicile-desktop/app-history
bun run turbo test --filter @domicile-desktop/app-history
```

The build is the whole extension, in `.vite/extension/`. The flake copies it
to `libexec/domicile/apps/history`.
