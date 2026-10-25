# @domicile-desktop/app-history

The History app: an app module, `history.js`, that replaces the blocked
`chrome://history`. See [HISTORY.md](/docs/HISTORY.md) and
[APP-MODULES.md](/docs/architecture/APP-MODULES.md).

```sh
domicile open --app .vite/app/history.js
```

- Spawns `domicile-app-host` (`domicile_launch::app_host`) and speaks length-prefixed JSON with it over
  stdin and stdout.
- Lists visits newest first under day headers, one row per page per day,
  150 pages at a time with infinite scroll.
- Search (`/` or Ctrl+F), row menus, check boxes with Shift ranges, keyboard
  navigation, "Clear browsing data" and per-site cookie clearing.
- Reloads the rows on screen when the window regains focus or is shown, and
  after its own removals. The host sends no events.
- Follows `prefers-color-scheme` and `prefers-reduced-motion`, which Domicile
  sets from the desktop.

## Removing a row

A row is one page's visits on one day. Removing it removes every visit to
that page on that day, as Chrome does, including visits on pages of the list
not loaded yet:

- The host's `visits` gives the page's visits on the row's day.
- The host's `delete_history` removes those visits and no others.

## Layout

| Path | What |
|---|---|
| `src/index.tsx` | `main(root, host)`, the module's entry. |
| `src/host.ts` | The app host process, every reply parsed with Zod. |
| `src/browser.ts` | What the app does outside the page, over the host and the clipboard. |
| `src/history-page.ts` | Paging the host's `history` + `visits` into rows. |
| `src/useHistory.ts` | Loads, pages, reloads and removes rows. |
| `src/App.tsx` | The page and its dialogs. |
| `icons/` | The app icon and the launcher preview. |

## Build and test

```sh
bun run turbo build:vite --filter @domicile-desktop/app-history
bun run turbo test --filter @domicile-desktop/app-history
```

The build is the module and its source map, in `.vite/app/`.
